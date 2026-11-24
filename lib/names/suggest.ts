/**
 * A name's other language, suggested (LATER_CHANGES_PLAN.md §3.1, step 2,
 * PR 399; DESIGN.md §5.3). Word by word, as an Egyptian full name is a row of
 * given names: each from Nizmo's list of names, then, for a business's name,
 * its business words in their places, then the rules, as a guess to check.
 * What the company has saved comes first, the most used first (§3.1, step
 * 3b, PR 401), each word with its other spellings under it. Only ever a
 * suggestion: nothing here is saved.
 */

import { GIVEN_NAMES } from "./given-names"
import { BUSINESS_WORDS, type BusinessWord } from "./business-words"
import { arabicGuess, englishGuess } from "./rules"
import { hasArabic } from "@/lib/names"

/** Another spelling of a word: the company's, with how many names use it, or the usual one. */
export type OtherSpelling = { text: string; from: "company" | "list"; uses?: number }
/** A word suggested, and where from; one of the company's with how many names use it, and its others. */
export type SuggestedWord = { text: string; from: "company" | "list" | "business" | "rules"; uses?: number; others?: OtherSpelling[] }
export type Suggestion = { text: string; words: SuggestedWord[]; guesses: string[] }
/** The company's spellings of the words asked about, by how each is looked up (lib/names/spellings.ts). */
export type SavedSpellings = Map<string, { text: string; uses: number }[]>
export type SuggestFor = { to: "en" | "ar"; kind: "person" | "business"; saved?: SavedSpellings }

/** A name's marks, Quranic signs and stretching, which people may type or not. */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g
/** An Arabic word as it's looked up: its hamza on alef, final ى and ة as people often type them. */
export const arabicKey = (word: string) => word.replace(MARKS, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s/g, "")
export const englishKey = (word: string) => word.toLowerCase()

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
export function suggestName(name: string, { to, kind, saved }: SuggestFor): Suggestion | null {
    const tokens = name.split(/[\s\-]+/).filter(Boolean)
    if (to === "en" ? !hasArabic(name) || ENGLISH.test(name) : hasArabic(name) || !ENGLISH.test(name)) return null
    const words = to === "en" ? toEnglish(tokens, kind, saved) : toArabic(tokens, kind, saved)
    return {
        text: words.map(word => word.text).join(" "),
        words,
        guesses: words.filter(word => word.from === "rules").map(word => word.text),
    }
}

/** An Arabic name in English: its name's words, then business words where English puts them. */
function toEnglish(tokens: string[], kind: SuggestFor["kind"], saved?: SavedSpellings): SuggestedWord[] {
    const { name, after, before, last } = kind === "business" ? businessParts(tokens, "ar") : { name: tokens, after: [], before: [], last: [] }
    const english = (word: BusinessWord): SuggestedWord => ({ text: word.en, from: "business" })
    return [...arabicName(name, kind, saved), ...after.map(english), ...before.map(english), ...last.map(english)]
}

/** An English name in Arabic: business words where Arabic puts them, around its name's words. */
function toArabic(tokens: string[], kind: SuggestFor["kind"], saved?: SavedSpellings): SuggestedWord[] {
    const { name, after, before, last } = kind === "business" ? businessParts(tokens, "en") : { name: tokens, after: [], before: [], last: [] }
    const arabic = (word: BusinessWord): SuggestedWord => ({ text: word.ar, from: "business" })
    return [...before.map(arabic), ...englishName(name, saved), ...after.map(arabic), ...last.map(arabic)]
}

/** The business word a business's name has at a word, of up to three words, the longest first. */
export function businessWordAt(tokens: string[], i: number, from: "ar" | "en"): { word: BusinessWord; length: number } | null {
    const words = from === "ar" ? BUSINESS_BY_ARABIC : BUSINESS_BY_ENGLISH
    const key = from === "ar" ? arabicKey : englishKey
    for (let length = Math.min(LONGEST, tokens.length - i); length > 0; length--) {
        const word = words.get(tokens.slice(i, i + length).map(key).join(" "))
        if (word) return { word, length }
    }
    return null
}

/** A business's name split into its business words, by their places, and the words of its name. */
function businessParts(tokens: string[], from: "ar" | "en") {
    const parts = { name: [] as string[], after: [] as BusinessWord[], before: [] as BusinessWord[], last: [] as BusinessWord[] }
    for (let i = 0; i < tokens.length; ) {
        const found = businessWordAt(tokens, i, from)
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
 * A name's own words, as they're looked up: a business's without its words
 * for what it is and does, wherever they are (Codex review on PR 401).
 */
export function nameWords(tokens: string[], kind: SuggestFor["kind"], from: "ar" | "en"): string[] {
    return kind === "business" ? businessParts(tokens, from).name : tokens
}

const article = (token: string) => /^(el|al)$/i.test(token)
/** Whether some of an English name's words are a name of the list: its spellings, or El and one. */
function listedInEnglish(tokens: string[]): string | undefined {
    const ar = BY_ENGLISH.get(tokens.map(englishKey).join(""))
    if (ar || tokens.length < 2 || !article(tokens[0])) return ar
    const named = BY_ENGLISH.get(tokens.slice(1).map(englishKey).join(""))
    return named && `ال${named}`
}

/**
 * An Arabic name's words as they're read, by how many each is written in:
 * a name of the list, or one the company learned whole, of up to three
 * words, typed with its spaces or without, the longest first, as one, and
 * every other word alone.
 */
export function arabicWords(tokens: string[], saved?: SavedSpellings): number[] {
    const lengths: number[] = []
    for (let i = 0; i < tokens.length; ) {
        let length = Math.min(LONGEST, tokens.length - i)
        const one = (key: string) => BY_ARABIC.has(key) || !!saved?.has(key)
        while (length > 1 && !one(arabicKey(tokens.slice(i, i + length).join("")))) length--
        lengths.push(length)
        i += length
    }
    return lengths
}

/**
 * An English name's words as they're read, by how many each is written in:
 * a name of the list of up to three words, spaced or joined, or El and one,
 * or one the company learned whole, the longest first, as one; El or Al and
 * the word after it as one; and every other word alone.
 */
export function englishWords(tokens: string[], saved?: SavedSpellings): number[] {
    const lengths: number[] = []
    for (let i = 0; i < tokens.length; ) {
        let length = Math.min(LONGEST, tokens.length - i)
        const one = (these: string[]) => !!listedInEnglish(these) || !!saved?.has(these.map(englishKey).join(""))
        while (length > 1 && !one(tokens.slice(i, i + length))) length--
        if (length === 1 && article(tokens[i]) && i + 1 < tokens.length) length = 2
        lengths.push(length)
        i += length
    }
    return lengths
}

/**
 * A word's company spellings first, the most used first, each with how many
 * names use it, and the usual spelling under them where it isn't one of
 * them. A guess has no place beside them.
 */
function companyFirst(usual: SuggestedWord | null, spellings: { text: string; uses: number }[] | undefined, to: "en" | "ar"): SuggestedWord | null {
    if (!spellings?.length) return usual
    const same = (a: string, b: string) => (to === "en" ? a.toLowerCase() === b.toLowerCase() : arabicKey(a) === arabicKey(b))
    const [first, ...rest] = spellings.slice().sort((a, b) => b.uses - a.uses)
    const others: OtherSpelling[] = rest.map(spelling => ({ text: spelling.text, from: "company", uses: spelling.uses }))
    if (usual?.from === "list" && !spellings.some(spelling => same(spelling.text, usual.text))) others.push({ text: usual.text, from: "list" })
    return { text: first.text, from: "company", uses: first.uses, others }
}

/**
 * An Arabic word of a name in English, as Nizmo has it: a name of the list;
 * a word of the list after its article, as El and the name, joined for a
 * person (Elsayed) and spaced for a business (El Nour); and the rules for
 * the rest. Words the company learned whole Nizmo has nothing for.
 */
function inEnglish(these: string[], kind: SuggestFor["kind"]): SuggestedWord | null {
    const entry = BY_ARABIC.get(arabicKey(these.join("")))
    if (entry) return { text: entry.en, from: "list" }
    if (these.length > 1) return null
    const token = these[0]
    const named = token.length > 3 && token.startsWith("ال") ? BY_ARABIC.get(arabicKey(token.slice(2))) : undefined
    if (named) return { text: kind === "business" ? `El ${named.en}` : `El${named.en.toLowerCase()}`, from: "list" }
    const guess = arabicGuess(token)
    return guess ? { text: guess, from: "rules" } : null
}

/** An Arabic name's words in English (arabicWords), the company's spellings first. */
function arabicName(tokens: string[], kind: SuggestFor["kind"], saved?: SavedSpellings): SuggestedWord[] {
    const words: SuggestedWord[] = []
    let i = 0
    for (const length of arabicWords(tokens, saved)) {
        const these = tokens.slice(i, i + length)
        i += length
        const word = companyFirst(inEnglish(these, kind), saved?.get(arabicKey(these.join(""))), "en")
        if (word) words.push(word)
    }
    return words
}

/**
 * An English word of a name in Arabic, as Nizmo has it: a name of the list,
 * or El or Al and one; El or Al spaced before a name of neither list,
 * guessed as joined to it; El joined to a name of the list; and the rules
 * for the rest. Words the company learned whole Nizmo has nothing for.
 */
function inArabic(these: string[]): SuggestedWord | null {
    const listed = listedInEnglish(these)
    if (listed) return { text: listed, from: "list" }
    // El spaced before a name of neither list: El Shenawy, as Elshenawy.
    if (these.length === 2 && article(these[0])) return { text: `ال${englishGuess(these[1])}`, from: "rules" }
    if (these.length > 1) return null
    // El joined to a name: Elsayed.
    const joined = englishKey(these[0]).match(/^(el|al)(.+)$/)
    const named = joined ? BY_ENGLISH.get(joined[2]) : undefined
    if (named) return { text: `ال${named}`, from: "list" }
    const guess = englishGuess(these[0])
    return guess ? { text: guess, from: "rules" } : null
}

/** An English name's words in Arabic (englishWords), the company's spellings first. */
function englishName(tokens: string[], saved?: SavedSpellings): SuggestedWord[] {
    const words: SuggestedWord[] = []
    let i = 0
    for (const length of englishWords(tokens, saved)) {
        const these = tokens.slice(i, i + length)
        i += length
        const word = companyFirst(inArabic(these), saved?.get(these.map(englishKey).join("")), "ar")
        if (word) words.push(word)
    }
    return words
}
