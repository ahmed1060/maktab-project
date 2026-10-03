import { describe, it, expect } from "vitest"
import { describeDetails, humanize } from "./audit-details"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import type { TranslationKey } from "./translations"

const reader = (dict: Record<string, string>, locale: string) => ({ t: (k: TranslationKey) => dict[k] ?? "", locale })
const EN = reader(en as Record<string, string>, "en")
const AR = reader(ar as Record<string, string>, "ar")

describe("an audit entry's details, as the reader reads them", () => {
    it("names each field and labels coded values, in either language", () => {
        const details = { oldStatus: "PENDING", newStatus: "IN_PROGRESS" }
        expect(describeDetails(details, EN)).toEqual([
            { label: "Old status", value: "Pending" },
            { label: "New status", value: "In Progress" },
        ])
        expect(describeDetails(details, AR)).toEqual([
            { label: "الحالة السابقة", value: "معلق" },
            { label: "الحالة الجديدة", value: "قيد التنفيذ" },
        ])
    })

    it("reads a change as before and after, the arrow pointing the way the language reads", () => {
        expect(describeDetails({ status: { old: "ACTIVE", new: "SUSPENDED" } }, EN)).toEqual([{ label: "Status", value: "Active → Suspended" }])
        expect(describeDetails({ hasHR: { from: false, to: true } }, AR)).toEqual([{ label: "الموارد البشرية", value: "لا ← نعم" }])
    })

    it("shows what somebody typed as typed, and a hidden secret as hidden", () => {
        expect(describeDetails({ reason: "Audit week", title: "Q3 REPORT draft", password: "[REDACTED]" }, AR)).toEqual([
            { label: "السبب", value: "Audit week" },
            { label: "العنوان", value: "Q3 REPORT draft" },
            { label: "كلمة المرور", value: "مخفي" },
        ])
    })

    it("names permissions as the permission matrix does, with their scope", () => {
        const [line] = describeDetails({ after: { name: "HR Officer", baseRole: "EMPLOYEE", grants: [{ permission: "dayoff.approve", scope: "COMPANY" }] } }, EN)
        expect(line).toEqual({
            label: "After",
            lines: [
                { label: "Name", value: "HR Officer" },
                { label: "Kind of role", value: "Employee" },
                { label: "Permissions", value: "Approve leave (Whole company)" },
            ],
        })
        const salaryEdit = (ar as Record<string, string>).perm_salary_edit
        expect(salaryEdit).toBeTruthy()
        expect(describeDetails({ permission: "salary.edit" }, AR)).toEqual([{ label: "الصلاحية", value: salaryEdit }])
    })

    it("names separation-of-duties pairs by what they mean", () => {
        const [line] = describeDetails({ separationOfDuties: { pairs: ["prepare_approve_payroll"], acknowledged: true } }, EN)
        expect(line.lines![0].value).toMatch(/^Preparing and approving payroll/)
        expect(line.lines![1]).toEqual({ label: "Acknowledged", value: "Yes" })
    })

    it("shows dates in the reader's format, a date stored as midnight UTC as the date it is", () => {
        const day = new Date("2026-10-04").toLocaleDateString("en", { timeZone: "UTC" })
        expect(describeDetails({ date: "2026-10-04" }, EN)).toEqual([{ label: "Date", value: day }])
        expect(describeDetails({ date: "2026-10-04T00:00:00.000Z" }, EN)).toEqual([{ label: "Date", value: day }])
        expect(describeDetails({ paidAt: "2026-10-04T13:45:00.000Z" }, EN)[0].value).toBe(new Date("2026-10-04T13:45:00.000Z").toLocaleString("en"))
    })

    it("says which fields hold an id", () => {
        expect(describeDetails({ role: "EMPLOYEE", roleId: "r-1" }, EN)).toEqual([{ label: "Role", value: "Employee" }, { label: "Role ID", value: "r-1" }])
    })

    it("keeps what it has no label for readable, never hidden", () => {
        expect(describeDetails({ someNewField: "SOME_NEW_CODE" }, EN)).toEqual([{ label: "Some new field", value: "SOME_NEW_CODE" }])
        expect(humanize("locationVerifyRadiusMeters")).toBe("Location verify radius meters")
    })

    it("lists items of a list of records one by one", () => {
        const [line] = describeDetails({ changes: [{ type: "SICK" }, { type: "CASUAL" }] }, AR)
        expect(line).toEqual({ label: "التغييرات", lines: [
            { label: "1", lines: [{ label: "النوع", value: "مرضية" }] },
            { label: "2", lines: [{ label: "النوع", value: "عارضة" }] },
        ] })
    })

    it("says nothing when there is nothing", () => {
        expect(describeDetails(null, EN)).toEqual([])
        expect(describeDetails({ note: null, skipped: [] }, EN)).toEqual([{ label: "Note", value: "None" }, { label: "Skipped", value: "None" }])
    })
})
