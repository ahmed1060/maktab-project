import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Attendance's last tabs on the building blocks (UI_PLAN.md §5 step 5,
 * part 7): the Requests tab's cards (one's phone, one's requests, what
 * waits on whoever decides, and overtime approved ahead); asking from a day
 * with the Requests page's own forms; adding a punch in the building blocks'
 * dialog; and Face verification's photos waiting, the overdue, and who it's
 * asked of, as lists (DESIGN.md §5.4).
 */

type Shown = { data?: unknown; error?: unknown }
const state = {
    locale: "en" as "en" | "ar",
    role: "ADMIN",
    grants: new Set<string>(),
    search: "tab=requests",
    phone: {} as Shown,
    reviews: {} as Shown,
    facePeople: {} as Shown,
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role, name: "Hana Saad" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p), companyWide: (p: string) => state.grants.has(p), canFor: (p: string) => state.grants.has(p) }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (key?.startsWith("/api/attendance/people")) {
            return { ...idle, data: { data: { today: "2026-10-31", people: [{ id: "u1", name: "Hana Saad", teamLeaderId: null }, { id: "u2", name: "Sami Nabil", teamLeaderId: null }] } } }
        }
        if (key?.startsWith("/api/attendance/phone")) return { ...idle, ...state.phone }
        if (key?.startsWith("/api/attendance/face/reviews")) return { ...idle, ...state.reviews }
        if (key?.startsWith("/api/attendance/face/people")) return { ...idle, ...state.facePeople }
        if (key?.startsWith("/api/attendance/permissions/balance")) {
            return { ...idle, data: { data: { enabled: true, types: ["LATE_ARRIVAL", "EARLY_LEAVE"], remainingMinutes: 120, minPerRequestMinutes: 15, maxPerRequestMinutes: 120 } } }
        }
        return idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

const shown = (x: unknown): Shown => x === "loading" ? {} : x === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) } : { data: { data: x } }

const PHONE = { active: { model: "Pixel 8", platform: "ANDROID" }, pending: { model: null, platform: "IOS" } }
const REVIEWS = [
    { id: "r1", userId: "u2", name: "Sami Nabil", purpose: "ENROLMENT", createdAt: "2026-10-30T07:05:00.000Z", attested: true, hasReference: false },
    { id: "r2", userId: "u3", name: "Mona Fawzy", purpose: "REVERIFY", createdAt: "2026-10-31T12:40:00.000Z", attested: false, hasReference: true, prototype: true },
]
const FACE_PEOPLE = {
    company: { allowed: true, reason: null },
    people: [
        { id: "u2", name: "Sami Nabil", required: true, consentedAt: "2026-10-12T09:00:00.000Z" },
        { id: "u3", name: "Mona Fawzy", required: false, consentedAt: null },
    ],
    overdue: [{ userId: "u4", name: "Omar Ali", since: "2026-10-15" }],
}

async function page({ tab = "requests", grants = [] as string[], role = "ADMIN", phone = PHONE as unknown, reviews = REVIEWS as unknown, facePeople = FACE_PEOPLE as unknown, locale = "en" as "en" | "ar" } = {}) {
    state.locale = locale
    state.role = role
    state.grants = new Set(grants)
    state.search = `tab=${tab}${role === "SUPER_ADMIN" ? "&companyId=c1" : ""}`
    state.phone = shown(phone)
    state.reviews = shown(reviews)
    state.facePeople = shown(facePeople)
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    const html = renderToStaticMarkup(h(AttendancePage))
    return html.slice(html.indexOf('<div role="tabpanel" id="attendance-panel"'))
}
const card = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-card-title">${title}</h2>`)
    return at < 0 ? "" : html.slice(html.lastIndexOf('<section class="ui-panel ui-card"', at), html.indexOf("</section>", at))
}
const section = (html: string, title: string) => {
    const at = html.indexOf(`>${title}</h2>`)
    return at < 0 ? "" : html.slice(html.lastIndexOf('<section class="ui-section"', at), html.indexOf("</section>", html.indexOf("</table>", at)))
}
const source = (file: string) => readFileSync(`app/(dashboard)/dashboard/attendance/${file}`, "utf8")
const DECIDES = ["attendance.approve_permissions", "attendance.approve_overtime", "attendance.correct", "attendance.approve_devices"]
const FACE = ["attendance.view_team", "attendance.approve_face"]

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("the Requests tab: one's phone", () => {
    it("is a card: the phone in use, and a new one waiting with Cancel the new phone", async () => {
        const part = card(await page(), "Your check-in phone")
        expect(part).toContain("<p>Pixel 8: in use</p>")
        // A phone without its model is named by its kind.
        expect(part).toContain(`<p>${en.req_my_phone_waiting.replace("{model}", "iPhone (iOS)").replace(/'/g, "&#x27;")}</p>`)
        expect(part).toContain('<div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-secondary">Cancel the new phone</button></div>')
    })

    it("says when there's no phone yet, and isn't there for a company without the app", async () => {
        // What the card says, as the other cards say theirs, not a settings card's note (found in the interface audit, PR 153).
        expect(card(await page({ phone: { active: null, pending: null } }), "Your check-in phone")).toContain(`<p>${en.req_my_phone_none}</p>`)
        expect(await page({ phone: "failed" })).not.toContain("Your check-in phone")
    })
})

describe("the Requests tab: one's requests and what waits on whoever decides", () => {
    it("points to one's own requests on the Requests page, in a card", async () => {
        const part = card(await page(), "My requests")
        expect(part).toContain(`<p>${en.requests_moved_mine.replace(/'/g, "&#x27;")}</p>`)
        expect(part).toContain('<div class="ui-card-actions"><a class="ui-btn ui-btn-secondary" href="/dashboard/requests?tab=mine">Open my requests</a></div>')
    })

    it("points whoever decides to To review, and whoever approves overtime has its own card to approve it ahead", async () => {
        const html = await page({ grants: DECIDES })
        const decide = card(html, "To decide")
        expect(decide).toContain(`<p>${en.requests_moved_review}</p>`)
        expect(decide).toContain('<a class="ui-btn ui-btn-secondary" href="/dashboard/requests?tab=review">Open requests to review</a>')
        const ahead = card(html, en.req_overtime_ahead_title)
        expect(ahead).toContain(`<p>${en.requests_overtime_ahead_line}</p>`)
        expect(ahead).toContain('<div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-secondary">Approve overtime ahead</button></div>')
    })

    it("has neither card for whoever decides nothing, nor Overtime ahead for whoever doesn't approve overtime", async () => {
        const none = await page()
        expect(none).not.toContain("To decide")
        expect(none).not.toContain(en.req_overtime_ahead_title)
        const some = await page({ grants: ["attendance.approve_permissions"] })
        expect(card(some, "To decide")).not.toBe("")
        expect(some).not.toContain(en.req_overtime_ahead_title)
    })

    it("asks nothing of a Super Admin, who has no phone or requests of their own", async () => {
        const html = await page({ role: "SUPER_ADMIN", grants: DECIDES })
        expect(html).not.toContain("Your check-in phone")
        expect(html).not.toContain("My requests")
        expect(card(html, "To decide")).not.toBe("")
    })

    it("is in the page's language", async () => {
        const html = await page({ locale: "ar", grants: DECIDES })
        expect(card(html, ar.req_my_phone)).toContain(`<p>Pixel 8: ${ar.req_my_phone_in_use.replace("{model}: ", "")}</p>`)
        expect(card(html, ar.req_mine)).toContain(ar.requests_open_mine)
        expect(card(html, ar.req_overtime_ahead_title)).toContain(ar.req_overtime_ahead)
    })

    it("keeps no old styles, confirm box or modal", () => {
        const tab = source("RequestsTab.tsx")
        expect(tab).not.toContain('className="glass"')
        expect(tab).not.toContain("style={")
        expect(tab).not.toContain('className="input"')
        expect(tab).not.toContain('className="btn')
        expect(tab).not.toContain("ConfirmModal")
        expect(tab).not.toContain("@/components/Modal")
        // Cancelling the new phone asks first in the building blocks' dialog, its other button not another "Cancel".
        expect(tab).toContain("title={t('req_my_phone_withdraw')}")
        expect(tab).toContain("{t('req_my_phone_keep')}")
        expect(tab).toMatch(/<Button variant="danger".*busy=\{action\.is\('withdraw-phone'\)\}>\{t\('req_my_phone_withdraw'\)\}<\/Button>/)
    })
})

describe("approving overtime ahead", () => {
    const form = async (locale: "en" | "ar" = "en") => {
        state.locale = locale
        const { OvertimeAheadForm } = await import("@/app/(dashboard)/dashboard/attendance/RequestsTab")
        return renderToStaticMarkup(h(OvertimeAheadForm, { today: "2026-10-31", companyId: null, people: [{ id: "u2", name: "Sami Nabil", teamLeaderId: null }], onCancel: () => {}, onDone: () => {} }))
    }

    it("is a form of labelled fields: whose, the day, the hours and a note, then Approve", async () => {
        const html = await form()
        expect(html).toMatch(/^<form class="ui-form" noValidate="">/)
        expect(html).toContain(`<p class="ui-hint">${en.req_overtime_ahead_hint.replace(/'/g, "&#x27;")}</p>`)
        expect(html).toContain('class="ui-label">Person</label>')
        expect(html).toContain('<option value="" selected="">Choose a person</option><option value="u2">Sami Nabil</option>')
        expect(html).toContain('ui-date-trigger">')
        expect(html).toMatch(/<input[^>]*type="number" inputMode="decimal" min="0.5" max="24" step="0.5"[^>]*name="hours"/)
        expect(html).toContain('class="ui-label">Note</label>')
        expect(html).toContain('<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">Cancel</button><button type="submit" class="ui-btn ui-btn-primary">Approve</button></div>')
        expect(html).not.toContain('class="input"')
    })

    it("says what's missing, under its field: whose, and hours from half an hour to 24", async () => {
        const { overtimeAheadErrors } = await import("@/app/(dashboard)/dashboard/attendance/RequestsTab")
        const t = (k: string) => en[k as keyof typeof en]
        expect(overtimeAheadErrors({ userId: "", date: "2026-10-31", hours: "" }, t)).toEqual({ userId: en.req_overtime_person_missing, hours: en.req_overtime_hours_invalid })
        for (const hours of ["0", "0.2", "24.5", "abc"]) expect(overtimeAheadErrors({ userId: "u2", date: "2026-10-31", hours }, t)).toEqual({ hours: en.req_overtime_hours_invalid })
        for (const hours of ["0.5", "2.5", "24"]) expect(overtimeAheadErrors({ userId: "u2", date: "2026-10-31", hours }, t)).toEqual({})
        // The day's picker can be emptied.
        expect(overtimeAheadErrors({ userId: "u2", date: "", hours: "2" }, t)).toEqual({ date: en.req_overtime_date_missing })
    })

    it("is in the page's language", async () => {
        const html = await form("ar")
        expect(html).toContain(`class="ui-label">${ar.punch_person}</label>`)
        expect(html).toContain(`>${ar.req_approve}</button></div>`)
    })
})

describe("asking from a day", () => {
    it("opens the Requests page's own forms, with the day's times filled in", async () => {
        state.locale = "en"
        const { AskPermission, ReportMissingPunch } = await import("@/app/(dashboard)/dashboard/requests/AttendanceDialogs")
        const ask = renderToStaticMarkup(h(AskPermission, { today: "2026-10-31", initial: { date: "2026-10-20", type: "EARLY_LEAVE", start: "16:00", end: "17:00" }, onCancel: () => {}, onAsked: () => {} }))
        expect(ask).toContain('<option value="EARLY_LEAVE" selected="">')
        expect(ask).toMatch(/name="start"[^>]*value="16:00"/)
        expect(ask).toMatch(/name="end"[^>]*value="17:00"/)
        const report = renderToStaticMarkup(h(ReportMissingPunch, { today: "2026-10-31", initial: { date: "2026-10-20", direction: "OUT" }, onCancel: () => {}, onReported: () => {} }))
        expect(report).toContain('<option value="OUT" selected="">Out</option>')
    })

    it("opens them in the building blocks' dialog, from the Days tab and the check-in page", () => {
        const tab = source("RequestsTab.tsx")
        expect(tab).toContain("from '../requests/AttendanceDialogs'")
        expect(tab).toContain("export function AskPermissionDialog(")
        expect(tab).toContain("export function ReportMissingDialog(")
        expect(tab).not.toContain("export function AskPermissionModal(")
        expect(tab).not.toContain("export function ReportMissingModal(")
        const days = source("page.tsx")
        expect(days).toContain("<AskPermissionDialog")
        expect(days).toContain("<ReportMissingDialog")
        const checkIn = readFileSync("app/(dashboard)/dashboard/check-in/page.tsx", "utf8")
        expect(checkIn).toContain("import { AskPermissionDialog } from '../attendance/RequestsTab'")
        expect(checkIn).toContain("<AskPermissionDialog")
    })
})

describe("adding a punch", () => {
    const form = async (initial?: { userId?: string; date?: string; direction?: "IN" | "OUT" }, locale: "en" | "ar" = "en") => {
        state.locale = locale
        const { AddPunchForm } = await import("@/app/(dashboard)/dashboard/attendance/AddPunchDialog")
        return renderToStaticMarkup(h(AddPunchForm, { today: "2026-10-31", companyId: null, people: [{ id: "u2", name: "Sami Nabil", teamLeaderId: null }], initial, onCancel: () => {}, onAdded: () => {} }))
    }

    it("is a form of labelled fields: whose, the day, the time, in or out, and why, then Add a punch", async () => {
        const html = await form()
        expect(html).toMatch(/^<form class="ui-form" noValidate="">/)
        expect(html).toContain('<option value="" selected="">Choose a person</option><option value="u2">Sami Nabil</option>')
        expect(html).toContain('ui-date-trigger">')
        expect(html).toMatch(/<input[^>]*type="time"[^>]*name="time"/)
        expect(html).toContain(`<option value="" selected="">${en.punch_direction_unknown}</option>`)
        expect(html).toContain('placeholder="')
        expect(html).toContain('<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">Cancel</button><button type="submit" class="ui-btn ui-btn-primary">Add a punch</button></div>')
    })

    it("starts on the person and direction a missing punch is for", async () => {
        const html = await form({ userId: "u2", date: "2026-10-20", direction: "OUT" })
        expect(html).toContain('<option value="u2" selected="">Sami Nabil</option>')
        expect(html).toContain('<option value="OUT" selected="">Out</option>')
    })

    it("says what's missing, under its field", async () => {
        const { punchFormErrors } = await import("@/app/(dashboard)/dashboard/attendance/AddPunchDialog")
        const t = (k: string) => en[k as keyof typeof en]
        expect(punchFormErrors({ userId: "", date: "2026-10-31", time: "", note: "  " }, t)).toEqual({ userId: en.punch_person_missing, time: en.punch_time_missing, note: en.punch_reason_required })
        expect(punchFormErrors({ userId: "u2", date: "2026-10-31", time: "17:00", note: "Forgot" }, t)).toEqual({})
        expect(punchFormErrors({ userId: "u2", date: "", time: "17:00", note: "Forgot" }, t)).toEqual({ date: en.punch_date_missing })
    })

    it("is in the page's language", async () => {
        const html = await form(undefined, "ar")
        expect(html).toContain(`class="ui-label">${ar.punch_time}</label>`)
        expect(html).toContain(`>${ar.punch_add}</button></div>`)
    })

    it("is the building blocks' dialog wherever it opens, with nothing of the old modal", () => {
        const dialog = source("AddPunchDialog.tsx")
        expect(dialog).toContain("<Dialog open onClose={close} title={t('punch_add')}>")
        expect(dialog).not.toContain("@/components/Modal")
        expect(dialog).not.toContain("style={")
        expect(dialog).not.toContain('className="input"')
        expect(source("page.tsx")).toContain("<AddPunchDialog")
        expect(source("ExceptionsTab.tsx")).toContain("<AddPunchDialog")
        expect(() => source("AddPunchModal.tsx")).toThrow()
    })
})

describe("face verification", () => {
    const face = (x: Partial<Parameters<typeof page>[0]> = {}) => page({ tab: "face", grants: FACE, ...x })
    const sent = (at: string, digits = "en-GB") => new Date(at).toLocaleString(digits, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

    it("says it's loading, or that it failed, with the server's message and Try again", async () => {
        expect(await face({ reviews: "loading" })).toContain(`<div class="ui-panel" role="status">`)
        const failed = await face({ facePeople: "failed" })
        expect(failed).toContain(en.face_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })

    it("lists the photos waiting as a list, each with whose, what for, when sent, what to know, and Review", async () => {
        const part = section(await face(), "Photos waiting for a decision")
        expect(part).toContain(`<p class="ui-hint">${en.face_queue_hint}</p>`)
        expect(part).toContain(`<caption class="ui-visually-hidden">Photos waiting for a decision</caption>`)
        expect(part).toContain("Sami Nabil")
        expect(part).toContain(en.audit_value_ENROLMENT)
        expect(part).toContain(en.audit_value_REVERIFY)
        expect(part).toContain(sent("2026-10-30T07:05:00.000Z"))
        expect(part).toContain(`<div class="ui-item-detail">${en.att_flag_ATTESTATION_UNVERIFIED}</div>`)
        expect(part).toContain(`<div class="ui-item-detail">${en.face_review_prototype}</div>`)
        expect(part).toContain('<button type="button" class="ui-btn ui-btn-primary ui-btn-sm">Review</button>')
    })

    it("says when nothing waits", async () => {
        expect(section(await face({ reviews: [] }), "Photos waiting for a decision")).toContain(`<p class="ui-empty-title">${en.face_queue_none}</p>`)
    })

    it("names the overdue in a card that waits on someone, each since when", async () => {
        const part = card(await face(), "Re-verification overdue")
        expect(part).toContain('data-tone="waiting"')
        expect(part).toContain(`<p class="ui-card-note">${en.face_overdue_hint}</p>`)
        expect(part).toContain('<ul class="ui-rows" aria-label="Re-verification overdue">')
        expect(part).toContain("Omar Ali")
        expect(part).toContain("since Thu 15 Oct")
        expect(card(await face({ facePeople: { ...FACE_PEOPLE, overdue: [] } }), "Re-verification overdue")).toBe("")
    })

    it("lists who it's asked of, each with a labelled checkbox, when they consented, and Ask to re-verify once they have", async () => {
        const part = section(await face(), "Who is asked for face verification")
        expect(part).toContain(`<p class="ui-hint">${en.face_people_hint}</p>`)
        expect(part).toMatch(/<input type="checkbox" class="ui-check" aria-label="Ask Sami Nabil for face verification" checked=""\/>/)
        expect(part).toMatch(/<input type="checkbox" class="ui-check" aria-label="Ask Mona Fawzy for face verification"\/>/)
        expect(part).toContain(new Date("2026-10-12T09:00:00.000Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))
        expect(part).toContain("Not yet")
        // Only for whoever is asked and consented.
        expect(part.match(/>Ask to re-verify<\/button>/g)).toHaveLength(2) // the table's and the phone card's, for Sami
    })

    it("says why it isn't available, in a card that waits on someone, and asks it of nobody new then", async () => {
        const html = await face({ facePeople: { ...FACE_PEOPLE, company: { allowed: false, reason: "NO_MOBILE_APP" } } })
        expect(html).toContain(`<section class="ui-panel ui-card" data-tone="waiting"><p>${en.face_unavailable_NO_MOBILE_APP.replace(/'/g, "&#x27;")}</p></section>`)
        expect(html).toMatch(/aria-label="Ask Mona Fawzy for face verification" disabled=""/)
        expect(html).not.toMatch(/aria-label="Ask Sami Nabil for face verification"[^>]*disabled=""/)
    })

    it("is in the page's language, digits too", async () => {
        const html = await face({ locale: "ar" })
        expect(html).toContain(ar.face_queue)
        expect(html).toContain(sent("2026-10-30T07:05:00.000Z", "ar-EG"))
        expect(html).toContain(ar.face_overdue_since.replace("{date}", new Date("2026-10-15T00:00:00Z").toLocaleDateString("ar-EG", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })))
        expect(html).toContain(`aria-label="${ar.face_ask_of.replace("{name}", "Sami Nabil")}"`)
    })

    it("decides in the building blocks' dialog: the photos, then Approve, or Reject with a reason in the same dialog", () => {
        const tab = source("FaceTab.tsx")
        expect(tab).not.toContain("ConfirmModal")
        expect(tab).not.toContain("@/components/Modal")
        expect(tab).not.toContain("LoadingSpinner")
        expect(tab).not.toContain('className="glass"')
        expect(tab).not.toContain('className="table"')
        expect(tab).not.toContain("style={")
        // Rejecting keeps the photos open, so they aren't fetched, and recorded, again.
        expect(tab).toContain("title={rejecting ? t('face_reject_title') : t('face_review_title').replace('{name}', review.name)}")
        expect(tab).toContain('<div className="ui-face-photos"')
        expect(tab).toMatch(/<Button variant="danger" type="submit"[^>]*busy=\{action\.is\('reject'\)\}>\{t\('chk_reject'\)\}<\/Button>/)
        // Asking to re-verify asks first.
        expect(tab).toContain("title={t('face_reverify')}")
    })
})

describe("a face photo", () => {
    it("has the building blocks' look, with the watermark over it", async () => {
        const { FacePhoto } = await import("@/components/FacePhoto")
        const html = renderToStaticMarkup(h(FacePhoto, { src: "/x", label: "New photo", mark: "Hana · 2026-11-01 01:00" }))
        expect(html).toContain('<figure class="ui-face-photo"><div class="ui-face-photo-frame">')
        expect(html).toContain('<img src="/x" alt="New photo" draggable="false"/>')
        expect(html).toContain('<div aria-hidden="true" class="ui-face-photo-marks">')
        expect(html).toContain("<figcaption>New photo</figcaption>")
        expect(html).not.toContain("style=")
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toContain(".ui-face-photos {")
        expect(css).toContain(".ui-face-photo-frame {")
    })
})

describe("found in the interface audit (PR 153)", () => {
    it("keeps focus in the review dialog when Reject or Back takes away the button that had it", () => {
        const tab = source("FaceTab.tsx")
        // Reject: to the reason. Back: to Reject again. Lost to the page, Escape didn't close the dialog.
        expect(tab).toContain("setRejecting(true); focusIn('textarea[name=\"reason\"]')")
        expect(tab).toContain("setRejecting(false); focusIn('[data-step=\"reject\"]')")
        expect(tab).toContain('<Button data-step="reject"')
        expect(tab).toContain('<div className="ui-face-photos" ref={photos}>')
    })

    it("puts the two photos side by side in the dialog, each its size before it loads", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const rule = (name: string) => css.slice(css.indexOf(`${name} {`), css.indexOf("}", css.indexOf(`${name} {`)))
        expect(rule(".ui-face-photos")).toContain("grid-template-columns: repeat(auto-fit, minmax(144px, 1fr));")
        expect(rule(".ui-face-photo-frame")).toContain("aspect-ratio: 3 / 4;")
        expect(rule(".ui-face-photo-frame > img")).toContain("height: 100%;")
    })

    it("ticks or unticks whoever is asked at once, while it saves: waiting on the server, a box looked like it hadn't taken the click", () => {
        const tab = source("FaceTab.tsx")
        expect(tab).toContain("checked={saving[x.id] ?? x.required}")
        expect(tab).toContain("setSaving(x => ({ ...x, [person.id]: required }))")
    })

    it("gives adding a punch's reason a placeholder as the other forms' are", async () => {
        expect(en.punch_add_reason_placeholder).toMatch(/^Such as .*…$/)
        expect(ar.punch_add_reason_placeholder).toMatch(/…$/)
        state.locale = "en"
        const { AddPunchForm } = await import("@/app/(dashboard)/dashboard/attendance/AddPunchDialog")
        const html = renderToStaticMarkup(h(AddPunchForm, { today: "2026-10-31", companyId: null, people: [], onCancel: () => {}, onAdded: () => {} }))
        expect(html).toContain(`placeholder="${en.punch_add_reason_placeholder}"`)
    })
})
