import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { settingsTab } from "./company-settings-tabs"
import { maySetField } from "./company-settings-access"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The straight-to-Nizmo switch (ATTENDANCE_PLAN.md §17.8, Phase 4 part 5,
 * PR 295): the Super Admin's, on the company's Attendance tab under who
 * sets its terminals up. Off, a terminal can't be added straight to Nizmo
 * and one that sends its scans that way is held. What the switch turns on
 * and its audit entry are in lib/terminal-push.db.test.ts, against a real
 * Postgres.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
// The list Fingerprint terminals shows, as the card reads it.
const list = { devices: [] as { connection: string; retiredAt: string | null }[], key: "", loading: false, failed: false }
vi.mock("swr", () => ({
    default: (key: string) => {
        list.key = key
        const read = !list.loading && !list.failed
        return { data: read ? { data: { devices: list.devices } } : undefined, error: list.failed ? new Error("no answer") : undefined, mutate: () => {}, isLoading: list.loading, isValidating: list.loading }
    },
}))

const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const text = (words: string) => words.replace(/'/g, "&#x27;")

describe("the switch", () => {
    it("is a field of the Attendance tab only the Super Admin sets, beside who sets terminals up", () => {
        const tab = settingsTab("attendance")!
        // With the company's own switch for what's left of permission hours, which an Admin sets (PR 446).
        expect(tab.fields).toEqual(["terminalsSetupByCompany", "terminalsDirectAllowed", "permissionLeftShown"])
        expect(tab.superAdminOnly).toEqual(["terminalsSetupByCompany", "terminalsDirectAllowed"])
        expect(maySetField({ role: "ADMIN", companyId: "c1" }, "attendance", "terminalsDirectAllowed")).toBe(false)
        expect(maySetField({ role: "SUPER_ADMIN" }, "attendance", "terminalsDirectAllowed")).toBe(true)
    })

    it("needs no migration: its column came with part 4, off for every company", () => {
        const sql = readFileSync("prisma/migrations/20261229000000_terminal_connection/migration.sql", "utf8").replace(/\s+/g, " ")
        expect(sql).toContain(`ALTER TABLE "Company" ADD COLUMN "terminalsDirectAllowed" BOOLEAN NOT NULL DEFAULT false;`)
        expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/terminalsDirectAllowed\s+Boolean\s+@default\(false\)/)
    })

    it("is saved as a yes or no, and written to the audit log by name, in both languages", () => {
        expect(readFileSync("lib/validations/company.schema.ts", "utf8")).toContain("terminalsDirectAllowed: z.boolean().optional()")
        const service = source("lib/services/company.service.ts")
        expect(service).toContain("...(terminalsDirectAllowed !== undefined && { terminalsDirectAllowed }),")
        expect(service).toContain("changes.terminalsDirectAllowed = { old: existing.terminalsDirectAllowed, new: terminalsDirectAllowed }")
        expect(en.audit_field_terminalsDirectAllowed).toBe("Terminals may send their scans straight to Nizmo")
        expect(ar.audit_field_terminalsDirectAllowed).toBe("يمكن للأجهزة إرسال بصماتها مباشرة إلى Nizmo")
    })

    it("comes with the Attendance tab's other fields, from both places the settings page reads a company", () => {
        expect(source("app/api/company-settings/route.ts")).toContain("terminalsDirectAllowed: true,")
        // The Super Admin's page reads the company here: without it the switch read Off after the page loaded again.
        expect(source("app/api/companies/route.ts")).toContain("terminalsSetupByCompany: true, terminalsDirectAllowed: true,")
        expect(source("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx")).toContain("useSWR(companyId ? `/api/companies?id=${companyId}` : null, fetcher)")
    })
})

describe("on the Attendance tab", () => {
    const direct = { connection: "DIRECT", retiredAt: null }
    async function card(on: boolean, terminals = 0, locale: "en" | "ar" = "en") {
        state.locale = locale
        // Its count leaves out a terminal through the agent, and one that is retired.
        list.devices = [...Array.from({ length: terminals }, () => direct), { connection: "AGENT", retiredAt: null }, { connection: "DIRECT", retiredAt: "2026-09-01T00:00:00Z" }]
        const { default: TerminalsDirectCard } = await import("@/components/TerminalsDirectCard")
        return renderToStaticMarkup(h(TerminalsDirectCard, { companyId: "c 1", on, onSaved: () => {} }))
    }

    it("the Super Admin's card says whether terminals may send straight to Nizmo, off to start", async () => {
        const off = await card(false)
        expect(off).toContain(en.att_term_direct_title)
        expect(off).toContain(text(en.att_term_direct_label))
        expect(off).toContain(text(en.att_term_direct_off_hint))
        expect(off).toContain(`>${en.att_term_setup_off_badge}<`)
        expect(off).toContain(`>${en.settings_turn_on}<`)
        expect(off).not.toContain(`>${en.settings_turn_off}<`)
        const on = await card(true)
        expect(on).toContain(text(en.att_term_direct_on_hint))
        expect(on).toContain(`>${en.att_term_setup_on_badge}<`)
        expect(on).toContain(`>${en.settings_turn_off}<`)
        expect(on).not.toContain(`>${en.settings_turn_on}<`)
    })

    it("its row's button is the short one the other settings' switches have, and the question's says in full what it does", () => {
        // A row's end is at most 60% of the row: on a phone a longer button lay over the row's words.
        const card = source("components/TerminalsDirectCard.tsx")
        expect(card).toContain("else void save(false) }}>{t('settings_turn_off')}</Button>")
        expect(card).toContain("onClick={() => setAsking('on')}>{t('settings_turn_on')}</Button>")
        expect(card).toContain("}}>{t(asking === 'off' ? 'att_term_direct_turn_off' : 'att_term_direct_turn_on')}</Button>")
        expect(source("components/ui/ui.css").replace(/\s+/g, " ")).toMatch(/\.ui-row-end \{[^}]*max-width: 60%;/)
        for (const words of [en, ar]) {
            expect(words.settings_turn_on.length).toBeLessThanOrEqual(8)
            expect(words.settings_turn_off.length).toBeLessThanOrEqual(8)
        }
    })

    it("says how many terminals send straight to Nizmo once any does, in one piece with its hint", async () => {
        expect(await card(true)).not.toContain("Straight to Nizmo now")
        const on = await card(true, 3)
        // A row's second line sets its pieces apart: the hint and the count are one.
        expect(on).toContain(`<span>${text(en.att_term_direct_on_hint)} ${en.att_term_direct_count.replace("{n}", "3")}</span>`)
        // Turned off with terminals still set that way, it says how many are held.
        expect(await card(false, 2)).toContain(`<span>${text(en.att_term_direct_off_hint)} ${en.att_term_direct_count.replace("{n}", "2")}</span>`)
    })

    it("in Arabic, its badge saying what its hint does, and its count in Arabic's digits", async () => {
        const off = await card(false, 0, "ar")
        expect(off).toContain(ar.att_term_direct_title)
        expect(off).toContain(`>${ar.settings_turn_on}<`)
        const on = await card(true, 12, "ar")
        expect(on).toContain(ar.att_term_direct_count.replace("{n}", "١٢"))
        for (const words of [en, ar]) {
            expect(words.att_term_direct_off_hint.startsWith(`${words.att_term_setup_off_badge}:`)).toBe(true)
            expect(words.att_term_direct_on_hint.startsWith(`${words.att_term_setup_on_badge}:`)).toBe(true)
        }
    })

    it("asks before allowing it, and before stopping it only when a terminal would be held", () => {
        const card = source("components/TerminalsDirectCard.tsx")
        // Allowing always asks: what a terminal sends counts towards pay.
        expect(card).toContain("onClick={() => setAsking('on')}")
        // Stopping asks when it holds a terminal's scans, and stops nothing otherwise.
        expect(card).toContain("onClick={() => { if (terminals > 0) setAsking('off'); else void save(false) }}")
        // And waits for the list to be read: before that, nothing says whether a terminal would be held.
        expect(card).toContain("const read = data !== undefined")
        expect(card).toContain("<Button size=\"sm\" busy={saving} disabled={!read} onClick={() => { if (terminals > 0)")
        // Its question stays open when saving fails, to try again or cancel.
        expect(card).toContain("if (await save(asking === 'on')) setAsking(null)")
        expect(card).toContain("return false")
        expect(card).toContain("body: JSON.stringify({ companyId, tab: 'attendance', terminalsDirectAllowed: next }),")
        // Stopping deletes nothing and is undone by allowing again, so no button here is in the danger colour.
        expect(card).not.toContain("danger")
    })

    it("keeps Turn off from being pressed until the list is read, and Turn on asks whatever the list holds", async () => {
        list.loading = true
        try {
            const on = await card(true, 2)
            expect(on).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${en.settings_turn_off}</button>`))
            expect(on).not.toContain("Straight to Nizmo now")
            expect(await card(false, 2)).not.toMatch(/<button[^>]*disabled=""/)
        } finally {
            list.loading = false
        }
        expect(await card(true, 2)).not.toMatch(/<button[^>]*disabled=""/)
    })

    it("when the list couldn't be read, keeps Turn off from being pressed and says so, with a way to read it again (Codex on PR 295)", async () => {
        // A load that failed isn't a list with no terminals: Turn off stopped at once, asking nothing, with terminals to hold.
        list.failed = true
        try {
            const on = await card(true, 2)
            expect(on).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${en.settings_turn_off}</button>`))
            expect(on).not.toContain("Straight to Nizmo now")
            expect(on).toContain(`<p class="ui-card-note" role="status">${text(en.att_term_direct_list_failed)} <button`)
            expect(on).toContain(`>${en.try_again}</button>`)
            // Off, nothing waits on the list: Turn on asks whatever it holds.
            const off = await card(false, 2)
            expect(off).not.toContain(text(en.att_term_direct_list_failed))
            expect(off).not.toMatch(/<button[^>]*disabled=""/)
            expect(await card(true, 2, "ar")).toContain(ar.att_term_direct_list_failed)
        } finally {
            list.failed = false
        }
        // Read, or still being read, it says nothing of the kind.
        expect(await card(true, 2)).not.toContain(text(en.att_term_direct_list_failed))
        list.loading = true
        try {
            expect(await card(true, 2)).not.toContain(text(en.att_term_direct_list_failed))
        } finally {
            list.loading = false
        }
        const source295 = source("components/TerminalsDirectCard.tsx")
        expect(source295).toContain("{on && !read && !!error && (")
        expect(source295).toContain("busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>")
    })

    it("is shown to the Super Admin alone, for a company holding the Terminals add-on, under who sets terminals up", () => {
        const tabs = readFileSync("components/CompanySettingsTabs.tsx", "utf8")
        const setup = tabs.indexOf("<TerminalsSetupCard")
        const direct = tabs.indexOf("<TerminalsDirectCard")
        expect(setup).toBeGreaterThan(-1)
        expect(direct).toBeGreaterThan(setup)
        expect(tabs).toMatch(/superAdmin && company\.terminalsOffered && \(\s*<>\s*<TerminalsSetupCard[^\n]*\n\s*<TerminalsDirectCard companyId=\{companyId\} on=\{!!company\.terminalsDirectAllowed\} onSaved=\{onSaved\} \/>/)
    })

    it("counts from the list Fingerprint terminals shows, and has it asked for again once the switch is saved", async () => {
        await card(true, 1)
        // The same key as the panel's: one added or retired there is counted here at once.
        expect(list.key).toBe("/api/attendance/devices?companyId=c%201")
        expect(source("components/AttendanceTerminalsPanel.tsx")).toContain("const q = `?companyId=${encodeURIComponent(companyId)}`")
        const card295 = source("components/TerminalsDirectCard.tsx")
        expect(card295).toContain("const terminals = devices.filter(d => d.connection === 'DIRECT' && !d.retiredAt).length")
        // So Add a terminal offers what was just allowed, without the page loaded again.
        expect(card295.indexOf("void mutate()")).toBeGreaterThan(card295.indexOf("onSaved({ terminalsDirectAllowed: next })"))
    })
})

describe("the words", () => {
    const KEYS = [
        "att_term_direct_title", "att_term_direct_label", "att_term_direct_off_hint", "att_term_direct_on_hint", "att_term_direct_count",
        "att_term_direct_turn_on", "att_term_direct_turn_off", "att_term_direct_on_title", "att_term_direct_on_msg", "att_term_direct_off_title", "att_term_direct_off_msg",
        "att_term_direct_list_failed",
        "audit_field_terminalsDirectAllowed",
    ] as const

    it("are in both languages, in sentence case, with no arrow, middle dot or \"we\"", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toBe(en[key])
            expect(ar[key], key).toMatch(/[؀-ۿ]/)
            for (const words of [en[key], ar[key]]) expect(words, key).not.toMatch(/ · |→|\bwe\b|\bour\b/i)
            // Sentence case: no word after the first starts with a capital, names aside.
            expect(en[key].replace(/Nizmo|Super Admin|First contacts|Fingerprint terminals/g, "").slice(1), key).not.toMatch(/(?<![.?:] )\b[A-Z][a-z]/)
        }
    })

    it("keep their numbers' places in both languages", () => {
        for (const key of ["att_term_direct_count", "att_term_direct_off_msg"] as const) {
            expect(en[key].split("{n}"), key).toHaveLength(2)
            expect(ar[key].split("{n}"), key).toHaveLength(2)
        }
    })

    it("say what stopping does: a terminal is held, it keeps its scans and sends them again", () => {
        expect(en.att_term_direct_off_msg).toContain("keeps its scans and sends them again")
        expect(en.att_term_direct_off_hint).toContain("is held")
    })
})
