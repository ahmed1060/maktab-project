import { randomBytes } from "crypto"

// Excludes visually-ambiguous characters (0/O, 1/l/I) since this is read
// off a screen once and typed back in by whoever it's handed to.
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*"

/**
 * Generates a random temporary password for admin-initiated resets.
 * Never persisted — the caller hashes it immediately and returns the
 * plaintext to the admin exactly once.
 */
export function generateTempPassword(length = 16): string {
    const bytes = randomBytes(length)
    let out = ""
    for (let i = 0; i < length; i++) {
        out += CHARSET[bytes[i] % CHARSET.length]
    }
    return out
}
