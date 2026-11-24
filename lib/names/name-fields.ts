import { hasArabic, writtenInArabic } from "@/lib/names"
import type { TranslationKey } from "@/lib/translations"
import type { Suggestion } from "./suggest"

/**
 * A name in English and in Arabic (DESIGN.md §5.3; LATER_CHANGES_PLAN.md
 * §3.1, step 4a, PR 402): the rules of its two fields, apart from their
 * look, which components/ui/NameFields.tsx draws. Kept from the server's
 * code, so a page can use them without the list of names coming with them.
 */

export type NameLanguage = "en" | "ar"
export type TwoNames = { en: string; ar: string }

/** The two fields in their order: the page's language first, on the start side. */
export function fieldsInOrder(locale: string): NameLanguage[] {
    return locale === "ar" ? ["ar", "en"] : ["en", "ar"]
}

/** What to suggest: the name typed in one field, in the other's language, while it's empty. */
export function toSuggest(names: TwoNames): { name: string; to: NameLanguage } | null {
    const en = names.en.trim()
    const ar = names.ar.trim()
    if (en && !ar) return { name: en, to: "ar" }
    if (ar && !en) return { name: ar, to: "en" }
    return null
}

/** Where a name's suggestion is asked (GET /api/names/suggest, step 3b): the Super Admin's for the company in view. */
export function suggestionPath(asked: { name: string; to: NameLanguage }, kind: "person" | "business", companyId?: string | null): string {
    const query = new URLSearchParams({ name: asked.name, to: asked.to, kind })
    if (companyId) query.set("companyId", companyId)
    return `/api/names/suggest?${query}`
}

/**
 * Where a suggestion comes from, said beside it: how many names here use
 * it, where it's all the company's (the fewest of its words'), or the
 * usual spelling, where it's all Nizmo's list. A business's words for what
 * it is and does are either's. Nothing for a guess, or for a mix of the two.
 */
export function sourceOf(suggestion: Suggestion): { uses: number } | "usual" | null {
    const words = suggestion.words.filter(word => word.from !== "business")
    if (words.length && words.every(word => word.from === "company")) return { uses: Math.min(...words.map(word => word.uses ?? 0)) }
    if (words.every(word => word.from === "list")) return "usual"
    return null
}

/** A spelling offered under the empty field, with how many names here use it, or as the usual one. */
export type SpellingOption = { text: string; uses?: number; usual?: true }

/**
 * The spellings offered when the empty field is focused (DESIGN.md §5.3):
 * a word's own, the company's first, the most used first, then the usual
 * one; a name of several words, the suggestion, then each word's others in
 * its place. Only the company's words have others (step 3b), each spelled
 * apart from the rest. None where there's only the one.
 */
export function spellingOptions(suggestion: Suggestion): SpellingOption[] {
    const options: SpellingOption[] = [suggestion.words.length === 1 ? { text: suggestion.text, uses: suggestion.words[0].uses } : { text: suggestion.text }]
    suggestion.words.forEach((word, i) => {
        for (const other of word.others ?? []) {
            const text = suggestion.words.map((w, j) => (j === i ? other.text : w.text)).join(" ")
            options.push(other.from === "company" ? { text, uses: other.uses } : { text, usual: true })
        }
    })
    return options.length > 1 ? options : []
}

/** What's wrong with a new name in one of its languages. */
export type NameMistake = "required" | "use_suggestion" | "not_english" | "not_arabic"

/** What a mistake says, `{name}` for the name in a sentence ("first name"). */
export function mistakeKey(mistake: NameMistake, language: NameLanguage): TranslationKey {
    if (mistake === "required") return language === "en" ? "name_required_en" : "name_required_ar"
    if (mistake === "use_suggestion") return language === "en" ? "name_use_suggestion_en" : "name_use_suggestion_ar"
    return mistake === "not_english" ? "name_not_english" : "name_not_arabic"
}

/**
 * A new name's mistakes: each language needed (DESIGN.md §5.3), the
 * suggestion offered for one left empty where the other is typed, and each
 * in its own letters, as the server takes them.
 */
export function newNameErrors(names: TwoNames): Partial<Record<NameLanguage, NameMistake>> {
    const en = names.en.trim()
    const ar = names.ar.trim()
    const errors: Partial<Record<NameLanguage, NameMistake>> = {}
    if (!en) errors.en = ar ? "use_suggestion" : "required"
    else if (hasArabic(en)) errors.en = "not_english"
    if (!ar) errors.ar = en ? "use_suggestion" : "required"
    else if (!writtenInArabic(ar)) errors.ar = "not_arabic"
    return errors
}
