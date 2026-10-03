import { NextResponse } from "next/server"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { RoleService } from "@/lib/services/role.service"
import { buildRoleMatrix } from "@/lib/role-matrix-export"
import { denyUnlessSuperAdmin } from "@/lib/role-errors"

/**
 * A company's roles as an Excel sheet for the contract (ROLES_PLAN.md §6.10).
 * Super Admin only, like the roles themselves. ?companyId=…&locale=en|ar
 */
export const GET = withStandardHandler(async (req, session) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const params = new URL(req.url).searchParams
    const companyId = params.get("companyId")
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const locale = params.get("locale") === "ar" ? "ar" : "en"
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
    if (!company) return ApiResponse.notFound("Company not found")

    const roles = await RoleService.listForCompany(companyId)
    const buffer = await buildRoleMatrix({ companyName: company.name, roles, locale, at: new Date() })
    // An ASCII name for the header; the company's own is inside the sheet.
    const safe = company.name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "company"
    return new NextResponse(buffer as any, {
        status: 200,
        headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="roles_${safe}_${locale}.xlsx"`,
        },
    })
})
