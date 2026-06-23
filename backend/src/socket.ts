import { Server, Socket } from 'socket.io'
import { parse as parseCookie } from 'cookie'
import {
  getOrCreateRoom,
  addParticipant,
  removeParticipant,
  updateFileContent,
  applyFilePatch,
  createFile,
  deleteFile,
  getRoomFiles,
  removeRoom,
} from './rooms'
import { executeCode } from './executor'
import { dbRoomExists, dbAddRoomMember, dbCreateRoom, dbGetUserById, dbSetRoomName, dbGetRoom, dbGetMemberRole, dbSetMemberRole, dbGetRoomMembers, dbRemoveMember, dbRenameFile, dbMoveFile, dbSaveChatMessage, dbGetChatMessages, type RoomRole } from './db'
import { verifySessionToken, SESSION_COOKIE_NAME } from './auth'
import bcrypt from 'bcryptjs'
import { createLogger } from './logger'
import { checkRateLimit } from './rateLimiter'
import { safeOn } from './safeHandler'
import { LIMITS, isString, isNonEmptyString, isBoundedString, isValidId, isNonNegativeInt, isFileKind } from './validation'


const log = createLogger('SOCKET')

let ioInstance: Server | null = null

const userRoomSockets = new Map<string, Set<Socket>>()

function userRoomKey(roomId: string, userId: string) {
  return `${roomId}:${userId}`
}

function trackUserSocket(roomId: string, userId: string, socket: Socket) {
  const key = userRoomKey(roomId, userId)
  if (!userRoomSockets.has(key)) userRoomSockets.set(key, new Set())
  userRoomSockets.get(key)!.add(socket)
}

function untrackUserSocket(roomId: string, userId: string, socket: Socket) {
  const key = userRoomKey(roomId, userId)
  const set = userRoomSockets.get(key)
  if (!set) return
  set.delete(socket)
  if (set.size === 0) userRoomSockets.delete(key)
}

function getUserSockets(roomId: string, userId: string): Socket[] {
  return Array.from(userRoomSockets.get(userRoomKey(roomId, userId)) ?? [])
}


function getRole(socket: Socket): RoomRole {
  return (socket.data?.role as RoomRole | undefined) ?? 'viewer'
}

function setRole(socket: Socket, role: RoomRole) {
  socket.data.role = role
}

export function notifyRoomDeleted(roomId: string) {
  ioInstance?.to(roomId).emit('room-deleted', { roomId })
  ioInstance?.in(roomId).socketsLeave(roomId)
  removeRoom(roomId)
}

// Chiamata dalla route REST /auth/rooms/:id/leave: se l'utente ha la room
// aperta in una o più tab/finestre in questo momento, le disconnette da
// quella room — stesso comportamento di un kick, per evitare che resti
// "dentro" una room di cui non è più membro lato DB.
export function notifyUserLeftRoom(roomId: string, userId: string) {
  for (const targetSocket of getUserSockets(roomId, userId)) {
    targetSocket.disconnect(true)
  }
}

// Called on logout or account deletion: immediately disconnects every socket
// the user has open across all rooms so a revoked session can't keep editing.
export function disconnectAllUserSockets(userId: string) {
  const suffix = `:${userId}`
  for (const [key, sockets] of userRoomSockets.entries()) {
    if (!key.endsWith(suffix)) continue
    for (const s of sockets) {
      s.emit('session-expired')
      s.disconnect(true)
    }
  }
}

// pending knock: socket id → { userId, userName }
// Shared across ALL connections (module scope) so that the owner's
// approve-knock/deny-knock handler — which runs on a *different* socket
// than the one that knocked — can actually find the pending entry.
const pendingKnocks = new Map<string, { userId: string | null; userName: string }>()

export function registerSocketHandlers(io: Server) {
  ioInstance = io
  io.on('connection', (socket: Socket) => {
    let currentRoom: string | null = null
    let currentUser: string = 'Anonymous'
    let currentUserEmail: string = 'unknown'
    let currentUserId: string | null = null
    let currentAvatar: string | null = null

    function admitUser(roomId: string, admittedSocket: Socket, admittedUserId: string | null, admittedName: string, admittedEmail: string, admittedAvatar?: string | null) {
      admittedSocket.join(roomId)

      let role: RoomRole = 'viewer'
      if (admittedUserId) {
        const existingRole = dbGetMemberRole(admittedUserId, roomId)
        if (!existingRole) {
          dbAddRoomMember(admittedUserId, roomId, 'viewer')
        } else {
          dbAddRoomMember(admittedUserId, roomId, existingRole)
        }
        role = existingRole ?? 'viewer'
        setRole(admittedSocket, role)
        trackUserSocket(roomId, admittedUserId, admittedSocket)
      }

      const participant = addParticipant(roomId, admittedSocket.id, admittedName, admittedUserId ?? undefined, role, admittedAvatar)
      const room = getOrCreateRoom(roomId)
      const roomRow = dbGetRoom(roomId)

      const otherParticipants = Array.from(room.participants.entries())
        .filter(([id]) => id !== admittedSocket.id)
        .map(([id, p]) => ({ id, name: p.name, color: p.color, dbUserId: p.userId, dbRole: p.role, avatar: p.avatar ?? null }))

      admittedSocket.emit('room-state', {
        files: getRoomFiles(roomId),
        participants: otherParticipants,
        roomName: roomRow?.name ?? null,
        role,
        chatHistory: dbGetChatMessages(roomId),
        hasPassword: !!roomRow?.password_hash,
      })

      admittedSocket.to(roomId).emit('participant-joined', {
        id: admittedSocket.id,
        name: participant.name,
        color: participant.color,
        dbUserId: participant.userId,
        dbRole: participant.role,
        avatar: participant.avatar ?? null,
      })

      log.info(`[ROOM] User admitted — user = ${admittedName} | email = ${admittedEmail} | role = ${role} | room = ${roomId}`)
    }

    // Legge il token di sessione dal cookie httpOnly presente nell'header
    // Cookie della richiesta HTTP di handshake (mai da handshake.auth o dal
    // payload dell'evento: il cookie httpOnly non è leggibile né forgiabile
    // da JS lato client, a differenza di un valore passato a mano).
    const cookieHeader = socket.handshake.headers.cookie
    let handshakeToken: string | undefined
    if (cookieHeader) {
      try {
        handshakeToken = parseCookie(cookieHeader)[SESSION_COOKIE_NAME]
      } catch {
        handshakeToken = undefined
      }
    }

    safeOn(socket, 'join-room', async ({
      roomId,
      userName,
      isNew,
      roomName,
      password,
    }: {
      roomId: string
      userName: string
      isNew?: boolean
      roomName?: string
      password?: string
    }) => {
      if (!checkRateLimit(socket, 'join-room')) return
      if (!isValidId(roomId)) return
      currentRoom = roomId
      currentUser = isNonEmptyString(userName, LIMITS.USER_NAME) ? userName : 'Anonymous'

      // Verify session token read from the httpOnly cookie
      if (handshakeToken) {
        const payload = verifySessionToken(handshakeToken)
        if (payload) {
          currentUserId = payload.userId
          const dbUser = dbGetUserById(payload.userId)
          if (dbUser) {
            currentUser = dbUser.name
            currentUserEmail = dbUser.email
            currentAvatar = dbUser.avatar ?? null
          }
        }
      }

      if (!isNew && !dbRoomExists(roomId)) {
        socket.emit('room-not-found', { roomId })
        return
      }

      if (isNew) {
        if (!currentUserId) {
          socket.emit('error', { message: 'Login required to create a room' })
          return
        }
        // Creator: create room and admit directly as owner
        dbCreateRoom(roomId, currentUserId, isString(roomName) ? roomName : undefined)
        socket.join(roomId)

        let role: RoomRole = 'viewer'
        if (currentUserId) {
          dbAddRoomMember(currentUserId, roomId, 'owner')
          role = 'owner'
          setRole(socket, role)
          trackUserSocket(roomId, currentUserId, socket)
        }

        const participant = addParticipant(roomId, socket.id, currentUser, currentUserId ?? undefined, role, currentAvatar)
        const room = getOrCreateRoom(roomId)
        const roomRow = dbGetRoom(roomId)

        socket.emit('room-state', {
          files: getRoomFiles(roomId),
          participants: [],
          roomName: roomRow?.name ?? null,
          role,
          chatHistory: dbGetChatMessages(roomId),
          hasPassword: false,
        })

        log.info(`[ROOM] Room created — user = ${currentUser} | email = ${currentUserEmail} | role = ${role} | room = ${roomId}`)
        return
      }

      // Existing room: owner is always admitted directly.
      // Other members (editor/viewer) must still pass the password if the room is locked.
      // Unknown visitors must knock (or pass password if locked).
      const roomRow = dbGetRoom(roomId)

      if (currentUserId) {
        const existingRole = dbGetMemberRole(currentUserId, roomId)
        if (existingRole) {
          if (existingRole === 'owner') {
            // Owner always gets in — they set the password
            admitUser(roomId, socket, currentUserId, currentUser, currentUserEmail, currentAvatar)
            return
          }
          // Editor / viewer: must enter password if room is locked
          if (roomRow?.password_hash) {
            if (!password) {
              socket.emit('room-password-required')
              return
            }
            const valid = await bcrypt.compare(password, roomRow.password_hash)
            if (!valid) {
              socket.emit('room-wrong-password')
              return
            }
          }
          admitUser(roomId, socket, currentUserId, currentUser, currentUserEmail, currentAvatar)
          return
        }
      }

      // Unknown visitor — check if room is password-protected
      if (roomRow?.password_hash) {
        if (!password) {
          socket.emit('room-password-required')
          return
        }
        const valid = await bcrypt.compare(password, roomRow.password_hash)
        if (!valid) {
          socket.emit('room-wrong-password')
          return
        }
        // Correct password — admit directly as viewer
        log.info(`[ROOM] Password correct — user = ${currentUser} | room = ${roomId}`)
        admitUser(roomId, socket, currentUserId, currentUser, currentUserEmail, currentAvatar)
        return
      }

      // No password — send knock to all owners currently in the room
      pendingKnocks.set(socket.id, { userId: currentUserId, userName: currentUser })
      log.info(`[ROOM] Knock received — user = ${currentUser} | email = ${currentUserEmail} | room = ${roomId}`)

      const room = getOrCreateRoom(roomId)
      let notified = false
      for (const [sid, p] of room.participants.entries()) {
        if (p.role === 'owner') {
          const ownerSocket = getUserSockets(roomId, p.userId ?? '')[0]
          if (ownerSocket) {
            ownerSocket.emit('knock', { knockId: socket.id, userName: currentUser, avatar: currentAvatar })
            notified = true
          }
        }
      }

      if (!notified) {
        socket.emit('knock-denied')
        pendingKnocks.delete(socket.id)
        log.info(`[ROOM] Knock auto-denied (no owner online) — user = ${currentUser} | room = ${roomId}`)
      } else {
        socket.emit('knock-pending')
      }
    })

    // Owner approves a knock
    safeOn(socket, 'approve-knock', ({ knockId }: { knockId: string }) => {
      if (!checkRateLimit(socket, 'approve-knock')) return
      if (!isValidId(knockId)) return
      if (!currentRoom) return
      if (getRole(socket) !== 'owner') return

      const knock = pendingKnocks.get(knockId)
      if (!knock) return
      pendingKnocks.delete(knockId)

      const knockerSocket = io.sockets.sockets.get(knockId)
      if (!knockerSocket) return

      log.info(`[ROOM] Knock approved — user = ${knock.userName} | by = ${currentUser} | room = ${currentRoom}`)
      const knockerAvatar = knock.userId ? (dbGetUserById(knock.userId)?.avatar ?? null) : null
      admitUser(currentRoom, knockerSocket, knock.userId, knock.userName, '(approved)', knockerAvatar)
    })

    // Owner denies a knock
    safeOn(socket, 'deny-knock', ({ knockId }: { knockId: string }) => {
      if (!checkRateLimit(socket, 'deny-knock')) return
      if (!isValidId(knockId)) return
      if (!currentRoom) return
      if (getRole(socket) !== 'owner') return

      const knock = pendingKnocks.get(knockId)
      if (!knock) return
      pendingKnocks.delete(knockId)

      const knockerSocket = io.sockets.sockets.get(knockId)
      if (knockerSocket) {
        knockerSocket.emit('knock-denied')
      }
      log.info(`[ROOM] Knock denied — user = ${knock.userName} | by = ${currentUser} | room = ${currentRoom}`)
    })

    safeOn(socket, 'code-change', ({ fileId, content }: { fileId: string; content: string }) => {
      if (!checkRateLimit(socket, 'code-change')) return
      if (!isValidId(fileId)) return
      if (!isBoundedString(content, LIMITS.FILE_CONTENT)) return
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      if (!updateFileContent(currentRoom, fileId, content)) {
        log.warn(`[ROOM] code-change su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      // Broadcast to ALL clients including sender so every client's
      // lastSyncedContent converges to the authoritative server state,
      // preventing divergence when concurrent full-content writes race.
      io.to(currentRoom).emit('code-update', { fileId, content, fromSocketId: socket.id })
    })

    safeOn(socket, 'code-patch', ({ fileId, start, deleteCount, insert }: { fileId: string; start: number; deleteCount: number; insert: string }) => {
      if (!checkRateLimit(socket, 'code-patch')) return
      if (!isValidId(fileId)) return
      if (!isNonNegativeInt(start, LIMITS.FILE_CONTENT)) return
      if (!isNonNegativeInt(deleteCount, LIMITS.FILE_CONTENT)) return
      if (!isBoundedString(insert, LIMITS.PATCH_INSERT)) return
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      // Apply the patch on the server's authoritative state and broadcast the
      // resulting full content (not the raw patch). This prevents divergence
      // when two clients send concurrent patches computed on the same base: each
      // patch is applied sequentially on the server's up-to-date content, and
      // all other clients replace their local copy with the authoritative result
      // instead of trying to re-apply a stale delta.
      const updated = applyFilePatch(currentRoom, fileId, start, deleteCount, insert)
      if (updated === null) {
        log.warn(`[ROOM] code-patch su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      io.to(currentRoom).emit('code-update', { fileId, content: updated, fromSocketId: socket.id })
    })

    safeOn(socket, 'cursor-move', ({ fileId, line, column }: { fileId: string; line: number; column: number }) => {
      if (!checkRateLimit(socket, 'cursor-move')) return
      if (!isValidId(fileId)) return
      if (!isNonNegativeInt(line, LIMITS.CURSOR_POS)) return
      if (!isNonNegativeInt(column, LIMITS.CURSOR_POS)) return
      if (!currentRoom) return
      socket.to(currentRoom).emit('cursor-update', {
        userId: socket.id,
        fileId,
        line,
        column,
      })
    })

    safeOn(socket, 'create-file', ({ parentId, name, type, content }: { parentId: string | null; name: string; type: 'file' | 'folder'; content?: string }, callback?: (node: ReturnType<typeof createFile>) => void) => {
      const reject = () => { if (typeof callback === 'function') callback(undefined as unknown as ReturnType<typeof createFile>) }
      if (!checkRateLimit(socket, 'create-file')) { reject(); return }
      if (parentId !== null && !isValidId(parentId)) { reject(); return }
      if (!isNonEmptyString(name, LIMITS.FILE_NAME)) { reject(); return }
      if (!isFileKind(type)) { reject(); return }
      if (content !== undefined && !isBoundedString(content, LIMITS.FILE_CONTENT)) { reject(); return }
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      const node = createFile(currentRoom, parentId, name, type, content)
      log.info(`[ROOM] File created — file = ${name} | user = ${currentUser} |  email = ${currentUserEmail} | room = ${currentRoom}`)
      if (typeof callback === 'function') callback(node)
      io.to(currentRoom).emit('file-created', { node, parentId: node.parentId })
    })

    safeOn(socket, 'import-zip', (
      { entries }: { entries: { tempId: string; parentTempId: string | null; name: string; type: 'file' | 'folder'; content?: string }[] },
      callback?: (idMap: Record<string, string>) => void,
    ) => {
      const reject = () => { if (typeof callback === 'function') callback({}) }
      if (!checkRateLimit(socket, 'import-zip')) { reject(); return }
      if (!Array.isArray(entries) || entries.length === 0 || entries.length > LIMITS.IMPORT_ENTRIES) { reject(); return }
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      const idMap: Record<string, string> = {}
      const createdNodes: ReturnType<typeof createFile>[] = []
      let totalContentSize = 0

      for (const entry of entries as unknown[]) {
        if (typeof entry !== 'object' || entry === null) continue
        const { tempId, parentTempId, name, type, content } = entry as Record<string, unknown>

        if (!isValidId(tempId)) continue
        if (parentTempId !== null && parentTempId !== undefined && !isValidId(parentTempId)) continue
        if (!isNonEmptyString(name, LIMITS.FILE_NAME)) continue
        if (!isFileKind(type)) continue
        if (content !== undefined && !isBoundedString(content, LIMITS.FILE_CONTENT)) continue

        if (isString(content)) {
          totalContentSize += content.length
          // Budget esaurito: interrompiamo l'import qui, le entry già create restano valide
          if (totalContentSize > LIMITS.IMPORT_TOTAL_CONTENT) break
        }

        const realParentId = parentTempId ? (idMap[parentTempId as string] ?? null) : null
        const node = createFile(currentRoom, realParentId, name, type, content as string | undefined)
        idMap[tempId as string] = node.id
        createdNodes.push(node)
      }

      io.to(currentRoom).emit('files-imported', { nodes: createdNodes })
      log.info(`[ROOM] ZIP imported — ${createdNodes.length} entries | user = ${currentUser} | room = ${currentRoom}`)
      if (typeof callback === 'function') callback(idMap)
    })

    safeOn(socket, 'rename-room', ({ name }: { name: string }) => {
      if (!checkRateLimit(socket, 'rename-room')) return
      if (!isString(name)) return
      if (!currentRoom) return
      if (getRole(socket) !== 'owner') return
      const savedName = dbSetRoomName(currentRoom, name.slice(0, LIMITS.ROOM_NAME))
      io.to(currentRoom).emit('room-renamed', { name: savedName })
      log.info(`[ROOM] Room renamed — name = ${savedName} | user = ${currentUser} |  email = ${currentUserEmail} | room = ${currentRoom}`)
    })

    safeOn(socket, 'delete-file', ({ fileId }: { fileId: string }) => {
      if (!checkRateLimit(socket, 'delete-file')) return
      if (!isValidId(fileId)) return
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      if (!deleteFile(currentRoom, fileId)) {
        log.warn(`[ROOM] delete-file su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      io.to(currentRoom).emit('file-deleted', { fileId })
      log.info(`[ROOM] File deleted — file = ${fileId} | user = ${currentUser} |  email = ${currentUserEmail} | room = ${currentRoom}`)
    })

    safeOn(socket, 'run-code', async ({ language, code }: { language: string; code: string }) => {
      if (!checkRateLimit(socket, 'run-code')) return
      if (!isString(language)) return
      if (!isBoundedString(code, LIMITS.RUN_CODE)) return
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      // run-started/run-result drive only the local "Running…" spinner and
      // output console for whoever clicked Run — they're not collaborative
      // state, so they go to the requesting socket only, not the whole room.
      socket.emit('run-started', { language })
      const result = await executeCode(language, code)
      socket.emit('run-result', {
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
        duration: result.duration,
        language,
      })
    })

    // Owner-only: change a member's role
    safeOn(socket, 'set-member-role', ({ userId, role }: { userId: string; role: RoomRole }) => {
      if (!checkRateLimit(socket, 'set-member-role')) return
      if (!isValidId(userId)) return
      if (!currentRoom || !currentUserId) return
      if (getRole(socket) !== 'owner') {
        socket.emit('role-error', { message: 'Only the owner can change roles' })
        return
      }
      if (!['editor', 'viewer'].includes(role)) {
        socket.emit('role-error', { message: 'Invalid role' })
        return
      }
      const memberRole = dbGetMemberRole(userId, currentRoom)
      if (!memberRole) {
        socket.emit('role-error', { message: 'Member not found' })
        return
      }

      if (memberRole === 'owner') {
        socket.emit('role-error', { message: 'Cannot change another owner\'s role' })
        return
      }
      dbSetMemberRole(userId, currentRoom, role)
      log.info(`[ROOM] Role changed — target = ${userId} | role = ${role} | by = ${currentUser} | room = ${currentRoom}`)
 
      io.to(currentRoom).emit('member-role-changed', { userId, role })

      for (const targetSocket of getUserSockets(currentRoom, userId)) {
        setRole(targetSocket, role)
        targetSocket.emit('role-refreshed', { role })
      }
    })

    // Owner-only: kick a member from the room
    safeOn(socket, 'kick-member', ({ userId }: { userId: string }) => {
      if (!checkRateLimit(socket, 'kick-member')) return
      if (!isValidId(userId)) return
      if (!currentRoom || !currentUserId) return
      if (getRole(socket) !== 'owner') {
        socket.emit('role-error', { message: 'Only the owner can kick members' })
        return
      }
      if (userId === currentUserId) {
        socket.emit('role-error', { message: 'Cannot kick yourself' })
        return
      }
      const memberRole = dbGetMemberRole(userId, currentRoom)
      if (memberRole === 'owner') {
        socket.emit('role-error', { message: 'Cannot kick another owner' })
        return
      }
      dbRemoveMember(userId, currentRoom)
      log.info(`[ROOM] Member kicked — target = ${userId} | by = ${currentUser} | room = ${currentRoom}`)
      io.to(currentRoom).emit('member-kicked', { userId })

      for (const targetSocket of getUserSockets(currentRoom, userId)) {
        targetSocket.disconnect(true)
      }
    })

    safeOn(socket, 'rename-file', ({ fileId, name }: { fileId: string; name: string }) => {
      if (!checkRateLimit(socket, 'rename-file')) return
      if (!isValidId(fileId)) return
      if (!isString(name)) return
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      const trimmed = name.trim().slice(0, LIMITS.FILE_NAME)
      if (!trimmed) return
      if (!dbRenameFile(fileId, currentRoom, trimmed)) {
        log.warn(`[ROOM] rename-file su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      log.info(`[ROOM] File renamed — file = ${fileId} | name = ${trimmed} | user = ${currentUser} | room = ${currentRoom}`)
      io.to(currentRoom).emit('file-renamed', { fileId, name: trimmed })
    })

    safeOn(socket, 'move-file', ({ fileId, parentId }: { fileId: string; parentId: string }) => {
      if (!checkRateLimit(socket, 'move-file')) return
      if (!isValidId(fileId)) return
      if (!isValidId(parentId)) return
      if (!currentRoom) return
      if (getRole(socket) === 'viewer') return
      if (!dbMoveFile(fileId, currentRoom, parentId)) {
        log.warn(`[ROOM] move-file su file/parent non appartenente alla room — file = ${fileId} | parent = ${parentId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      log.info(`[ROOM] File moved — file = ${fileId} | parent = ${parentId} | user = ${currentUser} | room = ${currentRoom}`)
      io.to(currentRoom).emit('file-moved', { fileId, parentId })
    })

    safeOn(socket, 'chat-send', ({ content }: { content: string }) => {
      if (!checkRateLimit(socket, 'chat-send')) return
      if (!currentRoom) return
      if (typeof content !== 'string') return
      const trimmed = content.trim().slice(0, 2000)
      if (!trimmed) return
      const msg = dbSaveChatMessage(currentRoom, currentUserId ?? null, currentUser, currentAvatar, trimmed)
      io.to(currentRoom).emit('chat-message', msg)
    })

    safeOn(socket, 'disconnect', () => {
      pendingKnocks.delete(socket.id)
      if (!currentRoom) return
      if (currentUserId) untrackUserSocket(currentRoom, currentUserId, socket)
      removeParticipant(currentRoom, socket.id)
      socket.to(currentRoom).emit('participant-left', { id: socket.id })
      log.info(`[ROOM] User left — user = ${currentUser} |  email = ${currentUserEmail} | room = ${currentRoom}`)
    })
  })
}