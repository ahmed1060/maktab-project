import { Workbook } from "exceljs"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import type { Locale, TranslationKey } from "@/lib/translations"

type TemplateUser = {
    firstName: string
    lastName: string
    username: string
    role: string
}

type TemplateVendor = {
    name: string
    locationName: string
}

// Bulk-upload template rows start at 3 (rows 1-2 are the base file's own
// headers/instructions) and are capped at 50 — same limit the bulk-upload
// parser itself enforces (tasks/new/page.tsx).
const FIRST_DATA_ROW = 3
const LAST_DATA_ROW = 52

/**
 * Turns the Super-Admin-uploaded base file into the actual downloadable
 * template: adds a "Users" sheet (backing the Employee Name column's
 * dropdown) and a "Vendors" sheet (backing the Vendor Name column's
 * dropdown), then wires the main sheet's Vendor Name (C) and Employee Name
 * (D) columns to them.
 *
 * The base file is the layout/branding — this never touches its existing
 * rows/columns, only adds the two reference sheets and the validations.
 * Its own column order needs to match what the parser reads (tasks/new/
 * page.tsx's handleBulkUpload): Title, Description, Vendor Name, Employee
 * Name, Deadline Date, Deadline Time, Difficulty.
 */
export async function generateBulkTaskTemplate(baseBuffer: Buffer, locale: Locale, users: TemplateUser[], vendors: TemplateVendor[]): Promise<Buffer> {
    const dict = locale === 'ar' ? ar : en
    const t = (key: TranslationKey) => dict[key] || en[key]
    const isAr = locale === 'ar'

    const workbook = new Workbook()
    await workbook.xlsx.load(baseBuffer as any)

    const mainSheet = workbook.worksheets[0]
    if (!mainSheet) throw new Error("TEMPLATE_BASE_EMPTY")

    // "Users" sheet — column A is deliberately "FirstName LastName
    // (username)", not a bare name: two employees can share a full name,
    // but username is unique (schema constraint), so embedding it in the
    // dropdown's own display text is what keeps the lookup unambiguous.
    // See the VLOOKUP wiring below, which searches this same column.
    const usersSheet = workbook.addWorksheet(isAr ? 'المستخدمين' : 'Users', isAr ? { views: [{ rightToLeft: true }] } : undefined)
    usersSheet.columns = [
        { header: isAr ? 'الاسم' : 'Name', key: 'display', width: 32 },
        { header: isAr ? 'الدور' : 'Role', key: 'role', width: 18 },
        { header: isAr ? 'اسم المستخدم' : 'Username', key: 'username', width: 20 },
    ]
    users.forEach(u => {
        usersSheet.addRow({
            display: `${u.firstName} ${u.lastName} (${u.username})`,
            role: t(`role_${u.role.toLowerCase()}` as TranslationKey) || u.role,
            username: u.username
        })
    })

    // "Vendors" sheet — deliberately just Name + Location, nothing else
    // (owner/mobile live on the Vendors page itself, not needed here).
    const vendorsSheet = workbook.addWorksheet(isAr ? 'الموردين' : 'Vendors', isAr ? { views: [{ rightToLeft: true }] } : undefined)
    vendorsSheet.columns = [
        { header: isAr ? 'الاسم' : 'Name', key: 'name', width: 30 },
        { header: isAr ? 'الموقع' : 'Location', key: 'location', width: 35 },
    ]
    vendors.forEach(v => {
        vendorsSheet.addRow({ name: v.name, location: v.locationName })
    })

    // Wire the main sheet's columns to both reference sheets. Ranges are
    // sized to the actual row counts (not a fixed guess) — an empty sheet
    // still gets a (harmless, unused) 1-row range rather than a 0-row one,
    // which some spreadsheet apps reject.
    const usersLastRow = Math.max(users.length + 1, 2)
    const vendorsLastRow = Math.max(vendors.length + 1, 2)

    // By the sheets' actual names, not "Users"/"Vendors" written out: an
    // Arabic download names them المستخدمين and الموردين, and a formula
    // pointing at a sheet that does not exist leaves every dropdown in the
    // file empty. Quoted, as a name that is not plain ASCII must be.
    const vendorsRange = `${sheetRef(vendorsSheet.name)}!$A$2:$A$${vendorsLastRow}`
    const usersRange = `${sheetRef(usersSheet.name)}!$A$2:$A$${usersLastRow}`

    for (let row = FIRST_DATA_ROW; row <= LAST_DATA_ROW; row++) {
        // Column C: Vendor Name dropdown, sourced from Vendors!A. Optional —
        // an empty cell just means no vendor for that row.
        mainSheet.getCell(`C${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [vendorsRange]
        }
        // Column D: Employee Name — one merged column for both cases, not
        // two. A dropdown (sourced from Users!A, "FirstName LastName
        // (username)") for the common single-assignee case; for a
        // multi-assignee task, type the usernames directly, comma-separated,
        // which the dropdown's list validation doesn't block (it warns on a
        // value outside the list but never rejects the keystroke — Excel
        // only hard-blocks free typing when a validation explicitly sets a
        // "Stop" error style, which this doesn't). The parser (tasks/new/
        // page.tsx) accepts both forms in the same cell: a trailing
        // "(username)" is extracted from a dropdown pick, anything else is
        // taken as a literal username.
        mainSheet.getCell(`D${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [usersRange]
        }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
}

/** A sheet name as a formula reference: quoted, with any quote inside doubled. */
function sheetRef(name: string): string {
    return `'${name.replace(/'/g, "''")}'`
}
