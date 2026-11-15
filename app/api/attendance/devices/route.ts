import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { TerminalBrandService } from "@/lib/services/terminal-brand.service"
import { attendanceCompanyFor } from "@/lib/attendance/settings-access"
import { denyTerminals } from "@/lib/attendance/terminals-access"
import { assertStepUp } from "@/lib/step-up"

/**
 * The company's fingerprint terminals, as its agents report them or as they
 * were added (ATTENDANCE_PLAN.md §17), and the brands one may be given: the
 * Super Admin's, not retired (§17.9, PR 280), with their notes for the setup
 * guide's steps (§17.7, PR 282). `directAllowed`: whether the Super Admin
 * has turned terminals straight to Nizmo on for the company (§17.8), and so
 * whether Add a terminal lists that way (PR 292).
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyTerminals(session, companyId)
    if (denied) return denied
    const [devices, brands, directAllowed] = await Promise.all([
        AttendanceDeviceService.list(companyId!), TerminalBrandService.offered(), AttendanceDeviceService.directAllowed(companyId!),
    ])
    return ApiResponse.success({ devices, brands, directAllowed })
})

// The serial number as an agent reports one (lib/attendance/agent-payloads.ts): the same terminal either way.
const schema = z.object({
    companyId: z.string().optional(),
    name: z.string().max(80),
    serialNumber: z.string().max(64),
    brandId: z.string().min(1).max(64),
    mode: z.enum(["ANY", "ENTRANCE", "EXIT"]).optional(),
    connection: z.enum(["AGENT", "DIRECT"]),
})

/**
 * A terminal added by hand (§17.7, PR 292). Set straight to Nizmo, its
 * address is issued and returned once: it lets scans in for any employee
 * number, so it asks for the step-up code (§17.10). Through the agent
 * nothing is issued, and it isn't asked for.
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const { companyId: named, ...input } = validation.data
    const companyId = attendanceCompanyFor(session, named)
    const denied = await denyTerminals(session, companyId)
    if (denied) return denied
    if (input.connection === "DIRECT") await assertStepUp(session, "attendance.manage_terminals")
    return ApiResponse.success(await AttendanceDeviceService.add(companyId!, input, session.user.id), 201)
})
