import { createLogger, maskEmail } from './logger'

const log = createLogger('MAIL')

const RESEND_URL = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Coderoom <noreply@rg-dev.lat>'
const DEFAULT_APP_URL = 'http://localhost:45031'
const DEFAULT_DAILY_LIMIT = 100
const SEND_TIMEOUT_MS = 10_000

export type MailMessage = {
  to: string
  subject: string
  html: string
  text: string
  /** Lets the provider ignore a duplicate request (e.g. a retry after a network error). */
  idempotencyKey?: string
}

export type MailTransport = (message: MailMessage) => Promise<void>

/* ------------------------------------------------------------------ */
/* Configuration (read lazily, so it can change between tests)         */
/* ------------------------------------------------------------------ */

export type MailLang = 'en' | 'it'

export type MailConfig = {
  apiKey: string | null
  from: string
  appUrl: string
  dailyLimit: number
  /** Language of the emails. The site is in English, so that is the default (MAIL_LANG=it for Italian). */
  lang: MailLang
}

export function isProduction(): boolean {
  return (process.env.NODE_ENV ?? 'development') === 'production'
}

export function getMailConfig(): MailConfig {
  const limit = Number.parseInt(process.env.MAIL_DAILY_LIMIT ?? '', 10)
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM,
    appUrl: (process.env.APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, ''),
    dailyLimit: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_DAILY_LIMIT,
    lang: process.env.MAIL_LANG?.trim().toLowerCase() === 'it' ? 'it' : 'en',
  }
}

/**
 * Call once at startup. In production the server must not start without a working email
 * configuration (nobody could confirm their account); in development it only warns.
 */
export function assertMailConfig(): void {
  const config = getMailConfig()

  if (!isProduction()) {
    if (!config.apiKey) {
      log.warn('RESEND_API_KEY non impostata: le email non vengono inviate, i link di verifica sono scritti nel log')
    }
    return
  }

  const problems: string[] = []
  if (!config.apiKey) problems.push('RESEND_API_KEY is required in production')
  if (!process.env.APP_URL?.trim()) {
    problems.push('APP_URL is required in production (it is used for the links in the emails)')
  } else {
    try {
      if (new URL(config.appUrl).protocol !== 'https:') problems.push('APP_URL must use https in production')
    } catch {
      problems.push('APP_URL is not a valid URL')
    }
  }
  if (!/^[^<>@]*<[^<>@\s]+@[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+$/.test(config.from)) {
    problems.push('MAIL_FROM is not valid (use: Name <address@domain>)')
  }
  if (problems.length > 0) {
    throw new Error(`Email configuration error: ${problems.join('; ')}`)
  }
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

let customTransport: MailTransport | null = null

/** Replaces the real transport (used by the tests). Pass null to restore the default. */
export function setMailTransport(transport: MailTransport | null) {
  customTransport = transport
}

async function sendWithResend(message: MailMessage, apiKey: string, from: string): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey

  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 300)
    throw new Error(`Resend responded ${response.status}: ${body}`)
  }
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (customTransport) return customTransport(message)

  const config = getMailConfig()
  if (config.apiKey) return sendWithResend(message, config.apiKey, config.from)

  if (isProduction()) throw new Error('RESEND_API_KEY is not set')

  // Development without a provider: show the message (it contains the link) in the log
  log.info('Email non inviata (nessun provider configurato) — contenuto:', {
    to: maskEmail(message.to),
    subject: message.subject,
    text: message.text,
  })
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export type VerificationEmailPurpose = 'signup' | 'change'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type VerificationCopy = {
  subject: Record<VerificationEmailPurpose, string>
  greeting: (name: string) => string
  intro: Record<VerificationEmailPurpose, string>
  button: Record<VerificationEmailPurpose, string>
  expiry: (hours: number) => string
  ignore: Record<VerificationEmailPurpose, string>
  fallback: string
}

const COPY: Record<MailLang, VerificationCopy> = {
  en: {
    subject: {
      signup: 'Confirm your email address — Coderoom',
      change: 'Confirm your new email address — Coderoom',
    },
    greeting: (name) => `Hi ${name},`,
    intro: {
      signup: 'Thanks for signing up for Coderoom. Please confirm this email address to activate your account.',
      change: 'You asked to use this email address for your Coderoom account. Confirm it to complete the change: until you do, your current address stays the same.',
    },
    button: { signup: 'Confirm email', change: 'Confirm new address' },
    expiry: (hours) => `This link is valid for ${hours} hours and can be used only once.`,
    ignore: {
      signup: "If you didn't sign up, you can ignore this message: the account will not be activated.",
      change: "If you didn't request this change, you can ignore this message: nothing will change.",
    },
    fallback: "If the button doesn't work, copy this address into your browser:",
  },
  it: {
    subject: {
      signup: 'Conferma il tuo indirizzo email — Coderoom',
      change: 'Conferma il nuovo indirizzo email — Coderoom',
    },
    greeting: (name) => `Ciao ${name},`,
    intro: {
      signup: 'Grazie per esserti registrato su Coderoom. Per attivare il tuo account conferma questo indirizzo email.',
      change: "Hai chiesto di usare questo indirizzo email per il tuo account Coderoom. Conferma per completare il cambio: finché non lo fai, l'indirizzo attuale resta invariato.",
    },
    button: { signup: 'Conferma email', change: 'Conferma nuovo indirizzo' },
    expiry: (hours) => `Il link è valido per ${hours} ore e può essere usato una sola volta.`,
    ignore: {
      signup: "Se non ti sei registrato tu, puoi ignorare questo messaggio: l'account non verrà attivato.",
      change: 'Se non hai chiesto tu questa modifica, puoi ignorare questo messaggio: non cambierà nulla.',
    },
    fallback: 'Se il pulsante non funziona, copia questo indirizzo nel browser:',
  },
}

export function buildVerificationEmail(params: {
  name: string
  link: string
  purpose: VerificationEmailPurpose
  expiresInHours: number
  lang?: MailLang
}): { subject: string; html: string; text: string } {
  const { link, purpose, expiresInHours } = params
  const lang = params.lang ?? getMailConfig().lang
  const copy = COPY[lang]
  const safeLink = escapeHtml(link)

  const subject = copy.subject[purpose]
  const greeting = copy.greeting(params.name)
  const intro = copy.intro[purpose]
  const button = copy.button[purpose]
  const expiry = copy.expiry(expiresInHours)
  const ignore = copy.ignore[purpose]

  const html = `<!doctype html>
<html lang="${lang}">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(greeting)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">${escapeHtml(intro)}</p>
        <p style="margin:0 0 24px;">
          <a href="${safeLink}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">${escapeHtml(button)}</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#52525b;">${escapeHtml(expiry)}</p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#52525b;">${escapeHtml(ignore)}</p>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;">${escapeHtml(copy.fallback)}<br><span style="word-break:break-all;">${safeLink}</span></p>
      </td></tr>
    </table>
  </body>
</html>`

  const text = `${greeting}

${intro}

${button}: ${link}

${expiry}
${ignore}
`

  return { subject, html, text }
}