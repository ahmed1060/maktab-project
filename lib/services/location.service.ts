import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"
import { googleMapsLink } from "@/lib/attendance/geo"
import type { CreateLocationInput, PlaceInput, UpdateLocationInput } from "@/lib/validations/location.schema"

/**
 * The places tasks happen at (CLIENTS_PLAN.md §2): each client's HQ and its
 * branches and sites, and shared places no client owns.
 *
 * Locations are the company's, so every check is company-wide: see them
 * with locations.view, add one with locations.add, and change one (its
 * details, archiving it, making it an HQ) with locations.manage. Another
 * company's is "not found", never "not allowed".
 *
 * Until step 2 moves tasks onto locations, the task form still copies a
 * client's own location fields into a new task: those follow its HQ here
 * (syncClientLocation).
 */

type Session = { user: { id: string; role: string; companyId?: string | null; [key: string]: unknown } }
type Tx = Prisma.TransactionClient

const isSuperAdmin = (session: Session) => session.user.role === "SUPER_ADMIN"

/** Who added it: the column's foreign key points at User, which a Super Admin isn't. */
function actor(session: Session) {
    const sa = isSuperAdmin(session)
    return { byUser: sa ? null : session.user.id, audit: { userId: sa ? null : session.user.id, superAdminId: sa ? session.user.id : null } }
}

/** A company's location, checked against the person: another company's is not found. */
function allow(session: Session, permission: Permission, companyId: string) {
    if (!isSuperAdmin(session) && session.user.companyId !== companyId) throw new Error("TASK_LOCATION_NOT_FOUND")
    if (!can(session.user as any, permission, { companyId })) throw new Error("TASK_LOCATION_FORBIDDEN")
}

const likeText = (text: string) => text.replace(/[\\%_]/g, c => `\\${c}`)

const ROW = {
    id: true, name: true, isHq: true, latitude: true, longitude: true, radiusMeters: true, archivedAt: true, createdAt: true,
    client: { select: { id: true, name: true } },
    company: { select: { name: true } },
} satisfies Prisma.LocationSelect

export type LocationRow = Prisma.LocationGetPayload<{ select: typeof ROW }>

export type LocationListQuery = {
    /** A Super Admin's chosen company; ignored for anyone else, who sees their own. Unset for a Super Admin is every company. */
    companyId?: string | null
    /** One client's; "shared" for the shared ones; unset for all. */
    clientId?: string | null
    search?: string | null
    /** The archived ones, instead of those in use. */
    archived?: boolean
    page: number
    limit: number
}

/**
 * A client's own location fields, which the task form still copies into a
 * new task, follow its HQ: its name, and a map link to its pin.
 */
async function syncClientLocation(tx: Tx, clientId: string) {
    const hq = await tx.location.findFirst({ where: { clientId, isHq: true }, select: { name: true, latitude: true, longitude: true } })
    if (!hq) return
    await tx.client.update({
        where: { id: clientId },
        data: {
            locationName: hq.name,
            locationLink: hq.latitude !== null && hq.longitude !== null ? googleMapsLink(hq.latitude, hq.longitude) : null,
        },
    })
}

/** A client's row held, so its HQ can't change under a change to it, nor the client go meanwhile. */
async function holdClient(tx: Tx, clientId: string) {
    const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Client" WHERE id = ${clientId} FOR NO KEY UPDATE`
    if (!held.length) throw new Error("CLIENT_NOT_FOUND")
}

export class LocationService {
    /** Locations, by client (shared ones last), each client's HQ first. A search finds one by its name or its client's. */
    static async list(session: Session, query: LocationListQuery) {
        const sa = isSuperAdmin(session)
        const companyId = sa ? query.companyId || null : session.user.companyId
        if (!sa && !companyId) return { data: [] as LocationRow[], total: 0 }
        if (!sa && !can(session.user as any, "locations.view", { companyId: companyId! })) throw new Error("TASK_LOCATION_FORBIDDEN")
        const trimmed = query.search?.trim()
        const search = trimmed ? likeText(trimmed) : ""
        const where: Prisma.LocationWhereInput = {
            ...(companyId ? { companyId } : {}),
            ...(query.clientId === "shared" ? { clientId: null } : query.clientId ? { clientId: query.clientId } : {}),
            archivedAt: query.archived ? { not: null } : null,
            ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { client: { name: { contains: search, mode: "insensitive" } } }] } : {}),
        }
        const [data, total] = await Promise.all([
            prisma.location.findMany({
                where,
                select: ROW,
                // Ascending, a shared location's missing client sorts last.
                orderBy: [{ client: { name: "asc" } }, { isHq: "desc" }, { name: "asc" }, { id: "asc" }],
                skip: (query.page - 1) * query.limit,
                take: query.limit,
            }),
            prisma.location.count({ where }),
        ])
        return { data, total }
    }

    static async get(session: Session, id: string) {
        const found = await prisma.location.findUnique({ where: { id }, select: { ...ROW, companyId: true } })
        if (!found) throw new Error("TASK_LOCATION_NOT_FOUND")
        allow(session, "locations.view", found.companyId)
        return { id: found.id, name: found.name, isHq: found.isHq, latitude: found.latitude, longitude: found.longitude, radiusMeters: found.radiusMeters, archivedAt: found.archivedAt, createdAt: found.createdAt, client: found.client, company: found.company } satisfies LocationRow
    }

    /**
     * Adds a location: a client's, or a shared one. A client's first, or its
     * first since its HQ was set elsewhere, is its HQ: a client made before
     * locations existed, by the release before, has none yet.
     */
    static async create(session: Session, input: CreateLocationInput) {
        const who = actor(session)
        const created = await prisma.$transaction(async tx => {
            let companyId: string
            let isHq = false
            if (input.clientId) {
                const client = await tx.client.findUnique({ where: { id: input.clientId }, select: { companyId: true } })
                if (!client) throw new Error("CLIENT_NOT_FOUND")
                if (!isSuperAdmin(session) && session.user.companyId !== client.companyId) throw new Error("CLIENT_NOT_FOUND")
                companyId = client.companyId
                allow(session, "locations.add", companyId)
                await holdClient(tx, input.clientId)
                isHq = !(await tx.location.findFirst({ where: { clientId: input.clientId, isHq: true }, select: { id: true } }))
            } else {
                const company = isSuperAdmin(session) ? input.companyId : session.user.companyId
                if (!company) throw new Error("COMPANY_SELECTION_REQUIRED")
                companyId = company
                allow(session, "locations.add", companyId)
            }
            const location = await tx.location.create({
                data: {
                    companyId, clientId: input.clientId ?? null, isHq,
                    name: input.name, latitude: input.latitude, longitude: input.longitude, radiusMeters: input.radiusMeters ?? null,
                    createdById: who.byUser,
                },
                select: { id: true },
            })
            if (isHq) await syncClientLocation(tx, input.clientId!)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("CREATE_LOCATION", "LOCATION", location.id, {
                tx, ...who.audit,
                details: { companyId, clientId: input.clientId ?? null, name: input.name, latitude: input.latitude, longitude: input.longitude, radiusMeters: input.radiusMeters ?? null, isHq },
            })
            return location
        })
        return LocationService.get(session, created.id)
    }

    /**
     * Changes a location: its details, archiving or restoring it, or making
     * it its client's HQ in place of the one it has. An HQ can't be archived;
     * another is made the HQ first.
     */
    static async update(session: Session, input: UpdateLocationInput) {
        const who = actor(session)
        const found = await prisma.location.findUnique({ where: { id: input.id }, select: { companyId: true, clientId: true } })
        if (!found) throw new Error("TASK_LOCATION_NOT_FOUND")
        allow(session, "locations.manage", found.companyId)
        await prisma.$transaction(async tx => {
            if (found.clientId) await holdClient(tx, found.clientId)
            const before = await tx.location.findUnique({ where: { id: input.id }, select: { name: true, latitude: true, longitude: true, radiusMeters: true, archivedAt: true, isHq: true, clientId: true } })
            // Deleted with its client meanwhile.
            if (!before) throw new Error("TASK_LOCATION_NOT_FOUND")
            const data: Prisma.LocationUpdateInput = {}
            if (input.name !== undefined) data.name = input.name
            if (input.latitude !== undefined) { data.latitude = input.latitude; data.longitude = input.longitude }
            if (input.radiusMeters !== undefined) data.radiusMeters = input.radiusMeters
            if (input.archived !== undefined) {
                if (input.archived && before.isHq) throw new Error("TASK_LOCATION_IS_HQ")
                data.archivedAt = input.archived ? (before.archivedAt ?? new Date()) : null
            }
            if (input.hq) {
                if (!before.clientId) throw new Error("TASK_LOCATION_SHARED")
                if (before.archivedAt && input.archived !== false) throw new Error("TASK_LOCATION_ARCHIVED")
                // The one it replaces first: a client has one HQ at most.
                await tx.location.updateMany({ where: { clientId: before.clientId, isHq: true, id: { not: input.id } }, data: { isHq: false } })
                data.isHq = true
            }
            await tx.location.update({ where: { id: input.id }, data })
            if (before.clientId && (before.isHq || input.hq)) await syncClientLocation(tx, before.clientId)
            const { AuditLogService } = await import("./audit-log.service")
            const action = input.hq ? "SET_LOCATION_HQ" : input.archived === true ? "ARCHIVE_LOCATION" : input.archived === false ? "RESTORE_LOCATION" : "UPDATE_LOCATION"
            await AuditLogService.log(action, "LOCATION", input.id, {
                tx, ...who.audit,
                details: { companyId: found.companyId, before, after: { ...input, id: undefined } },
            })
        })
        return LocationService.get(session, input.id)
    }

    /**
     * A new client's HQ, in the transaction that adds the client
     * (ClientService.create), or a change to it when the client is edited.
     * The client's own location fields follow it.
     */
    static async saveHq(tx: Tx, client: { id: string; companyId: string }, place: PlaceInput, byUser: string | null) {
        const hq = await tx.location.findFirst({ where: { clientId: client.id, isHq: true }, select: { id: true } })
        const details = { name: place.name, latitude: place.latitude, longitude: place.longitude, radiusMeters: place.radiusMeters ?? null }
        if (hq) await tx.location.update({ where: { id: hq.id }, data: details })
        else await tx.location.create({ data: { ...details, companyId: client.companyId, clientId: client.id, isHq: true, createdById: byUser } })
        await syncClientLocation(tx, client.id)
    }
}
