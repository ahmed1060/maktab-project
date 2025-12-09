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
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                try {
                    console.log('--- LOGIN ATTEMPT START ---')
                    console.log('1. Authorize called with email:', credentials?.email)

                    if (!credentials?.email || !credentials?.password) {
                        console.log('2. Missing credentials')
                        return null
                    }

                    console.log('3. Finding user in DB...')
                    const user = await prisma.user.findUnique({ where: { email: credentials.email } })
                    console.log('4. User found result:', user ? 'User exists' : 'User not found')

                    if (user) {
                        console.log('4.1 User details:', JSON.stringify({
                            id: user.id,
                            email: user.email,
                            role: user.role,
                            hasPassword: !!user.password,
                            status: user.status
                        }))
                    }

                    if (!user) return null

                    // Check if user is suspended
                    if (user.status === 'SUSPENDED') {
                        console.log('5. User is suspended')
                        throw new Error('Your account has been suspended. Please contact an administrator.')
                    }

                    console.log('6. Comparing password...')
                    const isValid = await bcrypt.compare(credentials.password, user.password)
                    console.log('7. Password valid:', isValid)

                    if (!isValid) return null

                    console.log('8. Updating user status...')
                    // Update user status to ACTIVE and lastActivity on successful login
                    try {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: {
                                status: 'ACTIVE',
                                lastActivity: new Date()
                            }
                        })
                        console.log('9. User status updated')
                    } catch (updateError) {
                        console.error('9.1 Error updating user status (non-fatal):', updateError)
                    }

                    const returnUser = {
                        id: user.id,
                        name: `${user.firstName} ${user.lastName}`,
                        email: user.email,
                        role: user.role,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        gender: user.gender || 'MALE',
                        avatar: user.avatar || null
                    }
                    console.log('10. Returning user object:', JSON.stringify(returnUser))
                    console.log('--- LOGIN ATTEMPT SUCCESS ---')
                    return returnUser

                } catch (error) {
                    console.error('--- LOGIN ATTEMPT ERROR ---')
                    console.error('Auth error details:', error)
                    if (error instanceof Error) {
                        console.error('Error message:', error.message)
                        console.error('Error stack:', error.stack)
                    }
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
                // We don't necessarily need to expose jti to the client session unless needed, 
                // but it's good for debugging if the user wants to see it.
                // (session.user as any).jti = token.jti 
            }
            return session
        },
        async jwt({ token, user }) {
            if (user) {
                token.role = user.role
                token.firstName = user.firstName
                token.lastName = user.lastName
                token.gender = user.gender
                token.avatar = user.avatar
                // Add unique session ID
                token.jti = uuidv4()
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
