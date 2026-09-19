import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * The hydration guard stays in one place.
 *
 * Sixteen components each kept their own copy of
 *
 *     const [mounted, setMounted] = useState(false)
 *     useEffect(() => { setMounted(true) }, [])
 *
 * which works and costs a guaranteed second render every time one of them
 * mounts: React renders, runs the effect, the effect sets state, React renders
 * again, for a value that was never going to be anything else. On a list of
 * fifty rows each holding a SafeDate that is fifty wasted passes.
 *
 * lib/useHydrated.ts answers the same question with useSyncExternalStore, which
 * React resolves as part of hydration rather than as a state update after it.
 * The pattern is easy to reach for again from memory, so this fails if it
 * comes back.
 */

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, out)
        else if (path.endsWith(".tsx")) out.push(path)
    }
    return out
}

const SOURCES = [...walk("app"), ...walk("components"), ...walk("context")]

describe("nothing re-implements the mounted flag", () => {
    it("is looking at the components", () => {
        expect(SOURCES.length).toBeGreaterThan(50)
    })

    it("has no mounted flag anywhere", () => {
        // The name, not the call. An earlier version of this matched
        // `setMounted(` and so let a reintroduced `const [mounted, setMounted]
        // = useState(false)` through until something called it — which is to
        // say it would have reported the problem one commit after it landed.
        //
        // A differently-named flag (setReady, setIsClient) is not caught here
        // and does not need to be: eslint's react-hooks/set-state-in-effect
        // reports that shape whatever it is called. This guard is specifically
        // against the idiom that was here sixteen times coming back.
        const offenders = SOURCES.filter(f => /\bset(Is)?Mounted\b/.test(stripComments(readFileSync(f, "utf8"))))
        expect(
            offenders,
            `these re-implement the flag instead of using useHydrated():\n${offenders.join("\n")}`,
        ).toEqual([])
    })

    it("keeps the shared hook on useSyncExternalStore, not an effect", () => {
        // Comments stripped: the hook explains at length why it is not an
        // effect, and a guard that reads its own justification as the offence
        // is the exact failure lib/strip-comments.ts exists for.
        const hook = stripComments(readFileSync("lib/useHydrated.ts", "utf8"))
        expect(hook).toMatch(/useSyncExternalStore/)
        // An effect here would put the extra render back for every caller at
        // once, which is the whole thing this replaced.
        expect(hook).not.toMatch(/useEffect/)
        // The server snapshot must be false, or SSR and the first client render
        // disagree and React throws a hydration mismatch.
        expect(hook).toMatch(/\(\)\s*=>\s*false/)
        expect(hook).toMatch(/\(\)\s*=>\s*true/)
    })
})
