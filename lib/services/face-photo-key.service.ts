import { prisma } from "@/lib/prisma"
import { reencryptFacePhoto, rotationKeysSame } from "@/lib/face-photo-crypto"
import { AuditLogService } from "@/lib/services/audit-log.service"

type Actor = { id: string; role: string }
type Stored = { id: string; photo: Uint8Array | null }

/** Every stored face photo: verification and reference photos, flagged frames. */
async function storedPhotos(): Promise<{ reviews: Stored[]; frames: Stored[] }> {
    const [reviews, frames] = await Promise.all([
        prisma.faceReview.findMany({ where: { photo: { not: null } }, select: { id: true, photo: true } }),
        prisma.faceFrame.findMany({ select: { id: true, photo: true } }),
    ])
    return { reviews, frames }
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
        const { reviews, frames } = await storedPhotos()
        let previous = 0, unreadable = 0
        for (const row of [...reviews, ...frames]) {
            const r = reencryptFacePhoto(Buffer.from(row.photo!))
            if (r === "unreadable") unreadable++
            else if (r !== "current") previous++
        }
        return { rotating: true as const, total: reviews.length + frames.length, previous, unreadable }
    }

    /**
     * Re-encrypts every photo still on the previous key with the current one.
     * Each row is written only if it still holds what was read, so a photo
     * replaced or deleted meanwhile is left as it now is. A photo no key
     * opens is counted, not touched. For any Super Admin (the route checks):
     * nothing is shown or deleted, and running it again does nothing more.
     */
    static async rekey(session: { user: Actor }) {
        if (!process.env.FACE_PHOTO_KEY_PREVIOUS) throw new Error("FACE_KEY_NOT_ROTATING")
        if (rotationKeysSame()) throw new Error("FACE_KEY_SAME")
        const { reviews, frames } = await storedPhotos()
        let moved = 0, unreadable = 0
        for (const [table, rows] of [["review", reviews], ["frame", frames]] as const) {
            for (const row of rows) {
                const stored = Buffer.from(row.photo!)
                const r = reencryptFacePhoto(stored)
                if (r === "current") continue
                if (r === "unreadable") { unreadable++; continue }
                const where = { id: row.id, photo: { equals: new Uint8Array(stored) } }
                const { count } = table === "review"
                    ? await prisma.faceReview.updateMany({ where, data: { photo: new Uint8Array(r) } })
                    : await prisma.faceFrame.updateMany({ where, data: { photo: new Uint8Array(r) } })
                moved += count
            }
        }
        await AuditLogService.log("REKEY_FACE_PHOTOS", "SYSTEM", "default", { superAdminId: session.user.id, details: { moved, unreadable } })
        return { moved, unreadable, ...(await FacePhotoKeyService.status()) }
    }
}
