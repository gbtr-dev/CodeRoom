import { spawn } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

type ExecResult = { output: string; error: string; exitCode: number; duration: number }

type LangConfig = {
  image: string
  filename: string
  // Command executed inside the container (use ['sh','-c','...'] for multi-step)
  cmd: string[]
  // Extra -e KEY=VALUE pairs needed by some runtimes
  extraEnv?: string[]
  // Compiled languages need more time (compilation + link + run)
  timeoutMs?: number
}

const INTERP_TIMEOUT  = 15_000   // interpreted: 15 s
const COMPILE_TIMEOUT = 60_000   // compiled: 60 s (includes compilation)
const MAX_OUTPUT      = 100_000  // 100 KB stdout + stderr cap

// One entry per executable language. Languages without a command (SQL, HTML,
// CSS, JSON, MD, …) are simply absent — the handler returns a clear message.
const LANG_CONFIGS: Record<string, LangConfig> = {
  // ── JavaScript / TypeScript ───────────────────────────────────────────────
  js:  { image: 'node:22-alpine', filename: 'index.js',  cmd: ['node', 'index.js'] },
  jsx: { image: 'node:22-alpine', filename: 'index.jsx', cmd: ['node', 'index.jsx'] },
  // Node 22 ships --experimental-strip-types: runs plain TS without tsx/ts-node
  ts:  { image: 'node:22-alpine', filename: 'index.ts',  cmd: ['node', '--experimental-strip-types', 'index.ts'] },
  tsx: { image: 'node:22-alpine', filename: 'index.tsx', cmd: ['node', '--experimental-strip-types', 'index.tsx'] },

  // ── Python ───────────────────────────────────────────────────────────────
  py: { image: 'python:3.12-alpine', filename: 'main.py', cmd: ['python', 'main.py'] },

  // ── Go ───────────────────────────────────────────────────────────────────
  // Redirect GOPATH/GOCACHE to /tmp (the only writable dir in a read-only container)
  go: {
    image: 'golang:1.23-alpine',
    filename: 'main.go',
    cmd: ['go', 'run', 'main.go'],
    extraEnv: ['GOPATH=/tmp/go', 'GOCACHE=/tmp/cache', 'HOME=/tmp'],
    timeoutMs: COMPILE_TIMEOUT,
  },

  // ── JVM ──────────────────────────────────────────────────────────────────
  // JEP 330 (JDK 11+): `java SourceFile.java` compiles + runs in one step
  java: {
    image: 'openjdk:21-slim',
    filename: 'Main.java',
    cmd: ['java', 'Main.java'],
    timeoutMs: COMPILE_TIMEOUT,
  },
  // kotlinc is slow (~30-60s for Hello World); set expectations accordingly
  kotlin: {
    image: 'zenika/kotlin:latest',
    filename: 'Main.kt',
    cmd: ['sh', '-c', 'kotlinc Main.kt -include-runtime -d /tmp/main.jar 2>/dev/null && java -jar /tmp/main.jar'],
    timeoutMs: COMPILE_TIMEOUT,
  },

  // ── C / C++ ──────────────────────────────────────────────────────────────
  c: {
    image: 'gcc:latest',
    filename: 'main.c',
    cmd: ['sh', '-c', 'gcc -o /tmp/out main.c && /tmp/out'],
    timeoutMs: COMPILE_TIMEOUT,
  },
  cpp: {
    image: 'gcc:latest',
    filename: 'main.cpp',
    cmd: ['sh', '-c', 'g++ -o /tmp/out main.cpp && /tmp/out'],
    timeoutMs: COMPILE_TIMEOUT,
  },

  // ── Rust ─────────────────────────────────────────────────────────────────
  rust: {
    image: 'rust:alpine',
    filename: 'main.rs',
    cmd: ['sh', '-c', 'rustc -o /tmp/out main.rs && /tmp/out'],
    extraEnv: ['CARGO_HOME=/tmp/cargo'],
    timeoutMs: COMPILE_TIMEOUT,
  },

  // ── C# (Mono) ────────────────────────────────────────────────────────────
  csharp: {
    image: 'mono:latest',
    filename: 'Program.cs',
    cmd: ['sh', '-c', 'mcs -out:/tmp/prog.exe Program.cs && mono /tmp/prog.exe'],
    timeoutMs: COMPILE_TIMEOUT,
  },

  // ── Swift ────────────────────────────────────────────────────────────────
  swift: {
    image: 'swift:slim',
    filename: 'main.swift',
    cmd: ['swift', 'main.swift'],
    extraEnv: ['HOME=/tmp'],
    timeoutMs: COMPILE_TIMEOUT,
  },

  // ── Scripting ────────────────────────────────────────────────────────────
  ruby:  { image: 'ruby:3.3-alpine',      filename: 'main.rb',    cmd: ['ruby',    'main.rb'] },
  php:   { image: 'php:8.3-cli-alpine',   filename: 'main.php',   cmd: ['php',     'main.php'] },
  perl:  { image: 'perl:slim',            filename: 'main.pl',    cmd: ['perl',    'main.pl'] },
  lua:   { image: 'nickblah/lua:5.4',     filename: 'main.lua',   cmd: ['lua',     'main.lua'] },
  r:     { image: 'r-base:latest',        filename: 'main.R',     cmd: ['Rscript', 'main.R'] },
  shell: { image: 'alpine:3.20',          filename: 'script.sh',  cmd: ['sh',      'script.sh'] },
}

export async function executeCode(language: string, code: string): Promise<ExecResult> {
  const start = Date.now()
  const config = LANG_CONFIGS[language]

  if (!config) {
    return {
      output: '',
      error: `Language "${language}" is not supported for execution.`,
      exitCode: 1,
      duration: 0,
    }
  }

  const dir = join(tmpdir(), `coderoom-${language}-${randomBytes(6).toString('hex')}`)
  const codeFile = join(dir, config.filename)

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(codeFile, code, 'utf8')

    // Build the -e KEY=VALUE flags for extra env vars
    const envFlags: string[] = []
    for (const e of config.extraEnv ?? []) envFlags.push('-e', e)

    const dockerArgs = [
      'run', '--rm',
      '--network',     'none',           // no internet access
      '--memory',      '256m',           // RAM cap
      '--memory-swap', '256m',           // disable swap
      '--cpus',        '0.5',            // half a core
      '--read-only',                     // container FS is read-only…
      '--tmpfs',       '/tmp:size=256m', // …except /tmp (for compiled binaries)
      '-v',            `${dir}:/code:ro`,// mount source read-only
      '-w',            '/code',
      '--stop-timeout','5',              // SIGTERM → SIGKILL after 5 s
      ...envFlags,
      config.image,
      ...config.cmd,
    ]

    return await runProcess('docker', dockerArgs, start, config.timeoutMs ?? INTERP_TIMEOUT)
  } catch (err: any) {
    return {
      output: '',
      error: err.message ?? 'Execution failed',
      exitCode: 1,
      duration: Date.now() - start,
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

function runProcess(cmd: string, args: string[], start: number, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    let output  = ''
    let error   = ''
    let finished = false

    const child = spawn(cmd, args)

    const finish = (code: number) => {
      if (finished) return
      finished = true
      resolve({
        output:   output.slice(0, MAX_OUTPUT).trim(),
        error:    error.slice(0, MAX_OUTPUT).trim(),
        exitCode: code,
        duration: Date.now() - start,
      })
    }

    child.stdout.on('data', (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { if (error.length < MAX_OUTPUT) error += chunk.toString() })
    child.on('close', (code) => finish(code ?? 1))
    child.on('error', (err: NodeJS.ErrnoException) => {
      error = err.code === 'ENOENT'
        ? 'Docker non trovato. Assicurati che Docker sia installato e in esecuzione.'
        : err.message
      finish(1)
    })

    setTimeout(() => {
      if (!finished) {
        child.kill('SIGKILL')
        error += '\nExecution timed out.'
        finish(1)
      }
    }, timeoutMs)
  })
}
