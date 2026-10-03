import { z } from "zod"
import type { NextResponse } from "next/server"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"

async function deviceFor(session: any, id: string): Promise<{ denied: NextResponse } | { device: { id: string; companyId: string } }> {
    const device = await AttendanceDeviceService.deviceOf(id)
    if (!device) return { denied: ApiResponse.notFound("Terminal not found") }
    const denied = await denyTerminals(session, device.companyId, "edit")
    return denied ? { denied } : { device }
}

const schema = z.object({ name: z.string().max(80).optional(), mode: z.enum(["ANY", "ENTRANCE", "EXIT"]).optional() })

/** Renamed, or marked entrance-only or exit-only (§17): for scans from now on. */
export const PATCH = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await deviceFor(session, params.id)
    if ("denied" in found) return found.denied
    return ApiResponse.success(await AttendanceDeviceService.update(found.device.id, validation.data, session.user.id))
})

/** Retired: no longer in use here. Its punches stay. */
export const DELETE = withStandardHandler(async (_req, session, _json, { params }) => {
    const found = await deviceFor(session, params.id)
    if ("denied" in found) return found.denied
    await AttendanceDeviceService.retire(found.device.id, session.user.id)
    return ApiResponse.success({ retired: true })
})
