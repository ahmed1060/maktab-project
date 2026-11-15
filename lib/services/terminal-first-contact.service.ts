import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { FIRST_CONTACT_DAYS, keepingFor, roomFor } from "@/lib/attendance/terminal-first-contact"

/**
 * A terminal's first contacts, kept and read (ATTENDANCE_PLAN.md §17.8,
 * PR 294): the first 50 requests Nizmo takes from a terminal straight to
 * Nizmo in its first 7 days, 5 of a kind, each kept for 7 days, for the
 * Super Admin alone. What is kept of one is decided in
 * lib/attendance/terminal-first-contact.ts.
 */

export type KeptContact = {
    method: string
    /** The route's pattern, never the address: the address is the secret. */
    path: string
    headers: Record<string, string>
    otherHeaders: string[]
    body: string
    kind: string
    outcome: string[]
}

export class TerminalFirstContactService {
    /** How many are kept for a terminal, by kind: read before a request's body is, to know whether to keep a copy. */
    static async counts(deviceId: string, db: Prisma.TransactionClient = prisma): Promise<{ kind: string; count: number }[]> {
        const rows = await db.terminalFirstContact.groupBy({ by: ["kind"], where: { deviceId }, _count: { _all: true } })
        return rows.map(r => ({ kind: r.kind, count: r._count._all }))
    }

    /**
     * Keeps one request, while there is room for it and for its kind. The
     * terminal's first is marked on it, once: its 7 days run from then.
     *
     * One at a time for a terminal: two requests at once would each find
     * room for the last one, so what is kept is counted again here, with
     * the terminal's row held. Not FOR UPDATE: that also holds up a scan
     * being stored for the terminal, which takes a key share on its row.
     */
    static async keep(deviceId: string, contact: KeptContact, now = new Date()): Promise<boolean> {
        return prisma.$transaction(async tx => {
            const held = await tx.$queryRaw<{ firstContactAt: Date | null }[]>`SELECT "firstContactAt" FROM "AttendanceDevice" WHERE id = ${deviceId} FOR NO KEY UPDATE`
            if (held.length === 0) return false
            if (!held[0].firstContactAt) await tx.attendanceDevice.update({ where: { id: deviceId }, data: { firstContactAt: now } })
            if (!roomFor(await TerminalFirstContactService.counts(deviceId, tx), contact.kind)) return false
            await tx.terminalFirstContact.create({
                data: {
                    deviceId, receivedAt: now, method: contact.method.slice(0, 16), path: contact.path, headers: contact.headers as Prisma.InputJsonObject,
                    otherHeaders: contact.otherHeaders, body: contact.body, kind: contact.kind, outcome: contact.outcome,
                },
            })
            return true
        })
    }

    /**
     * A terminal's kept contacts, in the order they came, with whether
     * more are still kept and until when: the server's clock says so, not
     * the reader's.
     */
    static async list(deviceId: string, now = new Date()) {
        const device = await prisma.attendanceDevice.findUnique({ where: { id: deviceId }, select: { id: true, name: true, firstContactAt: true } })
        if (!device) return null
        const contacts = await prisma.terminalFirstContact.findMany({
            where: { deviceId },
            orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
            select: { id: true, receivedAt: true, method: true, path: true, headers: true, otherHeaders: true, body: true, kind: true, outcome: true },
        })
        return {
            name: device.name,
            firstContactAt: device.firstContactAt,
            keptUntil: device.firstContactAt ? new Date(device.firstContactAt.getTime() + FIRST_CONTACT_DAYS * 86_400_000) : null,
            keeping: keepingFor(device.firstContactAt, now),
            contacts,
        }
    }

    /** Deletes what has been kept for 7 days: the nightly job's. */
    static async prune(now = new Date()): Promise<number> {
        const { count } = await prisma.terminalFirstContact.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - FIRST_CONTACT_DAYS * 86_400_000) } } })
        return count
    }
}
