import { describe, it, expect } from "vitest"
import { randomBytes } from "crypto"
import { decryptFacePhoto, encryptFacePhoto, reencryptFacePhoto } from "./face-photo-crypto"

/**
 * Rotating FACE_PHOTO_KEY (mobile/README.md): with the new key set and the
 * old one as FACE_PHOTO_KEY_PREVIOUS, the photos stored before still open,
 * and each can be moved to the new key; without the old key they can't.
 */
const key = () => randomBytes(32).toString("base64")
const photo = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])

describe("face photo key rotation", () => {
    const oldKey = key(), newKey = key()
    const before = encryptFacePhoto(photo, { FACE_PHOTO_KEY: oldKey })
    const rotating = { FACE_PHOTO_KEY: newKey, FACE_PHOTO_KEY_PREVIOUS: oldKey }

    it("opens a photo stored with the previous key", () => {
        expect(decryptFacePhoto(before, rotating)).toEqual(photo)
    })

    it("moves a photo to the new key, which then opens it alone", () => {
        const moved = reencryptFacePhoto(before, rotating)
        expect(Buffer.isBuffer(moved)).toBe(true)
        expect(decryptFacePhoto(moved as Buffer, { FACE_PHOTO_KEY: newKey })).toEqual(photo)
        expect(reencryptFacePhoto(moved as Buffer, rotating)).toBe("current")
    })

    it("says so when no key it has opens a photo", () => {
        expect(reencryptFacePhoto(before, { FACE_PHOTO_KEY: newKey })).toBe("unreadable")
        expect(() => decryptFacePhoto(before, { FACE_PHOTO_KEY: newKey })).toThrow("FACE_PHOTO_UNREADABLE")
    })

    it("refuses a malformed previous key rather than ignoring it", () => {
        expect(() => decryptFacePhoto(before, { FACE_PHOTO_KEY: newKey, FACE_PHOTO_KEY_PREVIOUS: "short" })).toThrow("FACE_PHOTO_KEY_PREVIOUS")
    })

    it("still reads and writes with the current key alone", () => {
        expect(decryptFacePhoto(encryptFacePhoto(photo, { FACE_PHOTO_KEY: newKey }), { FACE_PHOTO_KEY: newKey })).toEqual(photo)
        expect(() => encryptFacePhoto(photo, {})).toThrow("FACE_PHOTO_KEY is not set")
    })
})
