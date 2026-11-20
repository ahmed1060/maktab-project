import { INVITATION_HOURS } from "./client-invitation"
import type { ClientLanguage } from "./client-accounts"
import { button, coloursOf, copyLine, escape, fill as fillIn, framed, INK_2, oneLine, PAGE, paragraph as p, type Kinds, type WrittenEmail } from "./office-email"

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

export type InvitationEmail = WrittenEmail

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

const NAMES: Kinds = { names: new Set(["name", "office", "client", "sender"]), email: "email" }
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

type Fields = Partial<Record<"name" | "office" | "client" | "sender" | "email" | "hours", string>>

/** A sentence with its names in: as they are, kept whole in plain text, or as text in HTML. */
const fill = (sentence: string, values: Fields, as: "header" | "text" | "html") => fillIn(sentence, values, as, NAMES)

export function invitationEmail(facts: InvitationEmailFacts): InvitationEmail {
    const words = WORDS[facts.language]
    const arabic = facts.language === "ar"
    const office = oneLine(facts.office)
    const sender = facts.sender && oneLine(facts.sender.name) ? { name: oneLine(facts.sender.name), email: facts.sender.email } : null
    const values: Fields = {
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

    const colours = coloursOf(facts.brand)
    const link = escape(facts.link)
    const html = framed({
        language: facts.language,
        subject,
        office,
        colours,
        body: [
            p(fill(words.hello, values, "html")),
            p(fill(words.invited, values, "html")),
            p(escape(words.open)),
            button(link, words.button, colours),
            copyLine(words.copy, link, colours),
            p(fill(words.once, values, "html")),
            facts.resent ? p(escape(words.resent), `padding:10px 12px;border-radius:8px;background:${PAGE};color:${INK_2};font-size:14px;`) : "",
            p(escape(words.ignore)),
            p(fill(contact, values, "html")),
        ],
        sentBy: fill(words.sentBy, values, "html"),
        privacy: { href: facts.privacy, label: words.privacy },
    })

    return {
        subject,
        text,
        html,
        fromName: office,
        replyTo: sender ? { name: sender.name, address: sender.email } : null,
    }
}
