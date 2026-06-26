import { spawn } from 'child_process'

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

// Each entry defines the image and filename; the docker command is always
// `sh -c "cat > /tmp/<filename> && <run command>"` so code arrives via stdin
// and no host volume mount is needed (works with remote Docker daemons too).
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

// Returns the sh -c command that reads code from stdin, writes it to /tmp,
// then runs it. Compiled languages need extra steps (compile + run).
function buildShCmd(filename: string): string {
  const f = `/tmp/${filename}`
  const base = `cat > ${f}`

  if (filename === 'index.js')   return `${base} && node ${f}`
  if (filename === 'index.jsx')  return `${base} && node ${f}`
  if (filename === 'index.ts')   return `${base} && node --experimental-strip-types ${f}`
  if (filename === 'index.tsx')  return `${base} && node --experimental-strip-types ${f}`
  if (filename === 'main.py')    return `${base} && python ${f}`
  if (filename === 'main.go')    return `${base} && cd /tmp && go run main.go`
  if (filename === 'Main.java')  return `${base} && java ${f}`
  if (filename === 'Main.kt')    return `${base} && kotlinc ${f} -include-runtime -d /tmp/main.jar 2>/dev/null && java -jar /tmp/main.jar`
  if (filename === 'main.c')     return `${base} && gcc -o /tmp/out ${f} && /tmp/out`
  if (filename === 'main.cpp')   return `${base} && g++ -o /tmp/out ${f} && /tmp/out`
  if (filename === 'main.rs')    return `${base} && rustc -o /tmp/out ${f} && /tmp/out`
  if (filename === 'Program.cs') return `${base} && mcs -out:/tmp/prog.exe ${f} && mono /tmp/prog.exe`
  if (filename === 'main.swift') return `${base} && swift ${f}`
  if (filename === 'main.rb')    return `${base} && ruby ${f}`
  if (filename === 'main.php')   return `${base} && php ${f}`
  if (filename === 'main.pl')    return `${base} && perl ${f}`
  if (filename === 'main.lua')   return `${base} && lua ${f}`
  if (filename === 'main.R')     return `${base} && Rscript ${f}`
  if (filename === 'script.sh')  return `${base} && sh ${f}`
  return `${base} && ${f}`
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

  const envFlags: string[] = []
  for (const e of config.extraEnv ?? []) envFlags.push('-e', e)

  const dockerArgs = [
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
    'sh', '-c', buildShCmd(config.filename),
  ]

  return runProcess('docker', dockerArgs, code, start, config.timeoutMs ?? INTERP_TIMEOUT)
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

    // Write code to container stdin, then close so the cat command completes
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
