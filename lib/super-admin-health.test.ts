import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, Operations part 3a
 * (UI_PLAN.md §5 step 5): System health's page, and its housekeeping, backup,
 * recovery and maintenance mode cards. The scheduled jobs, the terminals and
 * the backup picker, part 3b, are in lib/super-admin-health-cards.test.ts.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN" } as Record<string, unknown> | null,
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.viewer ? { user: state.viewer } : null, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/dashboard/health", useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// Their own requests, and their own tests (lib/super-admin-health-cards.test.ts).
vi.mock("@/components/JobsCard", () => ({ default: () => h("div", { "data-card": "jobs" }) }))
vi.mock("@/components/TerminalsHealthCard", () => ({ default: () => h("div", { "data-card": "terminals" }) }))
vi.mock("@/components/BackupPickerModal", () => ({ default: () => null }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const PAGE = "app/(dashboard)/dashboard/health/page.tsx"
const DIALOGS = "components/HealthDialogs.tsx"
const HEALTH = "/api/admin/health"
const SETTINGS = "/api/system-settings"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const section = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-section-title">${esc(title)}</h2>`)
    if (at < 0) return ""
    const next = html.indexOf('<section class="ui-section">', at)
    return html.slice(at, next < 0 ? undefined : next)
}
const ok = (data: unknown) => ({ data: { success: true, data } })
const metrics = (m: Record<string, unknown> = {}) => ok({
    auditing: { total: 2021, prunable: 340, retentionDays: 90 },
    notifications: { total: 512, prunable: 0, retentionDays: 30 },
    storage: { totalFiles: 1234, reachable: true },
    ...m,
})
const settings = (on: boolean) => ok({ maintenanceMode: on, maintenanceMessage: on ? "Back in 10 minutes" : null })

function render(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null } = {}) {
    Object.assign(state, { swr, keys: [], locale: options.locale ?? "en" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    vi.stubGlobal("document", { body: {} })
    return import("@/app/(dashboard)/dashboard/health/page").then(({ default: HealthPage }) => {
        try {
            return renderToStaticMarkup(h(HealthPage))
        } finally {
            vi.unstubAllGlobals()
        }
    })
}
async function renderIn(element: () => Promise<ReturnType<typeof h>>, locale: "en" | "ar" = "en") {
    state.locale = locale
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(await element())
    } finally {
        vi.unstubAllGlobals()
    }
}

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/health/page")
}, 120000)

describe("the System health page", () => {
    it("has the page header, its name in sentence case, and leaves the old top bar's title alone", async () => {
        const top = header(await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }))
        expect(en.system_health).toBe("System health")
        expect(top).toContain(`<h1 class="ui-page-title">${en.system_health}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.system_health_subtitle)}</p>`)
        expect(readFileSync(PAGE, "utf8")).not.toContain("useHeader")
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        // It had no check of its own: anyone opening its address saw its cards, empty.
        const html = await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }, { viewer: { id: "a1", role: "ADMIN", companyId: "c1" } })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("puts what's running first, then housekeeping, backups and recovery, and maintenance mode, each a section of its own", async () => {
        const html = await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) })
        const titles = [...html.matchAll(/<h2 class="ui-section-title">([^<]+)<\/h2>/g)].map(m => m[1])
        expect(titles).toEqual([en.health_running, en.health_housekeeping, en.health_backups, en.maintenance_mode_header].map(esc))
        const running = section(html, en.health_running)
        expect(running).toContain('data-card="jobs"')
        expect(running).toContain('data-card="terminals"')
    })

    it("counts the stored files, and finds the ones nothing refers to, which deletes nothing", async () => {
        const html = section(await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }), en.health_housekeeping)
        expect(html).toContain(`<h2 class="ui-card-title">${esc(en.storage_header)}</h2>`)
        expect(html).toMatch(new RegExp(`<dt>${esc(en.health_files)}</dt><dd><span class="ui-num">1,234</span></dd>`))
        expect(html).toMatch(new RegExp(`<button[^>]*>.*?${esc(en.cleanup_orphaned)}</button>`))
        // Finding them is a look, not a delete: no "This permanently deletes files" first.
        expect(readFileSync(PAGE, "utf8")).not.toContain("confirm_cleanup_assets")
        const unreachable = section(await render({ [HEALTH]: metrics({ storage: { totalFiles: null, reachable: false } }), [SETTINGS]: settings(false) }), en.health_housekeeping)
        expect(unreachable).toContain(esc(en.storage_unreachable))
        expect(unreachable).not.toContain("—")
    })

    it("counts the audit log's entries and the notifications, and deletes the old ones, offered only where there are some", async () => {
        const html = section(await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }), en.health_housekeeping)
        expect(html).toContain(`<h2 class="ui-card-title">${en.audit_logs}</h2>`)
        expect(html).toMatch(new RegExp(`<dt>${esc(en.health_entries)}</dt><dd><span class="ui-num">2,021</span></dd>`))
        expect(html).toMatch(new RegExp(`<dt>${esc(en.health_older_than.replace("{days}", "90"))}</dt><dd><span class="ui-num">340</span></dd>`))
        expect(html).toMatch(new RegExp(`<button(?![^>]*disabled)[^>]*>.*?${esc(en.health_prune_logs.replace("{days}", "90"))}</button>`))
        expect(html).toContain(`<h2 class="ui-card-title">${en.notifications}</h2>`)
        expect(html).toMatch(new RegExp(`<dt>${esc(en.health_read_older_than.replace("{days}", "30"))}</dt><dd><span class="ui-num">0</span></dd>`))
        expect(html).toMatch(new RegExp(`<button(?=[^>]*disabled="")[^>]*>.*?${esc(en.health_prune_notifications.replace("{days}", "30"))}</button>`))
    })

    it("backs up now, and restores the latest backup or one picked, the restore in the danger colour", async () => {
        const html = section(await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }), en.health_backups)
        expect(html).toMatch(new RegExp(`<button[^>]*>.*?${esc(en.trigger_backup_now)}</button>`))
        expect(html).toMatch(new RegExp(`<button(?=[^>]*class="ui-btn ui-btn-danger")[^>]*>.*?${esc(en.recover_latest_backup)}</button>`))
        expect(html).toMatch(new RegExp(`<button[^>]*>.*?${esc(en.choose_backup_to_restore)}</button>`))
    })

    it("says whether maintenance mode is on, takes the message people are shown, and turns it on or off", async () => {
        const off = section(await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }), en.maintenance_mode_header)
        expect(off).toContain(`<span class="ui-badge ui-badge-neutral">${en.health_maintenance_off}</span>`)
        expect(off).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${esc(en.health_maintenance_message)}</label>`))
        expect(off).toMatch(/<textarea(?=[^>]*name="maintenanceMessage")(?=[^>]*maxLength="500")[^>]*>/)
        expect(off).toMatch(new RegExp(`<button[^>]*>.*?${esc(en.enable_maintenance_mode)}</button>`))
        const page = await render({ [HEALTH]: metrics(), [SETTINGS]: settings(true) })
        // On: said above everything else, where it was a yellow strip of its own.
        expect(page.indexOf(esc(en.maintenance_active_banner))).toBeLessThan(page.indexOf('<section class="ui-section">'))
        expect(page).toMatch(new RegExp(`<section(?=[^>]*data-tone="waiting")(?=[^>]*role="status")[^>]*>.*?${esc(en.maintenance_active_banner)}`))
        const on = section(page, en.maintenance_mode_header)
        expect(on).toContain(`<span class="ui-badge ui-badge-waiting">${en.health_maintenance_on}</span>`)
        expect(on).toContain(">Back in 10 minutes</textarea>")
        expect(on).toMatch(new RegExp(`<button[^>]*>.*?${esc(en.disable_maintenance_mode)}</button>`))
    })

    it("says while the counts load, and when they didn't, with the server's reason and Try again", async () => {
        const loading = section(await render({ [SETTINGS]: settings(false) }), en.health_housekeeping)
        expect(loading).toContain('role="status"')
        expect(loading).toContain(en.loading)
        const failed = section(await render({ [HEALTH]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) }, [SETTINGS]: settings(false) }), en.health_housekeeping)
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.health_load_failed)}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(`>${en.try_again}</button>`)
    })

    it("writes the counts as Arabic does", async () => {
        const html = await render({ [HEALTH]: metrics(), [SETTINGS]: settings(false) }, { locale: "ar" })
        expect(html).toContain('<span class="ui-num">١٬٢٣٤</span>')
        expect(html).toContain(ar.health_older_than.replace("{days}", "٩٠"))
    })

    it("leaves the old modals, spinner and styles typed in behind, and reports results as toasts", () => {
        const page = readFileSync(PAGE, "utf8")
        for (const old of ["ConfirmModal", "NoticeModal", "LoadingSpinner", "style={", "(t as any)", "glass-card", "className=\"btn\"", "locale === 'ar' ? 'جاري"]) expect(page, old).not.toContain(old)
        expect(page).not.toMatch(/\bas any\b/)
        expect(page).toContain("showToast(")
        expect(existsSync("components/NoticeModal.tsx")).toBe(false)
    })
})

describe("System health's dialogs", () => {
    it("asks before an action, and for a word typed before one that can't be undone, its button off until it's typed", async () => {
        const { ConfirmHealthAction } = await import("@/components/HealthDialogs")
        const html = await renderIn(async () => h(ConfirmHealthAction, {
            title: en.confirm_restore_latest_title, body: en.confirm_restore_latest_msg, word: "RESTORE", danger: true,
            confirmLabel: en.recover_latest_backup, busy: false, onConfirm: () => {}, onCancel: () => {},
        }))
        expect(html).toContain('role="dialog"')
        expect(html).toContain(esc(en.confirm_restore_latest_title))
        expect(html).toContain(esc(en.confirm_restore_latest_msg))
        // The word itself, as the code has it: left to right, never translated.
        const [before, after] = en.health_type_word.split("{word}")
        expect(html).toContain(`${esc(before)}<bdi dir="ltr" translate="no">RESTORE</bdi>${esc(after)}`)
        expect(html).toMatch(/<input(?=[^>]*name="confirmWord")(?=[^>]*autoComplete="off")(?=[^>]*spellCheck="false")[^>]*>/)
        expect(html).toMatch(new RegExp(`<button(?=[^>]*class="ui-btn ui-btn-danger")(?=[^>]*disabled="")[^>]*>.*?${esc(en.recover_latest_backup)}</button>`))
        // One that can be undone, or is only a look, asks without a word.
        const plain = await renderIn(async () => h(ConfirmHealthAction, {
            title: en.confirm_trigger_backup_title, body: en.confirm_trigger_backup_msg,
            confirmLabel: en.trigger_backup_now, busy: false, onConfirm: () => {}, onCancel: () => {},
        }))
        expect(plain).not.toContain('name="confirmWord"')
        expect(plain).toMatch(new RegExp(`<button(?=[^>]*class="ui-btn ui-btn-primary")(?![^>]*disabled)[^>]*>.*?${esc(en.trigger_backup_now)}</button>`))
    })

    it("lists the files nothing refers to before deleting them, each path kept as it is, with how many and how much", async () => {
        const { OrphanReport } = await import("@/components/HealthDialogs")
        const report = { orphaned: 2, total: 1234, bytes: 2.5 * 1024 * 1024, orphans: ["c1/records/a.pdf", "c1/tasks/b.jpg"] }
        const html = await renderIn(async () => h(OrphanReport, { report, busy: false, onDelete: () => {}, onClose: () => {} }))
        expect(html).toContain(esc(en.orphan_report_title))
        expect(html).toContain(en.health_orphans_found.replace("{count}", "2").replace("{total}", "1,234").replace("{size}", "2.5 MB"))
        expect(html).toContain('<li><bdi dir="ltr" translate="no">c1/records/a.pdf</bdi></li>')
        expect(html).toMatch(new RegExp(`<button(?=[^>]*class="ui-btn ui-btn-danger")[^>]*>.*?${esc(en.orphan_report_delete)}</button>`))
        const none = await renderIn(async () => h(OrphanReport, { report: { orphaned: 0, total: 1234, bytes: 0, orphans: [] }, busy: false, onDelete: () => {}, onClose: () => {} }))
        expect(none).toContain(esc(en.orphan_report_none))
        expect(none).not.toContain(esc(en.orphan_report_delete))
        expect(readFileSync(DIALOGS, "utf8")).not.toMatch(/style=\{|\bas any\b/)
    })
})

describe("System health, found in the interface audit", () => {
    it("lets the list of unused files be scrolled from the keyboard, named for what it lists", async () => {
        // It scrolls within itself, and a list that can't take focus can't be scrolled without a mouse.
        const { OrphanReport } = await import("@/components/HealthDialogs")
        const report = { orphaned: 1, total: 10, bytes: 2048, orphans: ["c1/a.pdf"] }
        const html = await renderIn(async () => h(OrphanReport, { report, busy: false, onDelete: () => {}, onClose: () => {} }))
        expect(html).toMatch(new RegExp(`<ul(?=[^>]*class="ui-report ui-report-scroll")(?=[^>]*tabindex="0")(?=[^>]*aria-label="${esc(en.orphan_report_title)}")[^>]*>`))
    })

    it("draws only the lines in view, for a backlog of thousands", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const rule = css.slice(css.indexOf(".ui-report-scroll > li {"))
        expect(rule.slice(0, rule.indexOf("}"))).toContain("content-visibility: auto")
    })

    it("says what to do next when a backup, a restore or maintenance mode didn't start", () => {
        for (const key of ["backup_trigger_failed", "restore_trigger_failed", "maintenance_toggle_failed"] as const) {
            expect(en[key], key).toMatch(/Try again/)
            expect(ar[key], key).toMatch(/حاول مرة أخرى/)
        }
    })
})

describe("System health, found in the browser", () => {
    it("names maintenance mode once, its state beside the section's title", async () => {
        // The section and its one card were both titled "Maintenance mode", one under the other.
        const html = await render({ [HEALTH]: metrics(), [SETTINGS]: settings(true) })
        const part = section(html, en.maintenance_mode_header)
        expect(part).not.toContain(`<h2 class="ui-card-title">${esc(en.maintenance_mode_header)}</h2>`)
        expect(part.slice(0, part.indexOf("</div>"))).toContain(`<span class="ui-badge ui-badge-waiting">${en.health_maintenance_on}</span>`)
    })

    it("spaces a question's sentence, the word's field and the buttons, as every dialog's form is", async () => {
        // The field and the buttons sat against the sentence and each other.
        const { ConfirmHealthAction } = await import("@/components/HealthDialogs")
        const html = await renderIn(async () => h(ConfirmHealthAction, {
            title: "t", body: "b", word: "RESTORE", confirmLabel: "go", busy: false, onConfirm: () => {}, onCancel: () => {},
        }))
        expect(html).toMatch(/<form class="ui-form"/)
    })

    it("spaces what a look for unused files found, and its buttons, from each other", async () => {
        const { OrphanReport } = await import("@/components/HealthDialogs")
        const html = await renderIn(async () => h(OrphanReport, { report: { orphaned: 1, total: 2, bytes: 1, orphans: ["a"] }, busy: false, onDelete: () => {}, onClose: () => {} }))
        expect(html.startsWith('<div class="ui-card-report">')).toBe(true)
        const css = readFileSync("components/ui/ui.css", "utf8")
        const rule = css.slice(css.indexOf(".ui-card-report {"))
        expect(rule.slice(0, rule.indexOf("}"))).toMatch(/gap: var\(--space-\d\)/)
    })
})

describe("System health, from Codex's review of PR 176", () => {
    it("can't be cancelled once the action is under way, by its button or by Escape", async () => {
        // Cancel closed the question while a restore or a delete went on: it looked called off and wasn't.
        const { ConfirmHealthAction } = await import("@/components/HealthDialogs")
        const html = await renderIn(async () => h(ConfirmHealthAction, {
            title: "t", body: "b", word: "RESTORE", danger: true, confirmLabel: "Restore", busy: true, onConfirm: () => {}, onCancel: () => {},
        }))
        expect(html).toMatch(new RegExp(`<button(?=[^>]*disabled="")[^>]*>${en.cancel}</button>`))
        const code = readFileSync(DIALOGS, "utf8")
        expect(code).toMatch(/<Dialog open onClose=\{\(\) => \{ if \(!busy\) onCancel\(\) \}\}/)
    })

    it("keeps a backup picker closed once it's closed, and takes only the latest list asked for", async () => {
        // Closed while it loaded, the list's answer opened it again, over whatever came next.
        const { answerFor } = await import("@/components/HealthDialogs")
        const asked = { request: 2, backups: [], loading: true, error: null }
        const answer = { request: 2, backups: [], loading: false, error: null }
        expect(answerFor(null, answer)).toBe(null)
        expect(answerFor({ ...asked, request: 3 }, answer)).toEqual({ ...asked, request: 3 })
        expect(answerFor(asked, answer)).toBe(answer)
        expect(readFileSync(PAGE, "utf8")).toContain("setPicker(p => answerFor(p, ")
    })
})
