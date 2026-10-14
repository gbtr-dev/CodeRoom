---
name: Coderoom
colors:
  editor: "#0d0d0d"
  chrome: "#0a0a0a"
  border: "#1a1a1a"
  accent: "#22c55e"
typography:
  sans:
    fontFamily: "Geist, sans-serif"
  mono:
    fontFamily: "Geist Mono, monospace"
rounded:
  DEFAULT: "0.5rem"
spacing:
  status-padding: "0.75rem"
components:
  button: {}
  sync-status: {}
---

# Coderoom design context

## Overview

Coderoom is a collaborative code editor. Preserve its existing compact, dark
editor shell and green active-tab accent; synchronization feedback should stay
quiet until an action is needed. The interface is currently English, as declared
by `frontend/app/layout.tsx`. This document records the touched editor workflow,
not a redesign of authentication or room management.

## Colors

The editor's existing surface colors are recorded above. Runtime ownership stays
in `frontend/app/globals.css`, the existing room shell, and shared button variants.
No theme generator or new global color system is introduced. Sync warnings use
Tailwind amber-300 with descriptive text, never color alone.

## Typography

Use the Geist and Geist Mono fonts loaded by the root layout. Status copy is
compact sans-serif; code remains monospace. Keep actions in sentence case.

## Rounded

Reuse `frontend/components/ui/button.tsx`; do not create another button system.

## Spacing

The synchronization strip reserves a minimum height of 2rem below the tabs.
Its text and actions wrap on narrow screens instead of hiding recovery actions.

## Components

| Capability | Canonical owner | Contract | Evidence |
| --- | --- | --- | --- |
| Buttons | `frontend/components/ui/button.tsx` | Outline, compact, keyboard focus, disabled retry offline | Existing Base UI primitive |
| File synchronization | `frontend/lib/fileSync.ts` | One acknowledged write per file, revision precondition, preserve drafts | `frontend/tests/file-sync.test.cjs`, `backend/tests/collaborative-edits.test.cjs` |
| Sync feedback | `frontend/components/room/SyncStatus.tsx` | Persistent status and recovery in the editor | `frontend/tests/sync-status.test.cjs` |
| Draft export | `frontend/lib/useImportExport.ts` | Existing text download, prefixed draft filename | SyncStatus download action |

### Synchronization and recovery

"Changes shared" means accepted by the server, not a guarantee of a disk flush.
Disjoint edits are rebased automatically; overlapping edits pause sharing and
keep the local draft in the current tab. Offer a download before switching to
the shared version. Drafts are not persisted in browser storage. Warn on actual
page unload while unshared changes remain. Reconnection fetches fresh versions;
never replay an old positional edit blindly. Failed writes require explicit retry.

Use a polite live region, preserve keyboard focus, and keep recovery controls
visible. No new animation, modal, search control, or locale convention is added.
