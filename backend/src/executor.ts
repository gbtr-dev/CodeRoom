import { spawn } from 'child_process'
import { format as prettierFormat } from 'prettier'

type ExecResult = { output: string; error: string; exitCode: number; duration: number }

type LangConfig = {
  image: string
  filename: string
  extraEnv?: string[]
  timeoutMs?: number
}

const INTERP_TIMEOUT  = 15_000
const COMPILE_TIMEOUT = 60_000
const MAX_OUTPUT      = 100_000

const LANG_CONFIGS: Record<string, LangConfig> = {
  js:     { image: 'node:22-alpine',       filename: 'index.js'   },
  jsx:    { image: 'node:22-alpine',       filename: 'index.jsx'  },
  ts:     { image: 'node:22-alpine',       filename: 'index.ts'   },
  tsx:    { image: 'node:22-alpine',       filename: 'index.tsx'  },
  py:     { image: 'python:3.12-alpine',   filename: 'main.py'    },
  go:     { image: 'golang:1.23-alpine',   filename: 'main.go',   extraEnv: ['GOPATH=/tmp/go', 'GOCACHE=/tmp/cache', 'HOME=/tmp'], timeoutMs: COMPILE_TIMEOUT },
  java:   { image: 'openjdk:21-slim',      filename: 'Main.java', timeoutMs: COMPILE_TIMEOUT },
  kotlin: { image: 'zenika/kotlin:latest', filename: 'Main.kt',   timeoutMs: COMPILE_TIMEOUT },
  c:      { image: 'gcc:latest',           filename: 'main.c',    timeoutMs: COMPILE_TIMEOUT },
  cpp:    { image: 'gcc:latest',           filename: 'main.cpp',  timeoutMs: COMPILE_TIMEOUT },
  rust:   { image: 'rust:alpine',          filename: 'main.rs',   extraEnv: ['CARGO_HOME=/tmp/cargo'], timeoutMs: COMPILE_TIMEOUT },
  csharp: { image: 'mono:latest',          filename: 'Program.cs',timeoutMs: COMPILE_TIMEOUT },
  swift:  { image: 'swift:slim',           filename: 'main.swift',extraEnv: ['HOME=/tmp'], timeoutMs: COMPILE_TIMEOUT },
  ruby:   { image: 'ruby:3.3-alpine',      filename: 'main.rb'    },
  php:    { image: 'php:8.3-cli-alpine',   filename: 'main.php'   },
  perl:   { image: 'perl:slim',            filename: 'main.pl'    },
  lua:    { image: 'nickblah/lua:5.4',     filename: 'main.lua'   },
  r:      { image: 'r-base:latest',        filename: 'main.R'     },
  shell:  { image: 'alpine:3.20',          filename: 'script.sh'  },
}

// Code is embedded as base64 in the shell command so stdin remains free
// for user input. `printf %s` avoids the trailing newline that `echo` adds,
// which matters for binary-safe decoding.
function buildShCmd(filename: string, codeBase64: string): string {
  const f = `/tmp/${filename}`
  const decode = `printf '%s' '${codeBase64}' | base64 -d > ${f}`
  if (filename === 'index.js')   return `${decode} && node ${f}`
  if (filename === 'index.jsx')  return `${decode} && node ${f}`
  if (filename === 'index.ts')   return `${decode} && node --experimental-strip-types ${f}`
  if (filename === 'index.tsx')  return `${decode} && node --experimental-strip-types ${f}`
  if (filename === 'main.py')    return `${decode} && python ${f}`
  if (filename === 'main.go')    return `${decode} && cd /tmp && go run main.go`
  if (filename === 'Main.java')  return `${decode} && java ${f}`
  if (filename === 'Main.kt')    return `${decode} && kotlinc ${f} -include-runtime -d /tmp/main.jar 2>/dev/null && java -jar /tmp/main.jar`
  if (filename === 'main.c')     return `${decode} && gcc -o /tmp/out ${f} && /tmp/out`
  if (filename === 'main.cpp')   return `${decode} && g++ -o /tmp/out ${f} && /tmp/out`
  if (filename === 'main.rs')    return `${decode} && rustc -o /tmp/out ${f} && /tmp/out`
  if (filename === 'Program.cs') return `${decode} && mcs -out:/tmp/prog.exe ${f} && mono /tmp/prog.exe`
  if (filename === 'main.swift') return `${decode} && swift ${f}`
  if (filename === 'main.rb')    return `${decode} && ruby ${f}`
  if (filename === 'main.php')   return `${decode} && php ${f}`
  if (filename === 'main.pl')    return `${decode} && perl ${f}`
  if (filename === 'main.lua')   return `${decode} && lua ${f}`
  if (filename === 'main.R')     return `${decode} && Rscript ${f}`
  if (filename === 'script.sh')  return `${decode} && sh ${f}`
  return `${decode} && ${f}`
}

// ── Warm container pool ───────────────────────────────────────────────────────

// Only pre-warm interpreted languages — compiled ones have long run times
// anyway so the container startup overhead is negligible by comparison.
const WARM_LANGUAGES = ['js', 'jsx', 'ts', 'tsx', 'py', 'ruby', 'php', 'perl', 'lua', 'shell']
const POOL_SIZE = 2

const pool = new Map<string, string[]>()

function dockerCmd(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env: { ...process.env } })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim())))
    child.on('error', reject)
  })
}

async function spawnWarmContainer(language: string): Promise<string | null> {
  const config = LANG_CONFIGS[language]
  if (!config) return null
  const envFlags: string[] = []
  for (const e of config.extraEnv ?? []) envFlags.push('-e', e)
  try {
    const id = await dockerCmd([
      'run', '-d', '--rm',
      '--network',     'none',
      '--memory',      '256m',
      '--memory-swap', '256m',
      '--cpus',        '0.5',
      '--read-only',
      '--tmpfs',       '/tmp:size=256m',
      '--stop-timeout','5',
      ...envFlags,
      config.image,
      'sleep', 'infinity',
    ])
    return id
  } catch {
    return null
  }
}

async function fillPool(language: string) {
  const current = pool.get(language) ?? []
  const needed = POOL_SIZE - current.length
  if (needed <= 0) return
  const ids = await Promise.all(Array.from({ length: needed }, () => spawnWarmContainer(language)))
  const valid = ids.filter((id): id is string => id !== null)
  pool.set(language, [...current, ...valid])
}

function killContainer(id: string) {
  spawn('docker', ['rm', '-f', id], { env: { ...process.env } }).on('error', () => {})
}

async function acquireContainer(language: string): Promise<string | null> {
  const available = pool.get(language) ?? []
  const id = available.shift() ?? null
  pool.set(language, available)
  fillPool(language).catch(() => {})
  return id
}

export async function initContainerPool() {
  await Promise.all(WARM_LANGUAGES.map(lang => fillPool(lang)))
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeCode(language: string, code: string, stdin?: string): Promise<ExecResult> {
  const start = Date.now()
  const config = LANG_CONFIGS[language]

  if (!config) {
    return { output: '', error: `Language "${language}" is not supported for execution.`, exitCode: 1, duration: 0 }
  }

  const codeBase64 = Buffer.from(code).toString('base64')
  const shCmd = buildShCmd(config.filename, codeBase64)
  const timeoutMs = config.timeoutMs ?? INTERP_TIMEOUT
  const stdinPayload = stdin ?? ''

  if (WARM_LANGUAGES.includes(language)) {
    const containerId = await acquireContainer(language)
    if (containerId) {
      const result = await runProcess(
        'docker', ['exec', '-i', containerId, 'sh', '-c', shCmd],
        stdinPayload, start, timeoutMs
      )
      killContainer(containerId)
      return result
    }
  }

  // Fallback: cold docker run
  const envFlags: string[] = []
  for (const e of config.extraEnv ?? []) envFlags.push('-e', e)

  return runProcess(
    'docker',
    [
      'run', '--rm', '-i',
      '--network',     'none',
      '--memory',      '256m',
      '--memory-swap', '256m',
      '--cpus',        '0.5',
      '--read-only',
      '--tmpfs',       '/tmp:size=256m',
      '--stop-timeout','5',
      ...envFlags,
      config.image,
      'sh', '-c', shCmd,
    ],
    stdinPayload, start, timeoutMs
  )
}

// ── Formatter ─────────────────────────────────────────────────────────────────

// Prettier parser per linguaggio — usato direttamente nel processo Node.js
const PRETTIER_PARSERS: Record<string, string> = {
  js: 'babel', jsx: 'babel', ts: 'typescript', tsx: 'typescript',
  css: 'css', html: 'html', json: 'json', md: 'markdown',
}

// Linguaggi formattati via Docker (tool già presenti nell'immagine, no download)
type DockerFmt = { image: string; cmd: string }
const DOCKER_FMTS: Record<string, DockerFmt> = {
  go:   { image: 'golang:1.23-alpine', cmd: 'gofmt' },
  rust: { image: 'rust:alpine',        cmd: 'rustfmt --edition 2021' },
}

export async function formatCode(language: string, code: string): Promise<{ formatted: string; error: string }> {
  // JS/TS/CSS/HTML/JSON/MD — usa prettier API direttamente nel processo
  const parser = PRETTIER_PARSERS[language]
  if (parser) {
    try {
      const formatted = await prettierFormat(code, { parser, printWidth: 100, singleQuote: true, semi: true, tabWidth: 2 })
      return { formatted, error: '' }
    } catch (err: any) {
      return { formatted: code, error: err.message ?? 'Prettier error' }
    }
  }

  // Go / Rust — gofmt e rustfmt sono già nell'immagine, nessun download
  const dockerFmt = DOCKER_FMTS[language]
  if (dockerFmt) {
    const result = await runProcess(
      'docker',
      [
        'run', '--rm', '-i',
        '--network',     'none',
        '--memory',      '128m',
        '--memory-swap', '128m',
        '--cpus',        '0.5',
        '--read-only',
        '--tmpfs',       '/tmp:size=64m',
        '--stop-timeout','5',
        dockerFmt.image,
        'sh', '-c', dockerFmt.cmd,
      ],
      code, Date.now(), 15_000
    )
    if (result.exitCode !== 0) return { formatted: code, error: result.error }
    return { formatted: result.output, error: '' }
  }

  return { formatted: code, error: '' }
}

function runProcess(cmd: string, args: string[], stdin: string, start: number, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    let output   = ''
    let error    = ''
    let finished = false

    const child = spawn(cmd, args, { env: { ...process.env } })

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

    child.stdin.write(stdin, 'utf8')
    child.stdin.end()

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
