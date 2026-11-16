import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"
import { KNOWN_REFUSALS } from "./api-errors"

/**
 * A ZKTeco terminal added straight to Nizmo, on Fingerprint terminals
 * (ATTENDANCE_PLAN.md §17.3, §17.7, Phase 4 part 6, PR 297; DESIGN.md
 * §5.5 Dialog): the office's address asked for, what to set on it with
 * nothing secret, its row, its menu, and the words. What the server does
 * is in lib/terminal-office-address.db.test.ts, against a real Postgres.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// A dialog is drawn into the page's body: here, where it's asked for.
vi.stubGlobal("document", { body: {} })

const ZK = { id: "b3", name: "ZKTeco", protocol: "ZKTECO" as const, notesEn: "Its cloud settings are under Comm.", notesAr: null }
const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const PANEL = source("components/AttendanceTerminalsPanel.tsx")
const DIALOGS = source("components/TerminalAddDialog.tsx")
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** A sentence as it's drawn: what's between backticks in a box of its own. */
const drawn = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code class="ui-guide-inline" dir="ltr" translate="no">$1</code>')
const words = (locale: "en" | "ar") => (locale === "ar" ? ar : en)

describe("Add a terminal, for a ZKTeco terminal straight to Nizmo", () => {
    it("asks for the office's address only there, and needs it before anything is sent", () => {
        expect(DIALOGS).toContain("const officeAsked = !!brand && !!connection && hasOfficeAddress({ protocol: brand.protocol, connection })")
        expect(DIALOGS).toContain("{officeAsked && <OfficeField value={office} error={errors.office}")
        expect(DIALOGS).toContain("office: officeAsked && addressLines(office).length === 0 ? t('att_term_office_required') : undefined,")
        expect(DIALOGS).toContain("if (wrong.name || wrong.brand || wrong.serialNumber || wrong.office || !brand || !connection) { focusFirstWrong(formRef.current); return }")
        // Sent only where it's asked for: the server refuses one for any other terminal.
        expect(DIALOGS).toContain("...(officeAsked && { officeAddresses: addressLines(office) })")
    })

    it("takes the address in a field of its own, one a line, left to right, under a visible label with how to find it", () => {
        expect(DIALOGS).toContain("<Field label={t('att_term_office')} hint={t('att_term_office_hint')} error={error}>")
        expect(DIALOGS).toContain('<TextArea {...p} name="officeAddresses" dir="ltr" rows={2} spellCheck={false} autoComplete="off"')
    })
})

describe("what to set on a ZKTeco terminal", () => {
    const render = async (locale: "en" | "ar", props: object = {}) => {
        state.locale = locale
        const { TerminalSettingsDialog } = await import("@/components/TerminalAddDialog")
        return renderToStaticMarkup(h(TerminalSettingsDialog, { name: "Front door", host: "nizmo.example", brand: null, onClose: () => {}, ...props }))
    }

    it("lists each setting under the terminal's own name for it, the server's address in a box with Copy", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await render(locale)
            expect(html).toContain(`>${words(locale).att_term_address_title.replace("{name}", "Front door")}</h2>`)
            const names = [...html.matchAll(/<dt><bdi dir="ltr" lang="en" translate="no">([^<]+)<\/bdi><\/dt>/g)].map(m => m[1])
            expect(names).toEqual(["Server address", "Server port", "Enable domain name", "HTTPS"])
            const boxes = [...html.matchAll(/<pre id="[^"]+" dir="ltr" translate="no"><code>([^<]+)<\/code><\/pre>/g)].map(m => m[1])
            expect(boxes).toEqual(["nizmo.example"])
            for (const value of ["443", "ON"]) expect(html).toContain(`<dd><code class="ui-guide-inline" dir="ltr" translate="no">${value}</code></dd>`)
        }
    })

    it("says where the settings are, that nothing is secret and its menu shows them again, then to try it, with Done alone", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await render(locale)
            const w = words(locale)
            const order = [drawn(w.att_term_settings_intro), "ui-device-settings", esc(w.att_term_settings_again), esc(w.att_term_address_then)].map(x => html.indexOf(x))
            expect(order.every(at => at >= 0), locale).toBe(true)
            expect(order).toEqual([...order].sort((a, b) => a - b))
            // Nothing in it is shown once.
            expect(html).not.toContain(esc(w.att_term_address_once))
            expect(html.match(/<button type="button" class="ui-btn ui-btn-primary"[^>]*>([^<]+)<\/button>/g)?.map(b => b.replace(/<[^>]+>/g, ""))).toEqual([w.att_term_done])
        }
    })

    it("has the brand's notes above it, where the Super Admin wrote some", async () => {
        const html = await render("en", { brand: ZK })
        expect(html.indexOf("Its cloud settings are under Comm.")).toBeGreaterThan(-1)
        expect(html.indexOf("Its cloud settings are under Comm.")).toBeLessThan(html.indexOf("ui-device-settings"))
    })
})

describe("Change office address", () => {
    const render = async (locale: "en" | "ar", props: object = {}) => {
        state.locale = locale
        const { OfficeAddressDialog } = await import("@/components/TerminalAddDialog")
        return renderToStaticMarkup(h(OfficeAddressDialog, { name: "Front door", addresses: ["203.0.113.7", "198.51.100.0/28"], busy: false, onClose: () => {}, onSubmit: async () => {}, ...props }))
    }

    it("opens filled with the addresses kept, one a line, says what saving does, and saves", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await render(locale)
            const w = words(locale)
            expect(html).toContain(`>${w.att_term_change_office_title.replace("{name}", "Front door")}</h2>`)
            expect(html).toContain(`<p>${esc(w.att_term_change_office_body)}</p>`)
            expect(html).toContain(`>${esc(w.att_term_office)}</label>`)
            expect(html).toMatch(/<textarea[^>]*name="officeAddresses"[^>]*dir="ltr"[^>]*>\n?203\.0\.113\.7\n198\.51\.100\.0\/28<\/textarea>/)
            expect(html).toMatch(new RegExp(`${w.cancel}</button><button type="submit" class="ui-btn ui-btn-primary"[^>]*>${w.save}</button>`))
        }
    })

    it("needs an address before anything is sent", () => {
        expect(DIALOGS).toContain("if (typed.length === 0) { setError(t('att_term_office_required')); focusFirstWrong(formRef.current); return }")
        expect(DIALOGS).toContain("await onSubmit(typed)")
    })
})

describe("on Fingerprint terminals", () => {
    it("shows what to set on it once it's added, as it shows a Hikvision terminal's address", () => {
        expect(PANEL).toContain("else if (d?.device && hasOfficeAddress(d.device)) setShownSettings({ name: d.device.name, brandId: d.device.brand?.id ?? null })")
        expect(PANEL).toContain("<TerminalSettingsDialog name={shownSettings.name} host={window.location.host}")
    })

    it("says on its row where it's let in from, each address left to right and never translated, joined by the language's own and", () => {
        expect(PANEL).toContain("if (!hasOfficeAddress(d) || !d.allowedAddresses?.length) return null")
        expect(PANEL).toContain("new Intl.ListFormat(intl, { type: 'conjunction' }).formatToParts(d.allowedAddresses)")
        expect(PANEL).toContain("p.type === 'element' ? <bdi key={i} dir=\"ltr\" translate=\"no\">{p.value}</bdi> : <Fragment key={i}>{p.value}</Fragment>")
        expect(PANEL).toContain("officeLine(d),")
        // Not joined by commas: the facts around it are.
        expect(PANEL).not.toContain("d.allowedAddresses.join(")
    })

    it("says a call from elsewhere in words, the address left to right", () => {
        expect(PANEL).toContain("if (words?.address !== undefined) {")
        expect(PANEL).toContain("reason = <>{before}<bdi dir=\"ltr\" translate=\"no\">{words.address}</bdi>{after}</>")
    })

    it("has What to set on it and Change office address in its menu, and saves the address to its own route", () => {
        expect(PANEL).toContain("...(hasOfficeAddress(d) ? [")
        expect(PANEL).toContain("{ key: 'settings', label: t('att_term_settings'), icon: WrenchIcon,")
        expect(PANEL).toContain("{ key: 'office', label: t('att_term_change_office'), icon: GlobeSimpleIcon, onSelect: () => setOfficeOf(d) },")
        expect(PANEL).toContain("send(`/api/attendance/devices/${officeOf.id}/office-address`, { method: 'PUT', body: JSON.stringify({ addresses }) }, 'att_term_office_saved'")
        // Only for one not retired: a retired terminal's menu is Restore, and the Super Admin's first contacts.
        const retired = PANEL.slice(PANEL.indexOf("const deviceMenu = (d: Device): MenuItem[] => d.retiredAt"), PANEL.indexOf(": [\n            { key: 'edit'"))
        expect(retired).not.toContain("hasOfficeAddress")
    })

    it("asks for the step-up code to change it, as adding it does", () => {
        const route = source("app/api/attendance/devices/[id]/office-address/route.ts")
        expect(route).toContain("export const PUT = withStandardHandler(")
        const denied = route.indexOf("if (denied) return denied")
        const stepUp = route.indexOf('await assertStepUp(session, "attendance.manage_terminals")')
        const saved = route.indexOf("AttendanceDeviceService.setOfficeAddresses(device.id, validation.data.addresses, session.user.id)")
        expect(denied).toBeGreaterThan(-1)
        expect(stepUp).toBeGreaterThan(denied)
        expect(saved).toBeGreaterThan(stepUp)
        expect(route).toContain("z.array(z.string().max(64)).max(MAX_IP_RANGES)")
        const add = source("app/api/attendance/devices/route.ts")
        expect(add).toContain('if (input.connection === "DIRECT") await assertStepUp(session, "attendance.manage_terminals")')
        expect(add).toContain("officeAddresses: z.array(z.string().max(64)).max(MAX_IP_RANGES).optional(),")
    })
})

describe("the words", () => {
    const KEYS = [
        "att_term_connection_DIRECT_ZKTECO_hint", "att_term_office", "att_term_office_hint", "att_term_office_required", "att_term_office_line",
        "att_term_settings", "att_term_settings_intro", "att_term_settings_again", "att_term_change_office", "att_term_change_office_title",
        "att_term_change_office_body", "att_term_office_saved", "att_term_refusal_ADDRESS_NOT_ALLOWED", "att_guide_direct_too", "audit_field_officeAddresses",
    ] as const

    it("are there in both languages, with the same slots", () => {
        const slots = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort()
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(slots(ar[key]), key).toEqual(slots(en[key]))
            expect(/[؀-ۿ]/.test(ar[key]), key).toBe(true)
        }
        expect(en.att_term_office_line).toContain("{addresses}")
        expect(en.att_term_refusal_ADDRESS_NOT_ALLOWED).toContain("{address}")
    })

    it("name the terminal's own menus the same in both languages, as they are on its screen", () => {
        const literals = (s: string) => s.match(/`[^`]+`/g) ?? []
        expect(literals(en.att_term_settings_intro)).toEqual(["`Comm.`", "`Cloud Server Setting`"])
        expect(literals(ar.att_term_settings_intro)).toEqual(literals(en.att_term_settings_intro))
    })
})

describe("the server's refusals", () => {
    it("say what's wrong with the office's address, in words", () => {
        for (const code of ["DEVICE_OFFICE_ADDRESS_REQUIRED", "DEVICE_INVALID_OFFICE_ADDRESS", "DEVICE_TOO_MANY_OFFICE_ADDRESSES"]) {
            expect(KNOWN_REFUSALS[code], code).toMatchObject({ status: 400 })
        }
        expect(KNOWN_REFUSALS.DEVICE_NO_OFFICE_ADDRESS).toMatchObject({ status: 409 })
        expect(KNOWN_REFUSALS.DEVICE_INVALID_OFFICE_ADDRESS.message).toContain("203.0.113.0/28")
        expect(KNOWN_REFUSALS.DEVICE_TOO_MANY_OFFICE_ADDRESSES.message).toContain("20")
    })
})
