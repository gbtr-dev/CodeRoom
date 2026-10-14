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
  heading: Record<VerificationEmailPurpose, string>
  label: string
  nextStep: string
  greeting: (name: string) => string
  intro: Record<VerificationEmailPurpose, string>
  button: Record<VerificationEmailPurpose, string>
  expiry: (hours: number) => string
  ignore: Record<VerificationEmailPurpose, string>
  fallback: string
  footer: string
}

const COPY: Record<MailLang, VerificationCopy> = {
  en: {
    subject: {
      signup: 'Confirm your email address — Coderoom',
      change: 'Confirm your new email address — Coderoom',
    },
    heading: { signup: 'One last step. Make it yours.', change: 'Confirm your new email.' },
    label: 'YOUR CODEROOM ACCOUNT',
    nextStep: 'The link opens a page where you can review and confirm your request.',
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
    footer: "An account notification from Coderoom.",
  },
  it: {
    subject: {
      signup: 'Conferma il tuo indirizzo email — Coderoom',
      change: 'Conferma il nuovo indirizzo email — Coderoom',
    },
    heading: { signup: 'Un ultimo passo. Ci sei.', change: 'Conferma la nuova email.' },
    label: 'IL TUO ACCOUNT CODEROOM',
    nextStep: 'Il link apre una pagina dove puoi confermare la tua richiesta.',
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
    footer: 'Una comunicazione relativa al tuo account.',
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
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#edf1ef;color:#17221c;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(intro)} ${escapeHtml(expiry)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#edf1ef" style="width:100%;background-color:#edf1ef;">
    <tr><td align="center" style="padding:36px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;">
        <tr><td bgcolor="#101915" style="padding:26px 28px;background-color:#101915;border-radius:16px 16px 0 0;border-bottom:3px solid #4ade80;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="padding-right:12px;color:#4ade80;font-family:Consolas,Menlo,monospace;font-size:22px;font-weight:bold;">&lt;/&gt;</td>
            <td style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:bold;letter-spacing:-0.5px;">Coderoom</td>
          </tr></table>
        </td></tr>
        <tr><td bgcolor="#ffffff" style="padding:32px 28px;background-color:#ffffff;border-left:1px solid #dce5df;border-right:1px solid #dce5df;">
          <p style="margin:0 0 14px;color:#39714e;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:1.6px;">${escapeHtml(copy.label)}</p>
          <h1 style="margin:0 0 24px;color:#13251a;font-size:30px;line-height:36px;letter-spacing:-0.8px;font-weight:bold;">${escapeHtml(copy.heading[purpose])}</h1>
          <p style="margin:0 0 10px;color:#17221c;font-size:16px;line-height:25px;font-weight:bold;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 26px;color:#4b5c52;font-size:15px;line-height:25px;">${escapeHtml(intro)}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td align="center" bgcolor="#4ade80" style="background-color:#4ade80;border-radius:8px;mso-padding-alt:16px 24px;">
              <a href="${safeLink}" style="display:inline-block;border:1px solid #4ade80;border-radius:8px;padding:15px 23px;color:#102218;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:bold;text-decoration:none;mso-padding-alt:0;">${escapeHtml(button)}</a>
            </td>
          </tr></table>
          <p style="margin:16px 0 24px;color:#5c6b62;font-size:12px;line-height:19px;">${escapeHtml(copy.nextStep)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td bgcolor="#f1f7f3" style="padding:14px 16px;background-color:#f1f7f3;border-left:3px solid #4ade80;color:#365340;font-size:13px;line-height:21px;">${escapeHtml(expiry)}</td>
          </tr></table>
          <p style="margin:20px 0 0;color:#5c6b62;font-size:13px;line-height:21px;">${escapeHtml(ignore)}</p>
        </td></tr>
        <tr><td bgcolor="#f8faf9" style="padding:22px 28px;background-color:#f8faf9;border:1px solid #dce5df;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 8px;color:#5c6b62;font-size:12px;line-height:19px;">${escapeHtml(copy.fallback)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;border-collapse:separate;">
            <tr><td bgcolor="#ffffff" style="padding:14px 16px;background-color:#ffffff;border:1px solid #dce5df;border-radius:8px;word-break:break-all;overflow-wrap:anywhere;">
              <a href="${safeLink}" style="color:#365340;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:20px;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeLink}</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:24px 16px 4px;">
          <p style="margin:0 0 5px;color:#365340;font-size:13px;line-height:20px;font-weight:bold;">Coderoom</p>
          <p style="margin:0;color:#64756a;font-size:12px;line-height:19px;">${escapeHtml(copy.footer)}</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`

  const text = `${greeting}

${intro}

${button}: ${link}

${copy.nextStep}

${expiry}
${ignore}
`

  return { subject, html, text }
}