import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { MAX_IP_RANGES, normaliseIpRange } from "@/lib/attendance/ip-ranges"

/**
 * Where people check in with the app (ATTENDANCE_PLAN.md §8.5, §9.4): a
 * circle on the map, the people who may check in there, and optionally the
 * office's public IPs. Archived, never deleted, because check-ins will point
 * at it; an archived one takes no check-ins.
 */

function fail(code: string): never {
    throw new Error(code)
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

export const RADIUS_METERS = { min: 20, max: 5000 } as const

export type LocationInput = {
    name: string
    latitude: number
    longitude: number
    radiusMeters: number
    officeIpRanges?: string[]
    everyone?: boolean
}

const AT_WORK = ["ACTIVE", "OFFLINE"] as const

const SHOWN = {
    id: true, name: true, latitude: true, longitude: true, radiusMeters: true, officeIpRanges: true,
    everyone: true, archivedAt: true, people: { select: { userId: true } },
} as const

/** The input, checked and tidied: a name, a real place, a sensible circle, addresses that parse. */
function clean(input: Partial<LocationInput>) {
    const name = input.name?.trim()
    if (input.name !== undefined && !name) fail("LOCATION_NAME_REQUIRED")
    if (input.latitude !== undefined && !(Math.abs(input.latitude) <= 90)) fail("LOCATION_INVALID_POINT")
    if (input.longitude !== undefined && !(Math.abs(input.longitude) <= 180)) fail("LOCATION_INVALID_POINT")
    if (input.radiusMeters !== undefined && !(Number.isInteger(input.radiusMeters) && input.radiusMeters >= RADIUS_METERS.min && input.radiusMeters <= RADIUS_METERS.max)) fail("LOCATION_INVALID_RADIUS")
    let officeIpRanges: string[] | undefined
    if (input.officeIpRanges !== undefined) {
        const entries = input.officeIpRanges.map(e => e.trim()).filter(Boolean)
        if (entries.length > MAX_IP_RANGES) fail("LOCATION_TOO_MANY_IPS")
        const parsed = entries.map(normaliseIpRange)
        if (parsed.some(p => p === null)) fail("LOCATION_INVALID_IP")
        officeIpRanges = [...new Set(parsed as string[])]
    }
    return {
        ...(name !== undefined && { name }),
        ...(input.latitude !== undefined && { latitude: input.latitude }),
        ...(input.longitude !== undefined && { longitude: input.longitude }),
        ...(input.radiusMeters !== undefined && { radiusMeters: input.radiusMeters }),
        ...(officeIpRanges !== undefined && { officeIpRanges }),
        ...(input.everyone !== undefined && { everyone: input.everyone }),
    }
}

const shown = (l: Prisma.WorkLocationGetPayload<{ select: typeof SHOWN }>) => {
    const { people, ...rest } = l
    return { ...rest, userIds: people.map(p => p.userId) }
}

export class AttendanceLocationService {
    /** The company's locations, in use first, and the people who could be put on one. */
    static async list(companyId: string) {
        const [locations, people] = await Promise.all([
            prisma.workLocation.findMany({ where: { companyId }, orderBy: [{ archivedAt: { sort: "desc", nulls: "first" } }, { name: "asc" }], select: SHOWN }),
            prisma.user.findMany({
                where: { companyId, status: { in: [...AT_WORK] } },
                select: { id: true, firstName: true, lastName: true },
                orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            }),
        ])
        return { locations: locations.map(shown), people: people.map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() })) }
    }

    static async locationOf(id: string) {
        return prisma.workLocation.findUnique({ where: { id }, select: { id: true, companyId: true } })
    }

    static async create(companyId: string, input: LocationInput, actorId: string) {
        const data = clean(input) as LocationInput
        return prisma.$transaction(async tx => {
            const row = await tx.workLocation.create({ data: { ...data, companyId }, select: SHOWN })
            await AuditLogService.log("CREATE_WORK_LOCATION", "WORK_LOCATION", row.id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId, name: row.name, latitude: row.latitude, longitude: row.longitude, radiusMeters: row.radiusMeters, officeIpRanges: row.officeIpRanges, everyone: row.everyone },
            })
            return shown(row)
        })
    }

    static async update(id: string, input: Partial<LocationInput>, actorId: string) {
        const data = clean(input)
        return prisma.$transaction(async tx => {
            const before = await tx.workLocation.findUnique({ where: { id }, select: { ...SHOWN, companyId: true } }) ?? fail("LOCATION_NOT_FOUND")
            if (before.archivedAt) fail("LOCATION_ARCHIVED")
            const after = await tx.workLocation.update({ where: { id }, data, select: SHOWN })
            const fields = ["name", "latitude", "longitude", "radiusMeters", "everyone"] as const
            const changes: Record<string, unknown> = {}
            for (const k of fields) if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] }
            if (before.officeIpRanges.join() !== after.officeIpRanges.join()) changes.officeIpRanges = { from: before.officeIpRanges, to: after.officeIpRanges }
            await AuditLogService.log("UPDATE_WORK_LOCATION", "WORK_LOCATION", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: before.companyId, name: after.name, ...changes },
            })
            return shown(after)
        })
    }

    /**
     * Exactly these people may check in here. Each must be one of the
     * company's own; the list replaces the last one.
     */
    static async setPeople(id: string, userIds: string[], actorId: string) {
        const wanted = [...new Set(userIds)]
        return prisma.$transaction(async tx => {
            const location = await tx.workLocation.findUnique({ where: { id }, select: { companyId: true, name: true, archivedAt: true, people: { select: { userId: true } } } }) ?? fail("LOCATION_NOT_FOUND")
            if (location.archivedAt) fail("LOCATION_ARCHIVED")
            const theirs = await tx.user.count({ where: { id: { in: wanted }, companyId: location.companyId } })
            if (theirs !== wanted.length) fail("LOCATION_PEOPLE_NOT_IN_COMPANY")
            const had = new Set(location.people.map(p => p.userId))
            const added = wanted.filter(u => !had.has(u))
            const removed = [...had].filter(u => !wanted.includes(u))
            if (removed.length > 0) await tx.userWorkLocation.deleteMany({ where: { locationId: id, userId: { in: removed } } })
            if (added.length > 0) await tx.userWorkLocation.createMany({ data: added.map(userId => ({ userId, locationId: id })) })
            if (added.length + removed.length > 0) {
                await AuditLogService.log("ASSIGN_WORK_LOCATION", "WORK_LOCATION", id, {
                    tx, ...(await actorOf(tx, actorId)), details: { companyId: location.companyId, name: location.name, added, removed },
                })
            }
            return { userIds: wanted }
        })
    }

    /** No longer taking check-ins. Who was on it is kept, for a restore. */
    static async archive(id: string, actorId: string) {
        await prisma.$transaction(async tx => {
            const l = await tx.workLocation.findUnique({ where: { id }, select: { companyId: true, name: true, archivedAt: true } }) ?? fail("LOCATION_NOT_FOUND")
            if (l.archivedAt) fail("LOCATION_ARCHIVED")
            await tx.workLocation.update({ where: { id }, data: { archivedAt: new Date() } })
            await AuditLogService.log("ARCHIVE_WORK_LOCATION", "WORK_LOCATION", id, { tx, ...(await actorOf(tx, actorId)), details: { companyId: l.companyId, name: l.name } })
        })
    }

    static async restore(id: string, actorId: string) {
        await prisma.$transaction(async tx => {
            const l = await tx.workLocation.findUnique({ where: { id }, select: { companyId: true, name: true, archivedAt: true } }) ?? fail("LOCATION_NOT_FOUND")
            if (!l.archivedAt) fail("LOCATION_NOT_ARCHIVED")
            await tx.workLocation.update({ where: { id }, data: { archivedAt: null } })
            await AuditLogService.log("RESTORE_WORK_LOCATION", "WORK_LOCATION", id, { tx, ...(await actorOf(tx, actorId)), details: { companyId: l.companyId, name: l.name } })
        })
    }

    /**
     * Where this person may check in now: the company's locations in use
     * that take everyone, or list them (§8.5). For the check-in itself (P3.3).
     */
    static async forPerson(companyId: string, userId: string) {
        return prisma.workLocation.findMany({
            where: { companyId, archivedAt: null, OR: [{ everyone: true }, { people: { some: { userId } } }] },
            select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true, officeIpRanges: true },
            orderBy: { name: "asc" },
        })
    }
}
