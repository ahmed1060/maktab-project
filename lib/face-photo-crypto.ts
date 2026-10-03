import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Encryption for face photos at rest (ATTENDANCE_PLAN.md §9.5): the
 * verification and reference photos, and flagged check-in frames. A key of
 * their own, FACE_PHOTO_KEY, separate from every other secret, the way
 * lib/mfa-crypto.ts does it for MFA secrets: a leaked database dump alone
 * reveals no face. Unset fails closed.
 *
 * Stored as iv (12) | tag (16) | ciphertext.
 */
const ALGORITHM = 'aes-256-gcm'

function getKey(env: Record<string, string | undefined> = process.env): Buffer {
    const raw = env.FACE_PHOTO_KEY
    if (!raw) throw new Error('FACE_PHOTO_KEY is not set, or is not 32 bytes base64 (openssl rand -base64 32)')
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) throw new Error('FACE_PHOTO_KEY is not set, or is not 32 bytes base64 (openssl rand -base64 32)')
    return key
}

export function encryptFacePhoto(photo: Buffer, env?: Record<string, string | undefined>): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, getKey(env), iv)
    const encrypted = Buffer.concat([cipher.update(photo), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
}

export function decryptFacePhoto(stored: Buffer, env?: Record<string, string | undefined>): Buffer {
    const decipher = createDecipheriv(ALGORITHM, getKey(env), stored.subarray(0, 12))
    decipher.setAuthTag(stored.subarray(12, 28))
    return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()])
}

/** A JPEG, by its first bytes: the only kind the app sends. */
export function isJpeg(photo: Buffer): boolean {
    return photo.length > 3 && photo[0] === 0xff && photo[1] === 0xd8 && photo[2] === 0xff
}
