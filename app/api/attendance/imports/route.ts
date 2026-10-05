import { readForm, withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, correctsCompany } from "@/lib/attendance/punch-access"
import { kindOf, readRows, sha256, MAX_FILE_BYTES } from "@/lib/attendance/punch-file"
import { columnMapSchema } from "@/lib/validations/attendance-punch.schema"

/** The company's imports, newest first. */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    if (!correctsCompany(session, access.companyId)) return ApiResponse.forbidden()
    return ApiResponse.success({ imports: await AttendancePunchService.imports(access.companyId) })
})

/**
 * A spreadsheet of punches, as a form upload: `file`, and optionally
 * `dateOrder` (DMY or MDY), `columns` (JSON, to override what was detected)
 * and `commit`. Without `commit` it only reports what importing would do.
 */
export const POST = withStandardHandler(async (req, session) => {
    const form = await readForm(req)
    if (!form) return ApiResponse.badRequest("Send the file as a form upload.")
    const access = await punchCompany(session, form.get("companyId"))
    if ("denied" in access) return access.denied
    if (!correctsCompany(session, access.companyId)) return ApiResponse.forbidden()

    const file = form.get("file")
    if (!(file instanceof File)) return ApiResponse.badRequest("No file provided")
    const kind = kindOf(file.name)
    if (!kind) return ApiResponse.badRequest("Upload an .xlsx or .csv file.")
    if (file.size > MAX_FILE_BYTES) return ApiResponse.badRequest("The file is larger than 5 MB. Split it by month.")
    const dateOrder = form.get("dateOrder") === "MDY" ? "MDY" : "DMY"
    let columns = null
    const columnsField = form.get("columns")
    if (typeof columnsField === "string" && columnsField) {
        let raw: unknown
        try { raw = JSON.parse(columnsField) } catch { return ApiResponse.badRequest("columns must be JSON") }
        const parsed = columnMapSchema.safeParse(raw)
        if (!parsed.success) return ApiResponse.badRequest("Validation Error", parsed.error.format())
        columns = parsed.data
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    let rows
    try {
        rows = await readRows(kind, bytes)
    } catch {
        return ApiResponse.badRequest("That file couldn't be read. Save it again as .xlsx or .csv.")
    }
    const report = await AttendancePunchService.importRows(
        access.companyId,
        { name: file.name, hash: sha256(bytes), rows },
        { dateOrder, columns },
        session.user.id,
        form.get("commit") === "true",
    )
    return ApiResponse.success(report, report.importId ? 201 : 200)
})
