import { prisma } from "@/lib/prisma"
import { DEFAULT_TIME_ZONE } from "@/lib/time"
import { DEFAULT_BRAND } from "@/lib/brand-colour"

// Single-row table (see prisma/schema.prisma's SystemSettings model) —
// this service is the one place that ever reads or writes it, so the
// "always id: 'default'" convention lives in exactly one spot.
const SETTINGS_ID = 'default'

// Re-exported, not defined here. It now lives in lib/branding-defaults, which
// imports nothing, so a client component can have the constant without having
// the database client that this file carries. Kept exported from here so the
// server-side callers that already import it are undisturbed.
export { DEFAULT_POWERED_BY_NAME } from '../branding-defaults'
import { DEFAULT_POWERED_BY_NAME } from '../branding-defaults'

export class SystemSettingsService {
    /**
     * Row is seeded by migration and never deleted, but get() falls back
     * to the schema defaults if it's ever missing rather than throwing —
     * a missing settings row shouldn't be able to break task submission.
     */
    static async get() {
        const settings = await prisma.systemSettings.findUnique({ where: { id: SETTINGS_ID } })
        return settings || { id: SETTINGS_ID, locationVerifyRadiusMeters: 70, maintenanceMode: false, maintenanceMessage: null, showPoweredBy: true, poweredByName: DEFAULT_POWERED_BY_NAME, defaultTimezone: DEFAULT_TIME_ZONE, stepUpMinutes: 60, brandColour: DEFAULT_BRAND, updatedAt: new Date() }
    }

    static async update(data: { locationVerifyRadiusMeters?: number, maintenanceMode?: boolean, maintenanceMessage?: string | null, showPoweredBy?: boolean, poweredByName?: string, defaultTimezone?: string, stepUpMinutes?: number, brandColour?: string }) {
        return prisma.systemSettings.upsert({
            where: { id: SETTINGS_ID },
            update: data,
            create: { id: SETTINGS_ID, ...data },
        })
    }
}
