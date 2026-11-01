import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The check-in page on the building blocks (UI_PLAN.md §5 step 5; DESIGN.md
 * §5.5, Check-in): the page header, the phone's card with Check in and
 * Check out side by side, what became of a check-in in a card with its
 * meaning, arriving late, face verification in a titled card, and loading,
 * refused and failed each saying so, in the page's language, digits too.
 */

type Loaded = { data?: unknown; error?: unknown }
const state = {
    locale: "en" as "en" | "ar",
    role: "EMPLOYEE",
    swr: {} as Record<string, Loaded>,
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    },
}))
vi.mock("@/components/FaceCamera", () => ({ useFaceCamera: () => ({ open: () => {}, element: null }) }))
vi.mock("@/lib/mobile/face", () => ({ faceVerifier: () => null, enrolFace: vi.fn(), faceInfo: vi.fn(), settleTemplates: vi.fn(), wrappingKey: vi.fn() }))
vi.mock("@/lib/mobile/face-check/verifier", () => ({ FACE_CHECK: false, faceCheckVerifier: () => null }))
vi.mock("@/lib/mobile/push", () => ({ enablePush: vi.fn(), pushPlugin: () => null }))
vi.mock("@/app/(dashboard)/dashboard/attendance/RequestsTab", () => ({ AskPermissionDialog: () => null }))

const device = { platform: "ANDROID" } as never
const PHONE = { model: "Pixel 8", platform: "ANDROID", keyFingerprint: "abc" }
const FACE_OFF = { active: false, required: false, consent: null, consentVersion: "1", phone: null, pendingReview: false, reverifyDue: false }
const refused = (status: number) => ({ error: Object.assign(new Error("Request failed"), { status, info: { error: status === 500 ? "Database unavailable" : "Not in your package" } }) })

async function screen({ swr = {} as Record<string, Loaded>, locale = "en" as "en" | "ar", role = "EMPLOYEE", withDevice = true } = {}) {
    state.locale = locale
    state.role = role
    state.swr = swr
    const { default: CheckInScreen } = await import("@/app/(dashboard)/dashboard/check-in/CheckInScreen")
    return renderToStaticMarkup(h(CheckInScreen, { device: withDevice ? device : null }))
}
const phone = (body: unknown, fingerprint: string | null = "abc") => ({
    "/api/attendance/phone": { data: { data: body } },
    "this-phone-key": { data: fingerprint },
    "/api/attendance/face": { data: { data: FACE_OFF } },
})
const big = (label: string, variant: string, disabled = false) => `<button type="button" class="ui-btn ui-btn-${variant} ui-btn-lg"${disabled ? ' disabled=""' : ""}>${label}</button>`

describe("the page", () => {
    it("has the page header, and in a browser says to use the app", async () => {
        state.locale = "en"
        state.role = "EMPLOYEE"
        state.swr = {}
        const { default: Page } = await import("@/app/(dashboard)/dashboard/check-in/page")
        const html = renderToStaticMarkup(h(Page))
        expect(html).toContain(`<h1 class="ui-page-title">${en.ci_title}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${en.ci_hint}</p>`)
        expect(html).toContain(`<p class="ui-empty-title">${en.ci_use_app}</p>`)
    })

    it("tells the Super Admin they have no attendance", async () => {
        expect(await screen({ role: "SUPER_ADMIN" })).toContain(`<p class="ui-empty-title">${en.ci_not_for_super_admin}</p>`)
    })

    it("says it's loading, that the package hasn't the app, or that the phone's details didn't load, with Try again", async () => {
        expect(await screen()).toContain('<div class="ui-panel" role="status">')
        const off = await screen({ swr: { "/api/attendance/phone": refused(403) } })
        expect(off).toContain(`<p class="ui-empty-title">${en.ci_not_available.replace(/'/g, "&#x27;")}</p>`)
        expect(off).not.toContain(">Try again</button>")
        const failed = await screen({ swr: { "/api/attendance/phone": refused(500) } })
        expect(failed).toContain(`<p class="ui-empty-title">${en.ci_load_failed.replace(/'/g, "&#x27;")}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })
})

describe("the phone's card", () => {
    it("offers to register a phone that isn't, as its primary button", async () => {
        const html = await screen({ swr: phone({ active: null, pending: null }, null) })
        expect(html).toContain(`<section class="ui-panel ui-card"><p>${en.ci_register_hint.replace(/'/g, "&#x27;")}</p><div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-primary">${en.ci_register}</button>`)
    })

    it("offers to use this phone instead of another, and says when its key couldn't be read", async () => {
        const html = await screen({ swr: { ...phone({ active: PHONE, pending: null }, null), "this-phone-key": { error: new Error("KEY") } } })
        expect(html).toContain(`<p class="ui-error" role="alert">${en.ci_key_failed.replace(/'/g, "&#x27;")}</p>`)
        expect(html).toContain(en.ci_other_phone.replaceAll("{model}", "Pixel 8"))
        expect(html).toContain(`>${en.ci_switch}</button>`)
    })

    it("has Check in and Check out side by side, large, and says a phone waiting for approval is", async () => {
        const html = await screen({ swr: phone({ active: null, pending: PHONE }) })
        expect(html).toContain(`<p>${en.ci_waiting.replace(/'/g, "&#x27;")}</p>`)
        expect(html).toContain(`<div class="ui-checkin-buttons">${big(en.ci_in, "primary")}${big(en.ci_out, "secondary")}</div>`)
    })

    it("waits for the face status before Check in can be pressed", async () => {
        const html = await screen({ swr: { ...phone({ active: PHONE, pending: null }), "/api/attendance/face": {} } })
        expect(html).toContain(big(en.ci_in, "primary", true))
    })
})

describe("face verification", () => {
    it("is a titled card, asking for consent first", async () => {
        const html = await screen({ swr: { ...phone({ active: PHONE, pending: null }), "/api/attendance/face": { data: { data: { ...FACE_OFF, required: true } } } } })
        expect(html).toContain(`<h2 class="ui-card-title">${en.face_consent_title}</h2>`)
        expect(html).toContain(`>${en.face_ci_consent_accept}</button>`)
    })

    it("says where it stands, with Withdraw my consent", async () => {
        const html = await screen({ swr: { ...phone({ active: PHONE, pending: null }), "/api/attendance/face": { data: { data: { ...FACE_OFF, consent: { acceptedAt: "2026-10-01" } } } } } })
        expect(html).toContain(`<h2 class="ui-card-title">${en.face_ci_title}</h2>`)
        expect(html).toContain(`<p>${en.face_ci_idle.replace(/'/g, "&#x27;")}</p>`)
        expect(html).toContain(`>${en.face_ci_withdraw}</button>`)
    })
})

describe("what became of a check-in", () => {
    const at = "2026-11-01T08:58:00"
    const answer = { outcome: "ACCEPTED", reasons: [], place: { id: "p", name: "Head office" }, distanceMeters: 42, at, late: null }
    const render = async (a: unknown, locale: "en" | "ar" = "en") => {
        state.locale = locale
        const { Answer } = await import("@/app/(dashboard)/dashboard/check-in/CheckInScreen")
        return renderToStaticMarkup(h(Answer, { answer: a as never }))
    }

    it("is a card read out by screen readers: recorded, with a check in the Good colour", async () => {
        const html = await render(answer)
        expect(html).toMatch(/^<section class="ui-panel ui-card" role="status"><p class="ui-checkin-answer"><svg[^>]*class="ui-icon ui-checkin-ok"/)
        expect(html).toContain(en.ci_accepted.replace("{time}", "08:58").replace("{place}", "<bdi>Head office</bdi>"))
        expect(html).toContain(en.ci_distance.replace("{n}", "42"))
    })

    it("waits on someone when it counts only once reviewed, and is a problem when not recorded", async () => {
        expect(await render({ ...answer, outcome: "FLAGGED", reasons: ["OUTSIDE_AREA"] })).toContain('<section class="ui-panel ui-card" data-tone="waiting" role="status">')
        const refusedHtml = await render({ outcome: "REFUSED", reason: "MOCK_LOCATION" })
        expect(refusedHtml).toContain('<section class="ui-panel ui-card" data-tone="problem" role="status">')
        expect(refusedHtml).toContain(en.ci_refused.replace("{reason}", en.ci_refusal_MOCK_LOCATION))
    })

    it("gives its time and distance in the page's digits", async () => {
        const html = await render(answer, "ar")
        expect(html).toContain(ar.ci_accepted.replace("{time}", "٠٨:٥٨").replace("{place}", "<bdi>Head office</bdi>"))
        expect(html).toContain(ar.ci_distance.replace("{n}", "٤٢"))
    })

    it("says how late, the permission left and Ask for permission hours, waiting on someone", async () => {
        state.locale = "ar"
        const { Late } = await import("@/app/(dashboard)/dashboard/check-in/CheckInScreen")
        const html = renderToStaticMarkup(h(Late, { late: { minutes: 17, startsAt: "08:30", date: "2026-11-01", ask: { start: "08:30", end: "08:47" } }, balance: { enabled: true, remainingMinutes: 120, types: ["LATE_ARRIVAL"] }, onAsk: () => {} }))
        expect(html).toContain('<section class="ui-panel ui-card" data-tone="waiting">')
        expect(html).toContain(ar.ci_late.replace("{n}", "١٧").replace("{start}", "٠٨:٣٠"))
        expect(html).toContain(ar.ci_late_balance.replace("{left}", "١٢٠"))
        expect(html).toContain(`>${ar.ci_ask_permission}</button>`)
    })
})

describe("in Arabic (the audit, PR 156)", () => {
    const at = "2026-11-01T18:39:00"
    const flagged = { outcome: "FLAGGED", reasons: ["OUTSIDE_AREA", "ATTESTATION_UNVERIFIED"], place: { id: "p", name: "Head office, Nasr City" }, distanceMeters: 15, at, late: null }
    const render = async (locale: "en" | "ar") => {
        state.locale = locale
        const { Answer } = await import("@/app/(dashboard)/dashboard/check-in/CheckInScreen")
        return renderToStaticMarkup(h(Answer, { answer: flagged as never }))
    }

    it("keeps a place's own name in its own direction", async () => {
        // An English name ran into the Arabic sentence: its full stop went to the wrong end.
        expect(await render("ar")).toContain("<bdi>Head office, Nasr City</bdi>")
    })

    it("lists the reasons for a review as each language does", async () => {
        // Joined with ", " they read as English inside Arabic.
        for (const [locale, words] of [["en", en], ["ar", ar]] as const) {
            const reasons = new Intl.ListFormat(locale, { type: "conjunction" }).format([words.att_flag_OUTSIDE_AREA, words.att_flag_ATTESTATION_UNVERIFIED])
            expect(await render(locale)).toContain(reasons)
        }
    })

    it("fits Check in and Check out on one line each, at half a phone's width", () => {
        // 24px either side left an Arabic label 112px on a 390px phone: both wrapped onto two lines.
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-btn-lg \{[^}]*padding-inline: var\(--space-3\);/)
    })
})

describe("its confirmations (Codex on PR 156)", () => {
    it("can't be closed while what they asked for is still being done", () => {
        // Escape closed Use this phone instead, or Withdraw my consent, while it went on: it looked
        // called off when it wasn't. The old confirmation window waited; so does this one.
        const src = readFileSync("app/(dashboard)/dashboard/check-in/CheckInScreen.tsx", "utf8")
        expect(src).toContain("const closeSwitching = () => { if (!busy) setSwitching(false) }")
        expect(src).toContain("const closeWithdrawing = () => { if (!busy) setWithdrawing(false) }")
        expect(src).toMatch(/open=\{switching\}\s*onClose=\{closeSwitching\}/)
        expect(src).toMatch(/open=\{withdrawing\}\s*onClose=\{closeWithdrawing\}/)
        expect(src).not.toContain("onClose={() => setSwitching(false)}")
        expect(src).not.toContain("onClose={() => setWithdrawing(false)}")
    })
})

describe("its look", () => {
    it("has the large button, and the two side by side, in the building blocks' styles", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-btn-lg \{[^}]*height: 56px;[^}]*font-size: var\(--text-lg\);/)
        const phones = css.slice(css.lastIndexOf("/* ── Phones ── */"))
        expect(phones).toMatch(/\.ui-btn-lg \{\s*height: 56px;/)
        expect(css).toMatch(/\.ui-checkin-buttons \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
    })

    it("has nothing of the old screen left", () => {
        for (const file of ["app/(dashboard)/dashboard/check-in/page.tsx", "app/(dashboard)/dashboard/check-in/CheckInScreen.tsx"]) {
            const src = readFileSync(file, "utf8")
            for (const old of ["style={", "LoadingSpinner", "ConfirmModal", 'className="btn', 'className="glass', "useHeader", "📲", "✅", "🕒"]) expect(src, `${file}: ${old}`).not.toContain(old)
        }
    })
})
