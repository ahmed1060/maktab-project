import { describe, it, expect } from "vitest"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Every placeholder in a string must survive translation.
 *
 * The existing parity checks (delivery.test.ts, native-dialogs.test.ts,
 * debt-recovery.test.ts) confirm a key exists in both languages. None confirm
 * the two strings take the same values. So an Arabic string that dropped
 * `{name}` would render without the name, and one that typed `{nmae}` would
 * print the braces to the reader — and both would pass every existing test,
 * because the key is present and the code substitutes happily into whatever
 * it finds.
 *
 * Found while checking the team feature's thirty new strings in both
 * languages. They all matched, and so, it turned out, did the other eleven
 * hundred — so this guards the whole dictionary, not only the new part.
 */

const placeholders = (s: unknown) =>
    typeof s === "string" ? (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort() : []

const keys = Object.keys(en as Record<string, unknown>)

describe("placeholders match across languages", () => {
    it("reads the real dictionaries, not a parse of them", () => {
        // A regex over the source would quietly skip any value quoted
        // differently, and a skipped key is an unchecked key.
        expect(keys.length).toBeGreaterThan(1000)
    })

    it("every translated string takes the same values as its English one", () => {
        const mismatched = keys
            .filter(k => k in (ar as Record<string, unknown>))
            .filter(k => {
                const a = placeholders((en as any)[k]).join(",")
                const b = placeholders((ar as any)[k]).join(",")
                return a !== b
            })
            .map(k => `${k}: en {${placeholders((en as any)[k])}} ar {${placeholders((ar as any)[k])}}`)
        expect(mismatched, mismatched.join("\n")).toEqual([])
    })
})
