import { prisma } from "@/lib/prisma"

// Single-row table (see prisma/schema.prisma's SystemSettings model) —
// this service is the one place that ever reads or writes it, so the
// "always id: 'default'" convention lives in exactly one spot.
const SETTINGS_ID = 'default'

// The fallback for the signature's name, used when the column is missing or has
// been emptied. Never an empty string: "Powered by" followed by nothing reads
// as a rendering bug, so clearing the field falls back here and switching the
// mark off entirely is the way to remove it.
export const DEFAULT_POWERED_BY_NAME = 'SHSD'

export class SystemSettingsService {
    /**
     * Row is seeded by migration and never deleted, but get() falls back
     * to the schema defaults if it's ever missing rather than throwing —
     * a missing settings row shouldn't be able to break task submission.
     */
    static async get() {
        const settings = await prisma.systemSettings.findUnique({ where: { id: SETTINGS_ID } })
        return settings || { id: SETTINGS_ID, locationVerifyRadiusMeters: 70, maintenanceMode: false, maintenanceMessage: null, showPoweredBy: true, poweredByName: DEFAULT_POWERED_BY_NAME, updatedAt: new Date() }
    }

    static async update(data: { locationVerifyRadiusMeters?: number, maintenanceMode?: boolean, maintenanceMessage?: string | null, showPoweredBy?: boolean, poweredByName?: string }) {
        return prisma.systemSettings.upsert({
            where: { id: SETTINGS_ID },
            update: data,
            create: { id: SETTINGS_ID, ...data },
        })
    }
}
