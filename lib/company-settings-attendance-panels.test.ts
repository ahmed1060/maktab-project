import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Company settings on the building blocks, part 3c (UI_PLAN.md §5 step 5):
 * the four panels above the Attendance tab's policy and calendar, that is
 * attendance in payroll, the fingerprint terminals, the check-in places and
 * face verification's legal readiness.
 */

type Loaded = { data?: unknown; error?: unknown; isLoading?: boolean; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    swr: {} as Record<string, Loaded>,
    // Each row menu's items as rendered, when a test wants to choose one.
    menus: null as null | { label: string; items: { key: string; onSelect?: () => void; disabled?: boolean }[] }[],
}

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/settings",
    useSearchParams: () => new URLSearchParams("tab=attendance"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/components/PointPicker", () => ({ default: () => null }))
vi.mock("@/components/ui", async (importOriginal) => {
    const ui = await importOriginal<typeof import("@/components/ui")>()
    const RowMenu = (props: Parameters<typeof ui.RowMenu>[0]) => {
        state.menus?.push(props)
        return h(ui.RowMenu, props)
    }
    return { ...ui, RowMenu }
})
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})

const esc = (s: string) => s.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const ok = (data: unknown) => ({ data: { data } })
const failed = (status: number) => ({ error: Object.assign(new Error("x"), { status, info: { error: status === 500 ? "Database unavailable" : "Not in the package" } }) })

async function render(file: string, swr: Record<string, Loaded>, { readOnly = false, locale = "en" as "en" | "ar" } = {}) {
    Object.assign(state, { swr, locale })
    const { default: Panel } = await import(`@/components/${file}`)
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Panel, { companyId: "c1", readOnly }))
    } finally {
        vi.unstubAllGlobals()
    }
}

const PAY = "/api/attendance/payroll-from?companyId=c1"
const FACE = "/api/attendance/face/legal?companyId=c1"
const AGENTS = "/api/attendance/agents?companyId=c1"
const DEVICES = "/api/attendance/devices?companyId=c1"
const PLACES = "/api/attendance/locations?companyId=c1"

describe("attendance in payroll", () => {
    it("is a card saying whether attendance reaches pay, from which month, in the page's language", async () => {
        const off = await render("AttendancePayrollPanel", { [PAY]: ok({ from: null, earliest: "2026-11" }) })
        expect(off).toContain(`<h2 class="ui-card-title">${en.attpay_title}</h2>`)
        expect(off).toContain(`<p>${esc(en.attpay_off)}</p>`)
        expect(off).toContain(`<p class="ui-card-note">${esc(en.attpay_hint)}</p>`)
        const on = await render("AttendancePayrollPanel", { [PAY]: ok({ from: "2026-12", earliest: "2026-11" }) }, { locale: "ar" })
        expect(on).toContain(ar.attpay_on.replace("{month}", "ديسمبر ٢٠٢٦"))
    })

    it("asks from which month in a labelled field, with the earliest under it, and none of it for someone who can only look", async () => {
        const html = await render("AttendancePayrollPanel", { [PAY]: ok({ from: "2026-12", earliest: "2026-11" }) })
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.attpay_from}</label>`))
        expect(html).toMatch(/<input class="ui-input"[^>]*type="month"/)
        expect(html).toContain(esc(en.attpay_earliest.replace("{month}", "November 2026")))
        expect(html).toMatch(new RegExp(`ui-btn-primary[^>]*>${en.attpay_set}</button>`))
        expect(html).toMatch(new RegExp(`ui-btn-secondary[^>]*>${en.attpay_stop}</button>`))
        const looking = await render("AttendancePayrollPanel", { [PAY]: ok({ from: "2026-12", earliest: "2026-11" }) }, { readOnly: true })
        expect(looking).not.toContain(`${en.attpay_from}</label>`)
        expect(looking).not.toContain("</button>")
    })

    it("says what's wrong with the month under the field, before asking", async () => {
        const { monthError } = await import("@/components/AttendancePayrollPanel")
        expect(monthError("", "2026-11")).toBe("attpay_month_required")
        expect(monthError("2026-10", "2026-11")).toBe("attpay_month_too_early")
        expect(monthError("2026-11", "2026-11")).toBeNull()
        expect(monthError("2025-01", null)).toBeNull()
        for (const key of ["attpay_month_required", "attpay_month_too_early"] as const) {
            expect(en[key]).toBeTruthy()
            expect(ar[key]).toBeTruthy()
        }
    })

    it("says when it didn't load, with Try again", async () => {
        const html = await render("AttendancePayrollPanel", { [PAY]: failed(500) })
        expect(html).toContain(esc(en.attpay_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(">Try again</button>")
    })
})

describe("face verification's legal readiness", () => {
    it("says whether it's confirmed, and since when in the page's language", async () => {
        const confirmed = await render("FaceLegalPanel", { [FACE]: ok({ system: "ON", mobileApp: true, legalConfirmedAt: "2026-10-05T09:00:00.000Z" }) })
        expect(confirmed).toContain(`<h2 class="ui-card-title">${en.face_legal_title}</h2>`)
        expect(confirmed).toContain(`<span class="ui-badge ui-badge-good">${en.face_legal_confirmed.replace("{date}", "5 Oct 2026")}</span>`)
        expect(confirmed).toMatch(new RegExp(`ui-btn-secondary[^>]*>${en.face_legal_withdraw}</button>`))
        // It was the date as stored: "2026-10-05".
        expect(confirmed).not.toContain("2026-10-05")
        const arabic = await render("FaceLegalPanel", { [FACE]: ok({ system: "ON", mobileApp: true, legalConfirmedAt: "2026-10-05T09:00:00.000Z" }) }, { locale: "ar" })
        expect(arabic).toContain(ar.face_legal_confirmed.replace("{date}", "٥ أكتوبر ٢٠٢٦"))
        const not = await render("FaceLegalPanel", { [FACE]: ok({ system: "ON", mobileApp: true, legalConfirmedAt: null }) })
        expect(not).toContain(`<span class="ui-badge ui-badge-neutral">${en.face_legal_not_confirmed}</span>`)
        expect(not).toMatch(new RegExp(`ui-btn-primary[^>]*>${en.face_legal_confirm}</button>`))
    })

    it("stands out while face checks are paused, and isn't there while they're off or the app isn't in the package", async () => {
        const paused = await render("FaceLegalPanel", { [FACE]: ok({ system: "PAUSED", mobileApp: true, legalConfirmedAt: null }) })
        expect(paused).toContain('data-tone="waiting"')
        expect(paused).toContain(en.face_sys_state_PAUSED)
        expect(await render("FaceLegalPanel", { [FACE]: ok({ system: "OFF", mobileApp: true, legalConfirmedAt: null }) })).toBe("")
        expect(await render("FaceLegalPanel", { [FACE]: ok({ system: "ON", mobileApp: false, legalConfirmedAt: null }) })).toBe("")
        expect(await render("FaceLegalPanel", { [FACE]: ok({ system: "ON", mobileApp: true, legalConfirmedAt: null }) }, { readOnly: true })).not.toContain("</button>")
    })
})

const AGENT_LIST = {
    agents: [
        { id: "a1", name: "Office PC", status: "ACTIVE", codeExpiresAt: null, hostname: "FRONT-DESK", agentVersion: "1.4.2", lastSeenAt: "2026-01-01T08:00:00.000Z", lastSyncAt: null, queueDepth: 3, clockDriftSeconds: 300, health: "OK" },
        { id: "a2", name: "Warehouse PC", status: "PENDING", codeExpiresAt: "2026-11-02T12:00:00.000Z", hostname: null, agentVersion: null, lastSeenAt: null, lastSyncAt: null, queueDepth: null, clockDriftSeconds: null, health: "WAITING" },
        { id: "a3", name: "Old PC", status: "REVOKED", codeExpiresAt: null, hostname: null, agentVersion: null, lastSeenAt: null, lastSyncAt: null, queueDepth: null, clockDriftSeconds: null, health: "REVOKED" },
    ],
}
const DEVICE_LIST = {
    devices: [
        { id: "d1", serialNumber: "ZK-001", name: "Front door", model: "K40", mode: "ENTRANCE", lastSeenAt: null, lastPunchAt: null, reachable: true, lastError: null, clockDriftSeconds: 600, recordCount: 95_000, recordCapacity: 100_000, retiredAt: null, health: { state: "OK", memoryFull: true, clockOff: true } },
        { id: "d2", serialNumber: "ZK-002", name: "Back door", model: null, mode: "ANY", lastSeenAt: null, lastPunchAt: null, reachable: true, lastError: null, clockDriftSeconds: null, recordCount: null, recordCapacity: null, retiredAt: "2026-06-01T00:00:00.000Z", health: { state: "RETIRED", memoryFull: false, clockOff: false } },
    ],
}
const terminals = (extra: Record<string, Loaded> = {}) => ({ [AGENTS]: ok(AGENT_LIST), [DEVICES]: ok(DEVICE_LIST), ...extra })

describe("the fingerprint terminals", () => {
    it("are a card listing the agents and the terminals as rows, each with its state as a badge", async () => {
        const html = await render("AttendanceTerminalsPanel", terminals())
        expect(html).toContain(`<h2 class="ui-card-title">${en.att_term_title}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.att_term_hint)}</p>`)
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.att_term_agents}</h3>`)
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.att_term_devices}</h3>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.att_term_agent_OK}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.att_term_agent_WAITING}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.att_term_queue.replace("{n}", "3")}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.att_term_memory_full.replace("{p}", "95")}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.att_term_device_RETIRED}</span>`)
        // A row's facts are joined as the language joins them, its mode among them.
        expect(html).toContain(`<bdi>FRONT-DESK</bdi>${en.list_separator}<bdi>v1.4.2</bdi>`)
        expect(html).toContain(en.att_term_mode_line.replace("{mode}", en.audit_value_ENTRANCE))
        expect(html).toContain(en.att_term_revoked_line.replace("{n}", "1"))
        expect(html).not.toContain(" · ")
    })

    it("give each agent and terminal a menu named for it, and Add an agent, to whoever reaches them", async () => {
        const html = await render("AttendanceTerminalsPanel", terminals())
        expect(html).toMatch(new RegExp(`ui-btn-primary[^>]*>(<svg[\\s\\S]*?</svg>)?${en.att_term_add_agent}</button>`))
        for (const name of ["Office PC", "Warehouse PC", "Front door", "Back door"]) {
            expect(html, name).toContain(`aria-label="${en.ui_more_actions_for.replace("{name}", name)}"`)
        }
        // The mode was a select in each row, changed as it was picked.
        expect(html).not.toContain("<select")
        // No read-only view since PR 277 (ATTENDANCE_PLAN.md §17.10): whoever
        // reaches the panel may change everything in it, and nobody else
        // reaches it at all.
        expect(readFileSync("components/AttendanceTerminalsPanel.tsx", "utf8")).not.toContain("readOnly")
    })

    it("aren't there when the package doesn't have them, and say so when they didn't load, with Try again", async () => {
        expect(await render("AttendanceTerminalsPanel", { [AGENTS]: failed(403) })).toBe("")
        const html = await render("AttendanceTerminalsPanel", { [AGENTS]: failed(500) })
        expect(html).toContain(esc(en.att_term_load_failed))
        expect(html).toContain(">Try again</button>")
    })

    it("connect an agent in the building blocks' dialogs: its name, then the code to type", async () => {
        const { AgentDialog, CodeDialog, TerminalDialog } = await import("@/components/AttendanceTerminalsPanel")
        Object.assign(state, { locale: "en", swr: {} })
        vi.stubGlobal("document", { body: {} })
        try {
            const agent = renderToStaticMarkup(h(AgentDialog, { busy: false, onClose: () => {}, onSubmit: async () => {} }))
            expect(agent).toContain('role="dialog"')
            expect(agent).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.att_term_agent_name}</label>`))
            expect(agent).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary[^"]*">${en.att_term_add_agent}</button>`))
            const code = renderToStaticMarkup(h(CodeDialog, { shown: { name: "Office PC", code: "AB12-CD34", expiresAt: null }, onClose: () => {} }))
            expect(code).toContain(en.att_term_code_title.replace("{name}", "Office PC"))
            expect(code).toMatch(/<p class="ui-code" dir="ltr" translate="no">AB12-CD34<\/p>/)
            expect(code).toContain(`${en.att_term_done}</button>`)
            const device = renderToStaticMarkup(h(TerminalDialog, { device: { name: "Front door", mode: "ENTRANCE" as const }, busy: false, onClose: () => {}, onSubmit: async () => {} }))
            expect(device).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.att_term_device_name}</label>`))
            expect(device).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.att_term_mode}</label>`))
            expect(device).toContain(esc(en.att_term_mode_hint))
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

const PLACE_LIST = {
    locations: [
        { id: "l1", name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 150, officeIpRanges: ["203.0.113.7", "203.0.113.8"], everyone: true, archivedAt: null, userIds: [] },
        { id: "l2", name: "Site B", latitude: 30.1, longitude: 31.3, radiusMeters: 300, officeIpRanges: [], everyone: false, archivedAt: null, userIds: ["u1"] },
        { id: "l3", name: "Old site", latitude: 30.2, longitude: 31.4, radiusMeters: 100, officeIpRanges: [], everyone: false, archivedAt: "2026-05-01T00:00:00.000Z", userIds: [] },
    ],
    people: [{ id: "u1", name: "Youssef Ali" }, { id: "u2", name: "Hana Saad" }],
}

describe("the check-in places", () => {
    it("are a card listing each place as a row: its radius, office IPs and who, with its map", async () => {
        const html = await render("AttendanceLocationsPanel", { [PLACES]: ok(PLACE_LIST) })
        expect(html).toContain(`<h2 class="ui-card-title">${en.att_loc_title}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.att_loc_hint)}</p>`)
        expect(html).toContain(["150 m", en.att_loc_ip_line.replace("{n}", "2"), en.att_loc_everyone_short].map(x => `<bdi>${x}</bdi>`).join(en.list_separator))
        expect(html).toContain(["300 m", "Youssef Ali"].map(x => `<bdi>${x}</bdi>`).join(en.list_separator))
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.att_loc_archived_badge}</span>`)
        expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=30.0444,31.2357"')
        expect(html).not.toContain(" · ")
    })

    it("give each place a menu named for it, and Add a place, to whoever may change them", async () => {
        const html = await render("AttendanceLocationsPanel", { [PLACES]: ok(PLACE_LIST) })
        expect(html).toMatch(new RegExp(`ui-btn-primary[^>]*>(<svg[\\s\\S]*?</svg>)?${en.att_loc_add}</button>`))
        for (const name of ["Head office", "Site B", "Old site"]) expect(html, name).toContain(`aria-label="${en.ui_more_actions_for.replace("{name}", name)}"`)
        expect(await render("AttendanceLocationsPanel", { [PLACES]: ok(PLACE_LIST) }, { readOnly: true })).not.toContain("</button>")
    })

    it("aren't there when the package doesn't have them, and say so when they didn't load, with Try again", async () => {
        expect(await render("AttendanceLocationsPanel", { [PLACES]: failed(403) })).toBe("")
        const html = await render("AttendanceLocationsPanel", { [PLACES]: failed(500) })
        expect(html).toContain(esc(en.att_loc_load_failed))
        expect(html).toContain(">Try again</button>")
    })

    it("ask for a place in the building blocks' dialog, each field labelled, with no arrow after its map link", async () => {
        const { PlaceDialog } = await import("@/components/AttendanceLocationsPanel")
        Object.assign(state, { locale: "en", swr: {} })
        vi.stubGlobal("document", { body: {} })
        try {
            const html = renderToStaticMarkup(h(PlaceDialog, {
                draft: { id: null, name: "", point: "30.0444, 31.2357", radius: "150", ips: "", everyone: false }, busy: false, onClose: () => {}, onSubmit: async () => {},
            }))
            expect(html).toContain('role="dialog"')
            for (const label of [en.att_loc_name, en.att_loc_point, en.att_loc_radius, en.att_loc_ips]) {
                expect(html, label).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${re(label)}</label>`))
            }
            expect(html).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check"[^>]*/>${re(en.att_loc_everyone)}</label>`))
            expect(html).toContain(`>${en.att_loc_map}</a>`)
            expect(html).not.toContain("↗")
            expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary[^"]*">${en.save}</button>`))
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it("say what's wrong with a place under each field before sending it", async () => {
        const { placeErrors } = await import("@/components/AttendanceLocationsPanel")
        const draft = { id: null, name: "Head office", point: "30.0444, 31.2357", radius: "150", ips: "", everyone: false }
        expect(placeErrors(draft)).toEqual({})
        expect(placeErrors({ ...draft, name: " " })).toEqual({ name: "att_loc_name_required" })
        expect(placeErrors({ ...draft, point: "" })).toEqual({ point: "att_loc_point_invalid" })
        expect(placeErrors({ ...draft, radius: "10" })).toEqual({ radius: "att_loc_radius_invalid" })
        expect(placeErrors({ ...draft, radius: "" })).toEqual({ radius: "att_loc_radius_invalid" })
        for (const key of ["att_loc_name_required", "att_loc_radius_invalid"] as const) {
            expect(en[key]).toBeTruthy()
            expect(ar[key]).toBeTruthy()
        }
    })
})

describe("nothing of the old panels is left", () => {
    it("has no hand-set styles, glass panels, old windows, drawn separators or arrows", () => {
        for (const file of ["AttendancePayrollPanel", "AttendanceTerminalsPanel", "AttendanceLocationsPanel", "FaceLegalPanel"].map(f => `components/${f}.tsx`)) {
            const src = readFileSync(file, "utf8")
            for (const old of ["style={", "className=\"glass", "ConfirmModal", "@/components/Modal", "className=\"btn", "className=\"input\"", "' · '", "↗", "as any"]) {
                expect(src, `${file}: ${old}`).not.toContain(old)
            }
        }
    })
})

describe("found in the browser and the audit (company settings part 3c)", () => {
    it("colours a link in a row's detail as a link, such as a place's map, not the browser's own blue", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-item-detail a \{\s*color: var\(--brand-text\);/)
    })

    it("keeps each of a row's facts apart from the next, so a host name or a version can't swap places with the words beside it in Arabic", async () => {
        const terms = await render("AttendanceTerminalsPanel", terminals(), { locale: "ar" })
        expect(terms).toContain(`<bdi>FRONT-DESK</bdi>${ar.list_separator}<bdi>v1.4.2</bdi>`)
        expect(terms).toContain(`<bdi>${ar.att_term_serial} ZK-001</bdi>${ar.list_separator}<bdi>K40</bdi>`)
        const places = await render("AttendanceLocationsPanel", { [PLACES]: ok(PLACE_LIST) }, { locale: "ar" })
        expect(places).toContain("<bdi>Youssef Ali</bdi>")
    })

    it("runs a row's facts on as one line of text, with no gap before each comma", async () => {
        // A row's detail lays out its icon and text with a gap between them,
        // so each fact and each comma took a gap of its own: "150 m , Everyone".
        const terms = await render("AttendanceTerminalsPanel", terminals())
        expect(terms).toContain(`<span class="ui-item-detail"><span><bdi>FRONT-DESK</bdi>`)
        expect(terms).toContain(`<span class="ui-item-detail"><span><bdi>${en.att_term_serial} ZK-001</bdi>`)
        const places = await render("AttendanceLocationsPanel", { [PLACES]: ok(PLACE_LIST) })
        expect(places).toMatch(new RegExp(`<span class="ui-item-detail"><span><bdi>150 m</bdi>[^]*?${en.att_loc_map}</a></span></span>`))
    })

    it("says how a terminal reads scans only once there's a terminal", async () => {
        // With none, it ran on from "No terminal yet" as one paragraph.
        const none = await render("AttendanceTerminalsPanel", { [AGENTS]: ok(AGENT_LIST), [DEVICES]: ok({ devices: [] }) })
        expect(none).toContain(esc(en.att_term_no_devices))
        expect(none).not.toContain(esc(en.att_term_mode_hint))
        expect(await render("AttendanceTerminalsPanel", terminals())).toContain(esc(en.att_term_mode_hint))
    })

    it("lets a point be typed on a phone, comma, minus and all, and names the place it edits", async () => {
        const { PlaceDialog } = await import("@/components/AttendanceLocationsPanel")
        Object.assign(state, { locale: "en", swr: {} })
        vi.stubGlobal("document", { body: {} })
        try {
            const html = renderToStaticMarkup(h(PlaceDialog, {
                draft: { id: "l2", name: "Site B", point: "30.1, 31.3", radius: "300", ips: "", everyone: false }, busy: false, onClose: () => {}, onSubmit: async () => {},
            }))
            // A decimal keypad has no comma or minus.
            expect(html).toMatch(/<input[^>]*name="point"[^>]*>/)
            expect(html.match(/<input[^>]*name="point"[^>]*>/)![0]).not.toContain('inputMode="decimal"')
            expect(html).toContain(`class="ui-dialog-title">${en.att_loc_edit_title.replace("{name}", "Site B")}</h2>`)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe("found in Codex's review (company settings part 3c)", () => {
    it("asks for one new code at a time, so the code shown is the one that works", async () => {
        // Each new code replaces the last: two at once could leave the slower
        // one's answer on screen, a code that no longer works.
        state.menus = []
        await render("AttendanceTerminalsPanel", terminals())
        const menus = state.menus
        state.menus = null
        const code = menus.find(m => m.label === en.ui_more_actions_for.replace("{name}", "Warehouse PC"))!.items.find(i => i.key === "code")!
        const asked = vi.fn(() => new Promise<Response>(() => {}))
        vi.stubGlobal("fetch", asked)
        try {
            code.onSelect!()
            code.onSelect!()
            expect(asked).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
        }
        // And the menu says so: what acts at once is greyed while something is being saved.
        for (const file of ["AttendanceTerminalsPanel", "AttendanceLocationsPanel"]) {
            const source = readFileSync(`components/${file}.tsx`, "utf8")
            expect(source, file).toMatch(/key: 'restore',[^\n]*disabled: busy/)
            expect(source, file).toMatch(/const inFlight = useRef\(false\)/)
            expect(source, file).toMatch(/if \(inFlight\.current\) return/)
            expect(source, file).toMatch(/finally \{\s*inFlight\.current = false/)
        }
        expect(readFileSync("components/AttendanceTerminalsPanel.tsx", "utf8")).toMatch(/key: 'code',[^\n]*disabled: busy/)
    })

    it("keeps a panel, and what's open in it, when a refresh fails after it loaded, and says so with Try again", async () => {
        // It swapped the whole panel for "didn't load", closing a half-done
        // edit and losing it, on a failed refresh in the background.
        const broken = failed(500)
        const panels: [string, Record<string, Loaded>, string][] = [
            ["AttendanceTerminalsPanel", terminals({ [AGENTS]: { ...ok(AGENT_LIST), ...broken } }), en.att_term_title],
            ["AttendanceLocationsPanel", { [PLACES]: { ...ok(PLACE_LIST), ...broken } }, en.att_loc_title],
            ["AttendancePayrollPanel", { [PAY]: { ...ok({ from: null, earliest: "2026-01" }), ...broken } }, en.attpay_title],
            ["FaceLegalPanel", { [FACE]: { ...ok({ system: "ON", mobileApp: true, legalConfirmedAt: null }), ...broken } }, en.face_legal_title],
        ]
        for (const [file, swr, title] of panels) {
            const html = await render(file, swr)
            expect(html, file).toContain(`<h2 class="ui-card-title">${title}</h2>`)
            expect(html, file).toContain(esc(en.ui_refresh_failed))
            expect(html, file).toMatch(/>Try again<\/button>/)
        }
    })
})
