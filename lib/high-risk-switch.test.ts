import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { asksForCode } from "./step-up"
import { updateCompanySchema } from "./validations/company.schema"
import { updateSystemSettingsSchema } from "./validations/system-settings.schema"
import { settingsTab } from "./company-settings-tabs"
import { maySetField } from "./company-settings-access"
import { KNOWN_REFUSALS } from "./api-errors"
import { switchRefusal } from "@/components/HighRiskSwitch"

/**
 * The switch that turns off the high-risk confirmation (ROLES_PLAN.md §6.15,
 * decided on 2026-11-09): which switch counts, how each is saved, and the
 * switch on System settings and on Company settings. What it does to an
 * action is in high-risk-switch.db.test.ts.
 */

const read = (path: string) => readFileSync(path, "utf8")

describe("which switch counts", () => {
    it("asks someone in a company where both are on", () => {
        expect(asksForCode({ system: true, company: true, superAdmin: false })).toBe(true)
        expect(asksForCode({ system: true, company: false, superAdmin: false })).toBe(false)
        expect(asksForCode({ system: false, company: true, superAdmin: false })).toBe(false)
        expect(asksForCode({ system: false, company: false, superAdmin: false })).toBe(false)
    })

    it("asks a Super Admin as the system's says, whatever the company's", () => {
        expect(asksForCode({ system: true, company: false, superAdmin: true })).toBe(true)
        expect(asksForCode({ system: false, company: true, superAdmin: true })).toBe(false)
    })
})

describe("the switches are saved", () => {
    it("takes either one as on or off, and nothing else", () => {
        for (const on of [true, false]) {
            expect(updateCompanySchema.safeParse({ id: "c1", confirmHighRisk: on }).success).toBe(true)
            expect(updateSystemSettingsSchema.safeParse({ confirmHighRisk: on }).success).toBe(true)
        }
        expect(updateCompanySchema.safeParse({ id: "c1", confirmHighRisk: "no" }).success).toBe(false)
        expect(updateSystemSettingsSchema.safeParse({ confirmHighRisk: 0 }).success).toBe(false)
    })

    it("is a company's General tab setting, for its Admin as well as the Super Admin", () => {
        expect(settingsTab("general")!.fields).toContain("confirmHighRisk")
        expect(maySetField({ role: "ADMIN" } as any, "general", "confirmHighRisk")).toBe(true)
        expect(maySetField({ role: "SUPER_ADMIN" } as any, "general", "confirmHighRisk")).toBe(true)
    })

    it("asks for a code to turn the system's off or on, and logs it", () => {
        const route = read("app/api/system-settings/route.ts")
        expect(route).toContain("if (validation.data.confirmHighRisk !== undefined && validation.data.confirmHighRisk !== before.confirmHighRisk) await assertRecentStepUp(session)")
        // Asked before it's saved.
        expect(route.indexOf("await assertRecentStepUp(session)")).toBeLessThan(route.indexOf("await SystemSettingsService.update("))
        expect(route).toContain("changes.confirmHighRisk = { old: before.confirmHighRisk, new: updated.confirmHighRisk }")
    })

    it("tells a company's settings whether it's off for every company", () => {
        expect(read("app/api/company-settings/route.ts")).toContain("shown.confirmHighRiskForAll = (await SystemSettingsService.get()).confirmHighRisk")
    })

    // The Super Admin's Company settings load the company from /api/companies,
    // not /api/company-settings: without both, a company's switch read On
    // whatever it was, and was offered where it's off for every company
    // (Codex on PR 240).
    it("sends the Super Admin's Company settings the company's switch and the system's", () => {
        const route = read("app/api/companies/route.ts")
        const one = route.slice(route.indexOf("if (id) {"), route.indexOf("const { page, limit }"))
        expect(one).toMatch(/select: \{[^}]*\bconfirmHighRisk: true/)
        expect(one).toContain("confirmHighRiskForAll: (await SystemSettingsService.get()).confirmHighRisk,")
    })
})

describe("the switch on the page", () => {
    const sw = read("components/HighRiskSwitch.tsx")

    it("says whether it's on, with Turn off or Turn on beside it, for whoever may change it", () => {
        expect(sw).toContain("<StatusBadge tone={shownOn ? 'good' : 'neutral'}>{shownOn ? t('high_risk_on') : t('high_risk_off')}</StatusBadge>")
        expect(sw).toContain("{changeable && (on")
        expect(sw).toContain("? <Button size=\"sm\" busy={saving} onClick={() => setAsking(true)}>{t('settings_turn_off')}</Button>")
        expect(sw).toContain(": <Button size=\"sm\" variant=\"primary\" busy={saving} onClick={() => { void turn(true) }}>{t('settings_turn_on')}</Button>")
    })

    it("asks before turning it off, saying what stops being asked, and its button isn't red", () => {
        expect(sw).toContain("title={t('high_risk_off_title')}")
        expect(sw).toContain("body={t(scope === 'all' ? 'high_risk_off_body_all' : 'high_risk_off_body_company')}")
        expect(sw).toContain("confirmLabel={t('settings_turn_off')}")
        expect(sw).toContain("onConfirm={() => turn(false)}")
        expect(sw).not.toMatch(/<ConfirmDialog[^>]*\bdanger\b/)
    })

    it("says nothing more when the code it asks for is turned down: the prompt said what it needed", () => {
        expect(sw).toContain("if (answer === 'quiet') return")
        expect(read("components/HighRiskSwitch.tsx")).toContain("code === 'STEP_UP_REQUIRED' || code === 'MFA_ENROL_REQUIRED'")
    })

    it("is on System settings, in the high-risk confirmation's card, above how long a code lasts", () => {
        const cards = read("components/SystemSettingsCards.tsx")
        expect(cards).toContain("before={<HighRiskSwitch scope=\"all\" on={stored.confirmHighRisk ?? true} save={saveSwitch} />}")
        expect(cards).toContain("{before}")
    })

    it("is on Company settings' General tab, and says when it's off for every company", () => {
        const tabs = read("components/CompanySettingsTabs.tsx")
        expect(tabs).toMatch(/<HighRiskCard\s+companyId=\{companyId\}\s+on=\{company\.confirmHighRisk \?\? true\}\s+offForAll=\{company\.confirmHighRiskForAll === false\}\s+readOnly=\{readOnly\}\s+superAdmin=\{superAdmin\}\s+onSaved=\{onSaved\}/)
        expect(sw).toContain("const changeable = !readOnly && !offForAll")
        expect(sw).toContain("note={offForAll ? <span id={noteId}>{t('high_risk_off_for_all')}")
        const card = read("components/HighRiskCard.tsx")
        expect(card).toContain("body: JSON.stringify({ companyId, tab: 'general', confirmHighRisk: next })")
    })
})

// Decided with the product owner on 2026-11-09 (ROLES_PLAN.md §6.15, PR 242):
// where the system's is off, a company's switch is greyed, with why beside
// it, and the server refuses a change to it, for its Admin and the Super
// Admin alike, before any code is asked.
describe("a company's switch while the system's is off", () => {
    const sw = read("components/HighRiskSwitch.tsx")

    it("stays, greyed: Turn on, aria-disabled, heard with the note as its reason, and clicking it does nothing", () => {
        expect(sw).toContain("const blocked = !readOnly && offForAll")
        expect(sw).toContain(`{blocked && <Button size="sm" variant="primary" aria-disabled="true" aria-describedby={noteId}>{t('settings_turn_on')}</Button>}`)
        // Nothing to click: no handler on it.
        const button = sw.slice(sw.indexOf("{blocked && <Button"), sw.indexOf("</Button>}", sw.indexOf("{blocked && <Button")))
        expect(button).not.toContain("onClick")
        expect(sw).toContain("const shownOn = on && !offForAll")
    })

    it("links the Super Admin to System settings, beside the note", () => {
        expect(sw).toContain(`{systemSettingsLink && <> <Link href="/dashboard/system-settings" className="ui-text-link">{t('system_settings')}</Link></>}`)
        expect(read("components/HighRiskCard.tsx")).toContain("systemSettingsLink={superAdmin}")
    })

    it("is refused by the server before any code is asked, changing nothing", () => {
        expect(KNOWN_REFUSALS.HIGH_RISK_OFF_FOR_ALL).toMatchObject({ status: 409 })
        const service = read("lib/services/company.service.ts")
        const refused = service.indexOf(`throw new Error("HIGH_RISK_OFF_FOR_ALL")`)
        expect(refused).toBeGreaterThan(0)
        expect(refused).toBeLessThan(service.indexOf("await assertRecentStepUp(session)", refused))
    })

    it("says the refusal in the page's language, and greys the card at once", () => {
        expect(switchRefusal({ code: "HIGH_RISK_OFF_FOR_ALL", error: "in English" })).toEqual({ offForAll: true })
        expect(sw).toContain("answer.offForAll ? t('high_risk_off_for_all') : answer.error || t('error_generic')")
        expect(read("components/HighRiskCard.tsx")).toContain("if (typeof refusal === 'object' && refusal.offForAll) onSaved({ confirmHighRiskForAll: false })")
    })

    it("says who turned it off and who can turn it on, in both languages", () => {
        expect(en.high_risk_off_for_all).toBe("Turned off by the Super Admin. Only the Super Admin can turn it on again.")
        expect(ar.high_risk_off_for_all).toBe("أُوقف من قِبل المسؤول العام، ولا يُعاد تشغيله إلا من قِبله.")
        expect(KNOWN_REFUSALS.HIGH_RISK_OFF_FOR_ALL.message).toBe(en.high_risk_off_for_all)
    })
})

describe("its words", () => {
    const keys = ["high_risk_ask_label", "high_risk_all_hint", "high_risk_company_hint", "high_risk_company_note", "high_risk_on", "high_risk_off",
        "high_risk_off_for_all", "high_risk_off_title", "high_risk_off_body_all", "high_risk_off_body_company", "audit_field_confirmHighRisk"] as const

    it("are in both languages", () => {
        for (const key of keys) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })

    it("in Arabic, command no one gender and ask no question", () => {
        const arabic = keys.map(k => ar[k]).join(" ")
        expect(arabic).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|انتظر|اطلب|أوقف|شغّل|هل تريد|هل أنت متأكد)/)
    })

    it("say what's still asked with the system's off: a Super Admin's own actions", () => {
        expect(en.high_risk_all_hint).toContain("deleting a company")
    })
})
