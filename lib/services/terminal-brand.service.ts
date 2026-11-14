import { Prisma, type TerminalProtocol } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AuditLogService } from "./audit-log.service"

/**
 * Terminal brands (ATTENDANCE_PLAN.md §17.9, Phase 4 part 3, PR 279): what is
 * printed on a fingerprint terminal, kept by the Super Admin for every
 * company, apart from the protocol Nizmo and the agent speak to it.
 *
 * - Protocols are code: only the ones Nizmo speaks are taken.
 * - Names are unique, ignoring capitals (a unique index on lower(name)).
 * - A brand's protocol stays while any terminal has it, retired or not:
 *   changing it under a working terminal would cut it off.
 * - One no terminal has had is deleted; one a terminal has is retired
 *   instead, and isn't offered for new terminals until it's put back
 *   (DESIGN.md §5.5, Row menu).
 * - Each change is written to the audit log, as templates' are.
 */

export const TERMINAL_PROTOCOLS: readonly TerminalProtocol[] = ["ZKTECO", "HIKVISION"]

export type TerminalBrandInput = { name: string; protocol: TerminalProtocol; notesEn?: string | null; notesAr?: string | null }
export type TerminalBrandRow = {
    id: string
    name: string
    protocol: TerminalProtocol
    notesEn: string | null
    notesAr: string | null
    retiredAt: string | null
    /** How many terminals have it printed on them, retired ones too. */
    terminalCount: number
}

function fail(code: string): never {
    throw new Error(code)
}

const text = (value: string | null | undefined) => value?.trim() || null

type Row = { id: string; name: string; protocol: TerminalProtocol; notesEn: string | null; notesAr: string | null; retiredAt: Date | null; _count: { devices: number } }
const SELECT = { id: true, name: true, protocol: true, notesEn: true, notesAr: true, retiredAt: true, _count: { select: { devices: true } } } as const
const shape = (b: Row): TerminalBrandRow => ({
    id: b.id, name: b.name, protocol: b.protocol, notesEn: b.notesEn, notesAr: b.notesAr,
    retiredAt: b.retiredAt ? b.retiredAt.toISOString() : null, terminalCount: b._count.devices,
})

/** The checked fields of a brand, or a refusal saying what's wrong. */
function checked(input: TerminalBrandInput) {
    const name = input.name?.trim() ?? ""
    if (!name) fail("BRAND_NAME_REQUIRED")
    if (!TERMINAL_PROTOCOLS.includes(input.protocol)) fail("BRAND_PROTOCOL_UNKNOWN")
    return { name, protocol: input.protocol, notesEn: text(input.notesEn), notesAr: text(input.notesAr) }
}

/** Another brand of this name, ignoring capitals. */
async function clash(name: string, except: string | null, client: Prisma.TransactionClient = prisma) {
    const other = await client.terminalBrand.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(except ? { NOT: { id: except } } : {}) }, select: { id: true } })
    if (other) fail("BRAND_NAME_TAKEN")
}

/** Two saved at once with the same name: the index refuses the second. */
function nameTakenOnRace(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("BRAND_NAME_TAKEN")
    throw error
}

/** Holds the brand's row until the change is done, so no terminal takes it meanwhile (a terminal's brand takes a key-share lock on it). */
async function locked(tx: Prisma.TransactionClient, id: string) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "TerminalBrand" WHERE id = ${id} FOR UPDATE`
    if (!row) fail("BRAND_NOT_FOUND")
    const brand = await tx.terminalBrand.findUnique({ where: { id }, select: SELECT })
    return brand ?? fail("BRAND_NOT_FOUND")
}

export class TerminalBrandService {
    /** Every brand, the ones offered first and the retired after them, each by name. */
    static async list(): Promise<TerminalBrandRow[]> {
        const rows = await prisma.terminalBrand.findMany({ select: SELECT })
        return rows
            .map(shape)
            .sort((a, b) => Number(a.retiredAt !== null) - Number(b.retiredAt !== null) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    }

    static async create(input: TerminalBrandInput, superAdminId: string): Promise<TerminalBrandRow> {
        const data = checked(input)
        await clash(data.name, null)
        const created = await prisma.terminalBrand.create({ data: { ...data, createdById: superAdminId }, select: SELECT }).catch(nameTakenOnRace)
        await AuditLogService.log("CREATE_TERMINAL_BRAND", "TERMINAL_BRAND", created.id, { superAdminId, details: { name: data.name, protocol: data.protocol } })
        return shape(created)
    }

    /** Its name and notes at any time; its protocol only while no terminal has it. */
    static async update(id: string, input: TerminalBrandInput, superAdminId: string): Promise<TerminalBrandRow> {
        const data = checked(input)
        const { before, after } = await prisma.$transaction(async tx => {
            const before = await locked(tx, id)
            if (data.protocol !== before.protocol && before._count.devices > 0) fail("BRAND_PROTOCOL_IN_USE")
            await clash(data.name, id, tx)
            const after = await tx.terminalBrand.update({ where: { id }, data, select: SELECT }).catch(nameTakenOnRace)
            return { before, after }
        })
        const changes: Record<string, { from: string | null; to: string | null }> = {}
        for (const field of ["name", "protocol", "notesEn", "notesAr"] as const) {
            if (before[field] !== after[field]) changes[field] = { from: before[field], to: after[field] }
        }
        await AuditLogService.log("UPDATE_TERMINAL_BRAND", "TERMINAL_BRAND", id, { superAdminId, details: { name: after.name, changes } })
        return shape(after)
    }

    /** Stops offering it for new terminals; those that have it keep it. */
    static async retire(id: string, superAdminId: string): Promise<TerminalBrandRow> {
        const brand = await prisma.terminalBrand.findUnique({ where: { id }, select: SELECT }) ?? fail("BRAND_NOT_FOUND")
        if (brand.retiredAt) fail("BRAND_RETIRED")
        const retired = await prisma.terminalBrand.update({ where: { id }, data: { retiredAt: new Date() }, select: SELECT })
        await AuditLogService.log("RETIRE_TERMINAL_BRAND", "TERMINAL_BRAND", id, { superAdminId, details: { name: brand.name } })
        return shape(retired)
    }

    /** Offers a retired brand for new terminals again. */
    static async restore(id: string, superAdminId: string): Promise<TerminalBrandRow> {
        const brand = await prisma.terminalBrand.findUnique({ where: { id }, select: SELECT }) ?? fail("BRAND_NOT_FOUND")
        if (!brand.retiredAt) fail("BRAND_NOT_RETIRED")
        const restored = await prisma.terminalBrand.update({ where: { id }, data: { retiredAt: null }, select: SELECT })
        await AuditLogService.log("RESTORE_TERMINAL_BRAND", "TERMINAL_BRAND", id, { superAdminId, details: { name: brand.name } })
        return shape(restored)
    }

    /** Deletes one no terminal has had; one a terminal has is retired instead. */
    static async remove(id: string, superAdminId: string): Promise<void> {
        const brand = await prisma.$transaction(async tx => {
            const brand = await locked(tx, id)
            if (brand._count.devices > 0) fail("BRAND_IN_USE")
            await tx.terminalBrand.delete({ where: { id } })
            return brand
        })
        await AuditLogService.log("DELETE_TERMINAL_BRAND", "TERMINAL_BRAND", id, { superAdminId, details: { name: brand.name, protocol: brand.protocol } })
    }
}
