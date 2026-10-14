export type TextPatch = { start: number; deleteCount: number; insert: string }

export function computeTextPatch(oldText: string, newText: string): TextPatch {
  let start = 0
  const oldLen = oldText.length
  const newLen = newText.length
  while (start < oldLen && start < newLen && oldText[start] === newText[start]) start++
  let oldEnd = oldLen
  let newEnd = newLen
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  return { start, deleteCount: oldEnd - start, insert: newText.slice(start, newEnd) }
}

export function applyTextPatch(content: string, patch: TextPatch): string {
  const { start, deleteCount, insert } = patch
  return content.slice(0, start) + insert + content.slice(start + deleteCount)
}

export type RebaseResult = {
  /** Remote text with the local, not-yet-sent edit applied on top of it. */
  text: string
  /** True when the two edits overlap: the remote edit wins and the local one is dropped. */
  conflict: boolean
  /** Maps a position (e.g. the caret) from the previous local text to `text`. */
  mapPosition: (pos: number) => number
}

function isNoop(p: TextPatch): boolean {
  return p.deleteCount === 0 && p.insert === ""
}

function shiftPatch(p: TextPatch, by: number): TextPatch {
  return { ...p, start: p.start + by }
}

function mapThroughPatch(pos: number, p: TextPatch): number {
  if (pos <= p.start) return pos
  if (pos >= p.start + p.deleteCount) return pos + p.insert.length - p.deleteCount
  return p.start + p.insert.length
}

/**
 * Three-way merge of a single local edit and a single remote edit made on the same `base`.
 *  - base:   text both sides started from (last content known to be on the server)
 *  - local:  what is currently in the editor (base + local keystrokes not yet sent)
 *  - remote: content just received from the server
 * Non-overlapping edits are both kept; if they overlap, the remote edit wins.
 */
export function rebaseLocalEdit(base: string, local: string, remote: string): RebaseResult {
  const remotePatch = computeTextPatch(base, remote)
  const localPatch = computeTextPatch(base, local)

  if (isNoop(remotePatch)) {
    return { text: local, conflict: false, mapPosition: (pos) => pos }
  }
  if (isNoop(localPatch)) {
    return { text: remote, conflict: false, mapPosition: (pos) => mapThroughPatch(pos, remotePatch) }
  }

  const localEnd = localPatch.start + localPatch.deleteCount
  const remoteEnd = remotePatch.start + remotePatch.deleteCount

  if (localEnd <= remotePatch.start) {
    // Local edit is entirely before the remote one: apply it as is, shift the remote one.
    const remoteInLocal = shiftPatch(remotePatch, localPatch.insert.length - localPatch.deleteCount)
    return {
      text: applyTextPatch(remote, localPatch),
      conflict: false,
      mapPosition: (pos) => mapThroughPatch(pos, remoteInLocal),
    }
  }

  if (localPatch.start >= remoteEnd) {
    // Local edit is entirely after the remote one: shift it by the remote length change.
    const localInRemote = shiftPatch(localPatch, remotePatch.insert.length - remotePatch.deleteCount)
    return {
      text: applyTextPatch(remote, localInRemote),
      conflict: false,
      mapPosition: (pos) => mapThroughPatch(pos, remotePatch),
    }
  }

  return { text: remote, conflict: true, mapPosition: (pos) => Math.min(pos, remote.length) }
}