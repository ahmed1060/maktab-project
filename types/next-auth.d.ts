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
            // System-wide maintenance mode (SystemSettings.maintenanceMode).
            // Refreshed on the same 60s recheck as userStatus/companyBanned;
            // always false for a SuperAdmin session — they're exempt.
            maintenanceMode?: boolean
            maintenanceMessage?: string | null
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
            // F-27, Phase 4: whether TOTP MFA is enrolled. Refreshed on the
            // same 60s recheck as isProtected/emailVerified — the actual
            // login-time challenge (Phase 5) doesn't read this from the
            // session (that would defeat the point), it queries fresh in
            // authorize() before a session even exists.
            mfaEnabled?: boolean
            // Vendors feature: this company's custom label for the Vendors
            // tab (null = default translated "Vendors"). Refreshed on the
            // same 60s recheck as maintenanceMode, not just seeded at sign-in
            // — see lib/auth.ts. Undefined/null for a SuperAdmin session.
            vendorsLabel?: string | null
            // Which bundles this company holds, resolved from its package.
            // Serialized (bundles as an array) because a Set does not survive
            // the JSON round trip a session token makes. Absent on a token
            // minted before packages shipped, which deserializes to
            // unrestricted — see deserializeAccess.
            featureAccess?: { unrestricted: boolean; bundles: ('COMPANY_MANAGEMENT' | 'HR')[] } | null
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
        mfaEnabled?: boolean
        vendorsLabel?: string | null
        featureAccess?: { unrestricted: boolean; bundles: ('COMPANY_MANAGEMENT' | 'HR')[] } | null
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
        maintenanceMode?: boolean
        maintenanceMessage?: string | null
        isProtected?: boolean
        emailVerified?: boolean
        mfaEnabled?: boolean
        vendorsLabel?: string | null
        featureAccess?: { unrestricted: boolean; bundles: ('COMPANY_MANAGEMENT' | 'HR')[] } | null
        // F-11: last time the merged revocation/suspension check actually
        // ran against the database, so it can be throttled instead of
        // running on every single request.
        checkedAt?: number
    }
}
