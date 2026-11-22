import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { moduleForApiPath } from "./features/routes"
import { AUDIT_ACTIONS } from "./audit-codes"
import { KNOWN_REFUSALS } from "./api-errors"
import { accountantReach, contractEnded, type ClientAccountant } from "./client-accountant"

/**
 * The responsible accountant (CLIENT_PORTAL_PLAN.md §7, §12 step 9b;
 * DESIGN.md §5.5, A client's tax position, for the company's people; PR 343),
 * as the owner's mockup draws it: at the foot of a client's Tax position, a
 * select that saves when picked, for whoever may edit clients; beside it
 * the accountant's WhatsApp number, or a note saying why the client's people
 * can't write to anyone, with the way to fix it.
 *
 * Saving and its refusals, against a real Postgres, are in
 * lib/client-accountant.db.test.ts.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const CSS = readFileSync("components/ui/ui.css", "utf8")
const rule = (selector: string) => CSS.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? ""

const SADEK = { id: "u1", name: "Mohamed Sadek", role: "EMPLOYEE", whatsappNumber: "+201001234567", ended: false }
const PEOPLE = [{ id: "u2", name: "Amal Fathy" }, { id: "u1", name: "Mohamed Sadek" }, { id: "u3", name: "Nour Adel" }]
const of = (person: ClientAccountant["person"]): ClientAccountant => ({ person, reach: accountantReach(person) })

type PanelProps = {
    accountant: ClientAccountant
    picker: { people: { id: string; name: string }[] | null; value: string; busy: boolean; onPick: (id: string) => void } | null
    editsProfile: boolean
}
async function panel(props: Partial<PanelProps> & { accountant: ClientAccountant }) {
    const { AccountantPanel } = await import("@/components/tax/ResponsibleAccountant")
    return renderToStaticMarkup(h(AccountantPanel, { picker: null, editsProfile: false, ...props }))
}
const picker = (value: string, more: Partial<NonNullable<PanelProps["picker"]>> = {}) => ({ people: PEOPLE, value, busy: false, onPick: () => {}, ...more })
/** What's beside the pick: the number, or why no one can be written to. */
const reach = (html: string) => html.match(/<div class="ui-accountant-reach"[^>]*>(.*)<\/div><\/div>$/)?.[1] ?? ""

describe("who the client's people can write to", () => {
    it("is the accountant, with a WhatsApp number, whose contract hasn't ended", () => {
        expect(accountantReach(SADEK)).toBe("whatsapp")
    })

    it("is no one where none is picked, the number is missing, or the contract has ended", () => {
        expect(accountantReach(null)).toBe("none")
        expect(accountantReach({ ...SADEK, whatsappNumber: null })).toBe("no_number")
        // An ended contract is said first: adding a number wouldn't help.
        expect(accountantReach({ ...SADEK, ended: true })).toBe("ended")
        expect(accountantReach({ ...SADEK, whatsappNumber: null, ended: true })).toBe("ended")
    })

    it("counts a contract ended once the person is archived or deleted, not while suspended", () => {
        expect(contractEnded("ARCHIVED")).toBe(true)
        expect(contractEnded("DELETED")).toBe(true)
        for (const status of ["ACTIVE", "OFFLINE", "INACTIVE", "SUSPENDED"]) expect(contractEnded(status), status).toBe(false)
    })
})

describe("the panel, for whoever may edit clients", () => {
    it("is a panel of its own, the pick then what's beside it", async () => {
        const html = await panel({ accountant: of(SADEK), picker: picker("u1") })
        expect(html).toMatch(/^<div class="ui-panel ui-accountant"><div class="ui-accountant-pick">/)
        expect(html.indexOf("ui-accountant-reach")).toBeGreaterThan(html.indexOf("ui-accountant-pick"))
    })

    it("is a select, Responsible accountant, with its hint, No one first, then the company's people", async () => {
        const html = await panel({ accountant: of(SADEK), picker: picker("u1") })
        const label = html.match(/<label for="([^"]+)" class="ui-label">Responsible accountant<\/label>/)
        expect(label).not.toBeNull()
        const select = html.match(/<select [^>]*>/)?.[0] ?? ""
        expect(select).toContain(`id="${label![1]}"`)
        expect(select).not.toContain("disabled")
        const hint = html.match(/<span id="([^"]+)" class="ui-hint">(.*?)<\/span>/)
        expect(hint?.[2]).toBe(esc(en.client_accountant_hint))
        expect(select).toContain(`aria-describedby="${hint![1]}"`)
        const options = [...html.matchAll(/<option value="([^"]*)"( selected="")?[^>]*>(.*?)<\/option>/g)].map(m => [m[1], m[3], !!m[2]])
        expect(options).toEqual([["", "No one", false], ["u2", "Amal Fathy", false], ["u1", "Mohamed Sadek", true], ["u3", "Nour Adel", false]])
    })

    it("shows No one picked where there's none", async () => {
        const html = await panel({ accountant: of(null), picker: picker("") })
        expect(html).toMatch(/<option value="" selected="">No one<\/option>/)
    })

    it("keeps one whose contract has ended in the select, greyed, until another is picked", async () => {
        const ended = { ...SADEK, id: "gone", name: "Gamal Gone", ended: true }
        const html = await panel({ accountant: of(ended), picker: picker("gone") })
        expect(html).toMatch(/<option value="gone" disabled="" selected="">Gamal Gone<\/option>|<option value="gone" selected="" disabled="">Gamal Gone<\/option>/)
        expect(html.indexOf('value="gone"')).toBeLessThan(html.indexOf('value="u2"'))
    })

    it("is off while it's sent, and while the people load", async () => {
        expect((await panel({ accountant: of(SADEK), picker: picker("u1", { busy: true }) })).match(/<select [^>]*>/)?.[0]).toContain('disabled=""')
        const loading = await panel({ accountant: of(SADEK), picker: picker("u1", { people: null }) })
        expect(loading.match(/<select [^>]*>/)?.[0]).toContain('disabled=""')
        // The one picked is still named while the others load.
        expect(loading).toMatch(/<option value="u1"[^>]*>Mohamed Sadek<\/option>/)
    })
})

describe("the panel, for anyone else", () => {
    it("names the accountant as text, with no select", async () => {
        const html = await panel({ accountant: of(SADEK) })
        expect(html).not.toContain("<select")
        expect(html).toContain('<dl class="ui-accountant-fact"><dt class="ui-label">Responsible accountant</dt><dd><bdi>Mohamed Sadek</bdi></dd></dl>')
    })

    it("says No one where there's none", async () => {
        expect(await panel({ accountant: of(null) })).toContain("<dt class=\"ui-label\">Responsible accountant</dt><dd>No one</dd>")
    })
})

describe("beside it", () => {
    it("the accountant's WhatsApp number, left to right as it's kept, read out when a pick changes it", async () => {
        const html = await panel({ accountant: of(SADEK), picker: picker("u1") })
        expect(html).toContain('<div class="ui-accountant-reach" data-reach="whatsapp" aria-live="polite">')
        expect(reach(html)).toContain('<dl class="ui-accountant-fact"><dt class="ui-label"><bdi>Mohamed Sadek</bdi>&#x27;s WhatsApp number</dt><dd><bdi dir="ltr" class="ui-num">+201001234567</bdi></dd></dl>')
        expect(reach(html)).not.toContain("ui-accountant-note")
    })

    it("a link to their profile, for whoever may edit it", async () => {
        const html = await panel({ accountant: of(SADEK), picker: picker("u1"), editsProfile: true })
        expect(reach(html)).toContain('<a class="ui-text-link" href="/dashboard/employees/u1">Change it on their profile</a>')
        expect(reach(await panel({ accountant: of(SADEK), picker: picker("u1") }))).not.toContain("<a ")
    })

    it("where no one is picked, a note saying so, with the way to fix it", async () => {
        const html = await panel({ accountant: of(null), picker: picker("") })
        expect(html).toContain('<div class="ui-accountant-reach" data-reach="none" aria-live="polite">')
        expect(reach(html)).toBe(`<p class="ui-accountant-note">${esc(en.client_accountant_none)}</p>`)
    })

    it("where their profile has no number, a note naming them, with Add the number for whoever may edit it", async () => {
        const bare = { ...SADEK, whatsappNumber: null }
        const html = await panel({ accountant: of(bare), picker: picker("u1"), editsProfile: true })
        const [before, after] = en.client_accountant_no_number.split("{name}")
        expect(reach(html)).toBe(`<p class="ui-accountant-note">${esc(before)}<bdi>Mohamed Sadek</bdi>${esc(after)} <a class="ui-text-link" href="/dashboard/employees/u1">Add the number</a></p>`)
        expect(reach(await panel({ accountant: of(bare), picker: picker("u1") }))).toBe(`<p class="ui-accountant-note">${esc(before)}<bdi>Mohamed Sadek</bdi>${esc(after)}</p>`)
    })

    it("where their contract has ended, a note naming them, with the way to fix it", async () => {
        const html = await panel({ accountant: of({ ...SADEK, ended: true }), picker: picker("u1"), editsProfile: true })
        const [before, after] = en.client_accountant_ended.split("{name}")
        expect(html).toContain('data-reach="ended"')
        expect(reach(html)).toBe(`<p class="ui-accountant-note">${esc(before)}<bdi>Mohamed Sadek</bdi>${esc(after)}</p>`)
    })

    it("in Arabic", async () => {
        state.locale = "ar"
        const html = await panel({ accountant: of(SADEK), picker: picker("u1"), editsProfile: true })
        expect(html).toContain(">المحاسب المسؤول</label>")
        expect(html).toContain('<option value="">لا أحد</option>')
        expect(reach(html)).toContain("<dt class=\"ui-label\">رقم واتساب <bdi>Mohamed Sadek</bdi></dt>")
        expect(reach(html)).toContain(">يُغيَّر من الصفحة الشخصية</a>")
        expect(reach(await panel({ accountant: of(null), picker: picker("") }))).toBe(`<p class="ui-accountant-note">${ar.client_accountant_none}</p>`)
    })
})

describe("its look", () => {
    it("is a panel with a card's inside, its two parts side by side, stacked where there's no room", () => {
        const box = rule(".ui-accountant")
        expect(box).toMatch(/padding:\s*var\(--card-pad-block\) var\(--card-pad-inline\);/)
        expect(box).toMatch(/display:\s*flex;/)
        expect(box).toMatch(/flex-wrap:\s*wrap;/)
        expect(box).toMatch(/gap:\s*var\(--space-4\);/)
        const parts = rule(".ui-accountant-pick,\n.ui-accountant-reach")
        expect(parts).toMatch(/flex:\s*1 1 280px;/)
        expect(parts).toMatch(/min-width:\s*0;/)
    })

    it("keeps the select to 320px, as the mockup draws it", () => {
        expect(rule(".ui-accountant-pick .ui-control")).toMatch(/max-inline-size:\s*320px;/)
    })

    it("puts the note on its own line, across the panel", () => {
        expect(rule('.ui-accountant-reach:not([data-reach="whatsapp"])')).toMatch(/flex-basis:\s*100%;/)
    })

    it("draws the note in the waiting colours, its link in its own colour", () => {
        const note = rule(".ui-accountant-note")
        expect(note).toMatch(/margin:\s*0;/)
        expect(note).toMatch(/background:\s*var\(--status-waiting-bg\);/)
        expect(note).toMatch(/color:\s*var\(--status-waiting-fg\);/)
        expect(note).toMatch(/border-radius:\s*var\(--radius-field\);/)
        expect(note).toMatch(/padding:\s*var\(--space-2\) var\(--space-3\);/)
        expect(note).toMatch(/font-size:\s*var\(--text-sm\);/)
        const link = rule(".ui-accountant-note .ui-text-link")
        expect(link).toMatch(/color:\s*inherit;/)
        expect(link).toMatch(/font-weight:\s*600;/)
    })

    it("draws the link to their profile under the number in --text-sm", () => {
        const link = rule(".ui-accountant-reach > .ui-text-link")
        expect(link).toMatch(/font-size:\s*var\(--text-sm\);/)
        expect(link).toMatch(/line-height:\s*var\(--leading-sm\);/)
    })

    // Found in the interface audit: a name too long for a phone's width pushed past its panel.
    it("breaks a name too long for its line, in the note and under a fact's label", () => {
        expect(rule(".ui-accountant-note")).toMatch(/overflow-wrap:\s*anywhere;/)
        expect(rule(".ui-accountant-fact dd")).toMatch(/overflow-wrap:\s*anywhere;/)
    })

    it("lays a fact's label over its value", () => {
        const fact = rule(".ui-accountant-fact")
        expect(fact).toMatch(/margin:\s*0;/)
        expect(fact).toMatch(/flex-direction:\s*column;/)
        expect(rule(".ui-accountant-fact dd")).toMatch(/margin:\s*0;/)
    })
})

describe("on the client's page", () => {
    const TAX = readFileSync("components/tax/TaxPosition.tsx", "utf8")
    const PAGE = readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8")
    const OWN = readFileSync("components/tax/ResponsibleAccountant.tsx", "utf8")
    const ROUTE = readFileSync("app/api/clients/accountant/route.ts", "utf8")

    it("is at the foot of the Tax position, before the first file too", () => {
        const panels = [...TAX.matchAll(/<ResponsibleAccountant clientId=\{clientId\} accountant=\{body\.accountant\} archived=\{body\.client\.archived\} picks=\{picks\} editsProfile=\{editsProfile\} onSaved=\{\(\) => mutate\(\)\} \/>/g)]
        expect(panels).toHaveLength(2)
        expect(TAX.indexOf("<ResponsibleAccountant", TAX.indexOf("tax_position_none_detail"))).toBeGreaterThan(-1)
        expect(TAX.lastIndexOf("<ResponsibleAccountant")).toBeGreaterThan(TAX.lastIndexOf("<DataList"))
    })

    it("takes its select from clients.edit, and its profile links from the profile's own rule", () => {
        expect(PAGE).toContain("<TaxPosition key={id} clientId={id} manages={can('tax.manage')} picks={can('clients.edit')} editsProfile={person => editsProfile({ can, viewer, person })} />")
    })

    it("lists who may be picked only for whoever picks, on a client that isn't archived, and saves each pick", () => {
        expect(OWN).toContain("if (picks && !archived) return <AccountantPicker clientId={clientId} accountant={accountant} editsProfile={edits} onSaved={onSaved} />")
        expect(OWN).toContain("useSWR<{ data: { people: AccountantCandidate[] } }>(`/api/clients/accountant?clientId=${encodeURIComponent(clientId)}`, fetcher)")
        expect(OWN).toContain("method: 'PUT'")
        expect(OWN).toContain("JSON.stringify({ clientId, userId: id || null })")
    })

    it("is a route of the client portal's, for whoever may edit clients", () => {
        expect(moduleForApiPath("/api/clients/accountant")).toBe("TAX_POSITION")
        // The client's own details stay the Clients module's.
        expect(moduleForApiPath("/api/clients")).toBe("CLIENTS")
        expect(ROUTE.match(/\{ permission: "clients\.edit" \}/g)).toHaveLength(2)
    })
})

describe("its words", () => {
    it("in English", () => {
        expect(en.client_accountant_label).toBe("Responsible accountant")
        expect(en.client_accountant_hint).toBe("The client sees this name on their page, and the contact button opens WhatsApp on this accountant's own number.")
        expect(en.client_accountant_no_one).toBe("No one")
        expect(en.client_accountant_number).toBe("{name}'s WhatsApp number")
        expect(en.client_accountant_change_number).toBe("Change it on their profile")
        expect(en.client_accountant_none).toBe("This client has no responsible accountant, so its people can't contact anyone on WhatsApp. Pick a responsible accountant.")
        expect(en.client_accountant_no_number).toBe("There's no WhatsApp number on {name}'s profile, so the client's people can't contact them.")
        expect(en.client_accountant_add_number).toBe("Add the number")
        expect(en.client_accountant_ended).toBe("{name}'s contract has ended, so the client's people can't contact them. Pick another responsible accountant.")
        expect(en.client_accountant_saved).toBe("Responsible accountant saved.")
        expect(en.client_accountant_removed).toBe("Responsible accountant removed.")
        expect(en.client_accountant_failed).toBe("The responsible accountant couldn't be saved. Try again.")
    })

    it("in Arabic, as the mockup says them, neutral as the app's are", () => {
        expect(ar.client_accountant_label).toBe("المحاسب المسؤول")
        expect(ar.client_accountant_hint).toBe("الاسم يظهر للعميل في صفحته، وزر التواصل يفتح واتساب على رقم المحاسب نفسه.")
        expect(ar.client_accountant_no_one).toBe("لا أحد")
        expect(ar.client_accountant_number).toBe("رقم واتساب {name}")
        expect(ar.client_accountant_change_number).toBe("يُغيَّر من الصفحة الشخصية")
        expect(ar.client_accountant_none).toBe("لا يوجد محاسب مسؤول لهذا العميل، فلا يمكن لأشخاصه التواصل على واتساب. يُرجى اختيار محاسب مسؤول.")
        expect(ar.client_accountant_no_number).toBe("لا يوجد رقم واتساب في صفحة {name}، فلا يمكن لأشخاص العميل التواصل.")
        expect(ar.client_accountant_add_number).toBe("إضافة الرقم")
        expect(ar.client_accountant_ended).toBe("انتهى عقد {name}، فلا يمكن لأشخاص العميل التواصل. يُرجى اختيار محاسب مسؤول آخر.")
        expect(ar.client_accountant_saved).toBe("حُفظ المحاسب المسؤول.")
        expect(ar.client_accountant_removed).toBe("أُزيل المحاسب المسؤول.")
        expect(ar.client_accountant_failed).toBe("تعذّر حفظ المحاسب المسؤول. يُرجى المحاولة مرة أخرى.")
    })

    it("in the audit log", () => {
        expect(AUDIT_ACTIONS).toContain("SET_CLIENT_ACCOUNTANT")
        expect(en.audit_action_SET_CLIENT_ACCOUNTANT).toBe("Set a client's responsible accountant")
        expect(ar.audit_action_SET_CLIENT_ACCOUNTANT).toBe("تم تحديد المحاسب المسؤول لعميل")
        expect(en.audit_field_accountant).toBe("Responsible accountant")
        expect(ar.audit_field_accountant).toBe("المحاسب المسؤول")
    })

    it("in the server's refusals", () => {
        expect(KNOWN_REFUSALS.CLIENTS_EDIT_REQUIRED.status).toBe(403)
        expect(KNOWN_REFUSALS.ACCOUNTANT_CLIENT_REQUIRED.status).toBe(400)
        expect(KNOWN_REFUSALS.ACCOUNTANT_PERSON_INVALID.status).toBe(400)
        expect(KNOWN_REFUSALS.ACCOUNTANT_NOT_IN_COMPANY.status).toBe(400)
        expect(KNOWN_REFUSALS.ACCOUNTANT_CONTRACT_ENDED.status).toBe(409)
    })
})
