import { randomBytes, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'

export const TRUSTED_DEVICE_COOKIE = 'mfa_td'
const TRUSTED_DEVICE_TTL_DAYS = 30

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

// authorize() gets a raw Cookie header string, not a parsed cookie jar —
// NextAuth v4's credentials provider genuinely doesn't hand one over (only
// query/body/headers/method reach it; confirmed against next-auth's own
// call site, not assumed from its .d.ts). This is a plain a=b; c=d parser
// for that one string, not a general-purpose cookie library.
function readCookie(header: string | null | undefined, name: string): string | undefined {
    if (!header) return undefined
    for (const part of header.split(';')) {
        const idx = part.indexOf('=')
        if (idx === -1) continue
        if (part.slice(0, idx).trim() === name) {
            return decodeURIComponent(part.slice(idx + 1).trim())
        }
    }
    return undefined
}

type Owner = { userId?: string; superAdminId?: string }

/**
 * F-27, Phase 5: lets an MFA-enabled account skip the code prompt on a
 * browser it's already completed the challenge on once. The cookie alone
 * never grants login — authorize() only ever consults this *after* the
 * password already checked out, so stealing just this cookie is useless
 * without the password too.
 */
export class TrustedDeviceService {
    /** Read-only — called from authorize(), which can't set response
     * cookies itself. Touches lastUsedAt on a hit; the token in the
     * cookie is never persisted anywhere, only its hash. */
    static async isTrusted(cookieHeader: string | null | undefined, owner: Owner): Promise<boolean> {
        const token = readCookie(cookieHeader, TRUSTED_DEVICE_COOKIE)
        if (!token) return false

        const record = await prisma.trustedDevice.findFirst({
            where: {
                tokenHash: hashToken(token),
                revokedAt: null,
                expiresAt: { gt: new Date() },
                userId: owner.userId ?? undefined,
                superAdminId: owner.superAdminId ?? undefined,
            }
        })
        if (!record) return false

        await prisma.trustedDevice.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        return true
    }

    /** Called from a normal authenticated route, right after a login that
     * actually completed an MFA challenge, when the user checked "remember
     * this device". Returns the raw token — the caller is the one that can
     * actually set the response cookie. */
    static async issue(owner: Owner, label?: string): Promise<string> {
        const token = randomBytes(32).toString('base64url')
        const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000)

        await prisma.trustedDevice.create({
            data: {
                tokenHash: hashToken(token),
                expiresAt,
                label,
                userId: owner.userId,
                superAdminId: owner.superAdminId,
            }
        })

        return token
    }
}
