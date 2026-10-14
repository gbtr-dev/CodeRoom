import type { FileSync } from './fileSync'

export type FormatRequest = { fileId: string; language: string; code: string }
export type FormatResult = { fileId: string; formatted: string; error: string }

/** Acknowledgements correlate replies; the captured draft controls application. */
export class FileFormatter {
  private pending?: { fileId: string }

  constructor(
    private sync: FileSync,
    private send: (request: FormatRequest, done: (error: Error | null, result?: FormatResult) => void) => void,
    private changed: (fileId: string, busy: boolean, notice: string) => void,
  ) {}

  start(fileId: string, language: string) {
    if (this.pending) return
    const draft = this.sync.prepareTransform(fileId)
    if (!draft) {
      this.changed(fileId, false, 'Formatting unavailable. Reconnect or resolve the sharing problem, then try Format again.')
      return
    }
    const pending = { fileId }
    this.pending = pending
    this.changed(fileId, true, 'Formatting…')
    const done = (error: Error | null, result?: FormatResult) => {
      if (this.pending !== pending) return
      this.pending = undefined
      let notice = ''
      if (error) notice = 'No formatting response received. Your code is unchanged. Try Format again.'
      else if (!result || result.fileId !== fileId || typeof result.formatted !== 'string' || typeof result.error !== 'string') {
        notice = 'Invalid formatting response. Your code is unchanged. Try Format again.'
      } else if (result.error) notice = result.error
      else if (!draft.apply(result.formatted)) {
        notice = 'Formatting skipped because the file changed or is unavailable. Review it and try Format again.'
      }
      this.changed(fileId, false, notice)
    }
    try { this.send({ fileId, language, code: draft.text }, done) }
    catch { done(new Error('Formatting request failed')) }
  }

  cancel() {
    if (!this.pending) return
    const { fileId } = this.pending
    this.pending = undefined
    this.changed(fileId, false, 'Formatting interrupted. Your code is unchanged. Try Format again when connected.')
  }
}
