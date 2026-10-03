import NextAuth, { DefaultSession } from "next-auth"

declare module "next-auth" {
    interface Session {
        user: {
            id: string
            role: string
            // The role this person holds and its grants, encoded as
            // lib/permissions/grants.ts does — what can() reads. Reloaded by
            // the jwt() callback within a minute of the role changing.
            roleId?: string | null
            grants?: string
            // The Super Admin previewing a role (ROLES_PLAN.md §6.6): the
            // session presents that role, and every write is refused.
            preview?: { roleId: string; roleName: string; roleBuiltIn?: string | null; companyId: string; companyName: string } | null
            // When this session last entered a step-up code (ROLES_PLAN.md
            // §6.15), in ms; set only by the jwt() callback after checking it.
            stepUpAt?: number | null
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
            theme?: string
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
            // see components/security/EmailSection.tsx.
            emailVerified?: boolean
            // F-27, Phase 4: whether TOTP MFA is enrolled. Refreshed on the
            // same 60s recheck as isProtected/emailVerified — the actual
            // login-time challenge (Phase 5) doesn't read this from the
            // session (that would defeat the point), it queries fresh in
            // authorize() before a session even exists.
            mfaEnabled?: boolean
            // This company's names and emoji for the nine company-facing
            // modules, keyed by lib/modules.ts's module keys. Typed loosely
            // because they arrive as Json from the database and travel through
            // the token's JSON round trip; parseModuleOverrides/parseModuleIcons
            // narrow them at every read. Refreshed on the same 60s recheck as
            // maintenanceMode, so a rename takes effect without a re-login.
            // Null for a SuperAdmin session, who has no one company.
            moduleLabels?: Record<string, string> | null
            moduleIcons?: Record<string, string> | null
            // This company's own mark, shown in the sidebar in place of the
            // default one. Always a URL this app minted — see the logo
            // endpoint. Null for a company that never uploaded one, and for a
            // SuperAdmin session, who has no one company.
            logoUrl?: string | null
            // Which bundles this company holds, resolved from its package.
            // Serialized (bundles as an array) because a Set does not survive
            // the JSON round trip a session token makes. Absent on a token
            // minted before packages shipped, which deserializes to
            // unrestricted — see deserializeAccess.
            featureAccess?: import('@/lib/features/bundles').SerializedAccess | null
            // Subscription state, computed server-side and refreshed on the
            // same 60s recheck. The date is an ISO string because a Date does
            // not survive the token's JSON round trip, and the state travels
            // already decided: no part of the lockout is computed in the
            // browser. Null for a Super Admin, who has no company.
            subscription?: { state: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'LOCKED' | 'LIFETIME'; date: string | null; daysRemaining: number | null } | null
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
        theme?: string
        userStatus?: string
        companyBanned?: boolean
        isProtected?: boolean
        emailVerified?: boolean
        mfaEnabled?: boolean
        moduleLabels?: Record<string, string> | null
        moduleIcons?: Record<string, string> | null
        logoUrl?: string | null
        featureAccess?: import('@/lib/features/bundles').SerializedAccess | null
        subscription?: { state: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'LOCKED' | 'LIFETIME'; date: string | null; daysRemaining: number | null } | null
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        role: string
        roleId?: string | null
        roleVersion?: number
        grants?: string
        /** An acting role is over and `grants` are those of the role returned to (§6.13). */
        actingEnded?: true
        preview?: import("@/lib/services/role.service").RolePreview | null
        stepUpAt?: number | null
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
        theme?: string
        userStatus?: string
        companyBanned?: boolean
        maintenanceMode?: boolean
        maintenanceMessage?: string | null
        isProtected?: boolean
        emailVerified?: boolean
        mfaEnabled?: boolean
        moduleLabels?: Record<string, string> | null
        moduleIcons?: Record<string, string> | null
        logoUrl?: string | null
        featureAccess?: import('@/lib/features/bundles').SerializedAccess | null
        subscription?: { state: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'LOCKED' | 'LIFETIME'; date: string | null; daysRemaining: number | null } | null
        // F-11: last time the merged revocation/suspension check actually
        // ran against the database, so it can be throttled instead of
        // running on every single request.
        checkedAt?: number
    }
}
