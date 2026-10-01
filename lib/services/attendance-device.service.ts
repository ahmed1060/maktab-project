import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { offsetMsIn } from "@/lib/time"
import type { AuthenticatedAgent } from "./attendance-agent.service"
import type { Heartbeat } from "@/lib/attendance/agent-payloads"

/**
 * Fingerprint terminals (ATTENDANCE_PLAN.md §17), as the agents report them.
 *
 * An agent's heartbeat says what it is (version, what it still holds, its
 * clock) and which terminals it reads, each with its own clock and how full
 * its memory is. A terminal is brought in the first time an agent of the
 * company reports it, and is in use by one company at a time; one retired
 * here is ignored until it is restored. Nothing an agent sends names a
 * company: it is the agent's.
 */

function fail(code: string): never {
    throw new Error(code)
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

/** An agent asked to rotate its token once it is this old. */
export const TOKEN_ROTATE_DAYS = 30

export type DeviceState = "ACTIVE" | "RETIRED" | "CLAIMED_ELSEWHERE"

/** Seconds a wall clock reading is ahead of the company's own wall clock now. */
export function wallClockDrift(reading: string, timeZone: string, now: Date): number {
    const localNow = now.getTime() + offsetMsIn(now, timeZone)
    return Math.round((Date.parse(`${reading}Z`) - localNow) / 1000)
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"

const SHOWN = {
    id: true, agentId: true, serialNumber: true, name: true, model: true, firmware: true, mode: true,
    firstSeenAt: true, lastSeenAt: true, reachable: true, lastError: true, clockDriftSeconds: true,
    userCount: true, recordCount: true, recordCapacity: true, lastPunchAt: true, retiredAt: true,
} as const

export class AttendanceDeviceService {
    static async list(companyId: string) {
        return prisma.attendanceDevice.findMany({ where: { companyId }, orderBy: [{ retiredAt: { sort: "desc", nulls: "first" } }, { name: "asc" }], select: SHOWN })
    }

    static async deviceOf(id: string) {
        return prisma.attendanceDevice.findUnique({ where: { id }, select: { id: true, companyId: true } })
    }

    /**
     * Renamed, or its mode changed (§17). A new mode applies to scans that
     * arrive from now on; punches already stored keep the direction they
     * were given.
     */
    static async update(id: string, input: { name?: string; mode?: "ANY" | "ENTRANCE" | "EXIT" }, actorId: string) {
        const name = input.name?.trim()
        if (input.name !== undefined && !name) fail("DEVICE_NAME_REQUIRED")
        return prisma.$transaction(async tx => {
            const before = await tx.attendanceDevice.findUnique({ where: { id }, select: { companyId: true, name: true, mode: true, serialNumber: true } }) ?? fail("DEVICE_NOT_FOUND")
            const after = await tx.attendanceDevice.update({ where: { id }, data: { ...(name && { name }), ...(input.mode && { mode: input.mode }) }, select: SHOWN })
            const changed = (k: "name" | "mode") => before[k] === after[k] ? undefined : { from: before[k], to: after[k] }
            await AuditLogService.log("UPDATE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId: before.companyId, serialNumber: before.serialNumber, name: changed("name") ?? after.name, mode: changed("mode") },
            })
            return after
        })
    }

    /** No longer in use here: its scans are ignored, and another company can bring it in. Its punches stay. */
    static async retire(id: string, actorId: string) {
        await prisma.$transaction(async tx => {
            const d = await tx.attendanceDevice.findUnique({ where: { id }, select: { companyId: true, name: true, serialNumber: true, retiredAt: true } }) ?? fail("DEVICE_NOT_FOUND")
            if (d.retiredAt) fail("DEVICE_RETIRED")
            await tx.attendanceDevice.update({ where: { id }, data: { retiredAt: new Date(), retiredById: actorId } })
            await AuditLogService.log("RETIRE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: d.companyId, name: d.name, serialNumber: d.serialNumber },
            })
        })
    }

    /** Back in use — unless another company has brought it in meanwhile. */
    static async restore(id: string, actorId: string) {
        await prisma.$transaction(async tx => {
            const d = await tx.attendanceDevice.findUnique({ where: { id }, select: { companyId: true, name: true, serialNumber: true, retiredAt: true } }) ?? fail("DEVICE_NOT_FOUND")
            if (!d.retiredAt) fail("DEVICE_NOT_RETIRED")
            try {
                await tx.attendanceDevice.update({ where: { id }, data: { retiredAt: null, retiredById: null } })
            } catch (e) {
                if (isUniqueViolation(e)) fail("DEVICE_IN_USE_ELSEWHERE")
                throw e
            }
            await AuditLogService.log("RESTORE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: d.companyId, name: d.name, serialNumber: d.serialNumber },
            })
        })
    }

    // --- the agent's side -------------------------------------------------------

    /**
     * What an agent says each time it checks in, recorded; and what it needs
     * back — each terminal's state and mode, our clock, and whether to
     * rotate its token.
     */
    static async heartbeat(agent: AuthenticatedAgent, beat: Heartbeat) {
        const now = new Date()
        const agentRow = await prisma.attendanceAgent.update({
            where: { id: agent.id },
            data: {
                lastSeenAt: now, agentVersion: beat.agentVersion, ...(beat.hostname && { hostname: beat.hostname }),
                queueDepth: beat.queueDepth, clockDriftSeconds: Math.round((Date.parse(beat.clock) - now.getTime()) / 1000),
            },
            select: { tokenIssuedAt: true },
        })
        const devices: { serialNumber: string; state: DeviceState; deviceId: string | null; mode: string | null }[] = []
        for (const d of beat.devices) {
            const health = {
                agentId: agent.id, reachable: d.reachable, lastError: d.reachable ? null : (d.error ?? null),
                ...(d.reachable && { lastSeenAt: now }),
                ...(d.model && { model: d.model }), ...(d.firmware && { firmware: d.firmware }),
                ...(d.clock && { clockDriftSeconds: wallClockDrift(d.clock, agent.timeZone, now) }),
                ...(d.userCount !== undefined && { userCount: d.userCount }),
                ...(d.recordCount !== undefined && { recordCount: d.recordCount }),
                ...(d.recordCapacity !== undefined && { recordCapacity: d.recordCapacity }),
            }
            devices.push(await this.report(agent, d.serialNumber, d.name, health))
        }
        const rotateToken = !agentRow.tokenIssuedAt || now.getTime() - agentRow.tokenIssuedAt.getTime() > TOKEN_ROTATE_DAYS * 86_400_000
        return { serverTime: now.toISOString(), timeZone: agent.timeZone, devices, rotateToken }
    }

    /** One terminal from a heartbeat: brought in, updated, or turned away. */
    private static async report(agent: AuthenticatedAgent, serialNumber: string, name: string | undefined, health: Prisma.AttendanceDeviceUncheckedUpdateInput) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const mine = await prisma.attendanceDevice.findUnique({ where: { companyId_serialNumber: { companyId: agent.companyId, serialNumber } }, select: { id: true, mode: true, retiredAt: true } })
            if (mine?.retiredAt) return { serialNumber, state: "RETIRED" as const, deviceId: mine.id, mode: null }
            if (mine) {
                await prisma.attendanceDevice.update({ where: { id: mine.id }, data: health })
                return { serialNumber, state: "ACTIVE" as const, deviceId: mine.id, mode: mine.mode }
            }
            const elsewhere = await prisma.attendanceDevice.findFirst({ where: { serialNumber, retiredAt: null }, select: { id: true } })
            if (elsewhere) return { serialNumber, state: "CLAIMED_ELSEWHERE" as const, deviceId: null, mode: null }
            try {
                const created = await prisma.$transaction(async tx => {
                    const row = await tx.attendanceDevice.create({
                        data: { ...(health as Prisma.AttendanceDeviceUncheckedCreateInput), companyId: agent.companyId, serialNumber, name: name || `Terminal ${serialNumber}` },
                        select: { id: true, mode: true, name: true },
                    })
                    await AuditLogService.log("ADD_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", row.id, {
                        tx, details: { companyId: agent.companyId, serialNumber, name: row.name, agent: agent.name },
                    })
                    return row
                })
                return { serialNumber, state: "ACTIVE" as const, deviceId: created.id, mode: created.mode }
            } catch (e) {
                // Another heartbeat brought it in at the same moment: read again.
                if (!isUniqueViolation(e)) throw e
            }
        }
        return { serialNumber, state: "CLAIMED_ELSEWHERE" as const, deviceId: null, mode: null }
    }
}
