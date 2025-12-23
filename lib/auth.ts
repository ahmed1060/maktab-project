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
                companyId: { label: "Company", type: "text" }
            },
            async authorize(credentials) {
                try {
                    console.log('--- LOGIN ATTEMPT START ---')
                    console.log('1. Authorize called with email:', credentials?.email)

                    if (!credentials?.email || !credentials?.password) {
                        return null
                    }

                    // 1. Check SuperAdmin Table first
                    const superAdmin = await prisma.superAdmin.findUnique({
                        where: { email: credentials.email }
                    })

                    if (superAdmin) {
                        console.log('User found in SuperAdmin table')
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
                            companyId: null, // Super Admins might not have a company
                            companyName: 'SHSD'
                        }
                    }

                    // 2. Check Regular User Table
                    console.log('Checking User table...')
                    const user = await prisma.user.findUnique({
                        where: { email: credentials.email },
                        include: { company: true }
                    })

                    if (!user) return null

                    // Verify Company (If selected)
                    if (credentials.companyId && credentials.companyId !== user.companyId) {
                        throw new Error('This user does not belong to the selected company.')
                    }

                    // Check for Company Ban Status (Raw Query because client is stale)
                    if (user.companyId) {
                        const companyStatus: any[] = await prisma.$queryRaw`SELECT "isBanned", name FROM "Company" WHERE id = ${user.companyId}`
                        if (companyStatus[0]?.isBanned) {
                            throw new Error('Company access restricted. Please contact support.')
                        }
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
                    } catch { }

                    return {
                        id: user.id,
                        name: `${user.firstName} ${user.lastName}`,
                        email: user.email,
                        role: user.role,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        gender: user.gender || 'MALE',
                        avatar: user.avatar || null,
                        companyId: user.companyId,
                        companyName: user.company?.name || null
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
                session.user.id = token.sub as string
                session.user.role = token.role
                session.user.firstName = token.firstName
                session.user.lastName = token.lastName
                session.user.gender = token.gender
                session.user.avatar = token.avatar
                session.user.companyId = token.companyId
                session.user.companyName = token.companyName
            }
            return session
        },
        async jwt({ token, user, trigger, session }) {
            if (user) {
                token.role = user.role
                token.firstName = user.firstName
                token.lastName = user.lastName
                token.gender = user.gender
                token.avatar = user.avatar
                token.companyId = user.companyId
                token.companyName = user.companyName
                token.jti = uuidv4()
            }
            if (trigger === 'update' && session) {
                if (session.firstName) token.firstName = session.firstName
                if (session.lastName) token.lastName = session.lastName
                if (session.gender) token.gender = session.gender
                if (session.avatar) token.avatar = session.avatar
            }
            return token
        }
    },
    pages: {
        signIn: '/login',
    },
    session: {
        strategy: "jwt",
    },
    secret: process.env.NEXTAUTH_SECRET || "secret",
}
