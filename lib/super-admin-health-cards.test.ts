import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { fileSize } from "./record-files"
import { DEFAULT_TIME_ZONE } from "./time"

/**
 * System health, Operations part 3b (UI_PLAN.md §5 step 5): its scheduled
 * jobs card, its terminals card and its backup picker on the building
 * blocks. Part 3a moved the page and its maintenance cards.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const NOW = Date.parse("2026-11-03T10:00:00Z")
const state = { locale: "en" as "en" | "ar", swr: {} as Record<string, Loaded> }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useNow", () => ({ useNow: () => NOW }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => ({ data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...(key ? state.swr[key] ?? {} : {}) }),
}))

const JOBS = "/api/admin/maintenance/jobs"
const TERMINALS = "/api/admin/terminals"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const hoursAgo = (n: number) => new Date(NOW - n * 36e5).toISOString()
const ago = (locale: "en" | "ar", n: number, unit: "hour" | "day") => new Intl.RelativeTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { numeric: "auto" }).format(-n, unit)
const job = (j: Record<string, unknown>) => ({
    job: "obligations", label: "Obligations", everyHours: 24, lastRunAt: hoursAgo(2), lastSuccessAt: hoursAgo(2),
    lastError: null, failureStreak: 0, neverRun: false, overdue: false, ...j,
})
const backup = (b: Record<string, unknown> = {}) => ({ reachable: true, error: null, newestAt: hoursAgo(3), newestName: "nizmo-2026-11-03", ageHours: 3, stale: false, ...b })
const jobsAnswer = (jobs: unknown[], b = backup()) => ({ data: { success: true, data: { jobs, backup: b, staleAfterHours: 30 } } })

async function render(component: string, props: Record<string, unknown>, swr: Record<string, Loaded>, locale: "en" | "ar" = "en") {
    Object.assign(state, { swr, locale })
    const { default: C } = await import(`@/components/${component}`)
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(C, props))
    } finally {
        vi.unstubAllGlobals()
    }
}
/** A row of the list: its <li> through its end. */
const rowOf = (html: string, text: string) => {
    const at = html.indexOf(text)
    const start = html.lastIndexOf("<li", at)
    return html.slice(start, html.indexOf("</li>", at) + 5)
}
const OLD = ["style={", "glass-card", "(t as any)", "' as any", "LoadingSpinner", "' · '", "className=\"btn\"", "fontSize"]

describe("the scheduled jobs card", () => {
    it("is a card with its title, says what it's for, and puts the backup first", async () => {
        const html = await render("JobsCard", {}, { [JOBS]: jobsAnswer([job({})]) })
        expect(html).toContain(`<h2 class="ui-card-title">${en.jobs_header}</h2>`)
        expect(html).toContain(esc(en.jobs_subtitle))
        expect(html.indexOf(`>${en.jobs_backup}<`)).toBeLessThan(html.indexOf(`>${en.jobs_name_obligations}<`))
        const row = rowOf(html, `>${en.jobs_backup}<`)
        expect(row).toContain(`<span class="ui-badge ui-badge-good">${en.jobs_backup_ok}</span>`)
        expect(row).toContain(en.jobs_backup_newest.replace("{when}", ago("en", 3, "hour")))
        expect(row).toContain('<bdi dir="ltr" translate="no">nizmo-2026-11-03</bdi>')
    })

    it("says which of the two reds it is when the backup isn't safe, the row marked", async () => {
        for (const [b, words] of [[{ reachable: false, newestAt: null, stale: true }, en.jobs_backup_unreachable], [{ error: "NO_BACKUPS", newestAt: null }, en.jobs_no_backups], [{ stale: true, newestAt: hoursAgo(50) }, en.jobs_backup_stale]] as const) {
            const row = rowOf(await render("JobsCard", {}, { [JOBS]: jobsAnswer([], backup(b)) }), `>${en.jobs_backup}<`)
            expect(row, words).toMatch(/^<li data-tone="overdue">/)
            expect(row, words).toContain(`<span class="ui-badge ui-badge-problem">${esc(words)}</span>`)
        }
    })

    it("names each job in the reader's language, how often it runs, and when it last worked", async () => {
        const html = await render("JobsCard", {}, { [JOBS]: jobsAnswer([job({}), job({ job: "check-in-reminder", label: "Check-in reminders", everyHours: 1 })]) }, "ar")
        const row = rowOf(html, `>${ar.jobs_name_obligations}<`)
        expect(html).not.toContain(">Obligations<")
        expect(row).toContain(`<span class="ui-badge ui-badge-good">${ar.jobs_working}</span>`)
        expect(row).toContain(ar.jobs_every_day)
        expect(row).toContain(ar.jobs_last_worked.replace("{when}", ago("ar", 2, "hour")))
        expect(rowOf(html, `>${ar.jobs_name_check_in_reminder}<`)).toContain(ar.jobs_every_hour)
    })

    it("shows silence as loudly as failure, and the last error in words where it was a tooltip", async () => {
        const html = await render("JobsCard", {}, { [JOBS]: jobsAnswer([
            job({ job: "prune", neverRun: true, lastRunAt: null, lastSuccessAt: null }),
            job({ job: "employment", overdue: true }),
            job({ job: "attendance", failureStreak: 1, lastError: "Timed out after 60s" }),
            job({ job: "acting-roles", failureStreak: 3, lastError: "boom" }),
        ]) })
        const never = rowOf(html, `>${en.jobs_name_prune}<`)
        expect(never).toMatch(/^<li data-tone="overdue">/)
        expect(never).toContain(`<span class="ui-badge ui-badge-problem">${en.jobs_never_run}</span>`)
        expect(never).toContain(en.jobs_no_run)
        expect(rowOf(html, `>${en.jobs_name_employment}<`)).toContain(`<span class="ui-badge ui-badge-problem">${en.jobs_overdue}</span>`)
        const once = rowOf(html, `>${en.jobs_name_attendance}<`)
        expect(once).toContain(`<span class="ui-badge ui-badge-waiting">${en.jobs_failing}</span>`)
        expect(once).toContain('<span class="ui-item-note"><bdi>Timed out after 60s</bdi></span>')
        expect(once).not.toContain("title=")
        expect(rowOf(html, `>${en.jobs_name_acting_roles}<`)).toContain(`<span class="ui-badge ui-badge-problem">${en.jobs_failing}</span>`)
    })

    it("says while it checks, and when it couldn't, with the server's reason and Try again", async () => {
        const loading = await render("JobsCard", {}, {})
        expect(loading).toMatch(new RegExp(`role="status"[^>]*>${en.jobs_loading}<`))
        const failed = await render("JobsCard", {}, { [JOBS]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } })
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.jobs_check_failed)}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(`>${en.try_again}</button>`)
    })

    it("leaves its styles typed in, its emoji and its untyped labels behind", () => {
        const src = readFileSync("components/JobsCard.tsx", "utf8")
        for (const old of [...OLD, "🩺", "💾", "jobs_hours_short", "fetchRetrying"]) expect(src, old).not.toContain(old)
        expect(src).not.toMatch(/\bas any\b/)
    })
})

const company = (c: Record<string, unknown> = {}) => ({
    companyId: "c1", name: "Delta Sites", working: true, tone: "bad",
    agents: [{ id: "a1", name: "Head office", health: "SILENT", queueDepth: null }],
    terminals: { total: 3, ok: 2, unreachable: 1, silent: 0, memoryFull: 0, clockOff: 0 },
    ...c,
})

describe("the terminals card", () => {
    it("lists each company with its state in its meaning's colour, and what's wrong, fact by fact", async () => {
        const html = await render("TerminalsHealthCard", {}, { [TERMINALS]: { data: { success: true, data: { companies: [company(), company({ companyId: "c2", name: "Nile Co", tone: "ok", agents: [{ id: "a2", name: "Main", health: "OK", queueDepth: 0 }], terminals: { total: 1, ok: 1, unreachable: 0, silent: 0, memoryFull: 0, clockOff: 0 } })] } } } })
        expect(html).toContain(`<h2 class="ui-card-title">${en.att_term_health_title}</h2>`)
        expect(html).toContain(esc(en.att_term_health_bad.replace("{count}", "1 company")))
        const bad = rowOf(html, "Delta Sites")
        expect(bad).toContain("<bdi>Delta Sites</bdi>")
        expect(bad).toContain(`<span class="ui-badge ui-badge-problem">${en.att_term_health_bad_pill}</span>`)
        const facts = [`<bdi>Head office</bdi>: ${en.att_term_agent_SILENT}`, en.att_term_health_terminals.replace("{ok}", "2").replace("{total}", "3"), en.att_term_health_unreachable.replace("{n}", "1")]
        expect(bad).toContain(facts.map(f => `<bdi>${f}</bdi>`).join(en.list_separator))
        expect(rowOf(html, "Nile Co")).toContain(`<span class="ui-badge ui-badge-good">${en.att_term_health_ok_pill}</span>`)
    })

    it("writes its counts as Arabic does", async () => {
        const html = await render("TerminalsHealthCard", {}, { [TERMINALS]: { data: { success: true, data: { companies: [company()] } } } }, "ar")
        expect(html).toContain(ar.att_term_health_terminals.replace("{ok}", "٢").replace("{total}", "٣"))
    })

    it("says so when no company has an agent yet", async () => {
        const html = await render("TerminalsHealthCard", {}, { [TERMINALS]: { data: { success: true, data: { companies: [] } } } })
        expect(html).toContain(esc(en.att_term_health_none))
        expect(html).not.toContain("ui-rows")
    })

    it("stays in its place when it didn't load, saying so with Try again, where it disappeared", async () => {
        const html = await render("TerminalsHealthCard", {}, { [TERMINALS]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } })
        expect(html).toContain(`<h2 class="ui-card-title">${en.att_term_health_title}</h2>`)
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
        const src = readFileSync("components/TerminalsHealthCard.tsx", "utf8")
        expect(src).not.toContain("return null")
        for (const old of [...OLD, "🖐"]) expect(src, old).not.toContain(old)
    })
})

const backups = [
    { folder: "daily", baseName: "nizmo-2026-11-02", sizeBytes: 48 * 1024 * 1024, modifiedTime: "2026-11-02T02:00:00Z" },
    { folder: "weekly", baseName: "nizmo-2026-10-27", sizeBytes: 46 * 1024 * 1024, modifiedTime: "2026-10-27T02:00:00Z" },
]
const picker = (p: Record<string, unknown> = {}) => ({ isOpen: true, backups, loading: false, error: null, onSelect: () => {}, onClose: () => {}, onRetry: () => {}, ...p })

describe("the backup picker", () => {
    it("is a dialog that lists each backup by its name as it's stored, which kind, when and how big", async () => {
        const html = await render("BackupPickerModal", picker(), {})
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`<h2 id="`)
        expect(html).toContain(esc(en.choose_backup_to_restore))
        const row = rowOf(html, "nizmo-2026-11-02")
        expect(row).toContain('<bdi dir="ltr" translate="no">nizmo-2026-11-02</bdi>')
        const when = new Date("2026-11-02T02:00:00Z").toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: DEFAULT_TIME_ZONE })
        expect(row).toContain([en.backup_folder_daily, when, fileSize(48 * 1024 * 1024, "en")].map(f => `<bdi>${f}</bdi>`).join(en.list_separator))
        // Each Restore names which, for someone hearing the list rather than seeing it.
        expect(row).toMatch(new RegExp(`<button(?=[^>]*aria-label="${en.backup_picker_select_named.replace("{name}", "nizmo-2026-11-02")}")[^>]*>${en.backup_picker_select}</button>`))
        expect(html).toContain(`>${en.cancel}</button>`)
    })

    it("says while it loads, when there are none, and when it couldn't, with Try again", async () => {
        expect(await render("BackupPickerModal", picker({ loading: true, backups: [] }), {})).toMatch(new RegExp(`role="status"[^>]*>${esc(en.backup_picker_loading)}<`))
        expect(await render("BackupPickerModal", picker({ backups: [] }), {})).toContain(esc(en.backup_picker_empty))
        const failed = await render("BackupPickerModal", picker({ backups: [], error: en.backup_picker_error }), {})
        expect(failed).toContain(esc(en.backup_picker_error))
        expect(failed).toContain(`>${en.try_again}</button>`)
    })

    it("is nothing while closed, and leaves the old window behind", async () => {
        expect(await render("BackupPickerModal", picker({ isOpen: false }), {})).toBe("")
        const src = readFileSync("components/BackupPickerModal.tsx", "utf8")
        for (const old of [...OLD, "createPortal", "useDialog(", "formatSize"]) expect(src, old).not.toContain(old)
    })

    it("is given its Try again by the page", () => {
        expect(readFileSync("app/(dashboard)/dashboard/health/page.tsx", "utf8")).toMatch(/onRetry=\{\(\) => \{ void openPicker\(\) \}\}/)
    })
})

describe("System health's labels", () => {
    it("are in sentence case, and the short hour and day words are gone", () => {
        expect(en.jobs_never_run).toBe("Never run")
        expect(en.backup_picker_select).toBe("Restore")
        for (const key of ["jobs_hours_short", "jobs_days_short", "backup_picker_title"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})

describe("System health's cards, found in the browser", () => {
    it("keeps an agent's name apart from its state, so they can't swap places in Arabic", async () => {
        // "Main branch: متصل" came out with the state first, the name and the state one run of text.
        const html = await render("TerminalsHealthCard", {}, { [TERMINALS]: { data: { success: true, data: { companies: [company()] } } } }, "ar")
        expect(html).toContain(`<bdi><bdi>Head office</bdi>: ${ar.att_term_agent_SILENT}</bdi>`)
    })

    it("says what went wrong when Google Drive didn't answer, in the server's words, where it guessed", async () => {
        // It said Drive "may not be set up" when the server had said it couldn't reach it.
        const failed = await render("BackupPickerModal", picker({ backups: [], error: en.backup_picker_error, reason: "Couldn't reach Google Drive to list backups" }), {})
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.backup_picker_error)}</p>`)
        expect(failed).toContain(`<p class="ui-empty-detail">${esc("Couldn't reach Google Drive to list backups")}</p>`)
        expect(en.backup_picker_error).not.toMatch(/may not|set up/)
        expect(readFileSync("app/(dashboard)/dashboard/health/page.tsx", "utf8")).toContain("reason={picker?.reason ?? null}")
    })
})

describe("System health's cards, found in the interface audit", () => {
    it("asks for the jobs again while it's open, so a job that ran since doesn't still read late", () => {
        // Its times ticked on while what they were about stayed as the page found them.
        expect(readFileSync("components/JobsCard.tsx", "utf8")).toMatch(/useSWR\('\/api\/admin\/maintenance\/jobs', fetcher, \{ refreshInterval: 5 \* 60_000 \}\)/)
    })

    it("says which card didn't load, where it said only that something went wrong", async () => {
        const html = await render("TerminalsHealthCard", {}, { [TERMINALS]: { error: Object.assign(new Error("x"), { status: 500, info: {} }) } })
        expect(html).toContain(`<p class="ui-empty-title">${esc(en.att_term_health_failed)}</p>`)
        expect(ar).toHaveProperty("att_term_health_failed")
    })
})
