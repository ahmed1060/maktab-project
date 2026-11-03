import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * System settings' face verification switch on the building blocks,
 * Operations part 4b (UI_PLAN.md §5 step 5). It was a card of its own
 * making, its sizes and colours typed in, its place held by hand-made
 * hidden copies, and its questions the old confirmation window.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = { locale: "en" as "en" | "ar", swr: {} as Record<string, Loaded> }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const SRC = "components/FaceSystemSwitch.tsx"
const FACE = "/api/system-settings/face"
const PURGE = "/api/system-settings/face/purge"
const REKEY = "/api/system-settings/face/rekey"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
/** What shows, without the hidden copies that hold its room. */
const shown = (html: string) => html.replace(/<div class="ui-reserve-room[^"]*" aria-hidden="true" inert="">[\s\S]*?<\/div>(?=<div)/g, "")
const status = (s: Record<string, unknown>) => ({ data: { data: { state: "ON", canChange: true, ...s } } })
const noPurge = { data: { data: null } }

async function render(swr: Record<string, Loaded>, locale: "en" | "ar" = "en") {
    Object.assign(state, { swr, locale })
    const { default: FaceSystemSwitch } = await import("@/components/FaceSystemSwitch")
    return renderToStaticMarkup(h(FaceSystemSwitch))
}

beforeAll(async () => {
    await import("@/components/FaceSystemSwitch")
}, 120000)

describe("the face verification switch", () => {
    it("is a card with its title and what it does", async () => {
        const html = await render({ [FACE]: status({}), [PURGE]: noPurge })
        expect(html).toContain(`<section class="ui-panel ui-card"><div class="ui-card-head"><h2 class="ui-card-title">${en.face_sys_title}</h2></div>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.face_sys_hint)}</p>`)
    })

    it("says where it stands with a badge in its meaning's colour, and a line on what that means", async () => {
        for (const [s, tone] of [["ON", "good"], ["PAUSED", "waiting"], ["OFF", "neutral"]] as const) {
            const html = shown(await render({ [FACE]: status({ state: s }), [PURGE]: noPurge }))
            expect(html, s).toContain(`<div class="ui-state-line"><span class="ui-badge ui-badge-${tone}">${en[`face_sys_badge_${s}`]}</span><span class="ui-card-note">${esc(en[`face_sys_detail_${s}`])}</span></div>`)
        }
    })

    it("offers the protected Super Admin each state's buttons, the purge in the danger colour", async () => {
        const on = shown(await render({ [FACE]: status({ state: "ON" }), [PURGE]: noPurge }))
        expect(on).toContain(`<div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-secondary">${en.face_sys_pause}</button><button type="button" class="ui-btn ui-btn-danger">${en.face_purge}</button></div>`)
        const off = shown(await render({ [FACE]: status({ state: "OFF" }), [PURGE]: noPurge }))
        expect(off).toContain(`<div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-primary">${en.face_sys_turn_on}</button></div>`)
        const paused = shown(await render({ [FACE]: status({ state: "PAUSED" }), [PURGE]: noPurge }))
        expect(paused).toContain(`<div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-primary">${en.face_sys_resume}</button><button type="button" class="ui-btn ui-btn-danger">${en.face_purge}</button></div>`)
    })

    it("tells every other Super Admin who can change it, in place of the buttons", async () => {
        const html = shown(await render({ [FACE]: status({ canChange: false }), [PURGE]: noPurge }))
        expect(html).toContain(`<div class="ui-card-actions"><p class="ui-card-note">${en.face_sys_protected_only}</p></div>`)
        expect(html).not.toContain(`>${en.face_sys_pause}</button>`)
    })

    it("holds the loaded card's room while it loads, and says it's loading", async () => {
        // Rendering less while it loaded pushed the Branding card below it
        // down (Codex reviews on #43 and #49). Whichever shows, each state's
        // line and buttons, and the protected-only line, sit hidden in its place.
        const html = await render({})
        expect(shown(html)).toContain(`<div class="ui-state-line"><span class="ui-card-note" role="status">${en.loading}</span></div>`)
        for (const s of ["ON", "PAUSED", "OFF"] as const) {
            expect(html, s).toContain(`<div class="ui-reserve-room ui-state-line" aria-hidden="true" inert=""><span class="ui-badge`)
            expect(html, s).toContain(`${esc(en[`face_sys_detail_${s}`])}</span></div>`)
        }
        expect(html).toContain(`<div class="ui-reserve-room ui-card-actions" aria-hidden="true" inert=""><button type="button" class="ui-btn ui-btn-secondary">${en.face_sys_pause}</button><button type="button" class="ui-btn ui-btn-danger">${en.face_purge}</button></div>`)
        expect(html).toContain(`<div class="ui-reserve-room ui-card-actions" aria-hidden="true" inert=""><p class="ui-card-note">${en.face_sys_protected_only}</p></div>`)
        // It waits for the purge record too, which would push the card when it came.
        const waiting = shown(await render({ [FACE]: status({}) }))
        expect(waiting).toContain(en.loading)
        expect(waiting).not.toContain(`>${en.face_sys_pause}</button>`)
    })

    it("says when it couldn't load, with Try again, in the same room", async () => {
        const html = await render({ [FACE]: { error: new Error("down") } })
        expect(shown(html)).toContain(`<div class="ui-state-line"><span class="ui-badge ui-badge-problem">${esc(en.face_sys_load_failed)}</span></div>`)
        expect(shown(html)).toContain(`<div class="ui-card-actions"><button type="button" class="ui-btn ui-btn-secondary">${en.try_again}</button></div>`)
        expect(html).toContain(`<div class="ui-reserve-room ui-state-line" aria-hidden="true" inert=""><span class="ui-badge ui-badge-problem">`)
    })

    it("says what the last purge destroyed, its date and numbers in the language's own", async () => {
        const purge = { data: { data: { at: "2026-10-05T09:00:00Z", keysDestroyed: 12, photosDeleted: 340, acknowledged: 9 } } }
        const html = await render({ [FACE]: status({}), [PURGE]: purge }, "ar")
        const date = new Date("2026-10-05T09:00:00Z").toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" })
        expect(html).toContain(`<p class="ui-card-note">${esc(ar.face_purge_record.replace("{date}", date).replace(/\{keys\}/g, "١٢").replace("{photos}", "٣٤٠").replace("{acks}", "٩"))}</p>`)
        expect(html).not.toContain("2026-10-05")
    })
})

describe("changing the face photo key", () => {
    const rekey = (r: Record<string, unknown>) => ({ data: { data: { rotating: true, ...r } } })

    it("is a section of the card under its own heading, holding the room of the most it can show", async () => {
        const html = await render({ [FACE]: status({ rotating: true }), [PURGE]: noPurge, [REKEY]: rekey({ total: 1200, previous: 300, unreadable: 0 }) })
        expect(html).toContain(`<div class="ui-card-report"><h3 class="ui-subsection-title">${en.face_rekey_title}</h3><div class="ui-reserve">`)
        for (const key of ["face_rekey_done", "face_rekey_same_key"] as const) {
            expect(html, key).toMatch(new RegExp(`<div class="ui-reserve-room ui-card-lines" aria-hidden="true" inert="">[^]*?${esc(en[key]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
        }
    })

    it("says how many photos are left, in the language's digits, with the button that moves them", async () => {
        const html = shown(await render({ [FACE]: status({ rotating: true }), [PURGE]: noPurge, [REKEY]: rekey({ total: 1200, previous: 300, unreadable: 0 }) }, "ar"))
        expect(html).toContain(`<div class="ui-card-lines"><p>${esc(ar.face_rekey_status.replace("{previous}", "٣٠٠").replace("{total}", "١٬٢٠٠"))}</p><button type="button" class="ui-btn ui-btn-primary">${ar.face_rekey_run}</button></div>`)
    })

    it("says when they're all moved, and when the key wasn't changed", async () => {
        const done = shown(await render({ [FACE]: status({ rotating: true }), [PURGE]: noPurge, [REKEY]: rekey({ total: 1200, previous: 0, unreadable: 4 }) }))
        expect(done).toContain(`<div class="ui-card-lines"><p>${esc(en.face_rekey_done)}</p><p class="ui-card-note">${esc(en.face_rekey_unreadable.replace("{n}", "4"))}</p></div>`)
        const same = shown(await render({ [FACE]: status({ rotating: true }), [PURGE]: noPurge, [REKEY]: rekey({ sameKey: true }) }))
        expect(same).toContain(`<div class="ui-card-lines"><p class="ui-error">${esc(en.face_rekey_same_key)}</p></div>`)
    })

    it("says while it reads the photos, and when it couldn't, with Try again", async () => {
        const reading = shown(await render({ [FACE]: status({ rotating: true }), [PURGE]: noPurge }))
        expect(reading).toContain(`<div class="ui-card-lines"><p class="ui-card-note" role="status">${en.loading}</p></div>`)
        const failed = shown(await render({ [FACE]: status({ rotating: true }), [PURGE]: noPurge, [REKEY]: { error: new Error("slow") } }))
        expect(failed).toContain(`<div class="ui-card-lines"><p class="ui-error">${esc(en.face_rekey_load_failed)}</p><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${en.try_again}</button></div>`)
    })
})

describe("its questions", () => {
    const src = readFileSync(SRC, "utf8")

    it("asks on the building blocks, the purge with PURGE typed first and its button in the danger colour", () => {
        expect(src).not.toContain("ConfirmModal")
        expect(src).toContain("<ConfirmHealthAction title={t('face_purge_title')} body={t('face_purge_text')} word=\"PURGE\" danger confirmLabel={t('face_purge')}")
        // Turning on, pausing and resuming ask with the button's own name.
        expect(src).toContain("confirmLabel={t(asking.label)}")
    })

    it("stays open, its button busy, until the server answers, and closes once it's done", () => {
        expect(src).toContain("busy={busy}")
        expect(src).toContain("if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')")
        expect(src).toMatch(/showToast\(t\(to === 'ON' \? 'face_sys_on_toast' : 'face_sys_paused_toast'\), 'success'\)\s*setAsking\(null\)/)
        expect(src).toMatch(/showToast\(t\('face_purge_done'\), 'success'\)\s*setPurging\(false\)/)
    })

    it("says the word to type once, in the field's label rather than also in the text", () => {
        for (const dict of [en, ar]) expect(dict.face_purge_text).not.toContain("PURGE")
    })
})

describe("on the building blocks", () => {
    const src = readFileSync(SRC, "utf8")

    it("leaves its typed-in sizes, colours and hand-made place-holders behind", () => {
        expect(src).not.toContain("style={")
        expect(src).not.toContain("className=\"glass\"")
        expect(src).not.toMatch(/function (StateLine|Controls|RotationBody)\(/)
        expect(src).toContain("from '@/components/ui'")
    })

    it("has its copy in both languages", () => {
        for (const key of ["face_sys_badge_ON", "face_sys_badge_PAUSED", "face_sys_badge_OFF", "face_sys_detail_ON", "face_sys_detail_PAUSED", "face_sys_detail_OFF", "face_sys_load_failed", "face_rekey_load_failed"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})
