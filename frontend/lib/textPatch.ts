
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