import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { v4 as uuidv4 } from 'uuid'

import { headers } from "next/headers"
import { RateLimiter } from "./api-utils"

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
                companyId: { label: "Company", type: "text" },
                remember: { label: "Remember", type: "text" }
            },
            async authorize(credentials) {
                try {
                    // Rate Limiting (5 attempts per 15 minutes per IP)
                    const headerList = headers()
                    const ip = headerList.get('x-forwarded-for') || 'unknown'
                    const { limited, resetAt } = await RateLimiter.getLimitData(`login:${ip}`, 5, 15 * 60 * 1000)
                    if (limited) {
                        const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        throw new Error(`Too many login attempts. Please try again at ${timeStr}.`)
                    }

                    const remember = credentials?.remember === 'true'

                    if (!credentials?.email || !credentials?.password) {
                        return null
                    }

                    // RESTRICTION SYNC: user(20)@domain(10).com
                    const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
                    if (!emailRegex.test(credentials.email)) {
                        return null
                    }

                    if (credentials.password.length < 8 || credentials.password.length > 20) {
                        return null
                    }

                    // 1. Check SuperAdmin Table first
                    const superAdmin = await prisma.superAdmin.findUnique({
                        where: { email: credentials.email }
                    })

                    if (superAdmin) {
                        const isValid = await bcrypt.compare(credentials.password, superAdmin.password)
                        if (!isValid) {
                            // Audit Log (Failure - Centralized)
                            const { AuditLogService } = await import("./services/audit-log.service")
                            await AuditLogService.log('LOGIN_FAILURE', 'USER', superAdmin.id, {
                                superAdminId: superAdmin.id,
                                details: { email: superAdmin.email, reason: 'INVALID_PASSWORD', ip }
                            })
                            return null
                        }

                        // Audit Log (Success - Centralized)
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
                            remember
                        }
                    }

                    // 2. Check Regular User Table
                    const user = await prisma.user.findUnique({
                        where: { email: credentials.email },
                        include: { company: true }
                    })

                    if (!user) {
                        // Audit Log (Failure - Unknown User - Centralized)
                        const { AuditLogService } = await import("./services/audit-log.service")
                        await AuditLogService.log('LOGIN_FAILURE', 'USER', 'UNKNOWN', {
                            details: { email: credentials.email, reason: 'USER_NOT_FOUND', ip }
                        })
                        return null
                    }

                    // Verify Company (If selected)
                    if (credentials.companyId && credentials.companyId !== user.companyId) {
                        throw new Error('This user does not belong to the selected company.')
                    }

                    // Check for Company Ban Status
                    if (user.company?.isBanned) {
                        throw new Error('Company access restricted. Please contact support.')
                    }

                    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
                        throw new Error('Your account has been suspended or deleted.')
                    }

                    const isValid = await bcrypt.compare(credentials.password, user.password)
                    if (!isValid) {
                        // Audit Log (Failure - Centralized)
                        const { AuditLogService } = await import("./services/audit-log.service")
                        await AuditLogService.log('LOGIN_FAILURE', 'USER', user.id, {
                            userId: user.id,
                            details: { email: user.email, reason: 'INVALID_PASSWORD', ip }
                        })
                        return null
                    }

                    // Update generic user status
                    try {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { status: 'ACTIVE', lastActivity: new Date() }
                        })
                    } catch (e) { console.error('[AUTH_STATUS_UPDATE_FAIL]', e) }

                    // Audit Log (Success - Centralized)
                    const { AuditLogService } = await import("./services/audit-log.service")
                    await AuditLogService.log('LOGIN', 'USER', user.id, {
                        userId: user.id,
                        details: { email: user.email, role: user.role, company: user.company?.name }
                    })

                    return {
                        id: user.id,
                        name: `${user.firstName} ${user.lastName}`,
                        email: user.email,
                        role: user.role,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        gender: user.gender || 'MALE',
                        avatar: user.avatar || null,
                        image: user.avatar || null, // Map to standard NextAuth field
                        companyId: user.companyId,
                        companyName: user.company?.name || null,
                        username: user.username,
                        language: user.language || 'en',
                        sessionVersion: (user as any).sessionVersion || 0,
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

            // --- SESSION REVOCATION CHECK (Wave 8) ---
            // On every JWT evaluation, we check if the session is still valid.
            // Skip check on initial sign-in (!user check)
            if (token.sub && !user) {
                try {
                    const userId = token.sub as string
                    const userRole = token.role as string

                    let dbVersion = 0
                    if (userRole === 'SUPER_ADMIN') {
                        const sa = await prisma.superAdmin.findUnique({
                            where: { id: userId },
                            select: { sessionVersion: true } as any
                        })
                        dbVersion = (sa as any)?.sessionVersion || 0
                    } else {
                        const u = await prisma.user.findUnique({
                            where: { id: userId },
                            select: { sessionVersion: true } as any
                        })
                        dbVersion = (u as any)?.sessionVersion || 0
                    }

                    const tokenVersion = token.sessionVersion as number || 0

                    // If DB version is higher than token version, revoke!
                    if (dbVersion > tokenVersion) {
                        console.log(`[AUTH] Revoking session for user ${userId} (Token:${tokenVersion} vs DB:${dbVersion})`)
                        return {} as any // Empty token = invalid session
                    }
                } catch (e) {
                    console.error("[AUTH] Revocation check failed, allowing session as fallback", e)
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
