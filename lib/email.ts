import nodemailer from 'nodemailer'

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
export async function sendVerificationCodeEmail(to: string, code: string, purpose: VerificationEmailPurpose, expiryMinutes: number = 10): Promise<void> {
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
}
