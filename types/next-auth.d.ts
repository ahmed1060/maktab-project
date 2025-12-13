import NextAuth, { DefaultSession } from "next-auth"

declare module "next-auth" {
    interface Session {
        user: {
            id: string
            role: string
            firstName: string
            lastName: string
            gender?: string
            avatar?: string | null
            companyId?: string | null
            companyName?: string | null
        } & DefaultSession["user"]
    }

    interface User {
        id: string
        role: string
        firstName: string
        lastName: string
        gender?: string
        avatar?: string | null
        companyId?: string | null
        companyName?: string | null
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        role: string
        firstName: string
        lastName: string
        gender?: string
        avatar?: string | null
        companyId?: string | null
        companyName?: string | null
    }
}
