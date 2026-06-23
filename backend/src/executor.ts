import { execFile, spawn } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

type ExecResult = {
  output: string
  error: string
  exitCode: number
  duration: number
}

const TIMEOUT_MS = 10_000   // 10 seconds max execution time
const MAX_OUTPUT = 100_000  // 100KB max output

const SUPPORTED_LANGUAGES = new Set(['js', 'py', 'go'])

export async function executeCode(language: string, code: string): Promise<ExecResult> {
  const start = Date.now()

  if (!SUPPORTED_LANGUAGES.has(language)) {
    return { output: '', error: `Language "${language}" not supported.`, exitCode: 1, duration: 0 }
  }

  try {
    switch (language) {
      case 'js':  return await runNode(code, start)
      case 'py':  return await runPython(code, start)
      case 'go':  return await runGo(code, start)
      default:    return { output: '', error: 'Unsupported language', exitCode: 1, duration: 0 }
    }
  } catch (err: any) {
    return {
      output: '',
      error: err.message ?? 'Execution failed',
      exitCode: 1,
      duration: Date.now() - start,
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

const LANG_LABELS: Record<string, string> = { js: 'Node.js', py: 'Python 3', go: 'Go' }
const LANG_BINARIES: Record<string, string> = { js: 'node', py: 'python3', go: 'go' }

function runProcess(
  cmd: string,
  args: string[],
  start: number,
  lang?: string,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let output = ''
    let error  = ''
    let finished = false

    const child = spawn(cmd, args, {
      env: {
        // Minimal, safe environment — no PATH tricks, no home dir leakage
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: tmpdir(),
        TMPDIR: tmpdir(),
      },
    })

    const finish = (code: number) => {
      if (finished) return
      finished = true
      resolve({
        output: output.slice(0, MAX_OUTPUT).trim(),
        error:  error.slice(0, MAX_OUTPUT).trim(),
        exitCode: code,
        duration: Date.now() - start,
      })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (error.length < MAX_OUTPUT) error += chunk.toString()
    })
    child.on('close', (code) => finish(code ?? 1))
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' && lang) {
        error += `${LANG_LABELS[lang] ?? cmd} non è installato su questa macchina (comando "${LANG_BINARIES[lang] ?? cmd}" non trovato nel PATH).`
      } else {
        error += err.message
      }
      finish(1)
    })

    // Hard timeout fallback (spawn's own timeout kills the process too)
    setTimeout(() => {
      if (!finished) {
        child.kill('SIGKILL')
        error += '\nExecution timed out (10s limit).'
        finish(1)
      }
    }, TIMEOUT_MS)
  })
}

async function runNode(code: string, start: number): Promise<ExecResult> {
  // Wrap in an async IIFE so top-level await works
  const wrapped = `(async () => { ${code} })()`
  return runProcess('node', ['--eval', wrapped], start, 'js')
}

async function runPython(code: string, start: number): Promise<ExecResult> {
  return runProcess('python3', ['-c', code], start, 'py')
}

async function runGo(code: string, start: number): Promise<ExecResult> {
  // Go requires a real file — write to a temp dir and clean up afterwards
  const dir = join(tmpdir(), `coderoom-go-${randomBytes(6).toString('hex')}`)
  const file = join(dir, 'main.go')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, code, 'utf8')
    return await runProcess('go', ['run', file], start, 'go')
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}