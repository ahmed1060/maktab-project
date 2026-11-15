import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { offsetMsIn } from "@/lib/time"
import type { AuthenticatedAgent } from "./attendance-agent.service"
import type { Heartbeat } from "@/lib/attendance/agent-payloads"
import { deviceHealth } from "@/lib/attendance/terminal-health"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import { newPushSecret } from "@/lib/attendance/terminal-secrets"
import { hasAddress, hikvisionPath, mayConnect, type TerminalConnection, type TerminalProtocol } from "@/lib/attendance/terminal-connections"
import { workingNow } from "./attendance-terminal-status"

/**
 * Fingerprint terminals (ATTENDANCE_PLAN.md §17), as the agents report them
 * or as someone adds them by hand (§17.7, PR 292).
 *
 * An agent's heartbeat says what it is (version, what it still holds, its
 * clock) and which terminals it reads, each with its own clock and how full
 * its memory is. A terminal is brought in the first time an agent of the
 * company reports it, and is in use by one company at a time; one retired
 * here is ignored until it is restored. Nothing an agent sends names a
 * company: it is the agent's.
 *
 * One added by hand waits for its first contact: an agent's report of its
 * serial number, or, set straight to Nizmo, its own call to the address
 * issued for it here, whose secret is returned once and never kept.
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

/**
 * What an agent hears of a terminal it reports. `DIRECT`: the terminal is
 * set straight to Nizmo (§17.6, PR 290), so its log is the terminal's to
 * send, not the agent's to read.
 */
export type DeviceState = "ACTIVE" | "RETIRED" | "CLAIMED_ELSEWHERE" | "DIRECT"

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
    protocol: true, brand: { select: { id: true, name: true, retiredAt: true } },
    // How its scans come, and for one straight to Nizmo, where it calls from
    // and what was refused (§17.7, PR 292). Never its secret's hash.
    connection: true, lastAddress: true, refusedCount: true, lastRefusedAt: true, lastRefusal: true,
} as const

/** The brand printed on it (§17.9, PR 280), and whether the Super Admin has retired it since. */
function withBrand<T extends { brand: { id: string; name: string; retiredAt: Date | null } | null }>(d: T) {
    return { ...d, brand: d.brand && { id: d.brand.id, name: d.brand.name, retired: d.brand.retiredAt !== null } }
}

export class AttendanceDeviceService {
    /** With each one's health now (§13.2). */
    static async list(companyId: string) {
        const [devices, working] = await Promise.all([
            // Who added it says whether it waits for its first contact (PR 292); it isn't sent on.
            prisma.attendanceDevice.findMany({ where: { companyId }, orderBy: [{ retiredAt: { sort: "desc", nulls: "first" } }, { name: "asc" }], select: { ...SHOWN, addedById: true } }),
            workingNow(companyId),
        ])
        const now = new Date()
        return devices.map(({ addedById, ...d }) => ({ ...withBrand(d), health: deviceHealth({ ...d, addedById }, now, working) }))
    }

    static async deviceOf(id: string) {
        return prisma.attendanceDevice.findUnique({ where: { id }, select: { id: true, companyId: true } })
    }

    /** Whether the Super Admin has turned terminals straight to Nizmo on for the company (§17.8). */
    static async directAllowed(companyId: string): Promise<boolean> {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { terminalsDirectAllowed: true } })
        return company?.terminalsDirectAllowed ?? false
    }

    /**
     * A terminal added by hand (§17.7, PR 292): its name, its brand, which
     * gives its protocol, its serial number, how it reads scans, and how it
     * connects, which must be a way built for its protocol and, straight to
     * Nizmo, one the company is allowed (§17.8).
     *
     * Through the agent it waits for an agent of the company to report its
     * serial number, and is then this one. Straight to Nizmo, its address
     * is issued: `path` is returned once, and only its secret's hash kept.
     *
     * A serial number is one terminal's: one the company already has,
     * retired or not, is refused, and so is one in use at another company.
     * The brand's row is held meanwhile, as when one is picked (PR 280).
     */
    static async add(
        companyId: string,
        input: { name: string; serialNumber: string; brandId: string; mode?: "ANY" | "ENTRANCE" | "EXIT"; connection: TerminalConnection },
        actorId: string,
    ) {
        const name = input.name.trim()
        if (!name) fail("DEVICE_NAME_REQUIRED")
        const serialNumber = input.serialNumber.trim()
        if (!serialNumber) fail("DEVICE_SERIAL_REQUIRED")
        const secret = input.connection === "DIRECT" ? newPushSecret() : null
        const taken = async (tx: Prisma.TransactionClient | typeof prisma) => {
            if (await tx.attendanceDevice.findUnique({ where: { companyId_serialNumber: { companyId, serialNumber } }, select: { id: true } })) return "DEVICE_SERIAL_TAKEN"
            // Another company's only: one that became this company's since the line above runs into the insert, and is read again.
            if (await tx.attendanceDevice.findFirst({ where: { serialNumber, retiredAt: null, companyId: { not: companyId } }, select: { id: true } })) return "DEVICE_IN_USE_ELSEWHERE"
            return null
        }
        try {
            const device = await prisma.$transaction(async tx => {
                const company = await tx.company.findUnique({ where: { id: companyId }, select: { terminalsDirectAllowed: true } }) ?? fail("COMPANY_NOT_FOUND")
                const [brand] = await tx.$queryRaw<{ name: string; protocol: TerminalProtocol; retiredAt: Date | null }[]>`SELECT name, protocol::text AS protocol, "retiredAt" FROM "TerminalBrand" WHERE id = ${input.brandId} FOR SHARE`
                if (!brand) fail("BRAND_NOT_FOUND")
                if (brand.retiredAt) fail("DEVICE_BRAND_RETIRED")
                if (input.connection === "DIRECT" && !company.terminalsDirectAllowed) fail("DEVICE_DIRECT_NOT_ALLOWED")
                if (!mayConnect(brand.protocol, input.connection, company.terminalsDirectAllowed)) fail("DEVICE_CONNECTION_NOT_BUILT")
                const clash = await taken(tx)
                if (clash) fail(clash)
                const created = await tx.attendanceDevice.create({
                    data: {
                        companyId, serialNumber, name, mode: input.mode ?? "ANY", protocol: brand.protocol, brandId: input.brandId,
                        connection: input.connection, pushSecretHash: secret && hashSecret(secret), addedById: actorId,
                    },
                    select: SHOWN,
                })
                await AuditLogService.log("ADD_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", created.id, {
                    tx, ...(await actorOf(tx, actorId)),
                    // The connection is said when it isn't the agent's: an agent's is how every terminal came until now.
                    details: { companyId, serialNumber, name, brand: brand.name, mode: created.mode, ...(input.connection === "DIRECT" && { connection: "DIRECT" }) },
                })
                return created
            })
            return { device: withBrand(device), path: secret && hikvisionPath(secret) }
        } catch (e) {
            if (!isUniqueViolation(e)) throw e
            // Added at the same moment, here by another request or an agent's report, or at another company.
            fail((await taken(prisma)) ?? "DEVICE_SERIAL_TAKEN")
        }
    }

    /**
     * A new address for a Hikvision terminal straight to Nizmo (§17.2,
     * PR 292): the one it has stops working at once, and the terminal is
     * set to the new one. `path` is returned once. It only replaces a
     * secret, so it works whether the company's switch is on or off.
     */
    static async issueAddress(id: string, actorId: string) {
        const secret = newPushSecret()
        const device = await prisma.$transaction(async tx => {
            const d = await tx.attendanceDevice.findUnique({
                where: { id }, select: { companyId: true, name: true, serialNumber: true, protocol: true, connection: true, retiredAt: true },
            }) ?? fail("DEVICE_NOT_FOUND")
            if (d.retiredAt) fail("DEVICE_RETIRED")
            if (!hasAddress(d)) fail("DEVICE_NO_ADDRESS")
            const updated = await tx.attendanceDevice.update({ where: { id }, data: { pushSecretHash: hashSecret(secret) }, select: SHOWN })
            await AuditLogService.log("ISSUE_TERMINAL_ADDRESS", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: d.companyId, name: d.name, serialNumber: d.serialNumber },
            })
            return updated
        })
        return { device: withBrand(device), path: hikvisionPath(secret) }
    }

    /**
     * Renamed, its mode changed (§17), or its brand picked (§17.9, PR 280).
     * A new mode applies to scans that arrive from now on; punches already
     * stored keep the direction they were given.
     *
     * A brand must speak the terminal's protocol and not be retired, unless
     * it's the one the terminal already has. Its row is held while the
     * terminal is saved, so the Super Admin can't change its protocol,
     * retire it or delete it meanwhile: whichever comes second sees the
     * first. Once picked, a brand can be changed but not taken off.
     */
    static async update(id: string, input: { name?: string; mode?: "ANY" | "ENTRANCE" | "EXIT"; brandId?: string }, actorId: string) {
        const name = input.name?.trim()
        if (input.name !== undefined && !name) fail("DEVICE_NAME_REQUIRED")
        return prisma.$transaction(async tx => {
            const before = await tx.attendanceDevice.findUnique({
                where: { id }, select: { companyId: true, name: true, mode: true, serialNumber: true, protocol: true, brandId: true, brand: { select: { name: true } } },
            }) ?? fail("DEVICE_NOT_FOUND")
            const brandId = input.brandId !== undefined && input.brandId !== before.brandId ? input.brandId : undefined
            if (brandId !== undefined) {
                const [brand] = await tx.$queryRaw<{ protocol: string; retiredAt: Date | null }[]>`SELECT protocol::text AS protocol, "retiredAt" FROM "TerminalBrand" WHERE id = ${brandId} FOR SHARE`
                if (!brand) fail("BRAND_NOT_FOUND")
                if (brand.retiredAt) fail("DEVICE_BRAND_RETIRED")
                if (brand.protocol !== before.protocol) fail("DEVICE_BRAND_PROTOCOL")
            }
            const after = await tx.attendanceDevice.update({
                where: { id }, data: { ...(name && { name }), ...(input.mode && { mode: input.mode }), ...(brandId !== undefined && { brandId }) }, select: SHOWN,
            })
            const changed = (k: "name" | "mode") => before[k] === after[k] ? undefined : { from: before[k], to: after[k] }
            await AuditLogService.log("UPDATE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: {
                    companyId: before.companyId, serialNumber: before.serialNumber, name: changed("name") ?? after.name, mode: changed("mode"),
                    brand: brandId !== undefined ? { from: before.brand?.name ?? null, to: after.brand?.name ?? null } : undefined,
                },
            })
            return withBrand(after)
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
     * rotate its token. A terminal set straight to Nizmo is answered
     * `DIRECT`, and nothing said of it is recorded (PR 290).
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
            const mine = await prisma.attendanceDevice.findUnique({ where: { companyId_serialNumber: { companyId: agent.companyId, serialNumber } }, select: { id: true, mode: true, retiredAt: true, connection: true } })
            if (mine?.retiredAt) return { serialNumber, state: "RETIRED" as const, deviceId: mine.id, mode: null }
            // One connection at a time (§17.6, PR 290): set straight to Nizmo,
            // it's the terminal that says how it is, so nothing the agent
            // says of it is taken, not even which agent last saw it.
            if (mine?.connection === "DIRECT") return { serialNumber, state: "DIRECT" as const, deviceId: mine.id, mode: null }
            if (mine) {
                await prisma.attendanceDevice.update({ where: { id: mine.id }, data: health })
                return { serialNumber, state: "ACTIVE" as const, deviceId: mine.id, mode: mine.mode }
            }
            // Another company's only: one that is this company's was brought
            // in by another of its heartbeats since the lookup above, and the
            // create below runs into it and reads again.
            const elsewhere = await prisma.attendanceDevice.findFirst({ where: { serialNumber, retiredAt: null, companyId: { not: agent.companyId } }, select: { id: true } })
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
