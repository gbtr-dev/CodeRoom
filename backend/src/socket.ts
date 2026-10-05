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
  hasOnlineOwner,
} from './rooms'
import { executeCode, formatCode } from './executor'
import { dbRoomExists, dbAddRoomMember, dbCreateRoom, dbCreateRoomWithOwner, dbGetUserById, dbSetRoomName, dbGetRoom, dbGetMemberRole, dbSetMemberRole, dbGetRoomMembers, dbRemoveMember, dbRenameFile, dbMoveFile, dbSaveChatMessage, dbGetChatMessages, type RoomRole } from './db'
import { verifySessionToken, SESSION_COOKIE_NAME } from './auth'
import bcrypt from 'bcryptjs'
import { createLogger, maskEmail } from './logger'
import { checkRateLimit } from './rateLimiter'
import { safeOn } from './safeHandler'
import { LIMITS, isString, isNonEmptyString, isBoundedString, isValidId, isNonNegativeInt, isFileKind, isValidFileName } from './validation'


const log = createLogger('SOCKET')

let ioInstance: Server | null = null

const userRoomSockets = new Map<string, Set<Socket>>()
// Track authenticated connections before admission too: password checks and
// pending knocks must not outlive a revoked session or room membership.
const connectionAccess = new Map<Socket, { userId: string | null; token?: string; roomId: string | null }>()

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
  for (const [socket, access] of connectionAccess) {
    if (access.roomId !== roomId) continue
    socket.emit('room-deleted', { roomId })
    socket.disconnect(true)
  }
  removeRoom(roomId)
}

export function notifyUserLeftRoom(roomId: string, userId: string) {
  for (const [socket, access] of connectionAccess) {
    if (access.roomId === roomId && access.userId === userId) socket.disconnect(true)
  }
}

export function notifyMemberRoleChanged(roomId: string, userId: string, role: RoomRole) {
  for (const socket of getUserSockets(roomId, userId)) {
    setRole(socket, role)
    const participant = getOrCreateRoom(roomId).participants.get(socket.id)
    if (participant) participant.role = role
    socket.emit('role-refreshed', { role })
  }
  ioInstance?.to(roomId).emit('member-role-changed', { userId, role })
}

export function notifyMemberRemoved(roomId: string, userId: string) {
  ioInstance?.to(roomId).emit('member-kicked', { userId })
  notifyUserLeftRoom(roomId, userId)
}

function expireSocket(socket: Socket) {
  socket.emit('session-expired')
  socket.disconnect(true)
}

export function disconnectAllUserSockets(userId: string) {
  for (const [socket, access] of connectionAccess) {
    if (access.userId === userId) expireSocket(socket)
  }
}

export function disconnectRevokedUserSockets(userId: string) {
  for (const [socket, access] of connectionAccess) {
    if (access.userId !== userId || !access.token) continue
    if (verifySessionToken(access.token)?.userId !== userId) expireSocket(socket)
  }
}

type PendingKnock = {
  userId: string | null
  userName: string
  roomId: string
  timeoutId: ReturnType<typeof setTimeout>
  admit: () => void
}
const pendingKnocks = new Map<string, PendingKnock>()
const MAX_PENDING_KNOCKS_PER_ROOM = 20

function cancelPendingKnock(socketId: string) {
  const knock = pendingKnocks.get(socketId)
  if (!knock) return
  clearTimeout(knock.timeoutId)
  pendingKnocks.delete(socketId)
}

export function registerSocketHandlers(io: Server) {
  ioInstance = io
  io.on('connection', (socket: Socket) => {
    let currentRoom: string | null = null
    let currentUser: string = 'Anonymous'
    let currentUserEmail: string = 'unknown'
    let currentUserId: string | null = null
    let currentAvatar: string | null = null
    let joinAttempt = 0
    let sessionExpiryTimer: ReturnType<typeof setTimeout> | undefined

    function hasValidSession() {
      if (!socket.connected) return false
      const access = connectionAccess.get(socket)
      if (!access?.userId) return true // Anonymous guests require owner approval.
      if (access.token && verifySessionToken(access.token)?.userId === access.userId) return true
      expireSocket(socket)
      return false
    }

    function armSessionExpiry(expiresAt: number) {
      // Node timers cap at ~24.8 days; sessions last 30 days. Re-arm long timers.
      const delay = Math.min(Math.max(expiresAt * 1000 - Date.now(), 1), 2_147_483_647)
      sessionExpiryTimer = setTimeout(() => {
        if (!socket.connected) return
        const access = connectionAccess.get(socket)
        const session = access?.token ? verifySessionToken(access.token) : null
        if (session && session.userId === access?.userId) armSessionExpiry(session.expiresAt)
        else expireSocket(socket)
      }, delay)
      sessionExpiryTimer.unref()
    }

    function onClientEvent(event: string, handler: (...args: any[]) => unknown) {
      safeOn(socket, event, (...args) => {
        if (!hasValidSession()) return
        if (currentRoom && socket.data.admitted) {
          if (!dbRoomExists(currentRoom)) {
            notifyRoomDeleted(currentRoom)
            return
          }
          if (currentUserId) {
            const role = dbGetMemberRole(currentUserId, currentRoom)
            if (!role) {
              notifyMemberRemoved(currentRoom, currentUserId)
              return
            }
            if (role !== getRole(socket)) notifyMemberRoleChanged(currentRoom, currentUserId, role)
          }
        }
        return handler(...args)
      })
    }

    function isCurrentAttempt(attempt: number) {
      return attempt === joinAttempt && hasValidSession()
    }

    function leaveCurrentRoom() {
      const roomId = currentRoom
      const wasOwner = getRole(socket) === 'owner'
      currentRoom = null
      socket.data.admitted = false
      setRole(socket, 'viewer')
      if (!roomId) return

      if (currentUserId) untrackUserSocket(roomId, currentUserId, socket)
      socket.leave(roomId)
      removeParticipant(roomId, socket.id)
      if (wasOwner && !hasOnlineOwner(roomId)) {
        for (const [knockId, knock] of pendingKnocks.entries()) {
          if (knock.roomId === roomId) {
            cancelPendingKnock(knockId)
            io.sockets.sockets.get(knockId)?.emit('knock-denied')
          }
        }
      }
      socket.to(roomId).emit('participant-left', { id: socket.id })
      log.info(`[ROOM] User left — user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | room = ${roomId}`)
    }

    // Commit room access only for the latest request on this connection.
    // Knock approvals call this closure on the requesting socket as well.
    function admitUser(roomId: string, attempt: number) {
      if (!isCurrentAttempt(attempt)) return
      const roomRow = dbGetRoom(roomId)
      if (!roomRow) {
        socket.emit('room-not-found', { roomId })
        return
      }

      let role: RoomRole = 'viewer'
      if (currentUserId) {
        const existingRole = dbGetMemberRole(currentUserId, roomId)
        role = existingRole ?? 'viewer'
        dbAddRoomMember(currentUserId, roomId, role)
        trackUserSocket(roomId, currentUserId, socket)
      }

      cancelPendingKnock(socket.id)
      currentRoom = roomId
      setRole(socket, role)
      socket.join(roomId)
      socket.data.admitted = true

      const participant = addParticipant(roomId, socket.id, currentUser, currentUserId ?? undefined, role, currentAvatar)
      const room = getOrCreateRoom(roomId)

      const otherParticipants = Array.from(room.participants.entries())
        .filter(([id]) => id !== socket.id)
        .map(([id, p]) => ({ id, name: p.name, color: p.color, dbUserId: p.userId, dbRole: p.role, avatar: p.avatar ?? null }))

      socket.emit('room-state', {
        files: getRoomFiles(roomId),
        participants: otherParticipants,
        roomName: roomRow?.name ?? null,
        role,
        chatHistory: dbGetChatMessages(roomId),
        hasPassword: !!roomRow?.password_hash,
      })

      socket.to(roomId).emit('participant-joined', {
        id: socket.id,
        name: participant.name,
        color: participant.color,
        dbUserId: participant.userId,
        dbRole: participant.role,
        avatar: participant.avatar ?? null,
      })

      log.info(`[ROOM] User admitted — user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | role = ${role} | room = ${roomId}`)
    }

    const cookieHeader = socket.handshake.headers.cookie
    let handshakeToken: string | undefined
    if (cookieHeader) {
      try {
        handshakeToken = parseCookie(cookieHeader)[SESSION_COOKIE_NAME]
      } catch {
        handshakeToken = undefined
      }
    }
    const session = handshakeToken ? verifySessionToken(handshakeToken) : null
    connectionAccess.set(socket, {
      userId: session?.userId ?? null,
      token: session ? handshakeToken : undefined,
      roomId: null,
    })

    onClientEvent('join-room', async ({
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
      if (!socket.connected) return
      const attempt = ++joinAttempt
      cancelPendingKnock(socket.id)
      leaveCurrentRoom()
      connectionAccess.get(socket)!.roomId = roomId
      currentUser = isNonEmptyString(userName, LIMITS.USER_NAME) ? userName : 'Anonymous'
      currentUserId = null
      currentUserEmail = 'unknown'
      currentAvatar = null

      // Verify session token read from the httpOnly cookie
      if (handshakeToken) {
        const payload = verifySessionToken(handshakeToken)
        if (payload) {
          const dbUser = dbGetUserById(payload.userId)
          if (dbUser) {
            currentUserId = dbUser.id
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
        const created = dbCreateRoomWithOwner(roomId, currentUserId, isString(roomName) ? roomName : undefined)
        if (created) {
          admitUser(roomId, attempt)
          log.info(`[ROOM] Room created — user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | role = owner | room = ${roomId}`)
          return
        }
        // isNew is only a client hint. For an existing room, enforce the same
        // membership, password and approval checks as every other join below.
      }

      const roomRow = dbGetRoom(roomId)

      if (currentUserId) {
        const existingRole = dbGetMemberRole(currentUserId, roomId)
        if (existingRole) {
          if (existingRole === 'owner') {
            // Owner always gets in — they set the password
            admitUser(roomId, attempt)
            return
          }
          // Editor / viewer: must enter password if room is locked
          if (roomRow?.password_hash) {
            if (!password) {
              socket.emit('room-password-required')
              return
            }
            const valid = await bcrypt.compare(password, roomRow.password_hash)
            if (!isCurrentAttempt(attempt)) return
            if (!valid) {
              socket.emit('room-wrong-password')
              return
            }
          }
          admitUser(roomId, attempt)
          return
        }
      }

      // Unknown visitor — check if room is password-protected
      if (roomRow?.password_hash) {
        // Anonymous users cannot enter password-protected rooms: require authentication
        if (!currentUserId) {
          socket.emit('login-required')
          return
        }
        if (!password) {
          socket.emit('room-password-required')
          return
        }
        const valid = await bcrypt.compare(password, roomRow.password_hash)
        if (!isCurrentAttempt(attempt)) return
        if (!valid) {
          socket.emit('room-wrong-password')
          return
        }
        // Correct password — admit authenticated user as viewer
        log.info(`[ROOM] Password correct — user = ${currentUser} | room = ${roomId}`)
        admitUser(roomId, attempt)
        return
      }

      // No password — send knock to all owners currently in the room
      // Cap pending knocks per room to prevent memory DoS
      const roomPendingCount = Array.from(pendingKnocks.values()).filter(k => k.roomId === roomId).length
      if (roomPendingCount >= MAX_PENDING_KNOCKS_PER_ROOM) {
        socket.emit('knock-denied')
        log.warn(`[ROOM] Knock denied — too many pending (${roomPendingCount}) | room = ${roomId}`)
        return
      }

      const denyPendingKnock = () => {
        if (pendingKnocks.get(socket.id) !== knock) return
        cancelPendingKnock(socket.id)
        socket.emit('knock-denied')
        log.info(`[ROOM] Knock expired — user = ${knock.userName} | room = ${roomId}`)
      }
      const knock: PendingKnock = {
        userId: currentUserId,
        userName: currentUser,
        roomId,
        timeoutId: setTimeout(denyPendingKnock, 60_000),
        admit: () => admitUser(roomId, attempt),
      }
      pendingKnocks.set(socket.id, knock)
      log.info(`[ROOM] Knock received — user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | room = ${roomId}`)

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
        // Random delay to prevent timing-based detection of owner presence.
        const delay = 1000 + Math.random() * 2000
        clearTimeout(knock.timeoutId)
        knock.timeoutId = setTimeout(denyPendingKnock, delay)
        log.info(`[ROOM] Knock auto-denied (no owner online) — user = ${currentUser} | room = ${roomId}`)
      } else {
        socket.emit('knock-pending')
      }
    })

    // Owner approves a knock
    onClientEvent('approve-knock', ({ knockId }: { knockId: string }) => {
      if (!checkRateLimit(socket, 'approve-knock')) return
      if (!isValidId(knockId)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) !== 'owner') return

      const knock = pendingKnocks.get(knockId)
      if (!knock || knock.roomId !== currentRoom) return
      cancelPendingKnock(knockId)

      const knockerSocket = io.sockets.sockets.get(knockId)
      if (!knockerSocket) return

      log.info(`[ROOM] Knock approved — user = ${knock.userName} | by = ${currentUser} | room = ${currentRoom}`)
      knock.admit()
    })

    // Owner denies a knock
    onClientEvent('deny-knock', ({ knockId }: { knockId: string }) => {
      if (!checkRateLimit(socket, 'deny-knock')) return
      if (!isValidId(knockId)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) !== 'owner') return

      const knock = pendingKnocks.get(knockId)
      if (!knock || knock.roomId !== currentRoom) return
      cancelPendingKnock(knockId)

      const knockerSocket = io.sockets.sockets.get(knockId)
      if (knockerSocket) {
        knockerSocket.emit('knock-denied')
      }
      log.info(`[ROOM] Knock denied — user = ${knock.userName} | by = ${currentUser} | room = ${currentRoom}`)
    })

    onClientEvent('code-change', ({ fileId, content }: { fileId: string; content: string }) => {
      if (!checkRateLimit(socket, 'code-change')) return
      if (!isValidId(fileId)) return
      if (!isBoundedString(content, LIMITS.FILE_CONTENT)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return
      if (!updateFileContent(currentRoom, fileId, content)) {
        log.warn(`[ROOM] code-change su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }

      io.to(currentRoom).emit('code-update', { fileId, content, fromSocketId: socket.id })
    })

    onClientEvent('code-patch', ({ fileId, start, deleteCount, insert }: { fileId: string; start: number; deleteCount: number; insert: string }) => {
      if (!checkRateLimit(socket, 'code-patch')) return
      if (!isValidId(fileId)) return
      if (!isNonNegativeInt(start, LIMITS.FILE_CONTENT)) return
      if (!isNonNegativeInt(deleteCount, LIMITS.FILE_CONTENT)) return
      if (!isBoundedString(insert, LIMITS.PATCH_INSERT)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return

      const updated = applyFilePatch(currentRoom, fileId, start, deleteCount, insert)
      if (updated === null) {
        log.warn(`[ROOM] code-patch su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      io.to(currentRoom).emit('code-update', { fileId, content: updated, fromSocketId: socket.id })
    })

    onClientEvent('cursor-move', ({ fileId, line, column }: { fileId: string; line: number; column: number }) => {
      if (!checkRateLimit(socket, 'cursor-move')) return
      if (!isValidId(fileId)) return
      if (!isNonNegativeInt(line, LIMITS.CURSOR_POS)) return
      if (!isNonNegativeInt(column, LIMITS.CURSOR_POS)) return
      if (!currentRoom || !socket.data.admitted) return
      socket.to(currentRoom).emit('cursor-update', {
        userId: socket.id,
        fileId,
        line,
        column,
      })
    })

    onClientEvent('create-file', ({ parentId, name, type, content }: { parentId: string | null; name: string; type: 'file' | 'folder'; content?: string }, callback?: (node: ReturnType<typeof createFile>) => void) => {
      const reject = () => { if (typeof callback === 'function') callback(undefined as unknown as ReturnType<typeof createFile>) }
      if (!checkRateLimit(socket, 'create-file')) { reject(); return }
      if (parentId !== null && !isValidId(parentId)) { reject(); return }
      if (!isValidFileName(name)) { reject(); return }
      if (!isFileKind(type)) { reject(); return }
      if (content !== undefined && !isBoundedString(content, LIMITS.FILE_CONTENT)) { reject(); return }
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return
      const node = createFile(currentRoom, parentId, name, type, content)
      log.info(`[ROOM] File created — file = ${name} | user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | room = ${currentRoom}`)
      if (typeof callback === 'function') callback(node)
      io.to(currentRoom).emit('file-created', { node, parentId: node.parentId })
    })

    onClientEvent('import-zip', (
      { entries }: { entries: { tempId: string; parentTempId: string | null; name: string; type: 'file' | 'folder'; content?: string }[] },
      callback?: (idMap: Record<string, string>) => void,
    ) => {

      const reject = () => { if (typeof callback === 'function') callback({ __rejected: '1' }) }
      if (!checkRateLimit(socket, 'import-zip')) { reject(); return }
      if (!Array.isArray(entries) || entries.length === 0 || entries.length > LIMITS.IMPORT_ENTRIES) { reject(); return }
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return
      const idMap: Record<string, string> = {}
      const createdNodes: ReturnType<typeof createFile>[] = []
      let totalContentSize = 0

      for (const entry of entries as unknown[]) {
        if (typeof entry !== 'object' || entry === null) continue
        const { tempId, parentTempId, name, type, content } = entry as Record<string, unknown>

        if (!isValidId(tempId)) continue
        if (parentTempId !== null && parentTempId !== undefined && !isValidId(parentTempId)) continue
        if (!isValidFileName(name)) continue
        if (!isFileKind(type)) continue
        if (content !== undefined && !isBoundedString(content, LIMITS.FILE_CONTENT)) continue

        if (isString(content)) {
          totalContentSize += content.length
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

    onClientEvent('rename-room', ({ name }: { name: string }) => {
      if (!checkRateLimit(socket, 'rename-room')) return
      if (!isString(name)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) !== 'owner') return
      const savedName = dbSetRoomName(currentRoom, name.slice(0, LIMITS.ROOM_NAME))
      io.to(currentRoom).emit('room-renamed', { name: savedName })
      log.info(`[ROOM] Room renamed — name = ${savedName} | user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | room = ${currentRoom}`)
    })

    onClientEvent('delete-file', ({ fileId }: { fileId: string }) => {
      if (!checkRateLimit(socket, 'delete-file')) return
      if (!isValidId(fileId)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return
      if (!deleteFile(currentRoom, fileId)) {
        log.warn(`[ROOM] delete-file su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      io.to(currentRoom).emit('file-deleted', { fileId })
      log.info(`[ROOM] File deleted — file = ${fileId} | user = ${currentUser} | email = ${maskEmail(currentUserEmail)} | room = ${currentRoom}`)
    })

    onClientEvent('run-code', async ({ language, code, stdin }: { language: string; code: string; stdin?: string }) => {
      if (!checkRateLimit(socket, 'run-code')) return
      if (!isString(language)) return
      if (!isBoundedString(code, LIMITS.RUN_CODE)) return
      if (stdin !== undefined && !isBoundedString(stdin, 10_000)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return

      socket.emit('run-started', { language })
      const result = await executeCode(language, code, stdin)
      socket.emit('run-result', {
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
        duration: result.duration,
        language,
      })
    })

    onClientEvent('format-code', async ({ language, code }: { language: string; code: string }) => {
      if (!checkRateLimit(socket, 'format-code')) return
      if (!isString(language)) return
      if (!isBoundedString(code, LIMITS.RUN_CODE)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return

      const result = await formatCode(language, code)
      socket.emit('format-result', result)
    })

    // Owner-only: change a member's role
    onClientEvent('set-member-role', ({ userId, role }: { userId: string; role: RoomRole }) => {
      if (!checkRateLimit(socket, 'set-member-role')) return
      if (!isValidId(userId)) return
      if (!currentRoom || !currentUserId || !socket.data.admitted) return
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
 
      notifyMemberRoleChanged(currentRoom, userId, role)
    })

    // Owner-only: kick a member from the room
    onClientEvent('kick-member', ({ userId }: { userId: string }) => {
      if (!checkRateLimit(socket, 'kick-member')) return
      if (!isValidId(userId)) return
      if (!currentRoom || !currentUserId || !socket.data.admitted) return
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
      notifyMemberRemoved(currentRoom, userId)
    })

    onClientEvent('rename-file', ({ fileId, name }: { fileId: string; name: string }) => {
      if (!checkRateLimit(socket, 'rename-file')) return
      if (!isValidId(fileId)) return
      if (!isValidFileName(name)) return
      if (!currentRoom || !socket.data.admitted) return
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

    onClientEvent('move-file', ({ fileId, parentId }: { fileId: string; parentId: string }) => {
      if (!checkRateLimit(socket, 'move-file')) return
      if (!isValidId(fileId)) return
      if (!isValidId(parentId)) return
      if (!currentRoom || !socket.data.admitted) return
      if (getRole(socket) === 'viewer') return
      if (!dbMoveFile(fileId, currentRoom, parentId)) {
        log.warn(`[ROOM] move-file su file/parent non appartenente alla room — file = ${fileId} | parent = ${parentId} | user = ${currentUser} | room = ${currentRoom}`)
        return
      }
      log.info(`[ROOM] File moved — file = ${fileId} | parent = ${parentId} | user = ${currentUser} | room = ${currentRoom}`)
      io.to(currentRoom).emit('file-moved', { fileId, parentId })
    })

    onClientEvent('chat-send', ({ content }: { content: string }) => {
      if (!checkRateLimit(socket, 'chat-send')) return
      if (!currentRoom || !socket.data.admitted) return
      if (typeof content !== 'string') return
      const trimmed = content.trim().slice(0, 2000)
      if (!trimmed) return
      const msg = dbSaveChatMessage(currentRoom, currentUserId ?? null, currentUser, currentAvatar, trimmed)
      io.to(currentRoom).emit('chat-message', msg)
    })

    safeOn(socket, 'disconnect', () => {
      ++joinAttempt
      clearTimeout(sessionExpiryTimer)
      connectionAccess.delete(socket)
      cancelPendingKnock(socket.id)
      leaveCurrentRoom()
      delete socket.data.__rateBuckets
      delete socket.data.__abuseBudget
    })
    if (session) armSessionExpiry(session.expiresAt)
  })
}
