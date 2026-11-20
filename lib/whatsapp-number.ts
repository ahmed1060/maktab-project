/**
 * A person's WhatsApp number, as it's typed on their profile and as it's
 * kept (CLIENT_PORTAL_PLAN.md §7, step 9a; DESIGN.md §5.5; PR 340): an
 * Egyptian mobile starting 01, or the number with its country code (+),
 * kept with its country code, "+201001234567". Empty is no number.
 *
 * The same rule on the profile, before anything is sent, and on the server,
 * which keeps what this gives; a CHECK in the column's migration holds the
 * shape it's kept in.
 */

export type WhatsAppNumber = { ok: true; number: string | null } | { ok: false }

/** Arabic-Indic digits, and the Persian ones a phone's keyboard can type, as their own. */
const DIGITS: Record<string, string> = {}
for (let i = 0; i < 10; i++) {
    DIGITS[String.fromCharCode(0x0660 + i)] = String(i)
    DIGITS[String.fromCharCode(0x06f0 + i)] = String(i)
}

/** An Egyptian mobile: 010, 011, 012 or 015, then eight digits. */
const EGYPTIAN_MOBILE = /^1[0125][0-9]{8}$/

export function whatsappNumber(typed: string): WhatsAppNumber {
    // What a number is written with but isn't: spaces (one that doesn't
    // break too, as a pasted one can have), dashes, dots and brackets.
    const plain = typed
        .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => DIGITS[digit])
        .replace(/[\s\u00a0\-.()]/g, "")
    if (plain === "") return { ok: true, number: null }

    // 00 is how a country code is often dialled in Egypt.
    const international = plain.startsWith("00") ? `+${plain.slice(2)}` : plain
    if (international.startsWith("+")) {
        if (!/^\+[1-9][0-9]{7,14}$/.test(international)) return { ok: false }
        // Egypt's own are held to its mobiles, as typed from 01.
        if (international.startsWith("+20") && !EGYPTIAN_MOBILE.test(international.slice(3))) return { ok: false }
        return { ok: true, number: international }
    }
    if (international.startsWith("0") && EGYPTIAN_MOBILE.test(international.slice(1))) return { ok: true, number: `+20${international.slice(1)}` }
    return { ok: false }
}
