/**
 * English and Arabic names (LATER_CHANGES_PLAN.md §3, step 1, PR 398; DESIGN.md
 * §5.3): an employee's first and last names, a client's name and its owner's,
 * and the company's name are each kept in both languages. The column there
 * before keeps the English, and an Arabic one is beside it (`firstNameAr`,
 * `nameAr`, …).
 *
 * A name written in Arabic before is in the English column still, copied
 * into its Arabic one (prisma/migrations/20270119000000_names_in_arabic). Its
 * Arabic letters say it has no English yet, so nothing was guessed or moved.
 */

import type { Locale } from "@/lib/translations"

/**
 * Arabic letters: the Arabic block, its supplement and extended letters,
 * and the presentation forms, short of the byte order mark (U+FEFF) at
 * their end, which isn't a letter. The migration reads the same ranges.
 */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/
const ENGLISH = /[A-Za-z]/

/** Whether any of a name's letters is Arabic. */
export function hasArabic(text: string | null | undefined): boolean {
    return !!text && ARABIC.test(text)
}

/** A name for an Arabic column: in Arabic letters, with no English ones. */
export function writtenInArabic(text: string): boolean {
    return hasArabic(text) && !ENGLISH.test(text)
}

/** One name in both languages: the English column, and the Arabic beside it. */
export type TwoLanguages = { en: string; ar?: string | null }

/**
 * A name in the page's language: the Arabic on an Arabic page and the
 * English on an English one, or the one it has while it has only one.
 */
export function nameIn(locale: Locale, name: TwoLanguages): string {
    const en = name.en.trim()
    const ar = name.ar?.trim() ?? ""
    return locale === "ar" ? ar || en : en || ar
}

/** A person's names, as the User table keeps them. */
export type PersonNames = { firstName: string; lastName: string; firstNameAr?: string | null; lastNameAr?: string | null }

/** A person's first and last names, each in the page's language. */
export function personName(person: PersonNames, locale: Locale): string {
    const first = nameIn(locale, { en: person.firstName, ar: person.firstNameAr })
    const last = nameIn(locale, { en: person.lastName, ar: person.lastNameAr })
    return [first, last].filter(Boolean).join(" ")
}

/**
 * The languages a record's names are missing, each once, English first: the
 * English where its column is empty or holds a name written in Arabic, and
 * the Arabic where its column is empty.
 */
export function missingLanguages(names: TwoLanguages[]): ("en" | "ar")[] {
    const missing = new Set<"en" | "ar">()
    for (const name of names) {
        if (!name.en.trim() || hasArabic(name.en)) missing.add("en")
        if (!name.ar?.trim()) missing.add("ar")
    }
    return (["en", "ar"] as const).filter(language => missing.has(language))
}

/**
 * The Arabic to keep beside a name being saved: the one given, or the name
 * itself where it's written in Arabic, as a form that asks for one name only
 * sends it, so a name in Arabic always has its Arabic. Undefined leaves the
 * Arabic as it is.
 *
 * `before` is the name as it was. A name sent back unchanged with the rest of
 * a form leaves an Arabic it has as it is, so one corrected since is never
 * written over (Codex review on PR 398); one with no Arabic yet gets it.
 */
export function arabicBeside(name: string | undefined, given: string | undefined, before?: TwoLanguages): string | undefined {
    if (given !== undefined) return given
    if (name === undefined || !hasArabic(name)) return undefined
    if (before && name === before.en && before.ar?.trim()) return undefined
    return name
}

/**
 * A name in both languages, to show both, as a name change's details do
 * (LATER_CHANGES_PLAN.md §3.1, step 4c, PR 404): the page's language first,
 * each once, and only the ones it has.
 */
export function bothLanguages(locale: Locale, name: TwoLanguages): string[] {
    const en = name.en.trim()
    const ar = name.ar?.trim() ?? ""
    const shown = locale === "ar" ? [ar, en] : [en, ar]
    return shown.filter((one, at) => one && shown.indexOf(one) === at)
}

/** A request to change one's own name, as ProfileUpdateRequest keeps it. */
export type AskedNames = { newFirstName: string; newLastName: string; newFirstNameAr?: string | null; newLastNameAr?: string | null }

/**
 * The names a name change saves once it's approved (LATER_CHANGES_PLAN.md
 * §3.1, step 4c, PR 404): each in both languages, as it was asked. One asked
 * before, with its English only, keeps an Arabic as PR 398 did
 * (arabicBeside): the name itself where it's written in Arabic, or the one
 * it had. `before` is the person's names as they are.
 */
export function approvedNames(asked: AskedNames, before?: PersonNames | null): { firstName: string; lastName: string; firstNameAr?: string; lastNameAr?: string } {
    const firstNameAr = asked.newFirstNameAr ?? arabicBeside(asked.newFirstName, undefined, before ? { en: before.firstName, ar: before.firstNameAr } : undefined)
    const lastNameAr = asked.newLastNameAr ?? arabicBeside(asked.newLastName, undefined, before ? { en: before.lastName, ar: before.lastNameAr } : undefined)
    return {
        firstName: asked.newFirstName,
        lastName: asked.newLastName,
        ...(firstNameAr !== undefined && { firstNameAr }),
        ...(lastNameAr !== undefined && { lastNameAr }),
    }
}
