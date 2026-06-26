# Coderoom

Real-time collaborative development environment. Multiple users can write code together in the same editor, share files, run code and chat — all from the browser, nothing to install.

---

## Features

### Real-time collaboration
- Shared code sync via diff/patch — only sends the changed characters, not the whole file
- Named cursors with per-user colors and a typing indicator
- Live participant list with avatars and roles
- 20+ languages highlighted · 3 access control layers · 3 permission roles · ∞ files per room

### Multi-file workspace
- Full nested file/folder tree shared live
- Create, rename, move and delete files and folders in real time
- Multiple tabs open at once
- Project-wide search — find text across all files instantly from the sidebar

### Syntax highlighting
- Custom-built engine covering 20+ languages (JS, TS, Python, Go, Rust, Java, C/C++, HTML, CSS, SQL, JSON, Markdown…)
- Auto-detected from file extension, zero config, no external dependencies

### Code execution
- Run code in 19 languages directly from the room via Docker-isolated containers
- Each language runs in its own official Docker image with `--network none`, memory cap and read-only filesystem
- Supported: JS, JSX, TS, TSX, Python, Go, Java, C, C++, Rust, C#, Ruby, PHP, Perl, Lua, Shell, Swift, Kotlin, R
- Stdin support — provide program input before execution via a labeled input modal
- Warm container pool for interpreted languages (JS, Python, Ruby…) — near-instant execution after first run
- Output appears in the integrated terminal panel

### Code formatting
- Format button in the toolbar formats the active file in one click
- JS, JSX, TS, TSX, CSS, HTML, JSON, Markdown — formatted via Prettier (runs in the backend process, instant)
- Go — formatted via `gofmt` in a Docker container
- Rust — formatted via `rustfmt` in a Docker container
- Formatted code is synced live to all participants in the room

### Import & Export
- Drop a ZIP to import an entire project — restores the full folder structure
- Download your workspace as a ZIP snapshot at any moment

### Layered access control
| Layer | How it works |
|---|---|
| **Knock** | Visitors knock — the owner approves or denies in real time without leaving the room *(default)* |
| **Invite links** | Time-limited tokenized links (1h / 24h / 7d). Whoever has one joins without knocking |
| **Room password** | bcrypt-hashed password, required at the door even via invite link *(optional)* |

### Role-based access

| Action | Owner 👑 | Editor ✏️ | Viewer 👁 |
|---|:---:|:---:|:---:|
| Edit code | ✓ | ✓ | — |
| View live | ✓ | ✓ | ✓ |
| Manage room | ✓ | — | — |
| Set password | ✓ | — | — |
| Create invites | ✓ | — | — |
| Assign roles | ✓ | — | — |

### In-room chat
- Real-time messages delivered over Socket.IO
- Last 50 messages persisted in SQLite and loaded on join
- Messages grouped by sender with profile avatars
- Unread badge when the panel is closed

### Authentication & Profile
- Email & password with persistent httpOnly sessions
- Update name, email, password or delete account from settings
- Profile photo: upload + canvas-side resize to 192×192 JPEG, visible on cursors and participant list

### Keyboard shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl+S` | Flush changes |
| `Ctrl+/` | Toggle comment |
| `Ctrl+D` | Duplicate line |
| `Ctrl+F` | Search in file |

---

## Tech stack

### Backend
| Technology | Version | Role |
|---|---|---|
| **Node.js** | 18+ | Runtime |
| **Fastify** | v5 | HTTP server (REST API) |
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
| **JSZip** | v3 | Import/Export workspace ZIP |
| **TypeScript** | 5.7 | Static typing |

---

## Architecture

Monorepo with two independent workspaces. The backend exposes REST (auth, profile, invites) and WebSocket (all real-time events). The frontend consumes both.

```
Coderoom/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Entry point — Fastify + Socket.IO setup
│   │   ├── auth.ts           # REST routes: login, signup, sessions, profile, avatar, invites
│   │   ├── socket.ts         # All WebSocket events: join, code sync, cursors, chat, knock, roles, file tree
│   │   ├── db.ts             # SQLite schema, prepared statements, exported functions (no ORM)
│   │   ├── rooms.ts          # In-memory room state (participants, files)
│   │   ├── executor.ts       # Code execution (Docker sandbox, 19 languages)
│   │   ├── csrf.ts           # CSRF protection via Origin/Referer check
│   │   ├── rateLimiter.ts    # Rate limiting for socket events
│   │   ├── authRateLimiter.ts# Rate limiting for auth routes (anti brute-force)
│   │   ├── logger.ts         # Structured logger (pino)
│   │   ├── safeHandler.ts    # safeOn wrapper for async socket handlers
│   │   └── validation.ts     # Input validators (IDs, strings, etc.)
│   ├── coderoom.db           # SQLite file (auto-generated on first run)
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx          # Homepage (landing)
│   │   ├── features/         # Features page
│   │   ├── docs/             # Documentation page
│   │   ├── login/            # Login
│   │   ├── signup/           # Sign up
│   │   ├── rooms/            # User room dashboard
│   │   ├── room/[id]/        # Collaborative editor (main page)
│   │   ├── settings/         # Profile settings
│   │   └── invite/[token]/   # Invite link entry
│   ├── components/
│   │   ├── auth-provider.tsx # Global auth context
│   │   ├── ChatPanel.tsx     # In-room chat panel
│   │   └── room/             # Editor components (Editor, Terminal, FileTree…)
│   ├── lib/
│   │   ├── useSocket.ts      # Socket.IO hook — full real-time lifecycle
│   │   ├── useFileTree.ts    # File tree management hook
│   │   ├── useImportExport.ts# ZIP import/export hook
│   │   ├── highlight.ts      # Custom syntax highlighting (20+ languages, no deps)
│   │   ├── textPatch.ts      # Text diff/patch for efficient sync
│   │   └── socket.ts         # socket.io-client factory
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

**Data flow — joining a room:**
`Client` → `socket.emit('join-room')` → `auth cookie` → `SQLite lookup` → `admitUser()` → `room-state` → `Editor + Chat`

---

## Database (SQLite)

The schema is created automatically on startup. No migration commands needed — columns added later are applied via a conditional `ALTER TABLE`.

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

## Environment variables

### Backend — `backend/.env`

```env
# Required in production. Used to sign/verify session tokens.
# Generate with: openssl rand -hex 64
JWT_SECRET=your_secret_here

# Runtime mode: 'development' | 'production'
# Set to 'production' to enable the Secure flag on cookies over HTTPS
NODE_ENV=development

# Frontend origin — update to your domain in production
# Default if unset: http://localhost:3000
CORS_ORIGIN=
```

> The frontend has no environment file — it connects to the backend at the hardcoded default `http://localhost:3001`.

---

## Installation & setup

**Prerequisites:** Node.js 18+ and Docker Desktop (for code execution inside rooms).

### 01 — Clone the repository
```bash
git clone https://github.com/gbtr-dev/CodeRoom.git
cd Coderoom
```

### 02 — Backend
```bash
cd backend
npm install

# Create .env file (see Env Vars section above)
# The DB is created automatically on first run

npm run dev    # port 3001
```

### 03 — Frontend
```bash
cd frontend
npm install
npm run dev    # port 3000
```

Open [http://localhost:3000](http://localhost:3000).

### 04 — Production build
```bash
# Backend
cd backend && npm run build && npm start

# Frontend
cd frontend && npm run build && npm start
```

---

## Default ports

| Service | Port |
|---|---|
| Frontend (Next.js) | `3000` |
| Backend (Fastify + Socket.IO) | `3001` |

---

## Troubleshooting

**`EADDRINUSE: address already in use :3001`**
```cmd
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Linux/macOS
lsof -ti:3001 | xargs kill -9
```

**`Cannot connect to server` on login**
Make sure the backend is running and that `node_modules` is installed in both folders.

**DB not created**
`coderoom.db` is generated automatically inside `backend/` on first run. Make sure the process has write permission on that directory.

---

## Security

- `httpOnly` + `SameSite=lax` session cookies (no stateless JWT)
- CSRF protection via Origin/Referer check on every mutating request
- Rate limiting for socket events and auth routes (anti brute-force)
- Revocable sessions (logout, password change)
- Input validation on all socket handlers and REST routes

---

Built by Luca and Alberto
