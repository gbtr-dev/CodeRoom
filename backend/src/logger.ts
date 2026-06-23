
type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const configured: Level = (process.env.LOG_LEVEL?.toLowerCase() as Level) ?? 'info'
const minLevel = LEVELS[configured] ?? LEVELS.info

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function kv(fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return ''
  return (
    '  ' +
    Object.entries(fields)
      .map(([k, v]) => `${k}=${v ?? '—'}`)
      .join('  ')
  )
}

function write(level: Level, module: string, message: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel) return
  const line = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}${kv(fields)}`
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export function maskEmail(email: string): string {
  if (!email) return '—'
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***@${email.slice(at + 1)}`
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) => write('debug', module, msg, fields),
    info:  (msg: string, fields?: Record<string, unknown>) => write('info',  module, msg, fields),
    warn:  (msg: string, fields?: Record<string, unknown>) => write('warn',  module, msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => write('error', module, msg, fields),
  }
}