import { createHash, randomBytes, randomInt } from "node:crypto"

/**
 * The secrets a Local Sync Agent holds (ATTENDANCE_PLAN.md §17).
 *
 * An admin is shown a short enrolment code, typed into the agent on the
 * office PC; the agent exchanges it once for a long token it then sends on
 * every request. Only the sha256 of either is stored, so a copy of the
 * database lets nobody act as an agent. The code is short enough to type,
 * which is why it is single-use, expires, and enrolment is rate limited.
 */

/** No 0/O, 1/I/L: read off a screen and typed on another machine. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 8

/** How long an enrolment code works. */
export const ENROLMENT_CODE_MINUTES = 30

const TOKEN_PREFIX = "mka_"

export function hashSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex")
}

/** "K7QD-2MXP": eight characters, about 40 bits, shown with a dash. */
export function newEnrolmentCode(): string {
    let code = ""
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * The code as typed, made comparable: case, spaces and dashes ignored. Null
 * if it cannot be one — including a character the alphabet leaves out.
 */
export function normaliseEnrolmentCode(typed: string): string | null {
    const bare = typed.toUpperCase().replace(/[\s-]/g, "")
    if (bare.length !== CODE_LENGTH || [...bare].some(c => !CODE_ALPHABET.includes(c))) return null
    return `${bare.slice(0, 4)}-${bare.slice(4)}`
}

/** 256 random bits, prefixed so a leaked one is recognisable for what it is. */
export function newAgentToken(): string {
    return TOKEN_PREFIX + randomBytes(32).toString("base64url")
}

/** The token from an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null): string | null {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? "")
    return m && m[1].startsWith(TOKEN_PREFIX) ? m[1] : null
}
