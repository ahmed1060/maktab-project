import nodemailer from 'nodemailer'
import { isUnroutableAddress } from './unroutable-address'

// F-27, Phase 0: the app's first-ever outbound email capability. Sends
// through a dedicated Gmail account (GMAIL_USER/GMAIL_APP_PASSWORD) rather
// than a transactional email provider — deliberately, since the app has no
// domain to verify with one (see the remediation log). No queue/retry
// infra at this scale; a failed send is surfaced as a retryable error to
// whoever triggered it, same as any other transient failure in this app.
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn("⚠️ Gmail credentials missing (GMAIL_USER/GMAIL_APP_PASSWORD). Outbound email will fail.")
}

const transporter = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    })
    : null

// Mirrors the Prisma VerificationPurpose enum. Kept as a separate type
// here rather than importing the Prisma one, so this module doesn't pull
// in the Prisma client just to know its own subject lines.
export type VerificationEmailPurpose = 'EMAIL_VERIFY' | 'EMAIL_CHANGE' | 'MFA_RECOVERY' | 'PASSWORD_RESET'

/**
 * What happened to a send.
 *
 * SKIPPED_UNROUTABLE is not a failure and must not be retried: the address is
 * one of the IETF's reserved names, so there is no server to deliver it to and
 * there never will be. Reporting it rather than returning silently matters,
 * because "sent" and "deliberately not sent" are different facts and a caller
 * that stamps an emailedAt should be able to tell them apart.
 */
export type SendOutcome = 'SENT' | 'SKIPPED_UNROUTABLE'

/**
 * The one place a demo address is stopped.
 *
 * Seeded payroll data carries names, salaries and payslips. Every one of those
 * is a message somebody would be upset to receive by mistake, and the only
 * reliable defence is that the address cannot be delivered to at all — checked
 * here, at the door, rather than at each of the growing number of places that
 * send something.
 */
function refuseUnroutable(to: string, what: string): boolean {
    if (!isUnroutableAddress(to)) return false
    console.warn(`✉️  Not sending ${what}: ${to} is a reserved address that cannot reach anybody.`)
    return true
}

const SUBJECTS: Record<VerificationEmailPurpose, string> = {
    EMAIL_VERIFY: 'Verify your email — Nizmo',
    EMAIL_CHANGE: 'Confirm your new email — Nizmo',
    MFA_RECOVERY: 'Your Nizmo sign-in code',
    PASSWORD_RESET: 'Reset your Nizmo password',
}

const INTROS: Record<VerificationEmailPurpose, string> = {
    EMAIL_VERIFY: 'Use this code to verify your email address.',
    EMAIL_CHANGE: 'Use this code to confirm your new email address.',
    MFA_RECOVERY: "Use this code to sign in — you're seeing this because you asked for a code instead of your authenticator app.",
    PASSWORD_RESET: 'Use this code to reset your password.',
}

/**
 * Sends a 6-digit verification code by email. English-only for now — the
 * app's translation infrastructure (lib/translations) isn't wired into
 * this yet; worth revisiting if bilingual email content matters later.
 */
export async function sendVerificationCodeEmail(to: string, code: string, purpose: VerificationEmailPurpose, expiryMinutes: number = 10): Promise<SendOutcome> {
    if (refuseUnroutable(to, `a ${purpose} code`)) return 'SKIPPED_UNROUTABLE'

    if (!transporter) {
        throw new Error('EMAIL_NOT_CONFIGURED')
    }

    const intro = INTROS[purpose]
    const text = `${intro}\n\nYour code: ${code}\n\nThis code expires in ${expiryMinutes} minutes. If you didn't request this, you can ignore this email.`
    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <p style="color: #1c2420; font-size: 15px;">${intro}</p>
            <p style="font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.1em; color: #24483f; margin: 24px 0; text-align: center;">${code}</p>
            <p style="color: #7c877e; font-size: 13px;">This code expires in ${expiryMinutes} minutes. If you didn't request this, you can ignore this email.</p>
        </div>
    `

    await transporter.sendMail({
        from: `Nizmo <${process.env.GMAIL_USER}>`,
        to,
        subject: SUBJECTS[purpose],
        text,
        html,
    })

    return 'SENT'
}

/**
 * A plain transactional email, for content that is not a verification code.
 *
 * Kept separate from sendVerificationCodeEmail rather than generalising it: that
 * one's whole shape — a big monospaced code, an expiry line — exists for one
 * job, and bending it into a general sender would make both worse.
 *
 * Throws on failure, deliberately. The caller decides what a failed send means;
 * for subscription notices it means "do not mark this as sent", so it is
 * retried tomorrow rather than silently lost.
 */
export async function sendPlainEmail(to: string, subject: string, text: string): Promise<SendOutcome> {
    // Before the transporter check, on purpose. A reserved address is a settled
    // answer — there is nothing to configure that would make it deliverable —
    // so it should give the same result whether or not Gmail is set up.
    if (refuseUnroutable(to, `"${subject}"`)) return 'SKIPPED_UNROUTABLE'

    if (!transporter) {
        throw new Error('EMAIL_NOT_CONFIGURED')
    }

    const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
            ${text.split('\n').map(line =>
                line.trim() === ''
                    ? '<div style="height: 12px;"></div>'
                    : `<p style="color: #1c2420; font-size: 15px; line-height: 1.6; margin: 0;">${line}</p>`
            ).join('')}
        </div>
    `

    await transporter.sendMail({
        from: `Nizmo <${process.env.GMAIL_USER}>`,
        to,
        subject,
        text,
        html,
    })

    return 'SENT'
}
