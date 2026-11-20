/**
 * The messages' templates (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10a;
 * PR 346): the two messages the client's page opens Contact on WhatsApp with,
 * Contact the accountant and Ask about this claim, each in Arabic and English.
 *
 * A text is kept with its fields as their names in braces, "{person}", which
 * are filled when the dialog opens. Nizmo's own start as §7 writes them; the
 * Super Admin changes Nizmo's, and a company's people its own copy
 * (ClientMessageTemplate). A company's people are given the company's copy,
 * else Nizmo's, else these.
 */

export const MESSAGE_KINDS = ['contact', 'claim'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const MESSAGE_LANGUAGES = ['ar', 'en'] as const
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number]

/**
 * What a message can name: the client account's name, the client's, the day
 * the figures are from; and a claim's number, its item as the page names it,
 * what remains, what was owed and its last day to pay.
 */
export type MessageField = 'person' | 'client' | 'asOf' | 'number' | 'item' | 'remaining' | 'original' | 'due'

/** Each message's own fields: a claim's can't be filled in Contact the accountant. */
export const MESSAGE_FIELDS: Record<MessageKind, readonly MessageField[]> = {
    contact: ['person', 'client', 'asOf'],
    claim: ['person', 'client', 'asOf', 'number', 'item', 'remaining', 'original', 'due'],
}

export const MESSAGE_MAX_LENGTH = 1000

/** The two messages, each in both languages. */
export type ClientMessages = Record<MessageKind, Record<MessageLanguage, string>>

/**
 * One of Nizmo's messages, as the Super Admin's page shows it (§12 step 10b,
 * PR 347): its text, and who changed it last and when, by the time its row
 * was last written; none for one never changed. That time is also what a
 * save says it started from.
 */
export type NizmoMessage = { kind: MessageKind; language: MessageLanguage; text: string; changedBy: string | null; changedAt: string | null }

/** Nizmo's own as §7 writes them, until the Super Admin changes them. */
export const NIZMO_MESSAGES: ClientMessages = {
    contact: {
        ar: 'السلام عليكم،\nأنا {person} من {client}.\nاستفسار عن الموقف الضريبي بتاريخ {asOf}:',
        en: 'Hello,\nThis is {person} from {client}.\nA question about the tax position as of {asOf}:',
    },
    claim: {
        ar: 'السلام عليكم،\nأنا {person} من {client}.\nاستفسار عن المطالبة رقم {number}:\nالبند: {item}\nالمتبقي: {remaining} جنيه من {original}\nآخر موعد للسداد: {due}',
        en: 'Hello,\nThis is {person} from {client}.\nA question about claim {number}:\nItem: {item}\nRemaining: EGP {remaining} of {original}\nLast day to pay: {due}',
    },
}

/**
 * Nizmo's own Contact the accountant before a client's first file, when
 * there's no day the figures are from (Decided, 2026-11-20).
 */
const NIZMO_CONTACT_UNDATED: Record<MessageLanguage, string> = {
    ar: 'السلام عليكم،\nأنا {person} من {client}.\nاستفسار عن الموقف الضريبي:',
    en: 'Hello,\nThis is {person} from {client}.\nA question about the tax position:',
}

/** A field in a text: a name in Latin letters, in braces. Other braces are text. */
const FIELD = /\{([A-Za-z]+)\}/g

function fieldsIn(text: string): string[] {
    const found: string[] = []
    const field = new RegExp(FIELD.source, 'g')
    for (let m = field.exec(text); m; m = field.exec(text)) found.push(m[1])
    return found
}

/** Characters as the database counts them: an emoji is one. */
export function messageLength(text: string): number {
    return Array.from(text).length
}

export type MessageProblem =
    | { problem: 'empty' }
    | { problem: 'too_long'; length: number }
    | { problem: 'field'; field: string }

/**
 * Why a text can't be kept for this message, or null: it's empty, it's over
 * 1,000 characters, or it names a field the message doesn't have.
 */
export function messageProblem(kind: MessageKind, text: string): MessageProblem | null {
    if (text.trim() === '') return { problem: 'empty' }
    const length = messageLength(text)
    if (length > MESSAGE_MAX_LENGTH) return { problem: 'too_long', length }
    const own: readonly string[] = MESSAGE_FIELDS[kind]
    const other = fieldsIn(text).find(field => !own.includes(field))
    return other === undefined ? null : { problem: 'field', field: other }
}

export type MessageValues = Partial<Record<MessageField, string | null>>

/**
 * The message as the dialog opens with it: each of its fields filled with
 * its value. A line whose field has nothing to fill is left out, so no
 * half-filled line is sent; Nizmo's own Contact the accountant, unchanged,
 * then asks about the tax position with no day, as it did before the
 * templates (Decided, 2026-11-20).
 */
export function fillMessage(kind: MessageKind, language: MessageLanguage, text: string, values: MessageValues): string {
    const own: readonly string[] = MESSAGE_FIELDS[kind]
    const value = (field: string) => (own.includes(field) ? values[field as MessageField] : undefined)
    const filled = (field: string) => { const v = value(field); return v !== null && v !== undefined && v !== '' }
    const written = kind === 'contact' && text === NIZMO_MESSAGES.contact[language] && !filled('asOf')
        ? NIZMO_CONTACT_UNDATED[language]
        : text
    return written.split(/\r?\n/)
        .filter(line => fieldsIn(line).every(field => !own.includes(field) || filled(field)))
        .map(line => line.replace(FIELD, (whole: string, field: string) => (own.includes(field) ? value(field) as string : whole)))
        .join('\n')
}

/** A kept text, as ClientMessageTemplate has it. */
export type KeptMessage = { companyId: string | null; kind: string; language: string; text: string }

/**
 * The texts a company's people are given, from the company's own and
 * Nizmo's kept: each message in each language the company's, else Nizmo's,
 * else Nizmo's own as written. A kept text that no longer passes the checks
 * gives way to the next.
 */
export function messagesFrom(kept: readonly KeptMessage[]): ClientMessages {
    const pick = (kind: MessageKind, language: MessageLanguage) => {
        const usable = kept.filter(k => k.kind === kind && k.language === language && messageProblem(kind, k.text) === null)
        return (usable.find(k => k.companyId !== null) ?? usable.find(k => k.companyId === null))?.text ?? NIZMO_MESSAGES[kind][language]
    }
    return {
        contact: { ar: pick('contact', 'ar'), en: pick('contact', 'en') },
        claim: { ar: pick('claim', 'ar'), en: pick('claim', 'en') },
    }
}
