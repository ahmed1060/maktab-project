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

type TemplateClient = {
    name: string
    locationName: string
}

/** A location a task can be done at, by its name in the list (CLIENTS_PLAN.md §2.7), each name once. */
type TemplateLocation = {
    id: string
    label: string
    client: string | null
}

// Bulk-upload template rows start at 3 (rows 1-2 are the base file's own
// headers/instructions) and are capped at 50 — same limit the bulk-upload
// parser itself enforces (tasks/new/page.tsx).
const FIRST_DATA_ROW = 3
const LAST_DATA_ROW = 52

/**
 * Turns the Super-Admin-uploaded base file into the actual downloadable
 * template: adds a "Users" sheet (backing the Employee Name column's
 * dropdown), a "Clients" sheet (backing the Client Name column's dropdown)
 * and a "Locations" sheet (backing the Location column's), then wires the
 * main sheet's Client Name (C), Employee Name (D) and Location (H) columns
 * to them.
 *
 * The base file is the layout/branding — this never touches its existing
 * rows/columns, only adds the reference sheets, the validations, and the
 * Location column after its own. Its own column order needs to match what
 * the parser reads (tasks/new/page.tsx's handleBulkUpload): Title,
 * Description, Client Name, Employee Name, Deadline Date, Deadline Time,
 * Difficulty; then Location, added here.
 */
export async function generateBulkTaskTemplate(baseBuffer: Buffer, locale: Locale, users: TemplateUser[], clients: TemplateClient[], locations: TemplateLocation[] = []): Promise<Buffer> {
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

    // "Clients" sheet — deliberately just Name + Location, nothing else
    // (owner/mobile live on the Clients page itself, not needed here).
    const clientsSheet = workbook.addWorksheet(isAr ? 'الموردين' : 'Clients', isAr ? { views: [{ rightToLeft: true }] } : undefined)
    clientsSheet.columns = [
        { header: isAr ? 'الاسم' : 'Name', key: 'name', width: 30 },
        { header: isAr ? 'الموقع' : 'Location', key: 'location', width: 35 },
    ]
    clients.forEach(v => {
        clientsSheet.addRow({ name: v.name, location: v.locationName })
    })

    // "Locations" sheet (CLIENTS_PLAN.md §2.7): each name once, and in a
    // hidden column the location it names, which the upload finds the
    // location by, never by matching the name. Only those a task can use:
    // in use, with their pin.
    const locationsSheet = workbook.addWorksheet(isAr ? 'المواقع' : 'Locations', isAr ? { views: [{ rightToLeft: true }] } : undefined)
    locationsSheet.columns = [
        { header: isAr ? 'الاسم' : 'Name', key: 'label', width: 40 },
        { header: isAr ? 'العميل' : 'Client', key: 'client', width: 30 },
        { header: 'Id', key: 'id', width: 38 },
    ]
    locations.forEach(l => locationsSheet.addRow({ label: l.label, client: l.client ?? t('locations_shared'), id: l.id }))
    locationsSheet.getColumn(3).hidden = true

    // The main sheet's Location column, after the base file's own: its
    // heading, and its instruction where the base file has a row of them,
    // each styled as the column before it. A cell the base file fills
    // itself is left as it is.
    for (const row of [1, 2]) {
        const cell = mainSheet.getCell(`H${row}`)
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') continue
        if (row === 2 && mainSheet.getRow(2).actualCellCount === 0) continue
        cell.value = row === 1 ? t('task_location') : t('bulk_location_hint')
        cell.style = { ...mainSheet.getCell(`G${row}`).style }
    }
    if (!mainSheet.getColumn(8).width) mainSheet.getColumn(8).width = 40

    // Wire the main sheet's columns to the reference sheets. Ranges are
    // sized to the actual row counts (not a fixed guess) — an empty sheet
    // still gets a (harmless, unused) 1-row range rather than a 0-row one,
    // which some spreadsheet apps reject.
    const usersLastRow = Math.max(users.length + 1, 2)
    const clientsLastRow = Math.max(clients.length + 1, 2)

    // By the sheets' actual names, not "Users"/"Clients" written out: an
    // Arabic download names them المستخدمين and الموردين, and a formula
    // pointing at a sheet that does not exist leaves every dropdown in the
    // file empty. Quoted, as a name that is not plain ASCII must be.
    const clientsRange = `${sheetRef(clientsSheet.name)}!$A$2:$A$${clientsLastRow}`
    const usersRange = `${sheetRef(usersSheet.name)}!$A$2:$A$${usersLastRow}`
    const locationsRange = `${sheetRef(locationsSheet.name)}!$A$2:$A$${Math.max(locations.length + 1, 2)}`

    for (let row = FIRST_DATA_ROW; row <= LAST_DATA_ROW; row++) {
        // Column C: Client Name dropdown, sourced from Clients!A. Optional —
        // an empty cell just means no client for that row.
        mainSheet.getCell(`C${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [clientsRange]
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
        // Column H: Location, from Locations!A. Left empty, the row takes
        // its client's HQ, as picking a client does on the task form.
        mainSheet.getCell(`H${row}`).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [locationsRange]
        }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    return Buffer.from(buffer)
}

/** A sheet name as a formula reference: quoted, with any quote inside doubled. */
function sheetRef(name: string): string {
    return `'${name.replace(/'/g, "''")}'`
}
