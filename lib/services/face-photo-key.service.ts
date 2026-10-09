import { prisma } from "@/lib/prisma"
import { reencryptFacePhoto, rotationKeysSame } from "@/lib/face-photo-crypto"
import { AuditLogService } from "@/lib/services/audit-log.service"

type Actor = { id: string; role: string }
type Stored = { id: string; photo: Uint8Array | null }

/**
 * Photos read at a time: each can be up to 400 KB, so a whole table at once
 * could exhaust a serverless function's memory (review on #33).
 */
const PAGE = 25
/** Photos one press re-encrypts, so a press ends well inside a function's time limit; press again for the rest. */
const PER_RUN = 200
/**
 * Photos one press reads, moved or not: photos already on the new key are
 * read to be passed over, and a press that read every photo each time made
 * a large rotation's total work grow with the square of its size (review on #33).
 */
const READS_PER_RUN = 1000

const TABLES = {
    review: (after: string) => prisma.faceReview.findMany({ where: { id: { gt: after }, photo: { not: null } }, select: { id: true, photo: true }, orderBy: { id: "asc" }, take: PAGE }),
    frame: (after: string) => prisma.faceFrame.findMany({ where: { id: { gt: after } }, select: { id: true, photo: true }, orderBy: { id: "asc" }, take: PAGE }),
}

type Table = keyof typeof TABLES
/** Where a run stopped: the last photo it read. The next run reads on from there. */
export type RekeyFrom = { table: Table; after: string }

/** Every stored face photo (verification and reference photos, flagged frames), a page at a time, from `from` on. */
async function* storedPhotos(from: RekeyFrom | null = null): AsyncGenerator<[Table, Stored]> {
    const tables = Object.keys(TABLES) as Table[]
    for (const table of tables.slice(from ? tables.indexOf(from.table) : 0)) {
        let after = from && table === from.table ? from.after : ""
        for (;;) {
            const rows = await TABLES[table](after)
            for (const row of rows) yield [table, row]
            if (rows.length < PAGE) break
            after = rows[rows.length - 1].id
        }
    }
}

/**
 * Rotating FACE_PHOTO_KEY (mobile/README.md, "Rotating FACE_PHOTO_KEY"):
 * with the new key set and the old one as FACE_PHOTO_KEY_PREVIOUS, moves
 * every stored face photo to the new key, so the old one can be removed.
 */
export class FacePhotoKeyService {
    /**
     * Whether a rotation is on, at once: status() reads every stored photo,
     * so the face card asks this with its own status and holds the rotation's
     * place meanwhile (Codex review on #49).
     */
    static rotating(): boolean {
        return !!process.env.FACE_PHOTO_KEY_PREVIOUS
    }

    /**
     * Where a rotation stands: nothing while no previous key is set (no
     * photo is opened then); that the two keys are the same, if they are;
     * otherwise how many photos are still on the old key, and how many no
     * key opens.
     */
    static async status() {
        if (!FacePhotoKeyService.rotating()) return { rotating: false as const }
        if (rotationKeysSame()) return { rotating: true as const, sameKey: true as const }
        let total = 0, previous = 0, unreadable = 0
        for await (const [, row] of storedPhotos()) {
            total++
            const r = reencryptFacePhoto(Buffer.from(row.photo!))
            if (r === "unreadable") unreadable++
            else if (r !== "current") previous++
        }
        return { rotating: true as const, total, previous, unreadable }
    }

    /**
     * Re-encrypts up to PER_RUN photos still on the previous key with the
     * current one, reading at most READS_PER_RUN, from where the last run
     * stopped (`from`); `next` is where this one stopped, null once it reached
     * the end. New photos are written with the current key, so none behind a
     * run's place can need moving. Each row is written only if it still holds
     * what was read, so a photo replaced or deleted meanwhile is left as it
     * now is. A photo no key opens is counted, not touched. For any Super
     * Admin (the route checks): nothing is shown or deleted, and once all are
     * moved a run does nothing more. It says what this run did, not where the
     * whole rotation stands: that is status(), read once at the end.
     */
    static async rekey(session: { user: Actor }, from: RekeyFrom | null = null, limits = { moves: PER_RUN, reads: READS_PER_RUN }) {
        if (!process.env.FACE_PHOTO_KEY_PREVIOUS) throw new Error("FACE_KEY_NOT_ROTATING")
        if (rotationKeysSame()) throw new Error("FACE_KEY_SAME")
        let moved = 0, unreadable = 0, read = 0
        let next: RekeyFrom | null = null
        for await (const [table, row] of storedPhotos(from)) {
            if (moved >= limits.moves || read >= limits.reads) break
            read++
            next = { table, after: row.id }
            const stored = Buffer.from(row.photo!)
            const r = reencryptFacePhoto(stored)
            if (r === "unreadable") unreadable++
            if (r === "current" || r === "unreadable") continue
            const where = { id: row.id, photo: { equals: new Uint8Array(stored) } }
            const { count } = table === "review"
                ? await prisma.faceReview.updateMany({ where, data: { photo: new Uint8Array(r) } })
                : await prisma.faceFrame.updateMany({ where, data: { photo: new Uint8Array(r) } })
            moved += count
        }
        // Stopped at a limit: the next run reads on from here. Read to the end: nothing is left behind it.
        const stopped = moved >= limits.moves || read >= limits.reads
        await AuditLogService.log("REKEY_FACE_PHOTOS", "SYSTEM", "default", { superAdminId: session.user.id, details: { moved, unreadable } })
        return { moved, unreadable, next: stopped ? next : null }
    }
}
