# Security Fixes — Coderoom (2026-07-10)

Sessione di security review approfondita seguita da fix sistematico di tutti i problemi trovati.

---

## Metodologia

Analisi statica completa della codebase (backend Fastify + frontend Next.js). Nessun problema critico trovato. Architettura di base solida: sessioni opache su SQLite, httpOnly cookie, CSRF origin check, prepared statements ovunque, isolamento Docker.

---

## Fix applicati

### Alta severità

#### 1. Docker TCP senza garanzia TLS
**File:** `backend/src/executor.ts`  
**Problema:** Se `DOCKER_TLS_VERIFY` fosse assente al deploy, Docker comunicava in chiaro su TCP sulla LAN → MITM + RCE potenziale.  
**Fix:** IIFE `assertDockerTls()` che blocca l'avvio del server se `DOCKER_HOST` usa `tcp://` senza `DOCKER_TLS_VERIFY=1`.

#### 2. JWT_SECRET inutilizzato nel .env
**File:** `backend/.env`  
**Problema:** Segreto reale presente in chiaro per codice JWT ormai rimosso (l'app usa sessioni su DB).  
**Fix:** Rimosso `JWT_SECRET` e il commento obsoleto. Il segreto va considerato compromesso.

#### 3. Shell injection latente in buildShCmd
**File:** `backend/src/executor.ts`  
**Problema:** Il codice utente (base64) veniva interpolato direttamente nella stringa del comando shell → architettura fragile.  
**Fix:** Il codice viene passato come variabile d'ambiente `CODEROOM_CODE` tramite `-e` nell'args array di `spawn`. Il comando shell usa `"$CODEROOM_CODE"` senza mai toccare il parser della shell.

---

### Media severità

#### 4. Email esposta ai viewer via GET /members
**File:** `backend/src/db.ts`  
**Problema:** La query `stmtSelectRoomMembers` includeva `u.email`, visibile a qualsiasi viewer della room.  
**Fix:** Rimosso `u.email` dalla SELECT. Il frontend non usava il campo.

#### 5. trustProxy: true — bypass rate limit IP
**File:** `backend/src/index.ts`  
**Problema:** Con `trustProxy: true` Fastify accettava qualsiasi `X-Forwarded-For`, forgiabile dal client → bypass rate limit.  
**Fix:** `trustProxy: 1` — si fida solo dell'ultimo hop (il proxy reale).

#### 6. Nessun limite sessioni attive per utente
**File:** `backend/src/db.ts`  
**Problema:** Ogni login creava una nuova sessione senza mai pulire le vecchie (TTL 30 giorni) → saturazione SQLite.  
**Fix:** `dbCreateSession` chiama `stmtPruneUserSessions` dopo ogni INSERT, mantenendo al massimo 10 sessioni attive per utente.

#### 7. Avatar XSS stored — nessun filtro nel frontend
**File:** `frontend/components/auth-provider.tsx`, `frontend/lib/useSocket.ts`  
**Problema:** Il frontend rendeva avatar grezzi dal DB senza validazione — nessuna difesa in profondità se il backend avesse un bypass.  
**Fix:** Funzione `sanitizeAvatar()` che accetta solo valori che iniziano con `data:image/`, applicata a tutti i punti di ingresso: login, signup, mount, partecipanti WebSocket, cronologia chat, messaggi real-time.

#### 8. move-file: fileId="root" non gestito
**File:** `backend/src/db.ts`  
**Problema:** `dbMoveFile` non aveva guard esplicito contro `fileId="root"` — assunzione implicita non documentata.  
**Fix:** `if (fileId === 'root') return false` all'inizio di `dbMoveFile`.

---

### Bassa severità

#### 10. Nessun Content-Security-Policy nel frontend
**File:** `frontend/next.config.mjs`  
**Fix:** CSP aggiunta via `headers()` in Next.js config:
- `script-src 'self' 'unsafe-inline'` (Next.js hydration)
- `connect-src` limitato a stesso dominio + backend
- `img-src 'self' data:` (avatar come data URL)
- `object-src 'none'`, `frame-ancestors 'none'`

#### 11. Cursor paginazione non validato
**File:** `backend/src/auth.ts`  
**Fix:** Check `Number.isInteger(cursor) && cursor >= 0` prima di passarlo alla query — risponde 400 se invalido.

#### 12. Timing side-channel knock/owner
**File:** `backend/src/socket.ts`  
**Problema:** Il deny automatico (no owner online) era istantaneo → rilevabile dal client.  
**Fix:** Delay casuale 1-3 secondi prima di emettere `knock-denied` automatico. Il timeout da 60s viene cancellato correttamente nel callback.

---

## Non fixato

**#9 — Email in chiaro nei log WebSocket** (bassa): `currentUserEmail` nei `log.info` di `socket.ts` non usa `maskEmail`. Fix: importare e wrappare le occorrenze alle righe 140, 221, 407, 459, 627.

---

## Deploy

Le modifiche ai sorgenti TypeScript richiedono rebuild:

```bash
# Stoppa il processo Node (PID 26272 al momento della review)
cd backend
npm run build
node dist/index.js
```

Il frontend Next.js va ribuilddato separatamente per applicare la CSP.
