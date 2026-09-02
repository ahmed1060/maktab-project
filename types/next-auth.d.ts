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
            image?: string | null
            picture?: string | null
            username: string
            language: string
            mustChangePassword?: boolean
            // F-11: stamped on the token by the merged revocation/suspension
            // check in the jwt() callback, so withStandardHandler can read
            // them from the session instead of re-querying the database on
            // every request. Undefined for a SuperAdmin session (no status/
            // company concept for that role).
            userStatus?: string
            companyBanned?: boolean
            // Founder-account protection: true only for a SuperAdmin flagged
            // isProtected in the database. Gates editing/deleting *other*
            // super admins — see app/api/super-admins/[id]/route.ts. Always
            // false/undefined for a User session.
            isProtected?: boolean
            // F-27: true once emailVerifiedAt is set on the account row.
            // middleware.ts blocks the rest of /dashboard until this is
            // true, the same way it already does for mustChangePassword —
            // see app/(dashboard)/dashboard/email-settings/page.tsx.
            emailVerified?: boolean
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
        image?: string | null
        picture?: string | null
        username?: string
        language?: string
        mustChangePassword?: boolean
        userStatus?: string
        companyBanned?: boolean
        isProtected?: boolean
        emailVerified?: boolean
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
        image?: string | null
        picture?: string | null
        username?: string
        language?: string
        mustChangePassword?: boolean
        userStatus?: string
        companyBanned?: boolean
        isProtected?: boolean
        emailVerified?: boolean
        // F-11: last time the merged revocation/suspension check actually
        // ran against the database, so it can be throttled instead of
        // running on every single request.
        checkedAt?: number
    }
}
