import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { visibleSettingsTabs } from "@/lib/company-settings-access"
import { cashAdvancesInUse } from "@/lib/cash-advances"
import { OwnerService } from "@/lib/services/owner.service"

/**
 * Whether the signed-in person's menu offers their company's settings: the
 * same question the dashboard layout answers on the first paint, asked again
 * as they move around, so the Super Admin's switch reaches an open dashboard
 * (ATTENDANCE_PLAN.md §5.2). And, read with it, whether the company uses cash
 * advances, for My cash advance in the side bar (CLIENTS_PLAN.md §7.5), and
 * whether they're an owner now, for My attendance (LATER_CHANGES_PLAN.md
 * §7.3, PR 428).
 */
export const GET = withStandardHandler(async (_req, session) => {
    const companyId = session.user.role === "SUPER_ADMIN" ? null : session.user.companyId
    const exposure = companyId ? await CompanyService.settingsExposure(companyId) : null
    return ApiResponse.success({
        visible: !!exposure && visibleSettingsTabs(session.user, exposure).length > 0,
        cashAdvances: cashAdvancesInUse(exposure),
        owner: !!companyId && !!(await OwnerService.of(session.user.id)),
    })
})
