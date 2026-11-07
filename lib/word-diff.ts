/**
 * What an edit changed, word by word (components/DiffViewer.tsx; DESIGN.md
 * §5.5, "What an edit changed"; PR 218).
 *
 * The text as it is now, with what was taken out and what was put in: the
 * longest run of words both share stays, so a word that stayed is never
 * marked taken out and put back (the old one looked only ten words ahead).
 * Words next to each other that changed together are one part, and parts of
 * one kind never sit side by side.
 *
 * Spaces between words are one, and line breaks are kept: the text's as it
 * is now, while what was taken out sits where it was, with the space it had
 * there, and the line breaks of now that it sits across follow it.
 */
export type DiffPart = { kind: "same" | "removed" | "added"; text: string }

type Word = { word: string; after: string }
/** A word shown: a word that stayed has its space after it now, and as it was. */
type Token = Word & { kind: DiffPart["kind"]; wasAfter?: string }

/** Past this many word pairs, what's between the same start and end is marked all changed: quick, whatever the length. */
const MOST_PAIRS = 4_000_000

function wordsOf(text: string): Word[] {
    const found: Word[] = []
    const pattern = /(\S+)(\s*)/g
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) found.push({ word: match[1], after: match[2] })
    return found
}

const breaksIn = (space: string) => space.split("\n").length - 1
/** One space, or the line breaks there were. */
const spaceOf = (breaks: number) => (breaks ? "\n".repeat(breaks) : " ")

const stayed = (was: Word, now: Word): Token => ({ ...now, kind: "same", wasAfter: was.after })

/** What's between the same start and end: the longest run both share stays. */
function between(was: Word[], now: Word[]): Token[] {
    const n = was.length
    const m = now.length
    if (n * m > MOST_PAIRS) {
        return [...was.map(w => ({ ...w, kind: "removed" as const })), ...now.map(w => ({ ...w, kind: "added" as const }))]
    }
    // longest[i][j]: the most words was[i..] and now[j..] share, in order.
    const longest = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            longest[i][j] = was[i].word === now[j].word ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1])
        }
    }
    const tokens: Token[] = []
    let i = 0
    let j = 0
    while (i < n || j < m) {
        if (i < n && j < m && was[i].word === now[j].word) {
            tokens.push(stayed(was[i++], now[j++]))
        } else if (i < n && (j === m || longest[i + 1][j] >= longest[i][j + 1])) {
            // What was taken out comes before what was put in its place.
            tokens.push({ ...was[i++], kind: "removed" })
        } else {
            tokens.push({ ...now[j++], kind: "added" })
        }
    }
    return tokens
}

export function wordDiff(before: string | null | undefined, after: string | null | undefined): DiffPart[] {
    const was = wordsOf(before ?? "")
    const now = wordsOf(after ?? "")
    // The same start and end first, then the slow part on what's between them.
    let start = 0
    while (start < was.length && start < now.length && was[start].word === now[start].word) start++
    let end = 0
    while (end < was.length - start && end < now.length - start && was[was.length - 1 - end].word === now[now.length - 1 - end].word) end++
    const tokens: Token[] = [
        ...now.slice(0, start).map((w, k) => stayed(was[k], w)),
        ...between(was.slice(start, was.length - end), now.slice(start, now.length - end)),
        ...now.slice(now.length - end).map((w, k) => stayed(was[was.length - end + k], w)),
    ]

    const parts: DiffPart[] = []
    const add = (kind: DiffPart["kind"], text: string) => {
        const last = parts[parts.length - 1]
        if (last?.kind === kind) last.text += text
        else parts.push({ kind, text })
    }
    // Line breaks of the text as it is now, held while what was taken out is shown.
    let owed = 0
    tokens.forEach((token, index) => {
        add(token.kind, token.word)
        const next = tokens[index + 1]
        if (!next) return
        let breaks: number
        if (next.kind === "removed" && token.kind !== "removed") {
            // What was taken out sits where it was, with the space it had there.
            const before = token.wasAfter === undefined ? 0 : breaksIn(token.wasAfter)
            owed = Math.max(breaksIn(token.after) - before, 0)
            breaks = before
        } else if (token.kind === "removed" && next.kind !== "removed") {
            // Then the line breaks of now it sat across: before what was put in its place, or
            // with its own before a word that stayed.
            breaks = next.kind === "added" ? owed : Math.max(owed, breaksIn(token.after))
            owed = 0
        } else {
            breaks = breaksIn(token.after)
        }
        // Inside a part, its own space; between parts, the text's, unmarked.
        add(next.kind === token.kind ? token.kind : "same", spaceOf(breaks))
    })
    return parts
}
