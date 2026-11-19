import { brandTokens } from "./brand-colour"
import { INVITATION_HOURS } from "./client-invitation"
import type { ClientLanguage } from "./client-accounts"
import { escapeHtml } from "./html-text"

/**
 * The invitation's email (CLIENT_PORTAL_PLAN.md §5.2, step 6b-2; DESIGN.md
 * §5.5, The invitation's email; PR 325): what one of a client's people is
 * sent when the office adds them, or sends their invitation again. In the
 * language they're invited in alone, never both in one; the words are the
 * ones agreed with the owner on the design canvas. No database and no
 * sending here: lib/services/client-account.service.ts gathers the facts and
 * lib/email.ts sends it.
 */

export type InvitationEmailFacts = {
    language: ClientLanguage
    person: { name: string; email: string }
    office: string
    client: string
    /** Whoever in the office sent it, for the reply and the line to ask them; none for a Super Admin. */
    sender: { name: string; email: string } | null
    /** The invitation's link (lib/client-invitation.ts), on Nizmo's own address. */
    link: string
    /** The privacy policy, on the same address. */
    privacy: string
    /** Sent again: an earlier link no longer works. */
    resent: boolean
    /** The default brand colour the Super Admin set, or none for Nizmo's own (DESIGN.md §2.1). */
    brand: string | null
}

export type InvitationEmail = {
    subject: string
    text: string
    html: string
    /** The name it's sent under: the office's. */
    fromName: string
    replyTo: { name: string; address: string } | null
}

const WORDS: Record<ClientLanguage, Record<string, string>> = {
    en: {
        subject: "Invitation to the tax position of {client}",
        hello: "Hello {name},",
        invited: "{office} invited you to the tax position of {client} on Nizmo.",
        open: "To set your password, open this link:",
        button: "Set password",
        copy: "If the button doesn't open, copy this link into your browser:",
        once: "This link works once, for {hours} hours. Once your password is set, you sign in with {email}.",
        resent: "Any earlier invitation link no longer works.",
        ignore: "If you weren't expecting this, you can ignore this email. The account can't be used until a password is set.",
        contact: "For any questions, please contact {sender} at {office}.",
        contactOffice: "For any questions, please contact {office}.",
        sentBy: "Sent through Nizmo on behalf of {office}.",
        privacy: "Privacy policy",
    },
    ar: {
        subject: "دعوة لمتابعة الموقف الضريبي لـ{client}",
        hello: "مرحبًا {name}،",
        invited: "دعوة من {office} لمتابعة الموقف الضريبي لـ{client} على Nizmo.",
        open: "لتعيين كلمة المرور، يُرجى فتح الرابط التالي:",
        button: "تعيين كلمة المرور",
        copy: "إذا لم يفتح الزر، يمكن نسخ هذا الرابط في المتصفح:",
        once: "الرابط صالح لمرة واحدة، لمدة {hours} ساعة. وبعد تعيين كلمة المرور، يكون تسجيل الدخول بالبريد الإلكتروني {email}.",
        resent: "أي رابط دعوة سابق لم يعد صالحًا.",
        ignore: "إذا لم تكن هذه الدعوة متوقعة، يمكن تجاهل هذه الرسالة، ولا يمكن استخدام الحساب قبل تعيين كلمة المرور.",
        contact: "للاستفسار، يُرجى التواصل مع {sender} من {office}.",
        contactOffice: "للاستفسار، يُرجى التواصل مع {office}.",
        sentBy: "أُرسلت هذه الرسالة عبر Nizmo نيابةً عن {office}.",
        privacy: "سياسة الخصوصية",
    },
}

// The light theme's neutrals (DESIGN.md §2.2): an email can't load the app's
// styles or follow a theme, so they're written into it.
const PAGE = "#f6f9fc"
const PANEL = "#ffffff"
const INK = "#0d253d"
const INK_2 = "#273951"
const MUTED = "#5d6b82"
const RULE = "#e3e8ee"
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Arabic', Tahoma, Arial, sans-serif"

// Each name is kept whole in the plain text, as the app's own strings keep
// them (DESIGN.md §3.2). The email address isn't: it's copied to sign in with.
const FSI = String.fromCharCode(0x2068)
const PDI = String.fromCharCode(0x2069)
const NAMES = new Set(["name", "office", "client", "sender"])

/** Text as text in HTML: never part of the email's code. */
const escape = escapeHtml
/** A name on one line: a line break in it would end a header, or start another. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

type Values = Partial<Record<"name" | "office" | "client" | "sender" | "email" | "hours", string>>

/** A sentence with its names in: as they are, kept whole in plain text, or as text in HTML. */
function fill(sentence: string, values: Values, as: "header" | "text" | "html"): string {
    return sentence.split(/(\{[a-z]+\})/).map(part => {
        const key = /^\{([a-z]+)\}$/.exec(part)?.[1] as keyof Values | undefined
        const value = key ? values[key] : undefined
        if (value === undefined) return as === "html" ? escape(part) : part
        if (as === "header") return value
        if (as === "text") return NAMES.has(key!) ? `${FSI}${value}${PDI}` : value
        if (key === "email") return `<bdi dir="ltr">${escape(value)}</bdi>`
        return NAMES.has(key!) ? `<bdi>${escape(value)}</bdi>` : escape(value)
    }).join("")
}

export function invitationEmail(facts: InvitationEmailFacts): InvitationEmail {
    const words = WORDS[facts.language]
    const arabic = facts.language === "ar"
    const office = oneLine(facts.office)
    const sender = facts.sender && oneLine(facts.sender.name) ? { name: oneLine(facts.sender.name), email: facts.sender.email } : null
    const values: Values = {
        name: oneLine(facts.person.name),
        office,
        client: oneLine(facts.client),
        sender: sender?.name,
        email: facts.person.email,
        hours: arabic ? String(INVITATION_HOURS).replace(/\d/g, d => ARABIC_DIGITS[Number(d)]) : String(INVITATION_HOURS),
    }
    const contact = sender ? words.contact : words.contactOffice
    const subject = fill(words.subject, values, "header")

    const text = [
        fill(words.hello, values, "text"),
        "",
        fill(words.invited, values, "text"),
        "",
        words.open,
        facts.link,
        "",
        fill(words.once, values, "text"),
        ...(facts.resent ? ["", words.resent] : []),
        "",
        words.ignore,
        "",
        fill(contact, values, "text"),
        "",
        fill(words.sentBy, values, "text"),
        `${words.privacy}: ${facts.privacy}`,
    ].join("\n")

    const { light } = brandTokens(facts.brand)
    const brand = light["--brand"]
    const onBrand = light["--on-brand"]
    const brandText = light["--brand-text"]
    const dir = arabic ? "rtl" : "ltr"
    const link = escape(facts.link)
    const initial = Array.from(office)[0]?.toUpperCase() ?? "N"
    const p = (inner: string, style = "") => `<p style="margin:0 0 14px;${style}">${inner}</p>`

    const html = `<!doctype html>
<html lang="${facts.language}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="max-width:600px;background:${PANEL};border:1px solid ${RULE};border-radius:12px;font-family:${FONT};color:${INK};">
<tr><td style="padding:20px 28px;border-bottom:1px solid ${RULE};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}"><tr>
<td aria-hidden="true" width="36" height="36" align="center" style="width:36px;height:36px;border-radius:8px;background:${brand};color:${onBrand};font-size:16px;font-weight:600;">${escape(initial)}</td>
<td width="10" style="width:10px;"></td>
<td style="font-size:16px;font-weight:600;color:${INK};"><bdi>${escape(office)}</bdi></td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 28px 10px;font-size:15px;line-height:1.7;color:${INK};">
${p(fill(words.hello, values, "html"))}
${p(fill(words.invited, values, "html"))}
${p(escape(words.open))}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td style="border-radius:999px;background:${brand};">
<a href="${link}" style="display:inline-block;padding:14px 28px 14px;line-height:20px;font-size:15px;font-weight:600;color:${onBrand};text-decoration:none;border-radius:999px;">${escape(words.button)}</a>
</td></tr></table>
${p(`${escape(words.copy)} <a href="${link}" dir="ltr" style="color:${brandText};word-break:break-all;">${link}</a>`, `font-size:13px;line-height:1.6;color:${MUTED};`)}
${p(fill(words.once, values, "html"))}
${facts.resent ? p(escape(words.resent), `padding:10px 12px;border-radius:8px;background:${PAGE};color:${INK_2};font-size:14px;`) : ""}
${p(escape(words.ignore))}
${p(fill(contact, values, "html"))}
</td></tr>
<tr><td style="padding:18px 28px 22px;border-top:1px solid ${RULE};background:${PAGE};border-radius:0 0 12px 12px;font-size:12px;line-height:1.7;color:${MUTED};">
${fill(words.sentBy, values, "html")} <a href="${escape(facts.privacy)}" style="color:${brandText};">${escape(words.privacy)}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`

    return {
        subject,
        text,
        html,
        fromName: office,
        replyTo: sender ? { name: sender.name, address: sender.email } : null,
    }
}
