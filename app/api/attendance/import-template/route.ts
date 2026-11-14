import { NextResponse } from "next/server"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { punchCompany, correctsCompany } from "@/lib/attendance/punch-access"
import { punchTemplate, PUNCH_TEMPLATE_TYPE } from "@/lib/attendance/punch-template"

/**
 * The import's template (ATTENDANCE_PLAN.md §13.9, PR 272), for the same
 * people as the import: ?locale=en|ar, and companyId for the Super Admin.
 * It holds no company data; the company is checked only so that whoever
 * can't import can't download it either.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    const access = await punchCompany(session, params.get("companyId"))
    if ("denied" in access) return access.denied
    if (!correctsCompany(session, access.companyId)) return ApiResponse.forbidden()
    // Anything but Arabic is English, so the file's name is never built from the address.
    const locale = params.get("locale") === "ar" ? "ar" : "en"
    return new NextResponse(new Uint8Array(await punchTemplate(locale)), {
        status: 200,
        headers: {
            "Content-Type": PUNCH_TEMPLATE_TYPE,
            "Content-Disposition": `attachment; filename="punches-template-${locale}.xlsx"`,
            "Cache-Control": "private, no-store",
        },
    })
})
