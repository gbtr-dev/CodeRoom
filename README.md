<div align="center">

<img src="https://raw.githubusercontent.com/gbtr-dev/CodeRoom/main/frontend/public/logo.png" alt="Coderoom" width="72" height="72" />

# Coderoom

**Real-time collaborative development environment.**  
Write code together, share files, run programs and chat — all from the browser, nothing to install.

<br />

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?style=flat-square&logo=socket.io)](https://socket.io)

</div>

---

## What is Coderoom?

Coderoom is a self-hosted collaborative code editor. Open a room, share the link, and code together in real time — with live cursors, a shared file tree, an integrated terminal, and in-room chat. No plugins, no accounts required to join, no cloud vendor lock-in.

---

## Features

### ⚡ Real-time collaboration
- Efficient diff/patch sync — only changed characters are transmitted, not the whole file
- Named cursors with per-user colors and live typing indicators
- Live participant list with avatars and permission roles

### 📁 Multi-file workspace
- Full nested file/folder tree shared across all participants in real time
- Create, rename, move and delete files and folders on the fly
- Multiple tabs open simultaneously
- Project-wide search — find text across all files from the sidebar

### 🎨 Syntax highlighting
- Custom-built engine covering 20+ languages
- Auto-detected from file extension — zero config, no external dependencies
- Supported: JS, TS, Python, Go, Rust, Java, C/C++, HTML, CSS, SQL, JSON, Markdown and more

### 🐳 Code execution
- Run code in 19 languages directly from the room
- Each run is fully isolated: Docker container with `--network none`, memory cap and read-only filesystem
- Warm container pool for interpreted languages (JS, Python, Ruby…) — near-instant execution
- Stdin support via an input modal before each run
- Output appears in the integrated terminal panel

**Supported runtimes:** JavaScript · TypeScript · Python · Go · Java · C · C++ · Rust · C# · Ruby · PHP · Perl · Lua · Shell · Swift · Kotlin · R · JSX · TSX

### 🖌️ Code formatting
- One-click format button in the editor toolbar
- JS/TS/JSX/TSX/CSS/HTML/JSON/Markdown via Prettier (runs in-process, instant)
- Go via `gofmt` · Rust via `rustfmt` — both in isolated Docker containers
- Formatted output is synced live to all participants

### 📦 Import & Export
- Drop a ZIP to import an entire project — folder structure fully restored
- Download the workspace as a ZIP snapshot at any time

### 🔐 Layered access control

| Layer | How it works |
|---|---|
| **Knock** | Visitors knock — the owner approves or denies in real time without leaving the room *(default)* |
| **Invite links** | Time-limited tokenized links (1 h / 24 h / 7 d) — whoever has one joins without knocking |
| **Room password** | bcrypt-hashed password required at the door, even via invite link *(optional)* |

### 👥 Role-based permissions

| Action | Owner 👑 | Editor ✏️ | Viewer 👁 |
|---|:---:|:---:|:---:|
| Edit code | ✓ | ✓ | — |
| View live | ✓ | ✓ | ✓ |
| Manage room | ✓ | — | — |
| Set password | ✓ | — | — |
| Create invite links | ✓ | — | — |
| Assign roles | ✓ | — | — |

### 💬 In-room chat
- Real-time messages via Socket.IO
- Last 50 messages persisted in SQLite and loaded on join
- Messages grouped by sender with profile avatars
- Unread badge when the panel is closed

### 🔑 Authentication & profile
- Email & password with persistent `httpOnly` sessions
- Update name, email, password or delete account from settings
- Profile photo: upload + canvas-side resize to 192×192 JPEG, shown on cursors and participant list

### ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Flush pending changes |
| `Ctrl+/` | Toggle comment |
| `Ctrl+D` | Duplicate line |
| `Ctrl+F` | Search in file |

---

## Tech stack

### Backend

| Technology | Version | Role |
|---|---|---|
| **Node.js** | 18+ | Runtime |
| **Fastify** | v5 | HTTP server & REST API |
| **Socket.IO** | v4 | WebSocket — real-time sync |
| **better-sqlite3** | v12 | Synchronous SQLite database |
| **bcryptjs** | v3 | Password hashing |
| **nanoid** | v5 | Unique IDs for rooms, files, tokens |
| **TypeScript** | v6 | Static typing |
| **ts-node + nodemon** | — | Dev server with hot reload |

### Frontend

| Technology | Version | Role |
|---|---|---|
| **Next.js** | 16 (App Router) | React framework |
| **React** | 19 | UI rendering |
| **Tailwind CSS** | v4 | Utility-first styling |
| **Socket.IO Client** | v4 | WebSocket connection |
| **JSZip** | v3 | ZIP import/export |
| **TypeScript** | 5.7 | Static typing |

---

## Architecture

Monorepo with two independent workspaces. The backend exposes REST (auth, profile, invites) and WebSocket (all real-time events). The frontend consumes both.

```
Coderoom/
├── backend/
│   ├── src/
│   │   ├── index.ts           # Entry point — Fastify + Socket.IO setup
│   │   ├── auth.ts            # REST routes: login, signup, sessions, profile, avatar, invites
│   │   ├── socket.ts          # WebSocket events: join, code sync, cursors, chat, knock, roles, file tree
│   │   ├── db.ts              # SQLite schema, prepared statements, exported functions (no ORM)
│   │   ├── rooms.ts           # In-memory room state (participants, files)
│   │   ├── executor.ts        # Code execution (Docker sandbox, 19 languages)
│   │   ├── csrf.ts            # CSRF protection via Origin/Referer check
│   │   ├── rateLimiter.ts     # Rate limiting for socket events
│   │   ├── authRateLimiter.ts # Rate limiting for auth routes (anti brute-force)
│   │   ├── logger.ts          # Structured logger (pino)
│   │   ├── safeHandler.ts     # safeOn wrapper for async socket handlers
│   │   └── validation.ts      # Input validators (IDs, strings, etc.)
│   ├── coderoom.db            # SQLite file (auto-generated on first run)
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx           # Homepage (landing)
│   │   ├── features/          # Features page
│   │   ├── docs/              # Documentation page
│   │   ├── login/             # Login
│   │   ├── signup/            # Sign up
│   │   ├── rooms/             # User room dashboard
│   │   ├── room/[id]/         # Collaborative editor (main page)
│   │   ├── settings/          # Profile settings
│   │   └── invite/[token]/    # Invite link entry
│   ├── components/
│   │   ├── auth-provider.tsx  # Global auth context
│   │   ├── ChatPanel.tsx      # In-room chat panel
│   │   └── room/              # Editor components (Editor, Terminal, FileTree…)
│   ├── lib/
│   │   ├── useSocket.ts       # Socket.IO hook — full real-time lifecycle
│   │   ├── useFileTree.ts     # File tree management hook
│   │   ├── useImportExport.ts # ZIP import/export hook
│   │   ├── highlight.ts       # Custom syntax highlighting (20+ languages, no deps)
│   │   ├── textPatch.ts       # Text diff/patch for efficient sync
│   │   └── socket.ts          # socket.io-client factory
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

**Data flow — joining a room:**

```
Client → socket.emit('join-room') → auth cookie → SQLite lookup → admitUser() → room state → Editor + Chat
```

---

## Database

Schema created automatically on startup — no migration commands needed. Columns added in later versions are applied via conditional `ALTER TABLE`.

| Table | Description | Key columns |
|---|---|---|
| `users` | User accounts | id, name, email, password_hash, avatar |
| `sessions` | httpOnly session tokens | id, user_id, created_at, expires_at |
| `rooms` | Rooms with optional name & password | id, name, created_by, password_hash |
| `room_members` | Membership and role per room | user_id, room_id, role, last_seen |
| `files` | Files and folders with content | id, room_id, name, kind, parent_id, content |
| `chat_messages` | Chat messages per room | id, room_id, user_id, user_name, avatar, content, created_at |
| `invites` | Tokenized invite links with TTL | token, room_id, created_by, expires_at |
| `login_attempts` | Brute-force rate limit counters | email, count, first_attempt_at, locked_until |

---

## Getting started

**Prerequisites:** Node.js 18+ · Docker Desktop (required for code execution)

### 1. Clone

```bash
git clone https://github.com/gbtr-dev/CodeRoom.git
cd Coderoom
```

### 2. Backend

```bash
cd backend
npm install
# Create a .env file — see Environment variables below
npm run dev   # → http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev   # → http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
# Backend
cd backend && npm run build && npm start

# Frontend
cd frontend && npm run build && npm start
```

---

## Environment variables

### `backend/.env`

```env
# Required in production — used to sign/verify session tokens
# Generate with: openssl rand -hex 64
JWT_SECRET=your_secret_here

# 'development' | 'production'
# Set to 'production' to enable the Secure flag on cookies (HTTPS)
NODE_ENV=development

# Frontend origin — update to your domain in production
# Default if unset: http://localhost:3000
CORS_ORIGIN=
```

> The frontend has no `.env` file — it connects to the backend at the default `http://localhost:3001`.

---

## Default ports

| Service | Port |
|---|---|
| Frontend (Next.js) | `3000` |
| Backend (Fastify + Socket.IO) | `3001` |

---

## Security

- `httpOnly` + `SameSite=lax` session cookies (no stateless JWT)
- CSRF protection via Origin/Referer check on every mutating request
- Per-event and per-route rate limiting (anti brute-force)
- Revocable sessions on logout and password change
- Input validation on all socket handlers and REST routes
- Docker sandbox with `--network none`, memory cap and read-only filesystem for code execution

---

## Troubleshooting

**`EADDRINUSE: address already in use :3001`**

```bash
# Linux/macOS
lsof -ti:3001 | xargs kill -9

# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

**`Cannot connect to server` on login**  
Make sure the backend is running and that `node_modules` is installed in both `backend/` and `frontend/`.

**DB not created**  
`coderoom.db` is generated automatically inside `backend/` on first run. Make sure the process has write permission on that directory.

---

<div align="center">

Built by [Luca](https://rg-dev.lat)

</div>