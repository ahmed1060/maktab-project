import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, Operations part 1
 * (UI_PLAN.md §5 step 5): Check-ins, the check-ins waiting for the Super
 * Admin because our app couldn't prove itself, and, across every company,
 * what the app sent, flagged and refused over the last 30 days.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN" } as Record<string, unknown> | null,
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; danger?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.viewer ? { user: state.viewer } : null, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/dashboard/check-ins", useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))
vi.mock("@/components/ui", async (importOriginal) => {
    const ui = await importOriginal<typeof import("@/components/ui")>()
    const RowMenu = (props: Parameters<typeof ui.RowMenu>[0]) => {
        state.menus.push(props as never)
        return h(ui.RowMenu, props)
    }
    return { ...ui, RowMenu }
})

const PAGE = "app/(dashboard)/dashboard/check-ins/page.tsx"
const API = "/api/admin/check-ins"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
// A section of the page, from its heading to the next one.
const section = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-section-title">${esc(title)}</h2>`)
    if (at < 0) return ""
    const next = html.indexOf('<section class="ui-section">', at)
    return html.slice(at, next < 0 ? undefined : next)
}

function render(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null } = {}) {
    Object.assign(state, { swr, keys: [], menus: [], locale: options.locale ?? "en" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    vi.stubGlobal("document", { body: {} })
    return import("@/app/(dashboard)/dashboard/check-ins/page").then(({ default: CheckInsPage }) => {
        try {
            return renderToStaticMarkup(h(CheckInsPage))
        } finally {
            vi.unstubAllGlobals()
        }
    })
}

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/check-ins/page")
}, 120000)

const waiting = (w: Record<string, unknown> = {}) => ({
    id: "p1", companyId: "c1", userId: "u1", direction: "IN", flagReasons: ["ATTESTATION_UNVERIFIED", "OUTSIDE_AREA"],
    checkIn: { latitude: 30.0444, longitude: 31.2357, distanceMeters: 420, accuracyMeters: 18.4, ip: "41.33.1.2", attestationReason: "token expired" },
    receivedAt: "2026-11-02T06:57:10.000Z", workLocation: { name: "Head office", latitude: 30.04, longitude: 31.23, radiusMeters: 150 },
    phone: { model: "Pixel 8", platform: "ANDROID" }, at: "2026-11-02T08:57:00", name: "Youssef Adel", teamLeaderId: null, companyName: "Delta Sites",
    ...w,
})
const integrity = (r: Record<string, unknown> = {}) => ({
    companyId: "c1", name: "Delta Sites", checkIns: 1240, accepted: 1190, flagged: 38, refused: 12,
    refusedBy: { MOCK_LOCATION: 9, BAD_SIGNATURE: 3 }, flaggedBy: { OUTSIDE_AREA: 30, IMPRECISE_LOCATION: 8 }, ...r,
})
const loaded = (queue: unknown[], rows: unknown[]) => ({ [API]: { data: { data: { queue, integrity: rows, days: 30 } } } })

describe("the Check-ins page", () => {
    it("has the page header, and leaves the old top bar's title alone", async () => {
        const top = header(await render(loaded([waiting()], [integrity()])))
        expect(top).toContain(`<h1 class="ui-page-title">${en.chk_title}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.chk_hint)}</p>`)
        expect(readFileSync(PAGE, "utf8")).not.toContain("useHeader")
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await render(loaded([waiting()], [integrity()]), { viewer: { id: "a1", role: "ADMIN", companyId: "c1" } })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
        await render(loaded([], []))
        expect(state.keys).toContain(API)
    })

    it("lists what waits for them in a section of its own, each check-in by company, person, phone, day, time and place", async () => {
        const html = await render(loaded([waiting()], [integrity()]))
        const queue = section(html, en.chk_queue)
        expect(queue).toContain(`<p class="ui-hint">${esc(en.chk_queue_hint)}</p>`)
        expect(queue).toContain(`<caption class="ui-visually-hidden">${en.chk_queue}</caption>`)
        for (const column of [en.chk_company, en.punch_person, en.punch_time, en.req_flagged_why]) expect(queue, column).toContain(`<th scope="col">${column}</th>`)
        // A name on one line, where the reasons' long lines squeezed it onto two (found in the browser).
        expect(queue).toContain('<span class="ui-nowrap"><bdi>Delta Sites</bdi></span>')
        expect(queue).toContain('<span class="ui-nowrap">Youssef Adel</span>')
        expect(queue).toContain("<bdi>Pixel 8</bdi>")
        // The day and time as the language writes them, where it was "2026-11-02 08:57".
        // As the Requests page writes a flagged check-in's: en-GB's clock is 24-hour.
        expect(queue).toContain(`2 Nov 2026${en.list_separator}8:57`)
        expect(queue).not.toContain("2026-11-02 08:57")
        expect(queue).toContain(en.requests_flagged_in)
        expect(queue).toContain("<bdi>Head office</bdi>")
    })

    it("says why each waits, in a sentence, with how far, how exactly, the network, the app check and the map", async () => {
        const queue = section(await render(loaded([waiting()], [integrity()])), en.chk_queue)
        expect(queue).toContain(`${en.att_flag_ATTESTATION_UNVERIFIED.charAt(0).toUpperCase()}${en.att_flag_ATTESTATION_UNVERIFIED.slice(1)}${en.list_separator}${en.att_flag_OUTSIDE_AREA}`)
        expect(queue).toContain(en.req_flagged_distance.replace("{n}", "420"))
        expect(queue).toContain(esc(en.req_flagged_accuracy.replace("{n}", "18")))
        // The network address and the verifier's words are its own, left to
        // right and never translated (the interface audit).
        expect(queue).toContain('<bdi dir="ltr" translate="no">41.33.1.2</bdi>')
        expect(queue).toContain(en.chk_attest_reason.replace("{reason}", '<bdi translate="no">token expired</bdi>'))
        expect(queue).toMatch(/<a(?=[^>]*href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=30\.0444,31\.2357")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>/)
        expect(queue).toContain(`>${en.requests_flagged_map}</a>`)
        // Not " · ", which reads as the digit zero beside an Arabic number.
        expect(queue).not.toContain(" · ")
    })

    it("accepts or rejects each, the buttons naming whose, and offers the face photos only where the face check failed", async () => {
        const html = await render(loaded([waiting(), waiting({ id: "p2", name: "Mona Hany", flagReasons: ["ATTESTATION_UNVERIFIED", "FACE_UNVERIFIED"] })], [integrity()]))
        const queue = section(html, en.chk_queue)
        for (const name of ["Youssef Adel", "Mona Hany"]) {
            expect(queue).toMatch(new RegExp(`<button(?=[^>]*class="ui-btn ui-btn-secondary ui-btn-sm")(?=[^>]*aria-label="${en.chk_accept}: ${name}")[^>]*>.*?${en.chk_accept}</button>`))
            expect(queue).toMatch(new RegExp(`<button(?=[^>]*class="ui-btn ui-btn-secondary ui-btn-sm")(?=[^>]*aria-label="${en.chk_reject}: ${name}")[^>]*>.*?${en.chk_reject}</button>`))
        }
        // Each row is drawn twice, as a table row and a phone's card.
        const faces = state.menus.filter(m => m.items.some(i => i.key === "face"))
        expect(faces.length).toBeGreaterThan(0)
        expect(faces.every(m => m.label === en.ui_more_actions_for.replace("{name}", "Mona Hany"))).toBe(true)
        expect(faces[0].items.map(i => i.label)).toEqual([en.face_flag_see])
    })

    it("says so when nothing waits", async () => {
        const queue = section(await render(loaded([], [integrity()])), en.chk_queue)
        expect(queue).toContain(`<p class="ui-empty-title">${en.chk_queue_none}</p>`)
        expect(queue).not.toContain("<table")
    })

    it("counts each company's check-ins, flagged and refused over the days it covers, with why, the most first", async () => {
        const html = await render(loaded([], [integrity(), integrity({ companyId: "c2", name: "Nile Works", checkIns: 80, accepted: 80, flagged: 0, refused: 0, refusedBy: {}, flaggedBy: {} })]))
        const counts = section(html, en.chk_integrity)
        expect(counts).toContain(`<p class="ui-hint">${esc(en.chk_integrity_hint.replace("{n}", "30"))}</p>`)
        expect(counts).toContain(`<caption class="ui-visually-hidden">${en.chk_integrity}</caption>`)
        expect(counts).toContain(`<th scope="col">${en.chk_company}</th>`)
        // The counts are numbers alone, and why after them, where why sat
        // under each count, end-aligned, and squeezed the names onto two
        // lines (found in the browser).
        for (const column of [en.chk_checkins, en.chk_accepted, en.chk_flagged, en.chk_refused]) expect(counts, column).toMatch(new RegExp(`<th(?=[^>]*scope="col")(?=[^>]*class="[^"]*ui-end)[^>]*>${column}</th>`))
        expect(counts).toContain(`<th scope="col">${en.req_flagged_why}</th>`)
        expect(counts).toContain('<span class="ui-nowrap"><bdi>Delta Sites</bdi></span>')
        expect(counts).toContain('<span class="ui-num">1,240</span>')
        expect(counts).toContain('<span class="ui-num">1,190</span>')
        expect(counts).toContain(`${en.chk_flagged}: 30 ${en.att_flag_OUTSIDE_AREA}${en.list_separator}8 ${en.att_flag_IMPRECISE_LOCATION}`)
        expect(counts).toContain(`${en.chk_refused}: 9 ${en.att_refusal_MOCK_LOCATION}${en.list_separator}3 ${en.att_refusal_BAD_SIGNATURE}`)
        // A company with none to say why has no lines for it.
        expect(counts).not.toContain(`${en.chk_flagged}: </div>`)
        // Refusals stand out, where a company has any.
        expect(counts).toContain('<span class="ui-badge ui-badge-problem">12</span>')
        expect(counts.match(/ui-badge-problem/g)).toHaveLength(2)
    })

    it("says so when the app has sent no check-ins yet", async () => {
        const counts = section(await render(loaded([], [])), en.chk_integrity)
        expect(counts).toContain(`<p class="ui-empty-title">${en.chk_integrity_none}</p>`)
    })

    it("says when it's loading, and when it failed, with the server's reason and Try again", async () => {
        const loading = await render({})
        expect(loading).toContain('role="status"')
        expect(loading).toContain(en.loading)
        expect(header(loading)).toContain(en.chk_title)
        const failed = await render({ [API]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } })
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.chk_load_failed)}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(`>${en.try_again}</button>`)
    })

    it("writes numbers, days and lists as Arabic does", async () => {
        const html = await render(loaded([waiting()], [integrity()]), { locale: "ar" })
        expect(html).toContain(`<h1 class="ui-page-title">${ar.chk_title}</h1>`)
        expect(html).toContain(ar.req_flagged_distance.replace("{n}", "٤٢٠"))
        expect(html).toContain(ar.chk_integrity_hint.replace("{n}", "٣٠"))
        expect(html).toContain('<span class="ui-num">١٬٢٤٠</span>')
        expect(html).toContain(`٣٠ ${ar.att_flag_OUTSIDE_AREA}${ar.list_separator}٨ ${ar.att_flag_IMPRECISE_LOCATION}`)
        expect(html).toContain(`${ar.att_flag_ATTESTATION_UNVERIFIED}${ar.list_separator}${ar.att_flag_OUTSIDE_AREA}`)
    })

    it("asks before rejecting in the Requests page's dialog, and takes the server's reason for a refusal", () => {
        const page = readFileSync(PAGE, "utf8")
        expect(page).toContain("from '../requests/AttendanceDialogs'")
        expect(page).toMatch(/<RejectRequest\b/)
        expect(page).toContain("t('requests_flagged_reject_question')")
        expect(page).toContain("t('requests_flagged_reject_placeholder')")
        expect(page).toMatch(/decideRequest\(\{ id: [^,]+, kind: 'flagged' \}, true, null\)/)
        // What came before: the old modal and spinner, and styles typed in.
        for (const old of ["ConfirmModal", "LoadingSpinner", "style={", "className=\"glass\"", "className=\"table\"", "btn btn-", "apiErrorText"]) expect(page, old).not.toContain(old)
        expect(page).not.toMatch(/\bas any\b/)
    })
})
