import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

vi.setConfig({ testTimeout: 60_000 })

/**
 * The company's name in English and in Arabic (LATER_CHANGES_PLAN.md §3.1,
 * step 7a, PR 408; DESIGN.md §5.3): in the Super Admin's Add company and
 * Edit company dialog, both needed for a new company and on an edit for a
 * name saved in one language, a business's, 2 to 50 characters each, as the
 * name has until now. The server asks the same. Only the Super Admin changes
 * a company's name, as the owner chose on 2026-11-24, so an Admin's Company
 * settings only says when it's in one language, and that Nizmo's team adds
 * the other.
 */

const state = { session: null as any, existing: null as any, written: [] as Record<string, unknown>[], companies: [] as any[] }
const model = (name: string) => new Proxy({}, {
    get: (_t, method: string) => async (args?: any) => {
        if (method === "findUnique" || method === "findUniqueOrThrow" || method === "findFirst") return state.existing
        if (method === "update") { state.written.push(args?.data ?? {}); return { ...state.existing, ...(args?.data ?? {}) } }
        if (method === "findMany") return name === "company" ? state.companies : []
        if (method === "count") return 0
        return {}
    },
})
const prismaMock: any = new Proxy({}, {
    get: (_t, prop: string) => {
        if (prop === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(prismaMock) : Promise.all(fn))
        if (prop === "$queryRaw" || prop === "$executeRaw") return async () => []
        return model(prop)
    },
})
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/name-spelling.service", () => ({ learnSpellings: async () => {} }))

beforeEach(() => {
    state.session = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } }
    state.existing = { id: "c1", name: "Nile Works", nameAr: null, usernameCode: "nw", usernameNext: 0, costNamesFromListOnly: false, confirmHighRisk: true }
    state.written = []
    state.companies = []
})

const t = (key: string) => (en as Record<string, string>)[key] ?? key
const tAr = (key: string) => (ar as Record<string, string>)[key] ?? key

describe("the company's name, checked before it's sent", () => {
    it("is 2 to 50 characters in each language, as it has been until now", async () => {
        const { COMPANY_NAME_MIN, COMPANY_NAME_MAX } = await import("@/lib/company-name")
        expect([COMPANY_NAME_MIN, COMPANY_NAME_MAX]).toEqual([2, 50])
    })

    it("needs both languages, each in its own letters, and offers the suggestion for one left empty", async () => {
        const { companyNameErrors } = await import("@/lib/company-name")
        expect(companyNameErrors({ en: "El Nil Accounting", ar: "مكتب النيل للمحاسبة" })).toEqual({})
        expect(companyNameErrors({ en: "", ar: "" })).toEqual({ name: "name_required_en", nameAr: "name_required_ar" })
        expect(companyNameErrors({ en: "El Nil", ar: " " })).toEqual({ nameAr: "name_use_suggestion_ar" })
        expect(companyNameErrors({ en: "النيل", ar: "النيل" })).toEqual({ name: "name_not_english" })
        expect(companyNameErrors({ en: "El Nil", ar: "El Nil" })).toEqual({ nameAr: "name_not_arabic" })
    })

    it("takes each from 2 characters to 50", async () => {
        const { companyNameErrors } = await import("@/lib/company-name")
        expect(companyNameErrors({ en: "N", ar: "ن" })).toEqual({ name: "companies_name_short", nameAr: "companies_name_short" })
        expect(companyNameErrors({ en: "Nk", ar: "نك" })).toEqual({})
        expect(companyNameErrors({ en: "N".repeat(50), ar: "ن".repeat(50) })).toEqual({})
        expect(companyNameErrors({ en: "N".repeat(51), ar: "ن".repeat(51) })).toEqual({ name: "name_too_long", nameAr: "name_too_long" })
    })

    it("says what's wrong naming the company name, its limit in the reader's digits", async () => {
        const { companyMistakeText } = await import("@/lib/company-name")
        expect(companyMistakeText(t, "en", "name_use_suggestion_ar")).toBe("Enter the company name in Arabic, or use the suggestion.")
        expect(companyMistakeText(tAr, "ar", "name_too_long")).toBe("يُرجى اختصار اسم الشركة إلى ٥٠ حرفاً.")
        expect(companyMistakeText(t, "en", "companies_name_short")).toBe(en.companies_name_short)
    })

    it("says the server's refusal of a name under its field", async () => {
        const { companyRefusedField } = await import("@/lib/company-name")
        const said = (field: string, why: string) => ({ error: "Validation Error", details: { [field]: { _errors: [why] } } })
        expect(companyRefusedField(said("nameAr", "Needed in Arabic"))).toEqual({ field: "nameAr", key: "name_required_ar" })
        expect(companyRefusedField(said("name", "Written in English letters"))).toEqual({ field: "name", key: "name_not_english" })
        expect(companyRefusedField(said("nameAr", "Too short"))).toEqual({ field: "nameAr", key: "companies_name_short" })
        expect(companyRefusedField(said("name", "Too long"))).toEqual({ field: "name", key: "name_too_long" })
        // A name another company has, in either language.
        expect(companyRefusedField({ error: "Company name in Arabic already exists" })).toEqual({ field: "nameAr", key: "companies_name_taken" })
        expect(companyRefusedField({ error: "Company already exists" })).toEqual({ field: "name", key: "companies_name_taken" })
        expect(companyRefusedField({ error: "Username code taken" })).toBeNull()
        expect(companyRefusedField(null)).toBeNull()
    })

    it("asks an edited company's name saved in one language for the other, at the top of the dialog", async () => {
        const { companyMissingNote } = await import("@/lib/company-name")
        expect(companyMissingNote({ name: "El Nil", nameAr: "النيل" })).toBeNull()
        expect(companyMissingNote({ name: "El Nil", nameAr: null })).toBe("name_missing_ar_note")
        expect(companyMissingNote({ name: "مكتب النيل", nameAr: "مكتب النيل" })).toBe("name_missing_en_note")
    })
})

describe("what the server takes", () => {
    const company = { name: "El Nil Accounting", nameAr: "مكتب النيل للمحاسبة" }

    it("adds a company only with its name in both languages, each in its own letters, 2 to 50 characters", async () => {
        const { createCompanySchema } = await import("@/lib/validations/company.schema")
        const refused = (body: Record<string, unknown>) => {
            const r = createCompanySchema.safeParse(body)
            return r.success ? null : Object.fromEntries(Object.entries(r.error.format()).filter(([k]) => k !== "_errors").map(([k, v]: [string, any]) => [k, v._errors[0]]))
        }
        expect(refused(company)).toBeNull()
        expect(createCompanySchema.parse({ ...company, name: "  El Nil  " }).name).toBe("El Nil")
        expect(refused({ name: "El Nil" })).toEqual({ nameAr: "Needed in Arabic" })
        expect(refused({ ...company, name: "مكتب" })).toEqual({ name: "Written in English letters" })
        expect(refused({ ...company, nameAr: "Nil" })).toEqual({ nameAr: "Written in Arabic letters" })
        expect(refused({ ...company, name: "N" })).toEqual({ name: "Too short" })
        expect(refused({ ...company, nameAr: "ن".repeat(51) })).toEqual({ nameAr: "Too long" })
    })

    it("edits one's Arabic in Arabic letters, 2 to 50 characters, and its English in English letters", async () => {
        const { updateCompanySchema } = await import("@/lib/validations/company.schema")
        expect(updateCompanySchema.safeParse({ id: "c1", nameAr: "مكتب النيل" }).success).toBe(true)
        expect(updateCompanySchema.safeParse({ id: "c1", nameAr: "Nil" }).success).toBe(false)
        expect(updateCompanySchema.safeParse({ id: "c1", nameAr: "ن" }).success).toBe(false)
        expect(updateCompanySchema.safeParse({ id: "c1", name: "مكتب" }).success).toBe(false)
        expect(updateCompanySchema.safeParse({ id: "c1", name: "N".repeat(51) }).success).toBe(false)
    })

    const put = async (body: Record<string, unknown>) => (await import("@/app/api/companies/route")).PUT(
        new Request("https://nizmo.test/api/companies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: {} } as any)

    it("doesn't take an edited name's English without its Arabic, sent or kept, and says which field", async () => {
        const res = await put({ id: "c1", name: "Nile Works" })
        expect(res.status).toBe(400)
        expect((await res.json()).details).toEqual({ nameAr: { _errors: ["Needed in Arabic"] } })
        expect(state.written).toEqual([])
    })

    it("takes it with its Arabic sent, or kept, and takes its Arabic alone", async () => {
        expect((await put({ id: "c1", name: "Nile Works", nameAr: "أعمال النيل" })).status).toBe(200)
        expect(state.written.at(-1)).toMatchObject({ name: "Nile Works", nameAr: "أعمال النيل" })
        state.existing = { ...state.existing, nameAr: "أعمال النيل" }
        expect((await put({ id: "c1", name: "Nile Work" })).status).toBe(200)
        state.existing = { ...state.existing, nameAr: null }
        expect((await put({ id: "c1", nameAr: "أعمال النيل" })).status).toBe(200)
    })

    it("lists each company with its name in Arabic, for the Edit dialog", async () => {
        state.companies = [{
            id: "c1", name: "Nile Works", nameAr: "أعمال النيل", usernameCode: "nw", usernameNext: 0, isBanned: false, createdAt: new Date(),
            trialPreset: "FOURTEEN_DAYS", trialExtensionDays: 0, package: null, payments: [], _count: { payments: 0 },
        }]
        const { CompanyService } = await import("@/lib/services/company.service")
        const listed = await CompanyService.listWithSubscription({ filter: "all" })
        expect(listed.data[0]).toMatchObject({ name: "Nile Works", nameAr: "أعمال النيل" })
    })

    it("says a name another company has in Arabic is its Arabic that's taken", () => {
        const route = readFileSync("app/api/companies/route.ts", "utf8")
        expect(route.split('arabicTaken(error) ? "Company name in Arabic already exists"')).toHaveLength(3)
    })
})

describe("the Super Admin's company dialog", () => {
    const dialog = readFileSync("components/CompanyDialogs.tsx", "utf8")

    it("asks the name in English and in Arabic, a business's, up to 50 characters", () => {
        expect(dialog).toContain(`<NameFields label={t('companies_name_label')} name="name" kind="business" max={COMPANY_NAME_MAX}`)
        expect(dialog).not.toMatch(/<TextInput \{\.\.\.p\} name="name"/)
    })

    it("edits it as it's kept, with the note at the top while it's in one language, and the company's spellings", () => {
        expect(dialog).toContain("useState<TwoNames>(() => (company ? savedName(company.name, company.nameAr) : { en: '', ar: '' }))")
        expect(dialog).toContain("{note && <FormNote>{t(note)}</FormNote>}")
        expect(dialog).toContain("companyId={company?.id ?? null}")
    })

    it("checks both before sending, says what's wrong under each, and sends both", () => {
        expect(dialog).toContain("const found = companyNameErrors(names)")
        expect(dialog).toContain("errors={{ en: said('name'), ar: said('nameAr') }}")
        expect(dialog).toContain("{ id: company.id, name: fields.name, nameAr: fields.nameAr, usernameCode: changedCode }")
        expect(dialog).toContain("{ name: fields.name, nameAr: fields.nameAr, trialPreset: fields.trial,")
        expect(dialog).toContain("const named = companyRefusedField(body)")
    })

    it("suggests the username code from the English", () => {
        expect(dialog).toContain("setAskFor(suggestionUrl(names.en, company?.id ?? null))")
    })
})

describe("an Admin's Company settings", () => {
    const page = readFileSync("app/(dashboard)/dashboard/settings/page.tsx", "utf8")
    const route = readFileSync("app/api/company-settings/route.ts", "utf8")

    it("says above its tabs when the company's name is in one language only, and that Nizmo's team adds the other", () => {
        expect(page).toContain("{missingLanguages([{ en: company.name, ar: company.nameAr }]).length > 0 && (")
        expect(page).toContain("<ListNote icon={TranslateIcon} title={t('company_name_missing_title')}>{t('company_name_missing_body')}</ListNote>")
        expect(page.indexOf("<ListNote")).toBeLessThan(page.indexOf("<CompanySettingsTabs"))
        expect(route).toContain("id: true, name: true, nameAr: true,")
        expect(route).toContain("{ id: company.id, name: company.name, nameAr: company.nameAr }")
    })

    it("says so in both languages, never as 'we'", () => {
        expect(en.company_name_missing_title).toBe("Your company's name is in one language only")
        expect(en.company_name_missing_body).toBe("Names are now kept in English and in Arabic. Nizmo's team adds its other language. Until then, it's shown in the language it has.")
        expect(ar.company_name_missing_title).toBe("اسم شركتك مكتوب بلغة واحدة فقط")
        expect(ar.company_name_missing_body).toBe("أصبحت الأسماء تُحفظ بالإنجليزية وبالعربية. يُضيف فريق Nizmo لغته الأخرى، ويُعرض حتى ذلك الحين باللغة المكتوب بها.")
    })
})
