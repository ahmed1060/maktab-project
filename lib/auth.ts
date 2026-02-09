import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { v4 as uuidv4 } from 'uuid'

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
                    const remember = credentials?.remember === 'true'

                    if (!credentials?.email || !credentials?.password) {
                        return null
                    }

                    // RESTRICTION SYNC: user(20)@domain(10).com
                    const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
                    if (!emailRegex.test(credentials.email)) {
                        return null
                    }

                    if (credentials.password.length < 6 || credentials.password.length > 20) {
                        return null
                    }

                    // 1. Check SuperAdmin Table first
                    const superAdmin = await prisma.superAdmin.findUnique({
                        where: { email: credentials.email }
                    })

                    if (superAdmin) {
                        const isValid = await bcrypt.compare(credentials.password, superAdmin.password)
                        if (!isValid) return null

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
                            remember
                        }
                    }

                    // 2. Check Regular User Table
                    const user = await prisma.user.findUnique({
                        where: { email: credentials.email },
                        include: { company: true }
                    })

                    if (!user) return null

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
                    if (!isValid) return null

                    // Update generic user status
                    try {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { status: 'ACTIVE', lastActivity: new Date() }
                        })
                    } catch (e) { console.error('[AUTH_STATUS_UPDATE_FAIL]', e) }

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
    secret: process.env.NEXTAUTH_SECRET || "secret",
}
