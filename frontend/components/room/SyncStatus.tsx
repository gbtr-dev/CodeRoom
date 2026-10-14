import { Button } from '@/components/ui/button'
import type { SyncView } from '@/lib/fileSync'

export function SyncStatus({ view, connected, notice, onDownload, onUseShared, onRetry }: {
  view?: SyncView
  connected: boolean
  notice?: string
  onDownload: () => void
  onUseShared: () => void
  onRetry: () => void
}) {
  const needsRecovery = view?.conflict || view?.error || (!connected && view?.pending)
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#1a1a1a] bg-[#0a0a0a] px-3 py-1 text-xs text-neutral-400">
      <span role="status" className={needsRecovery ? 'text-amber-300' : undefined}>
        {!view ? 'Loading shared file…' : view.error ?? (view.conflict
          ? 'Changes overlap with another edit. Your draft is kept in this tab.'
          : !connected ? 'Disconnected. Keep this tab open to preserve unshared changes.'
          : view?.pending ? 'Sharing changes…' : 'Changes shared')}
      </span>
      {notice && <span role="status" className="min-w-0 break-words">{notice}</span>}
      {needsRecovery && <Button variant="outline" size="xs" className="cursor-pointer border-neutral-700 bg-transparent text-neutral-200 hover:bg-neutral-800 hover:text-white" onClick={onDownload}>Download my draft</Button>}
      {view?.conflict && !view.error && <Button variant="outline" size="xs" className="cursor-pointer border-neutral-700 bg-transparent text-neutral-200 hover:bg-neutral-800 hover:text-white" onClick={() => {
        onDownload()
        onUseShared()
      }}>Download draft and load shared version</Button>}
      {view?.error && <Button variant="outline" size="xs" className="cursor-pointer border-neutral-700 bg-transparent text-neutral-200 hover:bg-neutral-800 hover:text-white" disabled={!connected} onClick={onRetry}>Retry sharing</Button>}
    </div>
  )
}
