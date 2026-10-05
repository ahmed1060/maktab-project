import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { apiErrorText } from "./api-error-text"

/**
 * A refused request's message, as a screen shows it. Six places showed the
 * response's text as it came, so an Employee asking for leave twice read
 * `{"success":false,"error":"You already have a leave request for that day."}`.
 */
describe("apiErrorText", () => {
    it("shows the API's message, not its JSON", () => {
        expect(apiErrorText('{"success":false,"error":"You already have a leave request for that day."}', "Failed"))
            .toBe("You already have a leave request for that day.")
    })

    it("falls back when there is no message to show", () => {
        expect(apiErrorText("", "Failed")).toBe("Failed")
        expect(apiErrorText('{"success":false}', "Failed")).toBe("Failed")
        expect(apiErrorText('{"success":false,"error":{"issues":[]}}', "Failed")).toBe("Failed")
        expect(apiErrorText("<!DOCTYPE html><html>…</html>", "Failed")).toBe("Failed")
    })

    it("keeps plain text as it is", () => {
        expect(apiErrorText("Username already in use", "Failed")).toBe("Username already in use")
    })
})

describe("screens", () => {
    it("never show a response's raw text as a message", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
        const raw = [...files("app"), ...files("components")].flatMap(f => {
            const src = readFileSync(f, "utf8")
            // a response read as text, then shown with `||` a fallback
            return [...src.matchAll(/const (\w+) = await \w+\.text\(\)/g)]
                .filter(m => new RegExp(`\\b${m[1]} \\|\\| `).test(src))
                .map(m => `${f}: ${m[1]}`)
        })
        expect(raw).toEqual([])
    })
})
