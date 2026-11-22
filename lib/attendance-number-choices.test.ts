import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { choicesForWaiting, pickedFor } from "./attendance/number-choices"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Choosing who an employee number is (ATTENDANCE_PLAN.md §14, §17.13; PR
 * 366), found at the first customer's: each number waiting for a person
 * offered everyone, including people who already had a number and people
 * picked for another waiting number. Now each offers only people with no
 * number and not picked in another row; the form for a number by hand still
 * offers everyone, for a second number on purpose. Whoever matches the
 * numbers may match their own.
 */

const state = {
    codes: { mapped: [] as { id: string; code: string; userId: string; name: string }[], unmatched: [] as { code: string; punches: number; from: string; to: string }[] },
    people: [] as { id: string; name: string; teamLeaderId: string | null }[],
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string) => key.startsWith("/api/attendance/codes")
        ? { data: { data: state.codes }, isValidating: false, mutate: async () => {} }
        : { data: { data: { people: state.people } }, isValidating: false, mutate: async () => {} },
}))

const person = (id: string, name: string) => ({ id, name, teamLeaderId: null })
const waiting = (code: string) => ({ code, punches: 3, from: "2026-11-01", to: "2026-11-21" })
const mapped = (code: string, userId: string, name: string) => ({ id: `m-${code}`, code, userId, name })

beforeEach(() => {
    state.people = [person("amal", "Amal Farid"), person("karim", "Karim Nabil"), person("me", "Mona Sami"), person("noor", "Noor Adel")]
    state.codes = { mapped: [mapped("41", "karim", "Karim Nabil")], unmatched: [waiting("42"), waiting("43")] }
})

async function tab() {
    const { default: NumbersTab } = await import("@/app/(dashboard)/dashboard/attendance/NumbersTab")
    return renderToStaticMarkup(h(NumbersTab, { q: "", companyId: null }))
}
/** Each select's offered names, in the order they're drawn: the waiting rows, their cards, then the form's. */
const selects = (html: string) => [...html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/g)]
    .map(([, inner]) => [...inner.matchAll(/<option value="([^"]+)"/g)].map(([, v]) => v))

describe("who a waiting number offers", () => {
    const people = [person("amal", "A"), person("karim", "K"), person("me", "M"), person("noor", "N")]
    const ids = (list: { id: string }[]) => list.map(p => p.id)

    it("nobody who has a number already", () => {
        expect(ids(choicesForWaiting(people, { mapped: [{ userId: "karim" }], picked: {}, waiting: ["42"], code: "42" }))).toEqual(["amal", "me", "noor"])
    })

    it("nobody picked for another waiting number, though this one's own pick stays", () => {
        const picked = { "42": "amal", "43": "noor" }
        expect(ids(choicesForWaiting(people, { mapped: [], picked, waiting: ["42", "43"], code: "42" }))).toEqual(["amal", "karim", "me"])
        expect(ids(choicesForWaiting(people, { mapped: [], picked, waiting: ["42", "43"], code: "43" }))).toEqual(["karim", "me", "noor"])
    })

    it("forgets a pick for a number that isn't waiting any more", () => {
        expect(ids(choicesForWaiting(people, { mapped: [], picked: { "40": "amal" }, waiting: ["42"], code: "42" }))).toEqual(["amal", "karim", "me", "noor"])
    })

    it("keeps oneself: whoever matches the numbers may match their own", () => {
        expect(ids(choicesForWaiting(people, { mapped: [], picked: {}, waiting: ["42"], code: "42" }))).toContain("me")
    })

    it("drops a pick once that person has been given a number, so it isn't saved as a second one", () => {
        expect(pickedFor("42", { "42": "amal" }, [])).toBe("amal")
        expect(pickedFor("42", { "42": "amal" }, [{ userId: "amal" }])).toBe("")
        expect(pickedFor("42", {}, [])).toBe("")
    })
})

describe("the Employee numbers tab", () => {
    it("offers each waiting number only people with no number, oneself included", async () => {
        const lists = selects(await tab())
        // Two waiting rows, their two cards, then the form.
        expect(lists).toHaveLength(5)
        for (const list of lists.slice(0, 4)) expect(list).toEqual(["amal", "me", "noor"])
    })

    it("offers everyone in the form below, for a second number on purpose, oneself included", async () => {
        expect(selects(await tab())[4]).toEqual(["amal", "karim", "me", "noor"])
    })

    it("offers nobody to a waiting number once everyone has one", async () => {
        state.codes.mapped = state.people.map((p, i) => mapped(String(30 + i), p.id, p.name))
        expect(selects(await tab()).slice(0, 4)).toEqual([[], [], [], []])
    })

    it("still offers no Remove on one's own number: someone else removes it", async () => {
        state.codes.mapped = [mapped("9", "me", "Mona Sami"), mapped("41", "karim", "Karim Nabil")]
        const html = await tab()
        const rows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner]) => inner)
        const mine = rows.find(r => r.includes("Mona Sami"))!
        const karims = rows.find(r => r.includes("Karim Nabil"))!
        expect(mine).not.toContain("punch_number_remove")
        expect(karims).toContain("punch_number_remove")
    })

    it("uses the rule for the waiting rows, and no longer leaves oneself out of the lists", () => {
        const source = readFileSync("app/(dashboard)/dashboard/attendance/NumbersTab.tsx", "utf8")
        expect(source).toContain("choicesForWaiting(people, { mapped: codes.mapped, picked: choice, waiting: waitingCodes, code: u.code })")
        // What a row shows and saves is its pick, dropped once that person has a number.
        expect(source).toContain("value={picked(u)}")
        expect(source).toContain("map(u.code, picked(u))")
        expect(source).toContain("disabled={!picked(u) || action.running}")
        expect(source).not.toContain("x.id !== me")
    })
})
