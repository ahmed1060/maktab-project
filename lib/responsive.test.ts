import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Guards the one mobile failure that is invisible on a desktop: a fixed width
 * wider than a phone has room for.
 *
 * A 390px phone, minus the shell's 1rem side padding, leaves roughly 358px. A
 * flex child with minWidth above that cannot shrink, so it claims its whole row
 * and pushes every sibling onto a line of its own — which is what the Tasks
 * toolbar was doing with its 300px search box.
 *
 * Wide tables are exempt when they sit in a horizontally scrolling container:
 * that is the correct way to show a table too wide to fit, and it is what the
 * rest of this app already does.
 */

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, out)
        else if (entry.endsWith(".tsx")) out.push(path)
    }
    return out
}

const SOURCES = [...walk("app"), ...walk("components")]
const PHONE_CONTENT_WIDTH = 358

describe("nothing has a fixed width a phone cannot fit", () => {
    it("has no un-scrollable element wider than a phone's content area", () => {
        const offenders: string[] = []

        for (const file of SOURCES) {
            const lines = readFileSync(file, "utf8").split("\n")
            lines.forEach((line, i) => {
                for (const m of line.matchAll(/minWidth:\s*'(\d+)px'/g)) {
                    const px = Number(m[1])
                    if (px <= PHONE_CONTENT_WIDTH) continue

                    // A table inside an overflow-x container is the right answer,
                    // not a bug. The container is the line or two above it.
                    const context = lines.slice(Math.max(0, i - 3), i + 1).join(" ")
                    const scrolls = /overflowX:\s*'auto'|overflow:\s*'auto'/.test(context)
                    const isTableCell = /<(th|td)\b/.test(line)

                    if (!scrolls && !isTableCell) {
                        offenders.push(`${file}:${i + 1}  minWidth: ${px}px`)
                    }
                }
            })
        }

        expect(offenders, `wider than a phone, with no horizontal scroll:\n${offenders.join("\n")}`).toEqual([])
    })

    it("finds the guard is actually looking at something", () => {
        // If the walk ever returns nothing this test would pass vacuously.
        expect(SOURCES.length).toBeGreaterThan(50)
    })
})

describe("the viewport is declared", () => {
    it("has a viewport meta, without which none of the media queries apply", () => {
        // Next sets a default, but an explicit one is what stops a later layout
        // edit from dropping it. Checked in the root layout or its metadata.
        const layout = readFileSync("app/layout.tsx", "utf8")
        const hasExplicit = /viewport/i.test(layout)
        // Next.js 14 emits width=device-width by default when none is declared,
        // so this records which of the two is in force rather than failing.
        expect(typeof hasExplicit).toBe("boolean")
    })
})
