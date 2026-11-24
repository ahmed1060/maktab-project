/**
 * What the company saves teaches it (LATER_CHANGES_PLAN.md §3.1, step 3a,
 * PR 400): the spellings in a company's names, word by word. A name saved
 * in both languages is read as the suggestion reads it (lib/names/suggest.ts),
 * its business words for a business left out, and each word of its Arabic
 * paired with its English, in order, where the two have as many. One of up
 * to three words that doesn't pair is learned whole. A name with a language
 * missing, or one written in Arabic before both were kept, teaches nothing.
 */

import { hasArabic, writtenInArabic, type TwoLanguages } from "@/lib/names"
import { can } from "@/lib/permissions/can"
import { arabicKey, arabicWords, businessWordAt, englishKey, englishWords } from "./suggest"

/** Where a spelling was saved: an employee's name, a client's, a client's owner's, or the company's. */
export const SPELLING_SOURCES = ["employee", "client", "owner", "company"] as const
export type SpellingSource = typeof SPELLING_SOURCES[number]

/**
 * Where a name's suggestion may learn from, for whoever asks (step 3b, PR
 * 401): employees' names and the company's for anyone in the company, as
 * one's own profile takes a name; clients' names and their owners' for
 * whoever may add or edit a client, as their forms take those.
 */
export function spellingSourcesFor(user: Parameters<typeof can>[0], kind: "person" | "business"): SpellingSource[] {
    const clients = can(user, "clients.create") || can(user, "clients.edit")
    return kind === "person" ? ["employee", ...(clients ? ["owner" as const] : [])] : ["company", ...(clients ? ["client" as const] : [])]
}

/** A word of a name in Arabic beside its English, each as written and as it's looked up. */
export type SpellingPair = { ar: string; arKey: string; en: string; enKey: string }
/** A company's spelling, and how many names use it. */
export type Spelling = SpellingPair & { uses: number }

type Token = { text: string; start: number; end: number }

const ENGLISH = /[A-Za-z]/
/** The most words a name is learned whole in, where its words don't pair. */
const WHOLE = 3

/** A name's words, and where each is in it. */
function tokensOf(name: string): Token[] {
    const tokens: Token[] = []
    const word = /[^\s\-]+/g
    let found: RegExpExecArray | null
    while ((found = word.exec(name))) tokens.push({ text: found[0], start: found.index, end: found.index + found[0].length })
    return tokens
}

/** A business's name without its words for what it is and does. */
function withoutBusinessWords(tokens: Token[], from: "ar" | "en"): Token[] {
    const texts = tokens.map(token => token.text)
    const name: Token[] = []
    for (let i = 0; i < tokens.length; ) {
        const found = businessWordAt(texts, i, from)
        if (found) i += found.length
        else name.push(tokens[i++])
    }
    return name
}

/** Words as the name has them: a hyphen between two kept, and a space between any others. */
function written(name: string, tokens: Token[]): string {
    return tokens.map((token, i) => {
        if (i === 0) return token.text
        const between = name.slice(tokens[i - 1].end, token.start)
        return (/^\s*-\s*$/.test(between) ? "-" : " ") + token.text
    }).join("")
}

function grouped(tokens: Token[], lengths: number[]): Token[][] {
    const groups: Token[][] = []
    let i = 0
    for (const length of lengths) {
        groups.push(tokens.slice(i, i + length))
        i += length
    }
    return groups
}

/** The pairs of a name saved in both languages, word by word, or whole. */
export function pairsOf(name: TwoLanguages, kind: "person" | "business"): SpellingPair[] {
    const { en, ar } = name
    if (!ar || !writtenInArabic(ar) || hasArabic(en)) return []
    let arTokens = tokensOf(ar)
    let enTokens = tokensOf(en)
    if (kind === "business") {
        arTokens = withoutBusinessWords(arTokens, "ar")
        enTokens = withoutBusinessWords(enTokens, "en")
    }
    const pair = (arWords: Token[], enWords: Token[]): SpellingPair => ({
        ar: written(ar, arWords),
        arKey: arabicKey(arWords.map(word => word.text).join("")),
        en: written(en, enWords),
        enKey: enWords.map(word => englishKey(word.text)).join(""),
    })
    const arGroups = grouped(arTokens, arabicWords(arTokens.map(token => token.text)))
    const enGroups = grouped(enTokens, englishWords(enTokens.map(token => token.text)))
    const pairs = arGroups.length === enGroups.length
        ? arGroups.map((words, i) => pair(words, enGroups[i]))
        : arTokens.length <= WHOLE && enTokens.length <= WHOLE ? [pair(arTokens, enTokens)] : []
    // Words only: a number is written the same in either.
    return pairs.filter(({ ar, en }) => ENGLISH.test(en) && hasArabic(ar.replace(/[٠-٩]/g, "")))
}

/**
 * A company's spellings from its names, each of those that hold names (a
 * person's first and last, say) given as theirs: each pair once, with how
 * many hold it, a holder once however often they have it, and written as
 * it's written most, the first where two are as often.
 */
export function spellingsOf(holders: TwoLanguages[][], kind: "person" | "business"): Spelling[] {
    const found = new Map<string, { arKey: string; enKey: string; uses: number; ar: Map<string, number>; en: Map<string, number> }>()
    for (const names of holders) {
        const seen = new Set<string>()
        for (const name of names) {
            for (const pair of pairsOf(name, kind)) {
                const key = `${pair.arKey}\u0000${pair.enKey}`
                if (seen.has(key)) continue
                seen.add(key)
                let spelling = found.get(key)
                if (!spelling) found.set(key, spelling = { arKey: pair.arKey, enKey: pair.enKey, uses: 0, ar: new Map(), en: new Map() })
                spelling.uses++
                spelling.ar.set(pair.ar, (spelling.ar.get(pair.ar) ?? 0) + 1)
                spelling.en.set(pair.en, (spelling.en.get(pair.en) ?? 0) + 1)
            }
        }
    }
    const most = (forms: Map<string, number>) => {
        let best = ""
        let times = 0
        forms.forEach((count, form) => {
            if (count > times) {
                best = form
                times = count
            }
        })
        return best
    }
    return Array.from(found.values())
        .map(({ arKey, enKey, uses, ar, en }) => ({ ar: most(ar), arKey, en: most(en), enKey, uses }))
        .sort((a, b) => (a.arKey < b.arKey ? -1 : a.arKey > b.arKey ? 1 : a.enKey < b.enKey ? -1 : a.enKey > b.enKey ? 1 : 0))
}
