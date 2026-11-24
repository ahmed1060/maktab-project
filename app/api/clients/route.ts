import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createClientSchema, updateClientSchema } from "@/lib/validations/client.schema"
import { ClientService } from "@/lib/services/client.service"
import { can } from "@/lib/permissions/can"
import { sessionHasModule } from "@/lib/features/require"
import { taxFiguresOld } from "@/lib/services/tax-claim.service"

// Each client's HQ (CLIENTS_PLAN.md §2.2), for its details and its form.
const HQ = { where: { isHq: true }, select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true } } as const

// Read with clients.view — a Team Leader holds it (they pick a client when
// creating a task) but none of adding, editing or deleting one; writes are
// checked per-method below.
export const GET = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    if (!can(session.user, "clients.view")) {
        return ApiResponse.forbidden()
    }

    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('id')

    if (clientId) {
        const client = await prisma.client.findUnique({ where: { id: clientId }, include: { locations: HQ } })
        if (!client) return ApiResponse.notFound("Client not found")
        if (!can(session.user, "clients.view", { companyId: client.companyId })) return ApiResponse.forbidden()
        return ApiResponse.success(client)
    }

    let companyId: string | undefined
    if (userRole === 'SUPER_ADMIN') {
        // No companyId means "all companies" — an aggregate view, not an
        // error. The frontend uses this when the Super Admin hasn't picked
        // one company via the switcher.
        companyId = searchParams.get('companyId') || undefined
    } else {
        if (!userCompanyId) return ApiResponse.success([])
        companyId = userCompanyId
    }

    // In use unless asked (CLIENTS_PLAN.md §4.3): what's picked from leaves
    // archived clients out; ?archived=1 lists those, and ?archived=all both,
    // as a filter keeps them.
    const archived = searchParams.get('archived')
    // That a client has a tax position is for whoever may delete it, whose
    // menu says Archive in place of Delete, and why (CLIENT_PORTAL_PLAN.md
    // §3.6). How many of its claims are open is its tax position's to say:
    // given only to those of them who may see tax positions, by their role
    // and their company's package.
    const deletes = can(session.user, "clients.delete")
    const seesTax = deletes && can(session.user, "tax.view") && sessionHasModule(session, "TAX_POSITION")
    // That it has people who can sign in is for whoever may delete it too,
    // whose menu says Archive in place of Delete, and why; how many is for
    // those of them who may manage who signs in for a client, by their role
    // and their company's package (§3.6, PR 329).
    const seesPeople = deletes && can(session.user, "client_accounts.view") && sessionHasModule(session, "TAX_POSITION")
    // How old a client's figures are, where they're 30 days old or more
    // (§4.3, PR 321), is for whoever may see tax positions, by their role and
    // their company's package: whose file is due shows on the list.
    const seesTaxDays = can(session.user, "tax.view") && sessionHasModule(session, "TAX_POSITION")
    const clients = await prisma.client.findMany({
        where: {
            ...(companyId ? { companyId } : {}),
            ...(archived === 'all' ? {} : { archivedAt: archived === '1' ? { not: null } : null }),
        },
        orderBy: { name: 'asc' },
        include: {
            // Whether deleting it archives it instead: it has tasks or
            // records, a tax position, or people who can sign in
            // (CLIENT_PORTAL_PLAN.md §3.6).
            _count: { select: { tasks: true, taxClaims: true, accounts: true } },
            recordSections: { where: { records: { some: {} } }, select: { id: true }, take: 1 },
            taxPosition: { select: { clientId: true, asOf: true } },
            // createdBy is null for a Super-Admin-created client (the FK
            // only targets User) — the frontend shows a generic "Super
            // Admin" label in that case rather than nothing.
            createdBy: { select: { firstName: true, lastName: true } },
            locations: HQ,
            // Company name is only needed to label rows in the Super
            // Admin's aggregate ("all companies") view — a non-Super-Admin
            // request is always scoped to their own single company already.
            ...(userRole === 'SUPER_ADMIN' ? { company: { select: { name: true } } } : {})
        }
    })

    // Counted to today where each client's own company is, and only where it's asked for.
    const old = seesTaxDays ? await taxFiguresOld(clients) : new Map<string, number>()

    return ApiResponse.success(clients.map(({ _count, recordSections, taxPosition, ...client }) => ({
        ...client,
        // Held by its tasks or records: it stays in the archive.
        inUse: _count.tasks > 0 || recordSections.length > 0,
        // A file uploaded for it, with claims open or none.
        ...(deletes ? { hasTax: _count.taxClaims > 0 || !!taxPosition } : {}),
        ...(seesTax ? { taxClaims: _count.taxClaims } : {}),
        ...(deletes ? { hasPeople: _count.accounts > 0 } : {}),
        ...(seesPeople ? { people: _count.accounts } : {}),
        ...(old.has(client.id) ? { taxDaysOld: old.get(client.id) } : {}),
    })))
})

export const POST = withStandardHandler(async (req, session, json) => {
    if (!can(session.user, "clients.create")) {
        return ApiResponse.forbidden()
    }

    const validation = createClientSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await ClientService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if (error.message === 'COMPANY_SELECTION_REQUIRED') return ApiResponse.badRequest("Company selection required for Super Admin")
        if (error.message === 'USER_NO_COMPANY') return ApiResponse.forbidden("User is not assigned to a company")
        // Unique constraint on (name, companyId)
        if (error.code === 'P2002') return ApiResponse.badRequest("A client with this name already exists")

        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    // Editing is clients.edit's; restoring from the archive undoes archiving,
    // so it's clients.delete's (LATER_CHANGES_PLAN.md §2, PR 365). Whoever
    // holds neither is refused before the body is read.
    if (!can(session.user, "clients.edit") && !can(session.user, "clients.delete")) {
        return ApiResponse.forbidden()
    }

    const validation = updateClientSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }
    if (!can(session.user, validation.data.restore ? "clients.delete" : "clients.edit")) {
        return ApiResponse.forbidden()
    }

    try {
        // Restored from the archive (CLIENTS_PLAN.md §4.3).
        if (validation.data.restore) return ApiResponse.success(await ClientService.restore(validation.data.id, session))
        const result = await ClientService.update(validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.notFound("Client not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()
        // Said under its field, as the schema's refusals are (PR 406).
        if (error.message === 'NAME_IN_BOTH_LANGUAGES') return ApiResponse.badRequest("Validation Error", { [error.field]: { _errors: [error.why] } })
        if (error.code === 'P2002') return ApiResponse.badRequest("A client with this name already exists")

        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (!can(session.user, "clients.delete")) {
        return ApiResponse.forbidden()
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return ApiResponse.badRequest("ID required")

    try {
        // One with tasks, records, a tax position or people who can sign in is archived instead
        // (CLIENTS_PLAN.md §4.3; CLIENT_PORTAL_PLAN.md §3.6), and says which. ?archive=1 archives it whatever it holds now:
        // what the person confirmed. ?force=1 deletes an archived one for good, where no task or
        // record holds it.
        const result = await ClientService.delete(id, session, { archive: searchParams.get('archive') === '1', forGood: searchParams.get('force') === '1' })
        return ApiResponse.success({ success: true, id, archived: result.archived, forTax: result.forTax, forPeople: result.forPeople })
    } catch (error: any) {
        if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.notFound("Client not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()

        throw error
    }
})
