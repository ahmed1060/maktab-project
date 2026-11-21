import { brandTokens } from "./brand-colour"
import type { ClientLanguage } from "./client-accounts"
import { escapeHtml } from "./html-text"

/**
 * What an office's emails to a client's people share (DESIGN.md §5.5, The
 * invitation's email and The update email): the frame they're drawn in,
 * with the office's initial and name at its top and, at its foot, that
 * Nizmo sent it on the office's behalf with the privacy policy's link; its
 * colours; the button; and how a sentence takes its names. Moved here,
 * unchanged, from the invitation's email (PR 325) when the update email
 * came (CLIENT_PORTAL_PLAN.md §4.4, PR 351). No database and no sending
 * here.
 */

/** An email as it's written, for lib/email.ts to send. */
export type WrittenEmail = {
    subject: string
    text: string
    html: string
    /** The name it's sent under: the office's. */
    fromName: string
    replyTo: { name: string; address: string } | null
}

// The light theme's neutrals (DESIGN.md §2.2): an email can't load the app's
// styles or follow a theme, so they're written into it.
export const PAGE = "#f6f9fc"
const PANEL = "#ffffff"
const INK = "#0d253d"
export const INK_2 = "#273951"
export const MUTED = "#5d6b82"
const RULE = "#e3e8ee"
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Arabic', Tahoma, Arial, sans-serif"

// Each name is kept whole in the plain text, as the app's own strings keep
// them (DESIGN.md §3.2). An email address isn't: it's copied to sign in with.
const FSI = String.fromCharCode(0x2068)
const PDI = String.fromCharCode(0x2069)

/** Text as text in HTML: never part of the email's code. */
export const escape = escapeHtml
/** A name on one line: a line break in it would end a header, or start another. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

/** What a sentence's braces hold, by name. */
export type Values = Record<string, string | undefined>
/** Which of a sentence's values are names, kept whole, and which an email address, written left to right. */
export type Kinds = { names: ReadonlySet<string>; email?: string }

/** A sentence with its values in: as they are, kept whole in plain text where they're names, or as text in HTML. */
export function fill(sentence: string, values: Values, as: "header" | "text" | "html", kinds: Kinds): string {
    return sentence.split(/(\{[a-z]+\})/).map(part => {
        const key = /^\{([a-z]+)\}$/.exec(part)?.[1]
        const value = key ? values[key] : undefined
        if (value === undefined) return as === "html" ? escape(part) : part
        if (as === "header") return value
        if (as === "text") return kinds.names.has(key!) ? `${FSI}${value}${PDI}` : value
        if (key === kinds.email) return `<bdi dir="ltr">${escape(value)}</bdi>`
        return kinds.names.has(key!) ? `<bdi>${escape(value)}</bdi>` : escape(value)
    }).join("")
}

/** The default brand colour's shades an email is drawn in (DESIGN.md §2.1). */
export type Colours = { brand: string; onBrand: string; brandText: string }
export function coloursOf(brand: string | null): Colours {
    const { light } = brandTokens(brand)
    return { brand: light["--brand"], onBrand: light["--on-brand"], brandText: light["--brand-text"] }
}

/** A paragraph of the email's body. */
export const paragraph = (inner: string, style = "") => `<p style="margin:0 0 14px;${style}">${inner}</p>`

/** The email's one button, at least 48px tall, to `link`, already written as HTML. */
export const button = (link: string, label: string, colours: Colours) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td style="border-radius:999px;background:${colours.brand};">
<a href="${link}" style="display:inline-block;padding:14px 28px 14px;line-height:20px;font-size:15px;font-weight:600;color:${colours.onBrand};text-decoration:none;border-radius:999px;">${escape(label)}</a>
</td></tr></table>`

/** Under the button, in the muted note size: the link itself, to copy where the button doesn't open, left to right. */
export const copyLine = (said: string, link: string, colours: Colours) =>
    paragraph(`${escape(said)} <a href="${link}" dir="ltr" style="color:${colours.brandText};word-break:break-all;">${link}</a>`, `font-size:13px;line-height:1.6;color:${MUTED};`)

export type Frame = {
    language: ClientLanguage
    subject: string
    /** The office's name, on one line. */
    office: string
    colours: Colours
    /** The body's lines, as HTML. */
    body: string[]
    /** The foot's sentence, as HTML, and the privacy policy's link. */
    sentBy: string
    privacy: { href: string; label: string }
}

/** The whole email, at most 600px wide: the office at its top, the body, and the foot under a rule. */
export function framed(frame: Frame): string {
    const dir = frame.language === "ar" ? "rtl" : "ltr"
    const { brand, onBrand, brandText } = frame.colours
    const initial = Array.from(frame.office)[0]?.toUpperCase() ?? "N"
    return `<!doctype html>
<html lang="${frame.language}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(frame.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="max-width:600px;background:${PANEL};border:1px solid ${RULE};border-radius:12px;font-family:${FONT};color:${INK};">
<tr><td style="padding:20px 28px;border-bottom:1px solid ${RULE};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}"><tr>
<td aria-hidden="true" width="36" height="36" align="center" style="width:36px;height:36px;border-radius:8px;background:${brand};color:${onBrand};font-size:16px;font-weight:600;">${escape(initial)}</td>
<td width="10" style="width:10px;"></td>
<td style="font-size:16px;font-weight:600;color:${INK};"><bdi>${escape(frame.office)}</bdi></td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 28px 10px;font-size:15px;line-height:1.7;color:${INK};">
${frame.body.join("\n")}
</td></tr>
<tr><td style="padding:18px 28px 22px;border-top:1px solid ${RULE};background:${PAGE};border-radius:0 0 12px 12px;font-size:12px;line-height:1.7;color:${MUTED};">
${frame.sentBy} <a href="${escape(frame.privacy.href)}" style="color:${brandText};">${escape(frame.privacy.label)}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`
}
