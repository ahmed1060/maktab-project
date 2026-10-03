import { NextAuthOptions } from "next-auth"
import { resolveBundles, serializeAccess } from "@/lib/features"
import { summarizeSubscription } from "@/lib/billing/summary"
import { isBlockedBySubscription } from "@/lib/billing/state"
import { parseModuleIcons, parseModuleOverrides } from "@/lib/modules"
import { parseTheme } from "@/lib/theme"
import CredentialsProvider from "next-auth/providers/credentials"
import { RoleService, PREVIEW_LASTS_MS } from "@/lib/services/role.service"
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
                let loginKey: string | null = null
                try {
                    // Rate Limiting (5 attempts per 15 minutes per IP)
                    // headers() is async since Next 15.
                    const headerList = await headers()
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
                    // Counted first and handed back below when the attempt turns
                    // out not to be a failure: the step that only asks for the
                    // two-factor code, and a sign-in that succeeds. Only wrong
                    // passwords and wrong codes use up the five — otherwise two
                    // two-factor sign-ins in a row locked the account out, and a
                    // whole office behind one address shared five sign-ins.
                    loginKey = `login:${ip}`
                    const { limited, resetAt } = await RateLimiter.getLimitData(loginKey, 5, 15 * 60 * 1000)
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
                        // The package rides along so feature access can be resolved
                        // at sign-in rather than only at the first throttled
                        // re-check — otherwise a fresh login would see every gated
                        // module locked for up to a minute.
                        include: {
                            company: {
                                include: {
                                    package: true,
                                    // The furthest-reaching confirmed period, for the
                                    // subscription state. Seeded at sign-in as well as
                                    // refreshed on the throttle, so a login is not
                                    // stateless for its first minute.
                                    payments: {
                                        where: { status: 'PAID' },
                                        orderBy: { endDate: 'desc' },
                                        take: 1,
                                        select: { endDate: true, graceExtensionHours: true },
                                    },
                                },
                            },
                        }
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

                        await RateLimiter.refund(loginKey)
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
                            theme: parseTheme(superAdmin.theme),
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

                    // Subscription lockout, beside the ban check for the same
                    // reason: both are "this company cannot be worked in right
                    // now", and one path is easier to reason about than two.
                    //
                    // The company's own Admin is deliberately still allowed in.
                    // They land on the subscription-expired page, which is the
                    // only way the account can be renewed — locking them out
                    // would leave it with nobody able to fix it.
                    const loginSubscription = summarizeSubscription(validatedUser.company)
                    if (loginSubscription && isBlockedBySubscription(loginSubscription.state, validatedUser.role)) {
                        throw new Error('This company\'s subscription has expired. Please contact your administrator.')
                    }

                    if (validatedUser.status === 'SUSPENDED' || validatedUser.status === 'DELETED') {
                        throw new Error('Your account has been suspended or deleted.')
                    }

                    // ARCHIVED is the end of a contract, and it blocks login on
                    // its own line rather than joining the one above. The record
                    // stays whole — payslips have to be reissuable years later —
                    // so nothing else stops an archived person signing in, and
                    // the message has to be its own: telling somebody whose
                    // contract ended that they were "suspended or deleted" sends
                    // them to an administrator to fix something that is not
                    // broken.
                    if (validatedUser.status === 'ARCHIVED') {
                        throw new Error('This account is closed. Please contact your administrator.')
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

                    await RateLimiter.refund(loginKey)

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
                        moduleLabels: parseModuleOverrides(validatedUser.company?.moduleLabels),
                        logoUrl: validatedUser.company?.logoUrl || null,
                        moduleIcons: parseModuleIcons(validatedUser.company?.moduleIcons),
                        featureAccess: serializeAccess(resolveBundles(validatedUser.company?.package)),
                        subscription: summarizeSubscription(validatedUser.company),
                        username: validatedUser.username,
                        language: validatedUser.language || 'en',
                        theme: parseTheme(validatedUser.theme),
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
                    if (loginKey && (error as Error)?.message === 'MFA_REQUIRED') await RateLimiter.refund(loginKey)
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
                session.user.roleId = token.roleId ?? null
                session.user.grants = token.grants ?? ""
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
                session.user.theme = token.theme as string | undefined
                session.user.mustChangePassword = !!token.mustChangePassword
                session.user.isProtected = !!token.isProtected
                session.user.emailVerified = !!token.emailVerified
                session.user.mfaEnabled = !!token.mfaEnabled
                session.user.userStatus = token.userStatus as string | undefined
                session.user.companyBanned = !!token.companyBanned
                session.user.maintenanceMode = !!token.maintenanceMode
                session.user.maintenanceMessage = token.maintenanceMessage as string | null | undefined
                session.user.moduleLabels = token.moduleLabels as Record<string, string> | null | undefined
                session.user.moduleIcons = token.moduleIcons as Record<string, string> | null | undefined
                session.user.logoUrl = token.logoUrl as string | null | undefined
                session.user.featureAccess = token.featureAccess as any
                session.user.subscription = token.subscription as any
                // When this session last confirmed a high-risk action (§6.15).
                session.user.stepUpAt = token.stepUpAt ?? null

                // Previewing a role (ROLES_PLAN.md §6.6): the Super Admin is
                // presented as a holder of it in its company — its kind, its
                // grants, the company's package — so every screen and route
                // answers as it would for them. The real identity stays in the
                // token; withStandardHandler refuses every write meanwhile.
                const preview = token.role === 'SUPER_ADMIN' ? token.preview : null
                session.user.preview = preview ? { roleId: preview.roleId, roleName: preview.roleName, roleBuiltIn: preview.roleBuiltIn ?? null, companyId: preview.companyId, companyName: preview.companyName } : null
                if (preview) {
                    session.user.role = preview.baseRole
                    session.user.roleId = preview.roleId
                    session.user.grants = preview.grants
                    session.user.companyId = preview.companyId
                    session.user.companyName = preview.companyName
                    session.user.featureAccess = preview.featureAccess as any
                    session.user.subscription = null as any
                }
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
                // Seeded at sign-in only. The cookie is what the server reads
                // per request; this exists so a first sign-in on a new browser
                // can adopt the preference the account already carries.
                token.theme = parseTheme((user as any).theme)
                token.mustChangePassword = (user as any).mustChangePassword || false
                token.isProtected = (user as any).isProtected || false
                token.emailVerified = (user as any).emailVerified || false
                token.mfaEnabled = (user as any).mfaEnabled || false
                token.userStatus = (user as any).userStatus
                token.companyBanned = (user as any).companyBanned || false
                // Read live, not hardcoded false — a session created while
                // maintenance is already on must reflect that immediately.
                // Previously this was seeded false unconditionally and only
                // corrected on the first 60s-throttled refresh below, so a
                // fresh login during active maintenance got a session that
                // claimed maintenance was off and could write data through
                // it — the one thing maintenance mode exists to prevent.
                const signInSettings = await prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { maintenanceMode: true, maintenanceMessage: true } })
                token.maintenanceMode = signInSettings?.maintenanceMode || false
                token.maintenanceMessage = signInSettings?.maintenanceMessage || null
                // Seeded here so they're populated immediately rather than
                // only after the first 60s-throttled refresh below; null for a
                // SuperAdmin sign-in, who has no one company whose names these
                // would be — they see the built-in defaults.
                token.moduleLabels = (user as any).moduleLabels || null
                token.moduleIcons = (user as any).moduleIcons || null
                token.logoUrl = (user as any).logoUrl || null
                token.featureAccess = (user as any).featureAccess || null
                token.subscription = (user as any).subscription || null
                token.checkedAt = Date.now()
                token.jti = uuidv4()
                // What they may do: their role's grants (ROLES_PLAN.md §4.4).
                // The Super Admin is outside the role system and holds none.
                if (user.role !== 'SUPER_ADMIN') Object.assign(token, await RoleService.forToken(user.id as string))

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
            // within ~90s on its own via a live DB check + client-side
            // redirect (maintenance-mode activation is near-instant instead,
            // via a Realtime broadcast — see UserHeartbeat.tsx), so a 60s
            // staleness window here (which only matters for middleware's
            // next page-navigation redirect, a secondary path) costs
            // nothing extra.
            // Skip on initial sign-in (!user check) — token.checkedAt was
            // just seeded above in that branch.
            // A token issued before roles were data carries no grants, and
            // can() gives nothing to someone without them. Load them now, on
            // its first request, rather than leave the person refused
            // everything until the next minute's check.
            if (token.sub && !user && token.role !== 'SUPER_ADMIN' && token.grants === undefined) {
                try {
                    Object.assign(token, await RoleService.forToken(token.sub as string))
                } catch (e) {
                    console.error("[AUTH] Loading role grants failed — revoking session", e)
                    return {} as any
                }
            }

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
                            // A preview follows the role as it is edited, and
                            // ends with it if it is deleted.
                            if (token.preview) {
                                const startedAt = token.preview.startedAt
                                token.preview = await RoleService.previewOf(token.preview.roleId)
                                    .then(p => ({ ...p, startedAt }))
                                    .catch(() => null)
                            }
                            token.isProtected = sa?.isProtected || false
                            token.emailVerified = !!sa?.emailVerifiedAt
                            token.mfaEnabled = sa?.mfaEnabled || false
                        } else {
                            // Maintenance mode fetched alongside, in parallel — same
                            // 60s throttle as everything else here, no extra round trip.
                            const [u, settings] = await Promise.all([
                                prisma.user.findUnique({
                                    where: { id: userId },
                                    select: {
                                        sessionVersion: true, status: true, emailVerifiedAt: true, mfaEnabled: true,
                                        role: true, roleId: true, assignedRole: { select: { version: true } },
                                        actingUntil: true,
                                        company: {
                                            select: {
                                                isBanned: true,
                                                // Refreshed rather than only seeded at sign-in:
                                                // the point of letting a Super Admin rename a
                                                // module is that the rename shows up, not that it
                                                // waits for whenever that company next logs in.
                                                moduleLabels: true, moduleIcons: true,
                                                logoUrl: true,
                                                // Same reasoning: assigning or changing a package
                                                // has to take effect promptly, not only after the
                                                // customer next signs in.
                                                package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } },
                                                // The furthest-reaching confirmed period,
                                                // for the subscription state. NULLs sort
                                                // first on DESC in Postgres, so a lifetime
                                                // row wins — correctly: nothing outlasts a
                                                // subscription that never ends.
                                                createdAt: true,
                                                trialPreset: true,
                                                trialExtensionDays: true,
                                                payments: {
                                                    where: { status: 'PAID' },
                                                    orderBy: { endDate: 'desc' },
                                                    take: 1,
                                                    select: { endDate: true, graceExtensionHours: true },
                                                },
                                            },
                                        },
                                    }
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
                            // Vendors feature: deliberately refreshed here rather than
                            // only seeded at sign-in like companyName is — the whole
                            // point of letting a Super Admin rename this tab is that it
                            // takes effect promptly, not just after the next login.
                            token.moduleLabels = parseModuleOverrides(u?.company?.moduleLabels)
                            token.moduleIcons = parseModuleIcons(u?.company?.moduleIcons)
                            token.logoUrl = u?.company?.logoUrl || null
                            // Null package resolves to unrestricted — grandfathered.
                            token.featureAccess = serializeAccess(resolveBundles(u?.company?.package))
                            // Refreshed on the same throttle: a lockout that only
                            // took effect at the next sign-in would let somebody
                            // work all day past their grace period.
                            token.subscription = summarizeSubscription(u?.company)
                            // Reassigned, or their role edited: reload what they
                            // may do, without signing them out. Both are compared —
                            // every role starts at version 1, so a move between
                            // two unedited roles changes only the id (§4.4).
                            //
                            // And once an acting role is over (§6.13): the grants
                            // of the role they return to, from then on, rather
                            // than whenever the nightly job moves them back.
                            const actingOver = !!u?.actingUntil && u.actingUntil <= new Date() && !token.actingEnded
                            if (u && ((u.roleId ?? null) !== (token.roleId ?? null) || (u.assignedRole?.version ?? 0) !== (token.roleVersion ?? 0) || actingOver)) {
                                const loaded = await RoleService.forToken(userId)
                                Object.assign(token, loaded)
                                token.role = loaded.role ?? u.role
                            }
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

            // A preview nobody ended ends by itself.
            if (token.preview && Date.now() - token.preview.startedAt > PREVIEW_LASTS_MS) token.preview = null

            // Start or end previewing a role (§6.6). The Super Admin's alone:
            // the real role in the token decides, never what the client sends.
            if (trigger === 'update' && session && 'previewRoleId' in session && token.role === 'SUPER_ADMIN' && token.sub) {
                const { AuditLogService } = await import("./services/audit-log.service")
                if (token.preview) {
                    await AuditLogService.log('END_ROLE_PREVIEW', 'ROLE', token.preview.roleId, { superAdminId: token.sub, details: {} })
                    token.preview = null
                }
                if (typeof session.previewRoleId === 'string') {
                    try {
                        token.preview = await RoleService.previewOf(session.previewRoleId)
                        await AuditLogService.log('START_ROLE_PREVIEW', 'ROLE', token.preview.roleId, {
                            superAdminId: token.sub,
                            details: { companyId: token.preview.companyId, roleName: token.preview.roleName },
                        })
                    } catch {
                        token.preview = null
                    }
                }
            }

            // Step-up confirmation (ROLES_PLAN.md §6.15): the code is checked
            // here, against the account's own secret, and only then is the
            // time written into the signed token — the browser can ask, never
            // tell. Fixed from this moment; nothing else extends it. Attempts
            // are limited in the database, not the token, since an older
            // cookie could be replayed to reset a count kept in it.
            if (trigger === 'update' && session && typeof session.stepUpCode === 'string' && token.sub) {
                const { limited } = await RateLimiter.getLimitData(`step-up:${token.sub}`, 5, 15 * 60 * 1000)
                if (!limited) {
                    const select = { mfaEnabled: true, mfaSecret: true } as const
                    const row = token.role === 'SUPER_ADMIN'
                        ? await prisma.superAdmin.findUnique({ where: { id: token.sub as string }, select })
                        : await prisma.user.findUnique({ where: { id: token.sub as string }, select })
                    if (row?.mfaEnabled && row.mfaSecret && await MfaService.verifyStoredCode(row.mfaSecret, session.stepUpCode)) {
                        token.stepUpAt = Date.now()
                    }
                }
            }

            // On session update (client-side update() call)
            if (trigger === 'update' && session) {
                // Which fields, not their values: a step-up code rides in here.
                console.log('JWT Update Triggered:', Object.keys(session))
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

                // The flags the dashboard is gated on — a forced password
                // reset, a verified email, MFA — and the address itself are
                // never taken from the client. `session` is whatever the
                // browser passes to update(), so trusting it let anybody call
                // update({ emailVerified: true, mustChangePassword: false })
                // from the console and walk past both gates in proxy.ts. The
                // callers ask only after the server has changed the row
                // (email confirmed, MFA set up or removed, password changed),
                // so re-reading it gives them the new value; a client claiming
                // otherwise gets the database's answer.
                const asksAboutSecurity = ['mustChangePassword', 'emailVerified', 'email', 'mfaEnabled'].some(key => session[key] !== undefined)
                if (asksAboutSecurity && token.sub) {
                    const select = { email: true, emailVerifiedAt: true, mfaEnabled: true, mustChangePassword: true } as const
                    const row = token.role === 'SUPER_ADMIN'
                        ? await prisma.superAdmin.findUnique({ where: { id: token.sub as string }, select })
                        : await prisma.user.findUnique({ where: { id: token.sub as string }, select })
                    if (row) {
                        token.mustChangePassword = row.mustChangePassword
                        token.emailVerified = !!row.emailVerifiedAt
                        token.email = row.email
                        token.mfaEnabled = row.mfaEnabled
                    }
                }
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
