import { computeTextPatch, rebaseLocalEdit, type TextPatch } from './textPatch'

export type FileSnapshot = { fileId: string; content: string; revision: string }
export type EditResult = ({ status: 'ok' | 'conflict' } & FileSnapshot) | { status: 'error'; error: string; uncertain?: boolean }
export type SyncView = { text: string; conflict: boolean; error?: string; pending: boolean }
type Flight = { text: string }
type State = {
  base: FileSnapshot
  local: string
  flight?: Flight
  uncertain?: Flight
  conflict: boolean
  error?: string
  draftVersion: number
}

/** One acknowledged write per file; unsent and in-flight drafts are never server state. */
export class FileSync {
  private files = new Map<string, State>()
  private connected = false

  constructor(
    private send: (fileId: string, revision: string, patch: TextPatch, done: (result: EditResult) => void) => void,
    private changed: (fileId: string, view: SyncView, mapPosition?: (pos: number) => number) => void,
  ) {}

  view(fileId: string): SyncView | undefined {
    const state = this.files.get(fileId)
    if (!state) return undefined
    return { text: state.local, conflict: state.conflict, error: state.error,
      pending: !!state.flight || !!state.uncertain || state.local !== state.base.content }
  }

  private publish(fileId: string, mapPosition?: (pos: number) => number) {
    const view = this.view(fileId)
    if (view) this.changed(fileId, view, mapPosition)
  }

  disconnect() {
    this.connected = false
    for (const [id, state] of this.files) {
      state.draftVersion++
      // A lost acknowledgement is ambiguous. Reconcile with a fresh snapshot
      // before sending anything again; do not replay the old positional patch.
      if (state.flight) state.uncertain = state.flight
      state.flight = undefined
      this.publish(id)
    }
  }

  connect(snapshots: FileSnapshot[]) {
    this.connected = false
    const ids = new Set(snapshots.map(snapshot => snapshot.fileId))
    for (const [id, state] of this.files) {
      if (!ids.has(id)) {
        state.flight = undefined
        state.error = 'This file is no longer available. Download your draft before leaving.'
        this.publish(id)
      }
    }
    for (const snapshot of snapshots) this.receive(snapshot)
    this.connected = true
    this.flush()
  }

  receive(snapshot: FileSnapshot) {
    const state = this.files.get(snapshot.fileId)
    if (!state) {
      this.files.set(snapshot.fileId, { base: snapshot, local: snapshot.content, conflict: false, draftVersion: 0 })
      this.publish(snapshot.fileId)
      return
    }
    // The acknowledgement follows any earlier remote event on this connection
    // and contains a newer/equal snapshot. Wait for it instead of rebasing twice.
    if (state.flight) return
    if (state.uncertain) {
      if (snapshot.content === state.uncertain.text) {
        // The lost write did commit. Rebase only the keystrokes typed after it.
        state.base = snapshot
      } else if (snapshot.revision !== state.base.revision && snapshot.content !== state.base.content) {
        // It may have committed and then been edited again. A three-way merge
        // against the old base could duplicate its insertion: keep the draft.
        state.conflict = true
      }
      state.uncertain = undefined
    }
    const wasConflict = state.conflict
    const merged = rebaseLocalEdit(state.base.content, state.local, snapshot.content)
    state.base = snapshot
    state.error = undefined
    state.conflict = wasConflict || merged.conflict
    if (state.local === snapshot.content) state.conflict = false
    if (!state.conflict) {
      if (state.local !== merged.text) state.draftVersion++
      state.local = merged.text
    }
    this.publish(snapshot.fileId, state.conflict ? undefined : merged.mapPosition)
  }

  edit(fileId: string, text: string) {
    const state = this.files.get(fileId)
    if (!state) return
    if (state.local !== text) state.draftVersion++
    state.local = text
    this.publish(fileId)
  }

  /** Capture a draft for asynchronous formatting; never replace later edits. */
  prepareTransform(fileId: string) {
    const state = this.files.get(fileId)
    if (!this.connected || !state || state.error || state.conflict) return undefined
    const version = state.draftVersion
    return {
      text: state.local,
      apply: (text: string) => {
        if (!this.connected || this.files.get(fileId) !== state || state.draftVersion !== version || state.error || state.conflict) return false
        this.edit(fileId, text)
        this.flush(fileId)
        return true
      },
    }
  }

  flush(fileId?: string) {
    for (const [id, state] of this.files) {
      if (fileId && id !== fileId) continue
      if (!this.connected || state.flight || state.conflict || state.error || state.local === state.base.content) continue
      const flight = { text: state.local }
      state.flight = flight
      this.publish(id)
      this.send(id, state.base.revision, computeTextPatch(state.base.content, flight.text), result => {
        // Ignore late replies after disconnect, deletion, or a newer connection.
        if (this.files.get(id) !== state || state.flight !== flight) return
        state.flight = undefined
        if (result.status === 'error') {
          if (result.uncertain) state.uncertain = flight
          state.error = result.error
          this.publish(id)
          return
        }
        if (result.status === 'ok') {
          // The sent text is now confirmed; preserve any typing since it was sent.
          state.base = { ...result, content: flight.text }
        }
        this.receive(result)
        this.flush(id)
      })
    }
  }

  /** Explicit resolution keeps the shared version; the UI offers a draft download first. */
  useShared(fileId: string) {
    const state = this.files.get(fileId)
    if (!state || !state.conflict) return
    state.draftVersion++
    state.local = state.base.content
    state.conflict = false
    this.publish(fileId)
  }

  hasPending() {
    return [...this.files.keys()].some(id => this.view(id)?.pending)
  }

  remove(fileId: string) {
    const state = this.files.get(fileId)
    if (!state) return
    state.draftVersion++
    if (this.view(fileId)?.pending) {
      state.flight = undefined
      state.error = 'This file was deleted. Download your draft before leaving.'
      this.publish(fileId)
    } else this.files.delete(fileId)
  }
}
