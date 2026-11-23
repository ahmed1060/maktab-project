import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { apiErrorText, refusalOf } from "./api-error-text"

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

/**
 * A refusal with every reason the server gave, as the role and company
 * screens show it (PR 392). It lived in the Super Admin's roles card, and 15
 * files borrowed it from there, so a screen that only words a refusal reached
 * the card and its calls; it lives here now.
 */
describe("refusalOf", () => {
    const refused = (body: string) => new Response(body, { status: 400 })

    it("shows the API's message, then each reason it gave", async () => {
        expect(await refusalOf(refused('{"success":false,"error":"That role is in use."}'), "Failed")).toBe("That role is in use.")
        expect(await refusalOf(refused('{"success":false,"error":"Refused.","details":{"errors":["Unknown permission: x.y","Needs See employees"]}}'), "Failed"))
            .toBe("Refused. — Unknown permission: x.y — Needs See employees")
    })

    it("falls back when there is no message, keeping any reasons", async () => {
        expect(await refusalOf(refused(""), "Failed")).toBe("Failed")
        expect(await refusalOf(refused("<!DOCTYPE html><html>…</html>"), "Failed")).toBe("Failed")
        expect(await refusalOf(refused('{"success":false,"details":{"errors":["Needs See employees"]}}'), "Failed")).toBe("Failed — Needs See employees")
    })

    it("is borrowed from here, not from the Super Admin's roles card", () => {
        const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
            e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes(".test.") ? [join(dir, e.name)] : [])
        const borrowed = [...files("app"), ...files("components"), ...files("lib")].filter(f => /import [^;]*\brefusalOf\b[^;]* from '@\/components\/CompanyRolesCard'/.test(readFileSync(f, "utf8")))
        expect(borrowed).toEqual([])
        expect(readFileSync("components/CompanyRolesCard.tsx", "utf8")).not.toContain("export async function refusalOf")
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
