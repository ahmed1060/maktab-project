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

const TABLES = {
    review: (after: string) => prisma.faceReview.findMany({ where: { id: { gt: after }, photo: { not: null } }, select: { id: true, photo: true }, orderBy: { id: "asc" }, take: PAGE }),
    frame: (after: string) => prisma.faceFrame.findMany({ where: { id: { gt: after } }, select: { id: true, photo: true }, orderBy: { id: "asc" }, take: PAGE }),
}

/** Every stored face photo (verification and reference photos, flagged frames), a page at a time. */
async function* storedPhotos(): AsyncGenerator<[keyof typeof TABLES, Stored]> {
    for (const table of Object.keys(TABLES) as (keyof typeof TABLES)[]) {
        let after = ""
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
     * Where a rotation stands: nothing while no previous key is set (no
     * photo is opened then); that the two keys are the same, if they are;
     * otherwise how many photos are still on the old key, and how many no
     * key opens.
     */
    static async status() {
        if (!process.env.FACE_PHOTO_KEY_PREVIOUS) return { rotating: false as const }
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
     * current one; run again for the rest. Each row is written only if it
     * still holds what was read, so a photo replaced or deleted meanwhile is
     * left as it now is. A photo no key opens is counted, not touched. For
     * any Super Admin (the route checks): nothing is shown or deleted, and
     * once all are moved a run does nothing more.
     */
    static async rekey(session: { user: Actor }) {
        if (!process.env.FACE_PHOTO_KEY_PREVIOUS) throw new Error("FACE_KEY_NOT_ROTATING")
        if (rotationKeysSame()) throw new Error("FACE_KEY_SAME")
        let moved = 0
        for await (const [table, row] of storedPhotos()) {
            if (moved >= PER_RUN) break
            const stored = Buffer.from(row.photo!)
            const r = reencryptFacePhoto(stored)
            if (r === "current" || r === "unreadable") continue
            const where = { id: row.id, photo: { equals: new Uint8Array(stored) } }
            const { count } = table === "review"
                ? await prisma.faceReview.updateMany({ where, data: { photo: new Uint8Array(r) } })
                : await prisma.faceFrame.updateMany({ where, data: { photo: new Uint8Array(r) } })
            moved += count
        }
        const after = await FacePhotoKeyService.status()
        const unreadable = "unreadable" in after ? after.unreadable : 0
        await AuditLogService.log("REKEY_FACE_PHOTOS", "SYSTEM", "default", { superAdminId: session.user.id, details: { moved, unreadable } })
        return { moved, ...after }
    }
}
