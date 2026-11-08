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
            { label: "New status", value: "In progress" },
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

    // They were two whole maps in JSON, {"tasks":"Jobs"} → {"tasks":"Work
    // orders"} (PR 233): one line for each section that changed, named as the
    // section is by default, its name as typed and its icon by its name.
    it("reads a company's section names and icons one section at a time", () => {
        const details = {
            moduleLabels: { old: { tasks: "Jobs", records: "Files" }, new: { tasks: "Work orders", records: "Files", clients: "Customers" } },
            moduleIcons: { old: {}, new: { tasks: "hard-hat" } },
        }
        expect(describeDetails(details, EN)).toEqual([
            { label: "Name for Tasks", value: "Jobs → Work orders" },
            { label: "Name for Clients", value: "Default → Customers" },
            { label: "Icon for Tasks", value: "Default → Hard hat" },
        ])
        expect(describeDetails(details, AR)).toEqual([
            { label: `اسم قسم ${ar.tasks}`, value: "Jobs ← Work orders" },
            { label: `اسم قسم ${ar.clients}`, value: "الافتراضي ← Customers" },
            { label: `أيقونة قسم ${ar.tasks}`, value: `الافتراضي ← ${ar.icon_name_hard_hat}` },
        ])
    })

    it("reads a section given back its default, one it no longer has, and an icon from before the palette", () => {
        expect(describeDetails({ moduleLabels: { old: { tasks: "Jobs" }, new: {} } }, EN)).toEqual([{ label: "Name for Tasks", value: "Jobs → Default" }])
        expect(describeDetails({ moduleLabels: { old: { vendors: "Suppliers" }, new: {} } }, EN)).toEqual([{ label: "Name for Vendors", value: "Suppliers → Default" }])
        expect(describeDetails({ moduleIcons: { old: { tasks: "🔧" }, new: { tasks: "wrench" } } }, EN)).toEqual([{ label: "Icon for Tasks", value: "🔧 → Wrench" }])
        expect(describeDetails({ moduleIcons: { old: null, new: { tasks: "wrench" } } }, EN)).toEqual([{ label: "Icon for Tasks", value: "Default → Wrench" }])
    })

    it("says nothing when there is nothing", () => {
        expect(describeDetails(null, EN)).toEqual([])
        expect(describeDetails({ note: null, skipped: [] }, EN)).toEqual([{ label: "Note", value: "None" }, { label: "Skipped", value: "None" }])
    })
})
