import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Anything a screen loads tries again by itself three times before it shows
 * a failure (DESIGN.md §5.5): through the shared fetcher with SWR, or
 * through fetchRetrying. This reads the code for each `fetch(` that loads,
 * one with no method or a GET, so a new one can't miss it. A save sends its
 * method, and is sent once.
 */

const ROOTS = ["app", "components", "context", "lib"]
// The server's own code, which no screen waits on, and the helper itself.
const SKIPPED = [/^app\/api\//, /^lib\/services\//, /^lib\/swr-fetcher\.ts$/, /\.test\.tsx?$/]

/** Loads left as they are, each with why. */
const ALLOWED: { file: string; mark: string; why: string }[] = [
    { file: "app/(dashboard)/dashboard/tasks/[id]/client.tsx", mark: "revgeocode.search.hereapi.com", why: "the map service's name for a pin, best-effort: the pin is kept without it" },
    { file: "components/LocationSearchInput.tsx", mark: "autosuggest.search.hereapi.com", why: "suggestions while typing: the next key asks again" },
    { file: "lib/here-tiles.ts", mark: "hereCopyrightUrl", why: "the map's copyright line, best-effort" },
    // Helpers that pass on what they're given: every caller gives a method.
    { file: "app/(dashboard)/dashboard/attendance/send.ts", mark: "fetch(url, init)", why: "writes only" },
    { file: "components/AttendanceLocationsPanel.tsx", mark: "...init", why: "writes only" },
    { file: "components/AttendanceTerminalsPanel.tsx", mark: "...init", why: "writes only" },
]

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (name === "node_modules") return []
        return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
    })
}

/** Each `fetch(` call, whole, with its line. */
function calls(source: string): { line: number; text: string }[] {
    const found: { line: number; text: string }[] = []
    for (const m of source.matchAll(/(?<![\w.])fetch\(/g)) {
        let i = m.index! + m[0].length
        for (let depth = 1; depth > 0 && i < source.length; i++) depth += source[i] === "(" ? 1 : source[i] === ")" ? -1 : 0
        found.push({ line: source.slice(0, m.index).split("\n").length, text: source.slice(m.index, i) })
    }
    return found
}

/** A load: no method, or a GET. A method in a variable is a save's. */
function loads(text: string): boolean {
    const literal = text.match(/\bmethod\s*:\s*(['"`])(\w+)\1/)
    if (literal) return ["GET", "HEAD"].includes(literal[2].toUpperCase())
    return !/\bmethod\b/.test(text)
}

describe("anything a screen loads tries again before it shows a failure", () => {
    const sources = ROOTS.flatMap(root => files(root)).filter(f => !SKIPPED.some(s => s.test(f)))

    it("with a plain fetch only where it's allowed, and why", () => {
        const plain = sources.flatMap(file => {
            const source = readFileSync(file, "utf8")
            return calls(source)
                .filter(c => loads(c.text))
                .filter(c => !ALLOWED.some(a => a.file === file && c.text.includes(a.mark)))
                .map(c => `${file}:${c.line} ${c.text.replace(/\s+/g, " ").slice(0, 80)}`)
        })
        expect(plain, "load these with fetchRetrying, or the shared fetcher (lib/swr-fetcher.ts)").toEqual([])
    })

    it("allows only what is still there", () => {
        for (const a of ALLOWED) expect(readFileSync(a.file, "utf8"), a.file).toContain(a.mark)
    })

    it("tells a save from a load", () => {
        expect(loads("fetch('/api/users?limit=1000')")).toBe(true)
        expect(loads("fetch(url, { cache: 'no-store' })")).toBe(true)
        expect(loads("fetch(url, { method: 'GET' })")).toBe(true)
        expect(loads("fetch('/api/x', { method: 'POST', body })")).toBe(false)
        expect(loads("fetch('/api/x', { method: editing ? 'PUT' : 'POST' })")).toBe(false)
        expect(loads("fetch(url, { method, body })")).toBe(false)
    })
})
