import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { v4 as uuidv4 } from 'uuid'

import { headers } from "next/headers"
import { RateLimiter, getClientIp } from "./api-utils"
import { MfaService } from "./services/mfa.service"
import { VerificationCodeService } from "./services/verification-code.service"
import { TrustedDeviceService } from "./services/trusted-device.service"

// F-17: a bcrypt.compare against a real hash takes measurably longer than
// returning immediately, so an unknown email used to return in ~0ms while a
// known one took ~80-150ms — a clear timing side-channel for enumerating
// accounts, on top of the status-check throws below leaking the same thing
// outright. Comparing against this fixed dummy hash for an unknown email
// keeps that comparison's cost in the same ballpark as a real one. This
// closes the "unknown email" gap specifically; SuperAdmin and User accounts
// still hash at different bcrypt cost factors (12 vs 10) elsewhere in the
// app, so it isn't a fully constant-time login path end to end.
// Exported so app/api/auth/mfa-recovery/request/route.ts — a second
// password-checking surface outside authorize() itself — stays identical
// rather than drifting from a copy-pasted literal.
export const DUMMY_PASSWORD_HASH = '$2b$10$8l1DIcjsHF.SoFHAsE28xOtbx8gG8u0PwT7GhO1wvcDXHycZLKgB.'

/**
 * F-27, Phase 5: the actual login-time MFA gate, shared between the
 * SuperAdmin and User branches of authorize() below.
 *
 * A trusted-device cookie skips this entirely. Otherwise: an
 * mfaRecoveryCode (the "email me a code instead" fallback) is checked
 * against VerificationCode; an mfaCode is checked against the account's
 * TOTP secret; if neither was submitted, this is the *first* pass through
 * authorize() for this login and the client needs to ask for one —
 * MFA_REQUIRED is not a failure, it's the expected first response for
 * every MFA-enabled account's login.
 */
async function checkMfaChallenge(params: {
    email: string
    mfaEnabled: boolean
    mfaSecret: string | null
    owner: { userId?: string; superAdminId?: string }
    mfaCode?: string
    mfaRecoveryCode?: string
    cookieHeader: string | null
}): Promise<void> {
    if (!params.mfaEnabled) return

    if (await TrustedDeviceService.isTrusted(params.cookieHeader, params.owner)) return

    if (params.mfaRecoveryCode) {
        const ok = await VerificationCodeService.verify(params.email, 'MFA_RECOVERY', params.mfaRecoveryCode)
        if (!ok) throw new Error('INVALID_MFA_CODE')
        return
    }

    if (params.mfaCode) {
        const ok = params.mfaSecret ? await MfaService.verifyStoredCode(params.mfaSecret, params.mfaCode) : false
        if (!ok) throw new Error('INVALID_MFA_CODE')
        return
    }

    throw new Error('MFA_REQUIRED')
}

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                companyId: { label: "Company", type: "text" },
                remember: { label: "Remember", type: "text" },
                // F-27: present only on the second round-trip of an
                // MFA-enabled login — see checkMfaChallenge above.
                mfaCode: { label: "MFA Code", type: "text" },
                mfaRecoveryCode: { label: "MFA Recovery Code", type: "text" }
            },
            async authorize(credentials) {
                try {
                    // Rate Limiting (5 attempts per 15 minutes per IP)
                    const headerList = headers()
                    // F-10: was reading the raw x-forwarded-for header, which is a
                    // client-controllable list an attacker can rotate to reset which
                    // rate-limit bucket they land in.
                    const ip = getClientIp(headerList)
                    // F-27: read here once, from the same next/headers() call this
                    // route handler already makes for the IP above, rather than
                    // trying to get a cookie out of authorize()'s own (req)
                    // parameter — NextAuth v4 genuinely doesn't pass cookies
                    // through there (checked its actual call site, not just the
                    // .d.ts, which under-declares what's available either way).
                    const cookieHeader = headerList.get('cookie')
                    const { limited, resetAt } = await RateLimiter.getLimitData(`login:${ip}`, 5, 15 * 60 * 1000)
                    if (limited) {
                        const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        throw new Error(`Too many login attempts. Please try again at ${timeStr}.`)
                    }

                    const remember = credentials?.remember === 'true'

                    if (!credentials?.email || !credentials?.password) {
                        return null
                    }

                    // F-15: login shouldn't re-validate email format at all — it should
                    // only compare credentials against whatever's on file. (The old
                    // regex here also rejected most real addresses: no .com, no
                    // local part over 20 chars, no domain label over 10.)
                    // F-16: no password length gate on login either — bcrypt truncates
                    // at 72 bytes, and whatever length restriction applied when the
                    // password was *set* already constrains what a legitimate login
                    // attempt looks like.

                    // F-17: look up the account and run bcrypt.compare exactly once,
                    // before any account-state branching, so neither the timing nor
                    // an early-thrown error can reveal whether the email is registered
                    // or what state that account is in to someone who doesn't already
                    // have the correct password.
                    const superAdmin = await prisma.superAdmin.findUnique({
                        where: { email: credentials.email }
                    })
                    const user = superAdmin ? null : await prisma.user.findUnique({
                        where: { email: credentials.email },
                        include: { company: true }
                    })

                    const passwordHash = superAdmin?.password || user?.password || DUMMY_PASSWORD_HASH
                    const isValid = await bcrypt.compare(credentials.password, passwordHash)

                    if (!isValid) {
                        if (superAdmin || user) {
                            const { AuditLogService } = await import("./services/audit-log.service")
                            await AuditLogService.log('LOGIN_FAILURE', 'USER', (superAdmin || user)!.id, {
                                userId: user ? user.id : null,
                                superAdminId: superAdmin ? superAdmin.id : null,
                                details: { email: credentials.email, reason: 'INVALID_PASSWORD', ip }
                            })
                        }
                        // F-18: no audit row for an unknown email — that was one
                        // AuditLog insert per guess, an unbounded, attacker-controlled
                        // write. The rate limiter above already tracks this IP; a
                        // failed guess against a real account is still logged, since
                        // that volume is bounded by how many accounts actually exist.
                        return null
                    }

                    // Password confirmed correct — only now do account-state checks,
                    // so their specific error messages only ever reach someone who
                    // already holds the real password.
                    if (superAdmin) {
                        // F-27: before the login is considered complete, not after —
                        // a login that only fails the MFA step must never reach the
                        // LOGIN audit entry below.
                        await checkMfaChallenge({
                            email: superAdmin.email,
                            mfaEnabled: (superAdmin as any).mfaEnabled || false,
                            mfaSecret: (superAdmin as any).mfaSecret || null,
                            owner: { superAdminId: superAdmin.id },
                            mfaCode: credentials.mfaCode,
                            mfaRecoveryCode: credentials.mfaRecoveryCode,
                            cookieHeader,
                        })

                        const { AuditLogService } = await import("./services/audit-log.service")
                        await AuditLogService.log('LOGIN', 'USER', superAdmin.id, {
                            superAdminId: superAdmin.id,
                            details: { email: superAdmin.email, role: 'SUPER_ADMIN' }
                        })

                        return {
                            id: superAdmin.id,
                            name: `${superAdmin.firstName} ${superAdmin.lastName}`,
                            email: superAdmin.email,
                            role: 'SUPER_ADMIN',
                            firstName: superAdmin.firstName,
                            lastName: superAdmin.lastName,
                            gender: superAdmin.gender || 'MALE',
                            avatar: superAdmin.avatar || null,
                            image: superAdmin.avatar || null, // Map to standard NextAuth field
                            companyId: null,
                            companyName: 'SHSD',
                            username: superAdmin.username,
                            language: superAdmin.language || 'en',
                            sessionVersion: (superAdmin as any).sessionVersion || 0,
                            mustChangePassword: (superAdmin as any).mustChangePassword || false,
                            isProtected: (superAdmin as any).isProtected || false,
                            emailVerified: !!(superAdmin as any).emailVerifiedAt,
                            mfaEnabled: (superAdmin as any).mfaEnabled || false,
                            remember
                            // No userStatus/companyBanned — SuperAdmin has neither concept.
                        }
                    }

                    // user is guaranteed set here: isValid was only true because either
                    // superAdmin or user's real hash matched, and the superAdmin branch
                    // above already returned.
                    const validatedUser = user!

                    // Verify Company (If selected)
                    if (credentials.companyId && credentials.companyId !== validatedUser.companyId) {
                        throw new Error('This user does not belong to the selected company.')
                    }

                    // Check for Company Ban Status
                    if (validatedUser.company?.isBanned) {
                        throw new Error('Company access restricted. Please contact support.')
                    }

                    if (validatedUser.status === 'SUSPENDED' || validatedUser.status === 'DELETED') {
                        throw new Error('Your account has been suspended or deleted.')
                    }

                    // F-27: before the login is considered complete, not after — see
                    // the matching comment in the SuperAdmin branch above.
                    await checkMfaChallenge({
                        email: validatedUser.email,
                        mfaEnabled: (validatedUser as any).mfaEnabled || false,
                        mfaSecret: (validatedUser as any).mfaSecret || null,
                        owner: { userId: validatedUser.id },
                        mfaCode: credentials.mfaCode,
                        mfaRecoveryCode: credentials.mfaRecoveryCode,
                        cookieHeader,
                    })

                    // Update generic user status
                    try {
                        await prisma.user.update({
                            where: { id: validatedUser.id },
                            data: { status: 'ACTIVE', lastActivity: new Date() }
                        })
                    } catch (e) { console.error('[AUTH_STATUS_UPDATE_FAIL]', e) }

                    // Audit Log (Success - Centralized)
                    const { AuditLogService } = await import("./services/audit-log.service")
                    await AuditLogService.log('LOGIN', 'USER', validatedUser.id, {
                        userId: validatedUser.id,
                        details: { email: validatedUser.email, role: validatedUser.role, company: validatedUser.company?.name }
                    })

                    return {
                        id: validatedUser.id,
                        name: `${validatedUser.firstName} ${validatedUser.lastName}`,
                        email: validatedUser.email,
                        role: validatedUser.role,
                        firstName: validatedUser.firstName,
                        lastName: validatedUser.lastName,
                        gender: validatedUser.gender || 'MALE',
                        avatar: validatedUser.avatar || null,
                        image: validatedUser.avatar || null, // Map to standard NextAuth field
                        companyId: validatedUser.companyId,
                        companyName: validatedUser.company?.name || null,
                        username: validatedUser.username,
                        language: validatedUser.language || 'en',
                        sessionVersion: (validatedUser as any).sessionVersion || 0,
                        mustChangePassword: (validatedUser as any).mustChangePassword || false,
                        // F-11: seed the merged revocation/suspension check's fields at
                        // sign-in so they're populated immediately, not just after the
                        // jwt() callback's first throttled re-check up to 60s later.
                        userStatus: 'ACTIVE', // just set above; not validatedUser.status, which is pre-login-update
                        companyBanned: validatedUser.company?.isBanned || false,
                        emailVerified: !!(validatedUser as any).emailVerifiedAt,
                        mfaEnabled: (validatedUser as any).mfaEnabled || false,
                        remember
                    }

                } catch (error) {
                    console.error('Auth error:', error)
                    throw error
                }
            }
        })
    ],
    callbacks: {
        async session({ session, token }) {
            if (session.user) {
                // Map all possible variations to ensure visibility
                const avatar = (token.avatar || token.image || token.picture) as string | null

                session.user.id = token.sub as string
                session.user.role = token.role as string
                session.user.firstName = token.firstName as string
                session.user.lastName = token.lastName as string
                session.user.gender = token.gender as string
                session.user.avatar = avatar
                session.user.image = avatar
                session.user.picture = avatar
                session.user.companyId = token.companyId as string | null
                session.user.companyName = token.companyName as string | null
                session.user.username = token.username as string
                session.user.language = token.language as string
                session.user.mustChangePassword = !!token.mustChangePassword
                session.user.isProtected = !!token.isProtected
                session.user.emailVerified = !!token.emailVerified
                session.user.mfaEnabled = !!token.mfaEnabled
                session.user.userStatus = token.userStatus as string | undefined
                session.user.companyBanned = !!token.companyBanned
                session.user.maintenanceMode = !!token.maintenanceMode
                session.user.maintenanceMessage = token.maintenanceMessage as string | null | undefined
            }
            return session
        },
        async jwt({ token, user, trigger, session }) {
            // Initial sign in
            if (user) {
                token.role = user.role
                token.firstName = user.firstName
                token.lastName = user.lastName
                token.gender = user.gender
                token.sessionVersion = (user as any).sessionVersion || 0
                // Store in multiple fields to be safe against stripping
                const avatarUrl = user.avatar || user.image || null
                token.avatar = avatarUrl
                token.image = avatarUrl
                token.picture = avatarUrl
                token.companyId = user.companyId
                token.companyName = user.companyName
                token.username = user.username
                token.language = user.language || 'en'
                token.mustChangePassword = (user as any).mustChangePassword || false
                token.isProtected = (user as any).isProtected || false
                token.emailVerified = (user as any).emailVerified || false
                token.mfaEnabled = (user as any).mfaEnabled || false
                token.userStatus = (user as any).userStatus
                token.companyBanned = (user as any).companyBanned || false
                token.maintenanceMode = false
                token.checkedAt = Date.now()
                token.jti = uuidv4()

                // Store remember flag in token
                if ('remember' in user) {
                    token.remember = (user as any).remember
                }
            }

            // DYNAMIC EXPIRATION LOGIC
            // If the user didn't check "Stay Signed In", we force the token to expire in 24 hours.
            if (token.remember === false) {
                const oneDayInSeconds = 24 * 60 * 60
                const now = Math.floor(Date.now() / 1000)
                const currentExp = token.exp as number | undefined

                if (!currentExp || currentExp > now + oneDayInSeconds) {
                    token.exp = now + oneDayInSeconds
                }
            }

            // --- SESSION REVOCATION + SUSPENSION CHECK (F-11, merged) ---
            // This used to be two separate DB round trips on every request:
            // this callback queried for sessionVersion on every JWT
            // evaluation, and withStandardHandler ran its own separate
            // user.findUnique for the suspension check. Merged into one
            // query that also feeds session.user.userStatus/companyBanned
            // (see the session() callback above and withStandardHandler
            // below, which reads those instead of querying again), and
            // throttled to once every 60s per token rather than every
            // request — UserHeartbeat already propagates a real suspension
            // (or maintenance-mode activation) within ~15-20s on its own via
            // a live DB check + client-side redirect, so a 60s staleness
            // window here (which only matters for middleware's next
            // page-navigation redirect, a secondary path) costs nothing extra.
            // Skip on initial sign-in (!user check) — token.checkedAt was
            // just seeded above in that branch.
            if (token.sub && !user) {
                const lastChecked = token.checkedAt || 0
                const checkIntervalMs = 60_000

                if (Date.now() - lastChecked > checkIntervalMs) {
                    try {
                        const userId = token.sub as string
                        const userRole = token.role as string

                        let dbVersion = 0
                        if (userRole === 'SUPER_ADMIN') {
                            const sa = await prisma.superAdmin.findUnique({
                                where: { id: userId },
                                select: { sessionVersion: true, isProtected: true, emailVerifiedAt: true, mfaEnabled: true }
                            })
                            dbVersion = sa?.sessionVersion || 0
                            token.isProtected = sa?.isProtected || false
                            token.emailVerified = !!sa?.emailVerifiedAt
                            token.mfaEnabled = sa?.mfaEnabled || false
                        } else {
                            // Maintenance mode fetched alongside, in parallel — same
                            // 60s throttle as everything else here, no extra round trip.
                            const [u, settings] = await Promise.all([
                                prisma.user.findUnique({
                                    where: { id: userId },
                                    select: { sessionVersion: true, status: true, company: { select: { isBanned: true } }, emailVerifiedAt: true, mfaEnabled: true }
                                }),
                                prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { maintenanceMode: true, maintenanceMessage: true } })
                            ])
                            dbVersion = u?.sessionVersion || 0
                            token.userStatus = u?.status
                            token.companyBanned = u?.company?.isBanned || false
                            token.emailVerified = !!u?.emailVerifiedAt
                            token.mfaEnabled = u?.mfaEnabled || false
                            token.maintenanceMode = settings?.maintenanceMode || false
                            token.maintenanceMessage = settings?.maintenanceMessage || null
                        }

                        if (token.sessionVersion === undefined) {
                            token.sessionVersion = dbVersion
                            console.log(`[AUTH] Initialized missing sessionVersion for user ${userId} to ${dbVersion}`)
                        } else {
                            const tokenVersion = token.sessionVersion as number

                            // If DB version is higher than token version, revoke!
                            if (dbVersion > tokenVersion) {
                                console.log(`[AUTH] REVOKING session for user ${userId} (Token:${tokenVersion} vs DB:${dbVersion})`)
                                return {} as any // Empty token = invalid session
                            }
                        }

                        token.checkedAt = Date.now()
                    } catch (e) {
                        // F-11: fail closed, not open. A DB blip used to just log and
                        // allow the (possibly already-revoked or suspended) session
                        // through unchanged, which meant making the database
                        // unhappy was itself a way to defeat revocation.
                        console.error("[AUTH] Revocation/suspension check failed — revoking session", e)
                        return {} as any
                    }
                }
            }

            // On session update (client-side update() call)
            if (trigger === 'update' && session) {
                console.log('JWT Update Triggered:', session)
                if (session.firstName !== undefined) token.firstName = session.firstName
                if (session.lastName !== undefined) token.lastName = session.lastName
                if (session.gender !== undefined) token.gender = session.gender

                // Allow both 'avatar' and 'image' as keys in the update call
                const newAvatar = session.avatar !== undefined ? session.avatar : session.image
                if (newAvatar !== undefined) {
                    token.avatar = newAvatar
                    token.image = newAvatar
                    token.picture = newAvatar
                }
                if (session.language !== undefined) token.language = session.language
                if (session.mustChangePassword !== undefined) token.mustChangePassword = session.mustChangePassword
                if (session.emailVerified !== undefined) token.emailVerified = session.emailVerified
                if (session.email !== undefined) token.email = session.email
                if (session.mfaEnabled !== undefined) token.mfaEnabled = session.mfaEnabled
            }
            return token
        }
    },
    pages: {
        signIn: '/login',
    },
    session: {
        strategy: "jwt",
        maxAge: 30 * 24 * 60 * 60, // 30 Days (Persistent Cookie)
    },
    secret: process.env.NEXTAUTH_SECRET,
}
