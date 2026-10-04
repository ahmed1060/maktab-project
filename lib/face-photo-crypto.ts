import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Encryption for face photos at rest (ATTENDANCE_PLAN.md §9.5): the
 * verification and reference photos, and flagged check-in frames. A key of
 * their own, FACE_PHOTO_KEY, separate from every other secret, the way
 * lib/mfa-crypto.ts does it for MFA secrets: a leaked database dump alone
 * reveals no face. Unset fails closed.
 *
 * Stored as iv (12) | tag (16) | ciphertext.
 *
 * Rotating the key (mobile/README.md, "Rotating FACE_PHOTO_KEY"): the new key
 * in FACE_PHOTO_KEY, the old one in FACE_PHOTO_KEY_PREVIOUS. Photos are
 * written with the new key and read with either, until every stored one has
 * been re-encrypted (FacePhotoKeyService.rekey) and the old key is removed.
 */
const ALGORITHM = 'aes-256-gcm'

type Env = Record<string, string | undefined>

function keyFrom(env: Env, name: 'FACE_PHOTO_KEY' | 'FACE_PHOTO_KEY_PREVIOUS'): Buffer {
    const key = Buffer.from(env[name] ?? '', 'base64')
    if (key.length !== 32) throw new Error(`${name} is not set, or is not 32 bytes base64 (openssl rand -base64 32)`)
    return key
}

function getKey(env: Env = process.env): Buffer {
    return keyFrom(env, 'FACE_PHOTO_KEY')
}

/** The old key while a rotation is under way; none otherwise. Set but malformed fails, as the current one does. */
function previousKey(env: Env = process.env): Buffer | null {
    return env.FACE_PHOTO_KEY_PREVIOUS ? keyFrom(env, 'FACE_PHOTO_KEY_PREVIOUS') : null
}

function decryptWith(key: Buffer, stored: Buffer): Buffer {
    const decipher = createDecipheriv(ALGORITHM, key, stored.subarray(0, 12))
    decipher.setAuthTag(stored.subarray(12, 28))
    return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()])
}

/** The key a stored photo opens with, and the photo; null if neither key opens it. */
function open(stored: Buffer, env?: Env): { photo: Buffer; current: boolean } | null {
    const current = getKey(env)
    const previous = previousKey(env)
    try { return { photo: decryptWith(current, stored), current: true } } catch { /* not this key */ }
    if (previous) try { return { photo: decryptWith(previous, stored), current: false } } catch { /* nor this one */ }
    return null
}

export function encryptFacePhoto(photo: Buffer, env?: Env): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, getKey(env), iv)
    const encrypted = Buffer.concat([cipher.update(photo), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
}

/** A stored photo, with the current key or, during a rotation, the previous one. Throws if neither opens it. */
export function decryptFacePhoto(stored: Buffer, env?: Env): Buffer {
    const opened = open(stored, env)
    if (!opened) throw new Error('FACE_PHOTO_UNREADABLE')
    return opened.photo
}

/**
 * A stored photo moved to the current key: "current" when it already is,
 * the new ciphertext when the previous key opened it, "unreadable" when
 * neither key does (written with a key that is gone).
 */
export function reencryptFacePhoto(stored: Buffer, env?: Env): Buffer | 'current' | 'unreadable' {
    const opened = open(stored, env)
    if (!opened) return 'unreadable'
    if (opened.current) return 'current'
    return encryptFacePhoto(opened.photo, env)
}

/** A JPEG, by its first bytes: the only kind the app sends. */
export function isJpeg(photo: Buffer): boolean {
    return photo.length > 3 && photo[0] === 0xff && photo[1] === 0xd8 && photo[2] === 0xff
}
