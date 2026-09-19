import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * The highlight-then-fade timer stays in one place.
 *
 * Four components had the same effect: set a flag true, start a six-second
 * timer, set it false again, and set it false in an else branch as well. Both
 * of those assignments ran synchronously inside the effect, so every
 * highlighted row rendered, committed, immediately set state and rendered
 * again — to reach a value the previous render could have worked out from its
 * own props.
 *
 * lib/useTemporaryHighlight.ts keeps only the part that genuinely cannot be
 * derived — whether the timer has fired — and computes the rest.
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

const SOURCES = [...walk("app"), ...walk("components")]

describe("nothing re-implements the highlight timer", () => {
    it("is looking at the components", () => {
        expect(SOURCES.length).toBeGreaterThan(50)
    })

    it("has no component holding the highlight in its own state", () => {
        const offenders = SOURCES.filter(f =>
            /\bsetShowVisualHighlight\b/.test(stripComments(readFileSync(f, "utf8"))))
        expect(
            offenders,
            `these should call useTemporaryHighlight():\n${offenders.join("\n")}`,
        ).toEqual([])
    })

    it("resets during render rather than from an effect", () => {
        const hook = stripComments(readFileSync("lib/useTemporaryHighlight.ts", "utf8"))

        // The reset has to happen during render. Moved into an effect it would
        // put back the extra commit this replaced; dropped altogether, a row
        // highlighted a second time would stay dark, because the first
        // highlight's timer had already said it was over.
        const effectStart = hook.indexOf("useEffect(")
        const resetStart = hook.indexOf("setFaded(false)")
        expect(resetStart, "the reset is missing").toBeGreaterThan(-1)
        expect(resetStart, "the reset moved inside the effect").toBeLessThan(effectStart)

        // The effect's only job is the timer.
        expect(hook.slice(effectStart)).toMatch(/setTimeout/)
        expect(hook.slice(effectStart)).not.toMatch(/setFaded\(false\)/)
    })
})
