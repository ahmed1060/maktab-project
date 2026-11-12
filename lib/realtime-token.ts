import { createHmac } from "node:crypto"

/**
 * The token that lets a browser listen to its private live-update channels
 * (REALTIME_PLAN.md). Supabase checks it with the project's JWT secret and
 * hands its claims to the rules on realtime.messages
 * (prisma/migrations/20261208000000_live_updates), which read sub,
 * company_id and super_admin, and sees_online: whether its person may see
 * who's online, as the Employees list shows it, which the rule for that
 * channel can't read from the app's permissions
 * (prisma/migrations/20261214000000_live_online); and sees_attendance:
 * whether its person may see other people's attendance, for the attendance
 * channel's rule (prisma/migrations/20261216000000_live_attendance).
 *
 * It opens nothing but the channels: the signals on them say only that
 * something changed, and every read still goes through the app's own routes.
 * Signed here, with node:crypto, rather than with a library: a JWT is a header,
 * the claims, and an HMAC of the two.
 */

/** An hour; the browser asks for another five minutes before it ends. */
export const REALTIME_TOKEN_SECONDS = 3600

type Viewer = { id: string; role: string; companyId?: string | null }

export type RealtimeClaims = {
    sub: string
    role: "authenticated"
    aud: "authenticated"
    iat: number
    exp: number
    company_id: string | null
    super_admin: boolean
    sees_online: boolean
    sees_attendance: boolean
}

export function realtimeClaims(viewer: Viewer, nowSeconds: number, seesOnline = false, seesAttendance = false): RealtimeClaims {
    return {
        sub: viewer.id,
        role: "authenticated",
        aud: "authenticated",
        iat: nowSeconds,
        exp: nowSeconds + REALTIME_TOKEN_SECONDS,
        company_id: viewer.companyId ?? null,
        super_admin: viewer.role === "SUPER_ADMIN",
        sees_online: seesOnline,
        sees_attendance: seesAttendance,
    }
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

export function signRealtimeToken(claims: RealtimeClaims, secret: string): string {
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`
    return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`
}
