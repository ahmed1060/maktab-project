import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { DEFAULT_TIME_ZONE, offsetMsIn } from "@/lib/time"
import type { AuthenticatedAgent } from "./attendance-agent.service"
import type { Heartbeat } from "@/lib/attendance/agent-payloads"
import { deviceHealth } from "@/lib/attendance/terminal-health"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import { newPushSecret } from "@/lib/attendance/terminal-secrets"
import { hasAddress, hasOfficeAddress, hikvisionPath, mayConnect, type TerminalConnection, type TerminalProtocol } from "@/lib/attendance/terminal-connections"
import { MAX_IP_RANGES, normaliseIpRange } from "@/lib/attendance/ip-ranges"
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
 * serial number, or, set straight to Nizmo, its own call: a Hikvision
 * terminal's to the address issued for it here, whose secret is returned
 * once and never kept, and a ZKTeco terminal's from its office's internet
 * address, kept here (PR 297). Either way, it can be moved to the other
 * later (PR 298).
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

/**
 * The office's internet addresses a ZKTeco terminal straight to Nizmo is
 * let in from (§17.3, PR 297), as typed: each an address or a range, as a
 * check-in location's office IPs (§9.4), written back the one way, each
 * once, and at least one.
 */
function officeAddressesOf(entries: readonly string[]): string[] {
    const typed = entries.map(e => e.trim()).filter(Boolean)
    if (typed.length === 0) fail("DEVICE_OFFICE_ADDRESS_REQUIRED")
    const parsed = typed.map(normaliseIpRange)
    if (parsed.some(a => a === null)) fail("DEVICE_INVALID_OFFICE_ADDRESS")
    const addresses = [...new Set(parsed as string[])]
    if (addresses.length > MAX_IP_RANGES) fail("DEVICE_TOO_MANY_OFFICE_ADDRESSES")
    return addresses
}

const SHOWN = {
    id: true, agentId: true, serialNumber: true, name: true, model: true, firmware: true, mode: true,
    firstSeenAt: true, lastSeenAt: true, reachable: true, lastError: true, clockDriftSeconds: true,
    userCount: true, recordCount: true, recordCapacity: true, lastPunchAt: true, retiredAt: true,
    protocol: true, brand: { select: { id: true, name: true, retiredAt: true } },
    // How its scans come, and for one straight to Nizmo, where it calls from
    // and what was refused (§17.7, PR 292). Never its secret's hash.
    connection: true, lastAddress: true, refusedCount: true, lastRefusedAt: true, lastRefusal: true,
    // Its own offset from UTC, as its last scan stated it (§17.5, PR 293).
    utcOffsetMinutes: true,
    // The office's internet addresses a ZKTeco terminal straight to Nizmo is let in from (§17.3, PR 297).
    allowedAddresses: true,
} as const

/** The brand printed on it (§17.9, PR 280), and whether the Super Admin has retired it since. */
function withBrand<T extends { brand: { id: string; name: string; retiredAt: Date | null } | null }>(d: T) {
    return { ...d, brand: d.brand && { id: d.brand.id, name: d.brand.name, retired: d.brand.retiredAt !== null } }
}

export class AttendanceDeviceService {
    /** With each one's health now (§13.2). */
    static async list(companyId: string) {
        const [devices, working, company] = await Promise.all([
            // Who added it says whether it waits for its first contact (PR 292); it isn't sent on.
            prisma.attendanceDevice.findMany({ where: { companyId }, orderBy: [{ retiredAt: { sort: "desc", nulls: "first" } }, { name: "asc" }], select: { ...SHOWN, addedById: true } }),
            workingNow(companyId),
            prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
        ])
        const now = new Date()
        // The company's own offset now: a terminal straight to Nizmo that states another says so on its row (PR 293).
        const zone = Math.round(offsetMsIn(now, company?.timezone ?? DEFAULT_TIME_ZONE) / 60_000)
        return devices.map(({ addedById, ...d }) => ({ ...withBrand(d), health: deviceHealth({ ...d, addedById }, now, working, zone) }))
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
     * serial number, and is then this one. Straight to Nizmo, a Hikvision
     * terminal's address is issued: `path` is returned once, and only its
     * secret's hash kept. A ZKTeco terminal's is fixed, so nothing is
     * issued; it is let in from its office's internet address alone, which
     * it needs, and no other terminal is given one (§17.3, PR 297).
     *
     * A serial number is one terminal's: one the company already has,
     * retired or not, is refused, and so is one in use at another company.
     * The brand's row is held meanwhile, as when one is picked (PR 280).
     */
    static async add(
        companyId: string,
        input: { name: string; serialNumber: string; brandId: string; mode?: "ANY" | "ENTRANCE" | "EXIT"; connection: TerminalConnection; officeAddresses?: string[] },
        actorId: string,
    ) {
        const name = input.name.trim()
        if (!name) fail("DEVICE_NAME_REQUIRED")
        const serialNumber = input.serialNumber.trim()
        if (!serialNumber) fail("DEVICE_SERIAL_REQUIRED")
        const taken = async (tx: Prisma.TransactionClient | typeof prisma) => {
            if (await tx.attendanceDevice.findUnique({ where: { companyId_serialNumber: { companyId, serialNumber } }, select: { id: true } })) return "DEVICE_SERIAL_TAKEN"
            // Another company's only: one that became this company's since the line above runs into the insert, and is read again.
            if (await tx.attendanceDevice.findFirst({ where: { serialNumber, retiredAt: null, companyId: { not: companyId } }, select: { id: true } })) return "DEVICE_IN_USE_ELSEWHERE"
            return null
        }
        try {
            const { device, secret } = await prisma.$transaction(async tx => {
                const company = await tx.company.findUnique({ where: { id: companyId }, select: { terminalsDirectAllowed: true } }) ?? fail("COMPANY_NOT_FOUND")
                const [brand] = await tx.$queryRaw<{ name: string; protocol: TerminalProtocol; retiredAt: Date | null }[]>`SELECT name, protocol::text AS protocol, "retiredAt" FROM "TerminalBrand" WHERE id = ${input.brandId} FOR SHARE`
                if (!brand) fail("BRAND_NOT_FOUND")
                if (brand.retiredAt) fail("DEVICE_BRAND_RETIRED")
                if (input.connection === "DIRECT" && !company.terminalsDirectAllowed) fail("DEVICE_DIRECT_NOT_ALLOWED")
                if (!mayConnect(brand.protocol, input.connection, company.terminalsDirectAllowed)) fail("DEVICE_CONNECTION_NOT_BUILT")
                const terminal = { protocol: brand.protocol, connection: input.connection }
                const office = hasOfficeAddress(terminal)
                if (!office && (input.officeAddresses ?? []).some(a => a.trim())) fail("DEVICE_NO_OFFICE_ADDRESS")
                const allowedAddresses = office ? officeAddressesOf(input.officeAddresses ?? []) : []
                const clash = await taken(tx)
                if (clash) fail(clash)
                // Issued only for a terminal with an address of its own: which it is, its brand says.
                const secret = hasAddress(terminal) ? newPushSecret() : null
                const created = await tx.attendanceDevice.create({
                    data: {
                        companyId, serialNumber, name, mode: input.mode ?? "ANY", protocol: brand.protocol, brandId: input.brandId,
                        connection: input.connection, pushSecretHash: secret && hashSecret(secret), allowedAddresses, addedById: actorId,
                    },
                    select: SHOWN,
                })
                await AuditLogService.log("ADD_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", created.id, {
                    tx, ...(await actorOf(tx, actorId)),
                    // The connection is said when it isn't the agent's: an agent's is how every terminal came until now.
                    details: {
                        companyId, serialNumber, name, brand: brand.name, mode: created.mode,
                        ...(input.connection === "DIRECT" && { connection: "DIRECT" }),
                        ...(office && { officeAddresses: allowedAddresses.join(", ") }),
                    },
                })
                return { device: created, secret }
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
     * The office's internet addresses a ZKTeco terminal straight to Nizmo is
     * let in from, changed (§17.3, §17.7, PR 297): from now on it is let in
     * from these alone. Written back the one way, each once, and recorded
     * with the addresses before and after; the same ones again change
     * nothing. It works whether the company's switch is on or off: it only
     * moves where the terminal is let in from.
     */
    static async setOfficeAddresses(id: string, entries: readonly string[], actorId: string) {
        const addresses = officeAddressesOf(entries)
        return prisma.$transaction(async tx => {
            const d = await tx.attendanceDevice.findUnique({
                where: { id }, select: { companyId: true, name: true, serialNumber: true, protocol: true, connection: true, retiredAt: true, allowedAddresses: true },
            }) ?? fail("DEVICE_NOT_FOUND")
            if (d.retiredAt) fail("DEVICE_RETIRED")
            if (!hasOfficeAddress(d)) fail("DEVICE_NO_OFFICE_ADDRESS")
            if (d.allowedAddresses.join("\n") === addresses.join("\n")) {
                return withBrand(await tx.attendanceDevice.findUniqueOrThrow({ where: { id }, select: SHOWN }))
            }
            const after = await tx.attendanceDevice.update({ where: { id }, data: { allowedAddresses: addresses }, select: SHOWN })
            await AuditLogService.log("UPDATE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId: d.companyId, serialNumber: d.serialNumber, name: d.name, officeAddresses: { from: d.allowedAddresses.join(", "), to: addresses.join(", ") } },
            })
            return withBrand(after)
        })
    }

    /**
     * A terminal moved to its other way of connecting (§17.6, §17.7, PR 298):
     * one built for its protocol, and straight to Nizmo only where the
     * company may use it, as when it's added. Its scans, name, brand, mode
     * and employee numbers stay.
     *
     * One connection at a time, so what belonged to the way it leaves starts
     * again: straight to Nizmo, the office's addresses or its secret, where
     * it had got to, where it last called from and what was refused; through
     * the agent, whether the agent reached it and its clock's drift, which
     * the agent measures again. Moved straight to Nizmo, it waits for its
     * first contact until it calls: what the agent saw of it isn't its own
     * call. A ZKTeco terminal needs its office's address, as when it's
     * added; a Hikvision terminal is issued its address, and `path` is
     * returned once.
     *
     * Its row is held meanwhile: of two moves at once, the second finds it
     * moved.
     */
    static async changeConnection(id: string, input: { connection: TerminalConnection; officeAddresses?: string[] }, actorId: string) {
        const to = input.connection
        const { device, secret } = await prisma.$transaction(async tx => {
            const [d] = await tx.$queryRaw<{ companyId: string; name: string; serialNumber: string; protocol: TerminalProtocol; connection: TerminalConnection; retiredAt: Date | null }[]>`
                SELECT "companyId", name, "serialNumber", protocol::text AS protocol, "connection"::text AS "connection", "retiredAt"
                FROM "AttendanceDevice" WHERE id = ${id} FOR UPDATE`
            if (!d) fail("DEVICE_NOT_FOUND")
            if (d.retiredAt) fail("DEVICE_RETIRED")
            if (d.connection === to) fail("DEVICE_SAME_CONNECTION")
            const company = await tx.company.findUnique({ where: { id: d.companyId }, select: { terminalsDirectAllowed: true } }) ?? fail("COMPANY_NOT_FOUND")
            if (to === "DIRECT" && !company.terminalsDirectAllowed) fail("DEVICE_DIRECT_NOT_ALLOWED")
            if (!mayConnect(d.protocol, to, company.terminalsDirectAllowed)) fail("DEVICE_CONNECTION_NOT_BUILT")
            const terminal = { protocol: d.protocol, connection: to }
            const office = hasOfficeAddress(terminal)
            if (!office && (input.officeAddresses ?? []).some(a => a.trim())) fail("DEVICE_NO_OFFICE_ADDRESS")
            const allowedAddresses = office ? officeAddressesOf(input.officeAddresses ?? []) : []
            const secret = hasAddress(terminal) ? newPushSecret() : null
            const moved = await tx.attendanceDevice.update({
                where: { id },
                data: {
                    connection: to, allowedAddresses, pushSecretHash: secret && hashSecret(secret),
                    pushCursor: null, lastAddress: null, refusedCount: 0, lastRefusedAt: null, lastRefusal: null,
                    reachable: true, lastError: null, clockDriftSeconds: null,
                    ...(to === "DIRECT" && { lastSeenAt: null }),
                },
                select: SHOWN,
            })
            await AuditLogService.log("UPDATE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: {
                    companyId: d.companyId, serialNumber: d.serialNumber, name: d.name, connection: { from: d.connection, to },
                    ...(office && { officeAddresses: allowedAddresses.join(", ") }),
                },
            })
            return { device: moved, secret }
        })
        return { device: withBrand(device), path: secret && hikvisionPath(secret) }
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
     *
     * The terminal's own row is held first, so a heartbeat changing its
     * protocol at that moment (takeProtocol) is waited for, and the brand is
     * checked against the protocol it then has (Codex on PR 301).
     */
    static async update(id: string, input: { name?: string; mode?: "ANY" | "ENTRANCE" | "EXIT"; brandId?: string }, actorId: string) {
        const name = input.name?.trim()
        if (input.name !== undefined && !name) fail("DEVICE_NAME_REQUIRED")
        return prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "AttendanceDevice" WHERE id = ${id} FOR UPDATE`
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
            // An agent before part 7's third PR says no protocol, and reads ZKTeco's only (PR 301).
            devices.push(await this.report(agent, d.serialNumber, d.name, health, d.protocol ?? "ZKTECO", d.reachable))
        }
        const rotateToken = !agentRow.tokenIssuedAt || now.getTime() - agentRow.tokenIssuedAt.getTime() > TOKEN_ROTATE_DAYS * 86_400_000
        return { serverTime: now.toISOString(), timeZone: agent.timeZone, devices, rotateToken }
    }

    /**
     * One terminal from a heartbeat: brought in, updated, or turned away.
     * `protocol` is what the agent reads it with, and `reached` whether it
     * did this time.
     */
    private static async report(agent: AuthenticatedAgent, serialNumber: string, name: string | undefined, health: Prisma.AttendanceDeviceUncheckedUpdateInput, protocol: TerminalProtocol, reached: boolean) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const mine = await prisma.attendanceDevice.findUnique({ where: { companyId_serialNumber: { companyId: agent.companyId, serialNumber } }, select: { id: true, mode: true, retiredAt: true, connection: true, protocol: true } })
            if (mine?.retiredAt) return { serialNumber, state: "RETIRED" as const, deviceId: mine.id, mode: null }
            // One connection at a time (§17.6, PR 290): set straight to Nizmo,
            // it's the terminal that says how it is, so nothing the agent
            // says of it is taken, not even which agent last saw it.
            if (mine?.connection === "DIRECT") return { serialNumber, state: "DIRECT" as const, deviceId: mine.id, mode: null }
            if (mine) {
                // Reached with another protocol than the one recorded: the agent reading it shows what it speaks (PR 301).
                if (reached && mine.protocol !== protocol) {
                    if (await this.takeProtocol(agent, mine.id, protocol, health)) return { serialNumber, state: "ACTIVE" as const, deviceId: mine.id, mode: mine.mode }
                    continue
                }
                // Only while it's still the agent's: a move straight to Nizmo,
                // or a retire, that commits after the read above isn't written
                // over, and it's read again (review on PR 298).
                const { count } = await prisma.attendanceDevice.updateMany({ where: { id: mine.id, connection: "AGENT", retiredAt: null }, data: health as Prisma.AttendanceDeviceUncheckedUpdateManyInput })
                if (count === 1) return { serialNumber, state: "ACTIVE" as const, deviceId: mine.id, mode: mine.mode }
                continue
            }
            // Another company's only: one that is this company's was brought
            // in by another of its heartbeats since the lookup above, and the
            // create below runs into it and reads again.
            const elsewhere = await prisma.attendanceDevice.findFirst({ where: { serialNumber, retiredAt: null, companyId: { not: agent.companyId } }, select: { id: true } })
            if (elsewhere) return { serialNumber, state: "CLAIMED_ELSEWHERE" as const, deviceId: null, mode: null }
            try {
                const created = await prisma.$transaction(async tx => {
                    const row = await tx.attendanceDevice.create({
                        data: { ...(health as Prisma.AttendanceDeviceUncheckedCreateInput), companyId: agent.companyId, serialNumber, name: name || `Terminal ${serialNumber}`, protocol },
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

    /**
     * A terminal of the agent's, reached with another protocol than the one
     * recorded (§17.4, PR 301): it speaks the one it was read with, and the
     * record was wrong. Its brand spoke the old one, so it's cleared, for an
     * Admin to pick one speaking this; the change is written to the audit
     * log. Its row is held meanwhile, and taken only while it's still the
     * agent's and not retired: false otherwise, to be read again.
     */
    private static async takeProtocol(agent: AuthenticatedAgent, id: string, protocol: TerminalProtocol, health: Prisma.AttendanceDeviceUncheckedUpdateInput): Promise<boolean> {
        return prisma.$transaction(async tx => {
            const [d] = await tx.$queryRaw<{ companyId: string; name: string; serialNumber: string; protocol: TerminalProtocol; connection: TerminalConnection; retiredAt: Date | null; brand: string | null }[]>`
                SELECT d."companyId", d.name, d."serialNumber", d.protocol::text AS protocol, d."connection"::text AS "connection", d."retiredAt", b.name AS brand
                FROM "AttendanceDevice" d LEFT JOIN "TerminalBrand" b ON b.id = d."brandId"
                WHERE d.id = ${id} FOR UPDATE OF d`
            if (!d || d.connection !== "AGENT" || d.retiredAt) return false
            // Another heartbeat may have taken it while this one waited for the row.
            const changed = d.protocol !== protocol
            await tx.attendanceDevice.update({ where: { id }, data: { ...health, ...(changed && { protocol, brandId: null }) } })
            if (changed) {
                await AuditLogService.log("UPDATE_ATTENDANCE_DEVICE", "ATTENDANCE_DEVICE", id, {
                    tx, details: {
                        companyId: d.companyId, serialNumber: d.serialNumber, name: d.name, agent: agent.name,
                        protocol: { from: d.protocol, to: protocol }, ...(d.brand && { brand: { from: d.brand, to: null } }),
                    },
                })
            }
            return true
        })
    }
}
