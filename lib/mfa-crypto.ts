import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// F-27: reversible encryption for SuperAdmin.mfaSecret / User.mfaSecret.
// Unlike a password hash, this has to come back out — the server reads
// the plaintext secret to compute the expected TOTP code on every login.
// MFA_ENCRYPTION_KEY is a distinct env var from F-02's deleted
// ENCRYPTION_KEY (different purpose, generated fresh — see the
// remediation log), never a fallback default: an unset key fails closed
// rather than silently encrypting with something guessable.
const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
    const raw = process.env.MFA_ENCRYPTION_KEY
    if (!raw) {
        throw new Error('MFA_ENCRYPTION_KEY is not set')
    }
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) {
        throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes (generate with: openssl rand -base64 32)')
    }
    return key
}

export function encryptMfaSecret(plaintext: string): string {
    const key = getKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptMfaSecret(ciphertext: string): string {
    const key = getKey()
    const [ivHex, authTagHex, dataHex] = ciphertext.split(':')
    if (!ivHex || !authTagHex || !dataHex) {
        throw new Error('Malformed MFA secret ciphertext')
    }
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()])
    return decrypted.toString('utf8')
}
