import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, part 3b (UI_PLAN.md §5 step
 * 5), the rest of the Customers group: a company's payments, opened from its
 * row in Companies, and the Packages companies are sold, with the dialogs
 * each adds and changes them in.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean; isLoading?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN" } as Record<string, unknown> | null,
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; href?: string; danger?: boolean; disabled?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.viewer ? { user: state.viewer } : null, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "c1" }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/dashboard/companies/c1/payments", useRouter: () => ({ replace: () => {}, push: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/HeaderContext", () => ({ useHeader: () => ({ setTitle: () => {}, setSubtitle: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded = key ? state.swr[key] ?? {} : {}
        return { error: undefined, isValidating: false, isLoading: !loaded.data && !loaded.error, mutate: async () => {}, ...loaded }
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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const ok = (data: unknown) => ({ data: { data } })
const failed = { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) }
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const day = (iso: string, locale = "en-GB") => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
const usd = (n: number, locale = "en-GB") => n.toLocaleString(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })

function render(element: Parameters<typeof renderToStaticMarkup>[0], swr: Record<string, Loaded> = {}, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null } = {}) {
    Object.assign(state, { swr, keys: [], menus: [], locale: options.locale ?? "en" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}

// The pages are slow to load the first time; once, before the tests time them.
beforeAll(async () => {
    await Promise.all([
        import("@/app/(dashboard)/dashboard/companies/[id]/payments/page"),
        import("@/app/(dashboard)/dashboard/packages/page"),
        import("@/components/PaymentDialogs"),
        import("@/components/PackageDialog"),
    ])
}, 120000)

const COMPANY = "/api/companies?id=c1"
const PAYMENTS = "/api/companies/c1/payments"
const PACKAGES = "/api/packages?includeInactive=true"

const payment = (p: Record<string, unknown> = {}) => ({
    id: "pay1", cost: 50, subscriptionType: "MONTHLY", status: "PAID", paidAt: "2026-11-01T09:00:00.000Z",
    startDate: "2026-11-01T09:00:00.000Z", endDate: "2026-12-01T09:00:00.000Z", createdAt: "2026-11-01T08:00:00.000Z",
    ...p,
})
const unpaid = (p: Record<string, unknown> = {}) => payment({ id: "pay2", cost: 500, subscriptionType: "ANNUALLY", status: "UNPAID", paidAt: null, startDate: null, endDate: null, createdAt: "2026-11-02T08:00:00.000Z", ...p })
const company = { [COMPANY]: ok({ id: "c1", name: "Delta Sites" }) }

const paymentsPage = async (swr: Record<string, Loaded>, options?: Parameters<typeof render>[2]) => {
    const { default: CompanyPaymentsPage } = await import("@/app/(dashboard)/dashboard/companies/[id]/payments/page")
    return render(h(CompanyPaymentsPage), swr, options)
}

describe("a company's payments", () => {
    it("is named for the company under a link back to Companies, with Add a payment", async () => {
        const top = header(await paymentsPage({ ...company, [PAYMENTS]: ok([payment()]) }))
        expect(top).toMatch(new RegExp(`<a class="ui-back-link" href="/dashboard/companies">.*${en.companies}</a>`))
        expect(top).toContain('<h1 class="ui-page-title"><bdi>Delta Sites</bdi></h1>')
        expect(top).toContain(`<p class="ui-page-subtitle">${en.companies_payments}</p>`)
        expect(top).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-primary">.*${en.payments_add}</button>`))
    })

    it("says Payments until the company's name is in", async () => {
        const top = header(await paymentsPage({ [PAYMENTS]: ok([]) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.companies_payments}</h1>`)
        expect(top).not.toContain("ui-page-subtitle")
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await paymentsPage({ ...company, [PAYMENTS]: ok([payment()]) }, { viewer: { id: "a1", role: "ADMIN" } })
        expect(html).not.toContain("ui-page-header")
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("lists each payment: what it pays for and when it was added, its amount, the period it covers and whether it's paid", async () => {
        const html = await paymentsPage({ ...company, [PAYMENTS]: ok([
            unpaid(),
            payment(),
            payment({ id: "pay3", cost: 2000, subscriptionType: "LIFETIME", endDate: null }),
        ]) })
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.companies_payments}</caption>`)
        for (const column of [en.payments_for, en.payments_amount, en.payments_covers, en.status_label]) expect(html, column).toContain(`<th scope="col"${column === en.payments_amount ? ' class="ui-end"' : ""}>${column}</th>`)
        expect(html).toContain(en.payments_month)
        expect(html).toContain(en.payments_year)
        expect(html).toContain(en.payments_lifetime)
        expect(html).toContain(en.payments_added_on.replace("{date}", day("2026-11-02T08:00:00.000Z")))
        expect(html).toContain(`<span class="ui-num">${usd(50)}</span>`)
        expect(html).toContain(`<span class="ui-num">${usd(500)}</span>`)
        expect(html).toContain(`<span class="ui-num">${usd(2000)}</span>`)
        expect(html).toContain(esc(en.payments_period.replace("{from}", day("2026-11-01T09:00:00.000Z")).replace("{to}", day("2026-12-01T09:00:00.000Z"))))
        expect(html).toContain(esc(en.payments_period_lifetime.replace("{from}", day("2026-11-01T09:00:00.000Z"))))
        expect(html).toContain(esc(en.payments_starts_when_paid))
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.payments_paid}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.payments_unpaid}</span>`)
        expect(html).toContain('<ul class="ui-cards"')
    })

    it("says it in Arabic with Arabic digits", async () => {
        const html = await paymentsPage({ ...company, [PAYMENTS]: ok([payment()]) }, { locale: "ar" })
        expect(html).toContain(usd(50, "ar-EG"))
        expect(html).toContain(day("2026-12-01T09:00:00.000Z", "ar-EG"))
        expect(html).toContain(ar.payments_paid)
    })

    it("offers Mark as paid and Delete on an unpaid payment, each named for it, and nothing on a paid one, which stays as it is", async () => {
        const html = await paymentsPage({ ...company, [PAYMENTS]: ok([unpaid(), payment()]) })
        const name = en.payments_the_payment.replace("{amount}", usd(500))
        expect(html).toContain(`aria-label="${esc(en.payments_mark_paid_for.replace("{name}", name))}"`)
        expect(html).toContain(`>${en.mark_as_paid}</button>`)
        expect(state.menus.map(m => m.label)).toEqual([en.ui_more_actions_for.replace("{name}", name), en.ui_more_actions_for.replace("{name}", name)])
        expect(state.menus[0].items.map(i => [i.key, i.danger])).toEqual([["delete", true]])
        expect(html.match(new RegExp(`>${en.mark_as_paid}</button>`, "g"))).toHaveLength(2)
    })

    it("says when there are none yet, what a payment is, and while they load, and when they didn't, with the server's reason and Try again", async () => {
        const none = await paymentsPage({ ...company, [PAYMENTS]: ok([]) })
        expect(none).toContain(`class="ui-empty-title">${esc(en.payments_none)}<`)
        expect(none).toContain(esc(en.payments_none_hint))
        expect(await paymentsPage(company)).toContain('<div class="ui-panel" role="status">')
        const html = await paymentsPage({ ...company, [PAYMENTS]: failed })
        expect(html).toContain(esc(en.payments_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("asks before a payment is deleted, named for it, saying nothing else changes", () => {
        const source = readFileSync("app/(dashboard)/dashboard/companies/[id]/payments/page.tsx", "utf8")
        expect(source).toMatch(/<DeleteTemplateDialog[\s\S]*?name=\{paymentName\(removing\)\}[\s\S]*?body=\{t\('payments_delete_body'\)\}/)
    })
})

describe("the payment dialogs", () => {
    it("adds a payment: what it pays for and its amount, each labelled, saying it's unpaid until it's marked paid", async () => {
        const { AddPaymentDialog } = await import("@/components/PaymentDialogs")
        const html = render(h(AddPaymentDialog, { companyId: "c1", onClose: () => {}, onAdded: () => {} }))
        expect(html).toContain(`class="ui-dialog-title">${en.payments_add}</h2>`)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.payments_type_label}</label>`))
        expect(html).toContain(`<option value="MONTHLY" selected="">${en.payments_month}</option><option value="ANNUALLY">${en.payments_year}</option><option value="LIFETIME">${en.payments_lifetime}</option>`)
        expect(html).toContain(esc(en.payments_add_hint))
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.payments_amount}</label>`))
        expect(html).toMatch(/<span class="ui-control has-start-icon">.*<input[^>]*inputMode="decimal"[^>]*name="cost"/)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.payments_add_submit}</button>`))
    })

    it("says on Add what's wrong with the amount, as the server would", async () => {
        const { amountError } = await import("@/lib/subscription-display")
        expect(amountError("", { zero: false })).toBe("missing")
        expect(amountError("  ", { zero: false })).toBe("missing")
        for (const wrong of ["0", "-5", "abc", "1e3x", "99999999999"]) expect(amountError(wrong, { zero: false }), wrong).toBe("wrong")
        expect(amountError("49.999", { zero: false })).toBe("places")
        expect(amountError(" 49.99 ", { zero: false })).toBeNull()
        expect(amountError("0", { zero: true })).toBeNull()
        expect(amountError("-1", { zero: true })).toBe("wrong")
    })

    it("asks before marking one paid, saying the period it will pay for and that it can't be deleted after", async () => {
        const { MarkPaidDialog } = await import("@/components/PaymentDialogs")
        const now = new Date()
        const html = render(h(MarkPaidDialog, { payment: unpaid({ subscriptionType: "MONTHLY", cost: 50 }) as never, payments: [], busy: false, onCancel: () => {}, onConfirm: () => {} }))
        expect(html).toContain(`class="ui-dialog-title">${esc(en.payments_mark_title.replace("{name}", en.payments_the_payment.replace("{amount}", usd(50))))}</h2>`)
        const next = new Date(now)
        next.setMonth(next.getMonth() + 1)
        expect(html).toContain(esc(en.payments_mark_period.replace("{from}", day(now.toISOString())).replace("{to}", day(next.toISOString()))))
        expect(html).toContain(esc(en.payments_mark_final))
        expect(html).toContain(`class="ui-btn ui-btn-primary">${en.mark_as_paid}</button>`)
        const life = render(h(MarkPaidDialog, { payment: unpaid({ subscriptionType: "LIFETIME" }) as never, payments: [], busy: false, onCancel: () => {}, onConfirm: () => {} }))
        expect(life).toContain(esc(en.payments_mark_lifetime.replace("{from}", day(now.toISOString()))))
    })

    it("works out that period as the server will: after the furthest one paid for, or from now", async () => {
        const { periodIfPaid } = await import("@/lib/billing/period")
        const now = new Date("2026-11-02T10:00:00Z")
        expect(periodIfPaid([], "MONTHLY", now)).toEqual({ start: now, end: new Date("2026-12-02T10:00:00Z") })
        // Paid early: it carries on from the end of the one paid for, a calendar month on.
        const paid = [{ endDate: "2026-11-30T10:00:00Z" }, { endDate: "2026-10-01T10:00:00Z" }]
        expect(periodIfPaid(paid, "MONTHLY", now)).toEqual({ start: new Date("2026-11-30T10:00:00Z"), end: new Date("2026-12-30T10:00:00Z") })
        expect(periodIfPaid(paid, "ANNUALLY", now).end).toEqual(new Date("2027-11-30T10:00:00Z"))
        // Paid late: from now, not back-dated.
        expect(periodIfPaid([{ endDate: "2026-10-01T10:00:00Z" }], "MONTHLY", now).start).toEqual(now)
        // A lifetime one held: the server finds it first, and starts from now.
        expect(periodIfPaid([{ endDate: "2026-11-30T10:00:00Z" }, { endDate: null }], "MONTHLY", now).start).toEqual(now)
        expect(periodIfPaid([], "LIFETIME", now)).toEqual({ start: now, end: null })
    })

    it("works the period out from the payments that are paid, and not the one being marked", () => {
        const source = readFileSync("components/PaymentDialogs.tsx", "utf8")
        expect(source).toContain("payments.filter(p => p.status === 'PAID' && p.id !== payment.id)")
    })
})

const pkg = (p: Record<string, unknown> = {}) => ({
    id: "p1", name: "Growth", description: "For teams that run payroll", isActive: true, isPublic: true,
    priceMonthly: 50, priceAnnual: 500, priceLifetime: null,
    hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: false, hasAttendanceMobile: true,
    _count: { companies: 3 },
    ...p,
})
const packagesPage = async (swr: Record<string, Loaded>, options?: Parameters<typeof render>[2]) => {
    const { default: PackagesPage } = await import("@/app/(dashboard)/dashboard/packages/page")
    return render(h(PackagesPage), swr, options)
}

describe("the Packages page", () => {
    it("has the page header with Add a package", async () => {
        const top = header(await packagesPage({ [PACKAGES]: ok([pkg()]) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.packages}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.packages_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-primary">.*${en.packages_add}</button>`))
    })

    it("is the Super Admin's only, known from the first paint, and asks the server nothing for anyone else", async () => {
        const html = await packagesPage({ [PACKAGES]: ok([pkg()]) }, { viewer: { id: "a1", role: "ADMIN" } })
        expect(html).not.toContain("ui-page-header")
        expect(state.keys.every(k => k === null)).toBe(true)
        expect(readFileSync("app/(dashboard)/dashboard/packages/page.tsx", "utf8")).not.toContain("useSession")
    })

    it("lists each package with what it grants, its prices and how many companies are on it, retired ones too", async () => {
        const html = await packagesPage({ [PACKAGES]: ok([
            pkg(),
            pkg({ id: "p2", name: "Basic", description: null, isActive: false, isPublic: false, hasHR: false, hasAttendanceMobile: false, priceLifetime: 2000, _count: { companies: 0 } }),
        ]) })
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.packages}</caption>`)
        for (const column of [en.packages_package, en.packages_grants, en.packages_prices]) expect(html, column).toContain(`<th scope="col">${column}</th>`)
        expect(html).toContain(`<th scope="col" class="ui-end">${en.companies}</th>`)
        expect(html).toContain("<bdi>Growth</bdi>")
        expect(html).toContain("For teams that run payroll")
        expect(html).toContain(`<bdi>Basic</bdi> <span class="ui-badge ui-badge-neutral">${en.package_retired}</span> <span class="ui-badge ui-badge-neutral">${en.packages_unlisted}</span>`)
        expect(html).toContain(`${en.bundle_hr}, ${en.bundle_attendance_mobile}`)
        expect(html).toContain(en.core_only)
        expect(html).toContain(en.packages_per_month.replace("{price}", usd(50)))
        expect(html).toContain(en.packages_per_year.replace("{price}", usd(500)))
        expect(html).toContain(en.packages_not_for_life)
        expect(html).toContain(en.packages_for_life.replace("{price}", usd(2000)))
        expect(html).toContain('<td class="ui-end"><span class="ui-num">3</span></td>')
        expect(html).toContain("3 companies")
        expect(html).toContain('<ul class="ui-cards"')
    })

    it("puts Edit and Delete in each package's menu, and Delete can't be picked while companies are on it, saying why", async () => {
        await packagesPage({ [PACKAGES]: ok([pkg(), pkg({ id: "p2", name: "Basic", _count: { companies: 0 } })]) })
        const growth = state.menus.find(m => m.label === en.ui_more_actions_for.replace("{name}", "Growth"))!
        expect(growth.items.map(i => i.key)).toEqual(["edit", "delete"])
        expect(growth.items[1]).toMatchObject({ label: en.packages_delete_in_use, disabled: true, danger: true })
        const basic = state.menus.find(m => m.label.includes("Basic"))!
        expect(basic.items[1]).toMatchObject({ label: en.delete, disabled: undefined, danger: true })
    })

    it("says when there are none yet, while they load, and when they didn't, with the server's reason and Try again", async () => {
        const none = await packagesPage({ [PACKAGES]: ok([]) })
        expect(none).toContain(`class="ui-empty-title">${esc(en.packages_none)}<`)
        expect(none).toContain(esc(en.packages_none_hint))
        expect(await packagesPage({})).toContain('<div class="ui-panel" role="status">')
        const html = await packagesPage({ [PACKAGES]: failed })
        expect(html).toContain(esc(en.packages_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("asks before a package is deleted, named for it", () => {
        const source = readFileSync("app/(dashboard)/dashboard/packages/page.tsx", "utf8")
        expect(source).toMatch(/<DeleteTemplateDialog[\s\S]*?name=\{removing\.name\}[\s\S]*?body=\{t\('packages_delete_body'\)\}/)
    })
})

describe("the package dialog", () => {
    it("adds a package: its name, description and prices, what it grants and whether it's sold, each labelled", async () => {
        const { PackageDialog } = await import("@/components/PackageDialog")
        const html = render(h(PackageDialog, { pkg: null, onClose: () => {}, onSaved: () => {} }))
        expect(html).toContain(`class="ui-dialog-title">${en.packages_add}</h2>`)
        for (const name of [en.package_name, en.package_description, en.price_monthly, en.price_annual, en.price_lifetime]) expect(html, name).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${name}</label>`))
        expect(html).toMatch(/<input(?=[^>]*name="name")(?=[^>]*maxLength="80")[^>]*>/)
        expect(html).toMatch(/<textarea(?=[^>]*name="description")(?=[^>]*maxLength="500")[^>]*>/)
        expect(html.match(/inputMode="decimal"/g)).toHaveLength(3)
        expect(html).toContain(esc(en.packages_lifetime_hint))
        expect(html).toContain(`<legend class="ui-label">${en.packages_grants_legend}</legend>`)
        for (const bundle of [en.bundle_company_management, en.bundle_hr, en.bundle_attendance_terminals, en.bundle_attendance_mobile]) expect(html, bundle).toContain(bundle)
        // The attendance add-ons sit on HR: without it they can't be picked, and say why.
        expect(html.match(/<input type="checkbox" class="ui-check" disabled=""[^>]*aria-describedby="[^"]+"/g)).toHaveLength(2)
        expect(html).toContain(esc(en.attendance_requires_hr))
        expect(html).toContain(esc(en.packages_core_only_hint))
        expect(html).toContain(`<legend class="ui-label">${en.packages_selling_legend}</legend>`)
        expect(html).toContain(esc(en.packages_active))
        expect(html).toContain(esc(en.packages_active_hint))
        expect(html).toContain(esc(en.packages_public))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.packages_add_submit}</button>`))
    })

    it("changes one, named for it, its values filled in, and says first how many companies it reaches", async () => {
        const { PackageDialog } = await import("@/components/PackageDialog")
        const html = render(h(PackageDialog, { pkg: pkg(), onClose: () => {}, onSaved: () => {} }))
        expect(html).toContain(`class="ui-dialog-title">${en.packages_edit_title.replace("{name}", "Growth")}</h2>`)
        expect(html).toContain('value="Growth"')
        expect(html).toContain('value="50"')
        expect(html).toContain('value="500"')
        expect(html).toContain(`<div class="ui-dialog-note" data-tone="waiting"><p>${esc(en.packages_reaches.replace("{count}", "3 companies"))}</p></div>`)
        expect(html).not.toContain(esc(en.packages_core_only_hint))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.save}</button>`))
        const unused = render(h(PackageDialog, { pkg: pkg({ _count: { companies: 0 } }), onClose: () => {}, onSaved: () => {} }))
        expect(unused).not.toContain("ui-dialog-note")
    })

    it("says on Save what's wrong with each field, under it, as the server would", async () => {
        const { packageErrors, emptyPackage } = await import("@/components/PackageDialog")
        const fine = { ...emptyPackage(), name: "Growth", priceMonthly: "50", priceAnnual: "500" }
        expect(packageErrors(fine)).toEqual({})
        expect(packageErrors({ ...fine, name: "  " })).toEqual({ name: "packages_name_required" })
        expect(packageErrors({ ...fine, priceMonthly: "" })).toEqual({ priceMonthly: "packages_price_required" })
        expect(packageErrors({ ...fine, priceAnnual: "-1" })).toEqual({ priceAnnual: "packages_price_wrong" })
        expect(packageErrors({ ...fine, priceMonthly: "1.234" })).toEqual({ priceMonthly: "amount_two_places" })
        expect(packageErrors({ ...fine, priceMonthly: "0" })).toEqual({})
        expect(packageErrors({ ...fine, priceLifetime: "x" })).toEqual({ priceLifetime: "packages_price_wrong" })
    })

    it("sends what was typed as the server takes it: names trimmed, prices as numbers, an empty lifetime price not sold for life", async () => {
        const { packagePayload, emptyPackage, formOf } = await import("@/components/PackageDialog")
        const form = { ...emptyPackage(), name: " Growth ", description: " Payroll ", priceMonthly: "50", priceAnnual: "499.99", hasHR: true }
        expect(packagePayload(form, null)).toEqual({
            name: "Growth", description: "Payroll", isActive: true, isPublic: true, priceMonthly: 50, priceAnnual: 499.99, priceLifetime: null,
            hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: false, hasAttendanceMobile: false,
        })
        expect(packagePayload({ ...form, priceLifetime: "2000" }, pkg())).toMatchObject({ id: "p1", priceLifetime: 2000 })
        // A package's form shows a lifetime price it isn't sold at as empty.
        expect(formOf(pkg())).toMatchObject({ priceMonthly: "50", priceLifetime: "", hasHR: true, hasAttendanceMobile: true })
    })

    it("turns the attendance add-ons off with HR, and says so first when that takes them from companies", async () => {
        const { withBundle, losesAttendance, formOf } = await import("@/components/PackageDialog")
        const form = formOf(pkg())
        expect(withBundle(form, "hasHR", false)).toMatchObject({ hasHR: false, hasAttendanceTerminals: false, hasAttendanceMobile: false })
        expect(withBundle(form, "hasCompanyManagement", true)).toMatchObject({ hasCompanyManagement: true, hasAttendanceMobile: true })
        expect(losesAttendance(pkg(), withBundle(form, "hasHR", false))).toBe(true)
        expect(losesAttendance(pkg(), form)).toBe(false)
        expect(losesAttendance(null, withBundle(form, "hasHR", false))).toBe(false)
    })

    it("says a name that's taken under the name, and anything else the server refuses as it said it", () => {
        const source = readFileSync("components/PackageDialog.tsx", "utf8")
        expect(source).toContain("body?.error === 'A package with this name already exists'")
        expect(source).toContain("showToast(await refusalOf(res, t('error_generic')), 'error')")
    })
})

describe("nothing of the old pages is left", () => {
    const files = [
        "app/(dashboard)/dashboard/companies/[id]/payments/page.tsx",
        "app/(dashboard)/dashboard/packages/page.tsx",
        "components/PaymentDialogs.tsx",
        "components/PackageDialog.tsx",
    ]

    it("has no inline styles, old windows, spinner, header title, drawn icons or emoji", () => {
        for (const file of files) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toMatch(/@\/components\/(Modal|ConfirmModal|LoadingSpinner)'/)
            expect(source, file).not.toMatch(/className="(input|btn|glass|label)/)
            expect(source, file).not.toContain("useHeader")
            expect(source, file).not.toContain("<svg")
            expect(source, file).not.toMatch(/[🧾✅∞]/u)
            expect(source, file).not.toContain(" · ")
            expect(source, file).not.toMatch(/\bas any\b/)
            expect(source, file).not.toContain("eslint-disable")
        }
    })

    it("has every word it says in both languages, and none of the old pages' own", () => {
        const said = [
            "payments_add", "payments_add_submit", "payments_for", "payments_amount", "payments_covers", "payments_month", "payments_year",
            "payments_lifetime", "payments_added_on", "payments_period", "payments_period_lifetime", "payments_starts_when_paid", "payments_paid",
            "payments_unpaid", "payments_none", "payments_none_hint", "payments_load_failed", "payments_type_label", "payments_add_hint",
            "payments_amount_required", "payments_amount_wrong", "amount_two_places", "payments_added", "payments_mark_title", "payments_mark_period",
            "payments_mark_lifetime", "payments_mark_final", "payments_marked", "payments_the_payment", "payments_mark_paid_for", "payments_delete_body",
            "payments_deleted", "packages_hint", "packages_add", "packages_add_submit", "packages_edit_title", "packages_package", "packages_grants",
            "packages_prices", "packages_per_month", "packages_per_year", "packages_for_life", "packages_not_for_life", "packages_unlisted",
            "packages_none", "packages_none_hint", "packages_load_failed", "packages_delete_in_use", "packages_delete_body", "packages_added",
            "packages_saved", "packages_deleted", "packages_reaches", "packages_grants_legend", "packages_core_only_hint", "packages_selling_legend",
            "packages_active", "packages_active_hint", "packages_public", "packages_name_required", "packages_name_taken", "packages_price_required",
            "packages_price_wrong", "packages_lifetime_hint",
        ]
        for (const key of said) {
            expect(en, key).toHaveProperty(key)
            expect(ar, key).toHaveProperty(key)
            expect(ar[key as keyof typeof ar], key).not.toBe(en[key as keyof typeof en])
        }
        for (const key of ["payments_period", "payments_mark_period"]) for (const dict of [en, ar]) {
            expect(dict[key as keyof typeof en], key).toContain("{from}")
            expect(dict[key as keyof typeof en], key).toContain("{to}")
        }
        const gone = [
            "payment_history", "management_for", "add_payment", "loading_payments", "no_payments_found", "no_payments_hint", "subscription_type",
            "dates_column", "quick_actions", "annually", "lifetime", "created_at", "start_date", "end_date", "pending_activation", "status_paid",
            "status_unpaid", "delete_payment_title", "delete_payment_warning_msg", "add_subscription_title", "payment_added_success",
            "payment_marked_paid", "payment_deleted_success", "back_to_companies", "add_package", "edit_package", "no_packages_yet",
            "not_sold_as_lifetime", "companies_on_package", "package_delete_blocked", "package_edit_warning", "bundles", "package_active",
            "package_public", "package_created_success", "package_updated_success", "package_deleted_success",
        ]
        for (const key of gone) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
