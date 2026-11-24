/**
 * A name's other language, suggested (LATER_CHANGES_PLAN.md §3.1, step 2,
 * PR 399; DESIGN.md §5.3). Word by word, as an Egyptian full name is a row of
 * given names: each from Nizmo's list of names, then, for a business's name,
 * its business words in their places, then the rules, as a guess to check.
 * What a company has saved comes first when step 3 adds it. Only ever a
 * suggestion: nothing here is saved.
 */

import { GIVEN_NAMES } from "./given-names"
import { BUSINESS_WORDS, type BusinessWord } from "./business-words"
import { arabicGuess, englishGuess } from "./rules"
import { hasArabic } from "@/lib/names"

export type SuggestedWord = { text: string; from: "list" | "business" | "rules" }
export type Suggestion = { text: string; words: SuggestedWord[]; guesses: string[] }
export type SuggestFor = { to: "en" | "ar"; kind: "person" | "business" }

/** A name's marks, Quranic signs and stretching, which people may type or not. */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g
/** An Arabic word as it's looked up: its hamza on alef, final ى and ة as people often type them. */
const arabicKey = (word: string) => word.replace(MARKS, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s/g, "")
const englishKey = (word: string) => word.toLowerCase()

const BY_ARABIC = new Map<string, { ar: string; en: string }>()
const BY_ENGLISH = new Map<string, string>()
for (const [ar, en, ...also] of GIVEN_NAMES) {
    BY_ARABIC.set(arabicKey(ar), { ar, en })
    for (const spelling of [en, ...also]) BY_ENGLISH.set(spelling.toLowerCase(), ar)
}
const BUSINESS_BY_ARABIC = new Map(BUSINESS_WORDS.map(word => [word.ar.split(" ").map(arabicKey).join(" "), word]))
const BUSINESS_BY_ENGLISH = new Map(BUSINESS_WORDS.map(word => [word.en.split(" ").map(englishKey).join(" "), word]))
/** The most words a name of the list, or a business word, is written in. */
const LONGEST = 3

const ENGLISH = /[A-Za-z]/

/**
 * A name's other language, or null where there's nothing to suggest: no
 * name, or one with any letter of the language asked for already, as only a
 * name written wholly in the other language is suggested.
 */
export function suggestName(name: string, { to, kind }: SuggestFor): Suggestion | null {
    const tokens = name.split(/[\s\-]+/).filter(Boolean)
    if (to === "en" ? !hasArabic(name) || ENGLISH.test(name) : hasArabic(name) || !ENGLISH.test(name)) return null
    const words = to === "en" ? toEnglish(tokens, kind) : toArabic(tokens, kind)
    return {
        text: words.map(word => word.text).join(" "),
        words,
        guesses: words.filter(word => word.from === "rules").map(word => word.text),
    }
}

/** An Arabic name in English: its name's words, then business words where English puts them. */
function toEnglish(tokens: string[], kind: SuggestFor["kind"]): SuggestedWord[] {
    const { name, after, before, last } = kind === "business" ? businessParts(tokens, BUSINESS_BY_ARABIC, arabicKey) : { name: tokens, after: [], before: [], last: [] }
    const english = (word: BusinessWord): SuggestedWord => ({ text: word.en, from: "business" })
    return [...arabicName(name, kind), ...after.map(english), ...before.map(english), ...last.map(english)]
}

/** An English name in Arabic: business words where Arabic puts them, around its name's words. */
function toArabic(tokens: string[], kind: SuggestFor["kind"]): SuggestedWord[] {
    const { name, after, before, last } = kind === "business" ? businessParts(tokens, BUSINESS_BY_ENGLISH, englishKey) : { name: tokens, after: [], before: [], last: [] }
    const arabic = (word: BusinessWord): SuggestedWord => ({ text: word.ar, from: "business" })
    return [...before.map(arabic), ...englishName(name), ...after.map(arabic), ...last.map(arabic)]
}

/** A business's name split into its business words, by their places, and the words of its name. */
function businessParts(tokens: string[], words: Map<string, BusinessWord>, key: (word: string) => string) {
    const parts = { name: [] as string[], after: [] as BusinessWord[], before: [] as BusinessWord[], last: [] as BusinessWord[] }
    for (let i = 0; i < tokens.length; ) {
        let found: { word: BusinessWord; length: number } | null = null
        for (let length = Math.min(LONGEST, tokens.length - i); length > 0 && !found; length--) {
            const word = words.get(tokens.slice(i, i + length).map(key).join(" "))
            if (word) found = { word, length }
        }
        if (found) {
            parts[found.word.place].push(found.word)
            i += found.length
        } else {
            parts.name.push(tokens[i])
            i++
        }
    }
    return parts
}

/**
 * An Arabic name's words in English: a name of the list, of up to three
 * words typed with their spaces or without, the longest first; a word of
 * the list after its article, as El and the name, joined for a person
 * (Elsayed) and spaced for a business (El Nour); and the rules for the rest.
 */
function arabicName(tokens: string[], kind: SuggestFor["kind"]): SuggestedWord[] {
    const words: SuggestedWord[] = []
    for (let i = 0; i < tokens.length; ) {
        let found: { en: string; length: number } | null = null
        for (let length = Math.min(LONGEST, tokens.length - i); length > 0 && !found; length--) {
            const entry = BY_ARABIC.get(arabicKey(tokens.slice(i, i + length).join("")))
            if (entry) found = { en: entry.en, length }
        }
        const token = tokens[i]
        if (found) {
            words.push({ text: found.en, from: "list" })
            i += found.length
            continue
        }
        const named = token.length > 3 && token.startsWith("ال") ? BY_ARABIC.get(arabicKey(token.slice(2))) : undefined
        const guess = named ? "" : arabicGuess(token)
        if (named) words.push({ text: kind === "business" ? `El ${named.en}` : `El${named.en.toLowerCase()}`, from: "list" })
        else if (guess) words.push({ text: guess, from: "rules" })
        i++
    }
    return words
}

/**
 * An English name's words in Arabic: a name of any of its spellings, of up
 * to three words written spaced or joined, the longest first; El or Al
 * before one, spaced or joined, as its article; and the rules for the rest,
 * El or Al spaced before a name they guess read as joined to it.
 */
function englishName(tokens: string[]): SuggestedWord[] {
    const words: SuggestedWord[] = []
    const article = (token: string) => /^(el|al)$/i.test(token)
    for (let i = 0; i < tokens.length; ) {
        let found: { ar: string; length: number } | null = null
        for (let length = Math.min(LONGEST, tokens.length - i); length > 0 && !found; length--) {
            const tokensHere = tokens.slice(i, i + length)
            const ar = BY_ENGLISH.get(tokensHere.map(englishKey).join(""))
            if (ar) found = { ar, length }
            // El and the name after it.
            else if (length > 1 && article(tokensHere[0])) {
                const named = BY_ENGLISH.get(tokensHere.slice(1).map(englishKey).join(""))
                if (named) found = { ar: `ال${named}`, length }
            }
        }
        if (found) {
            words.push({ text: found.ar, from: "list" })
            i += found.length
            continue
        }
        // El spaced before a name of neither list: El Shenawy, as Elshenawy.
        if (article(tokens[i]) && i + 1 < tokens.length) {
            words.push({ text: `ال${englishGuess(tokens[i + 1])}`, from: "rules" })
            i += 2
            continue
        }
        // El joined to a name: Elsayed.
        const joined = englishKey(tokens[i]).match(/^(el|al)(.+)$/)
        const named = joined ? BY_ENGLISH.get(joined[2]) : undefined
        if (named) words.push({ text: `ال${named}`, from: "list" })
        else {
            const guess = englishGuess(tokens[i])
            if (guess) words.push({ text: guess, from: "rules" })
        }
        i++
    }
    return words
}
