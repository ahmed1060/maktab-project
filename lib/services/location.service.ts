import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"
import { googleMapsLink } from "@/lib/attendance/geo"
import { locationLabel } from "@/lib/locations"
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

const PICK = { id: true, name: true, isHq: true, latitude: true, clientId: true } satisfies Prisma.LocationSelect
/** A location as a task's picker offers it; one with no pin is offered greyed (§2.8). */
export type PickRow = { id: string; name: string; isHq: boolean; needsPin: boolean }
const pickRow = (l: Prisma.LocationGetPayload<{ select: typeof PICK }>): PickRow => ({ id: l.id, name: l.name, isHq: l.isHq, needsPin: l.latitude === null })
/** More than a picker should list; a company with more uses the Locations page's search. */
const PICK_LIMIT = 500

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
     * What a task's location picker offers (§2.3): the task client's
     * locations in use, its HQ first, then the shared ones; only the shared
     * ones for a task with no client. A Super Admin names the company.
     */
    static async pickable(session: Session, query: { companyId?: string | null; clientId?: string | null }) {
        const companyId = isSuperAdmin(session) ? query.companyId || null : session.user.companyId ?? null
        if (!companyId) throw new Error("COMPANY_SELECTION_REQUIRED")
        allow(session, "locations.view", companyId)
        if (query.clientId) {
            const client = await prisma.client.findUnique({ where: { id: query.clientId }, select: { companyId: true } })
            if (!client || client.companyId !== companyId) throw new Error("CLIENT_NOT_FOUND")
        }
        const [client, shared] = await Promise.all([
            query.clientId
                ? prisma.location.findMany({ where: { clientId: query.clientId, archivedAt: null }, select: PICK, orderBy: [{ isHq: "desc" }, { name: "asc" }, { id: "asc" }], take: PICK_LIMIT })
                : [],
            prisma.location.findMany({ where: { companyId, clientId: null, archivedAt: null }, select: PICK, orderBy: [{ name: "asc" }, { id: "asc" }], take: PICK_LIMIT }),
        ])
        return { client: client.map(pickRow), shared: shared.map(pickRow) }
    }

    /**
     * Every location in use in a company, with its client, for the bulk
     * upload's review screen (§2.7): each row offers its own client's and
     * the shared ones, and is checked against them.
     */
    static async pickableAll(session: Session, query: { companyId?: string | null }) {
        const companyId = isSuperAdmin(session) ? query.companyId || null : session.user.companyId ?? null
        if (!companyId) throw new Error("COMPANY_SELECTION_REQUIRED")
        allow(session, "locations.view", companyId)
        // All of them, as the template's Locations sheet lists them: a row
        // naming one past a cap was refused, though the sheet offered it.
        const all = await prisma.location.findMany({
            where: { companyId, archivedAt: null },
            select: PICK,
            orderBy: [{ isHq: "desc" }, { name: "asc" }, { id: "asc" }],
        })
        return { locations: all.map(l => ({ ...pickRow(l), clientId: l.clientId })) }
    }

    /**
     * The location a task is to be done at (§2.3), checked against the
     * task: its company's, in use, its pin placed (§2.8), and its client's
     * or a shared one; a task with no client takes a shared one. Returns
     * what the task keeps: its id, and its name and map link as they are
     * now, for the task's own location text.
     */
    static async forTask(db: Tx, locationId: string, task: { companyId: string | null; clientId: string | null }) {
        const found = await db.location.findUnique({
            where: { id: locationId },
            select: { id: true, companyId: true, clientId: true, name: true, latitude: true, longitude: true, radiusMeters: true, archivedAt: true, client: { select: { name: true } } },
        })
        if (!found || found.companyId !== task.companyId) throw new Error("TASK_LOCATION_NOT_FOUND")
        if (found.archivedAt) throw new Error("TASK_LOCATION_ARCHIVED")
        if (found.latitude === null || found.longitude === null) throw new Error("TASK_LOCATION_NEEDS_PIN")
        if (found.clientId && found.clientId !== task.clientId) throw new Error("TASK_LOCATION_OTHER_CLIENT")
        const label = locationLabel(found.name, found.client?.name)
        return {
            id: found.id,
            label,
            text: JSON.stringify({ name: label, link: googleMapsLink(found.latitude, found.longitude) }),
            // What the check measures from (§2.5).
            place: { latitude: found.latitude, longitude: found.longitude, radiusMeters: found.radiusMeters },
        }
    }

    /**
     * A new client's HQ, in the transaction that adds the client
     * (ClientService.create), or a change to it when the client is edited.
     * The client's own location fields follow it.
     *
     * Whoever may manage clients gives a client its HQ, with the client or
     * later for one without, but changing the one it has is changing a
     * location: locations.manage, as on the Locations page.
     */
    static async saveHq(tx: Tx, client: { id: string; companyId: string }, place: PlaceInput, session: Session) {
        const hq = await tx.location.findFirst({ where: { clientId: client.id, isHq: true }, select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } })
        const details = { name: place.name, latitude: place.latitude, longitude: place.longitude, radiusMeters: place.radiusMeters ?? null }
        if (hq) {
            const changed = (Object.keys(details) as (keyof typeof details)[]).some(k => hq[k] !== details[k])
            if (changed && !can(session.user as any, "locations.manage", { companyId: client.companyId })) throw new Error("TASK_LOCATION_FORBIDDEN")
            await tx.location.update({ where: { id: hq.id }, data: details })
        }
        else await tx.location.create({ data: { ...details, companyId: client.companyId, clientId: client.id, isHq: true, createdById: actor(session).byUser } })
        await syncClientLocation(tx, client.id)
    }
}
