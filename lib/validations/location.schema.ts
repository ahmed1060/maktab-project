import { z } from "zod"
import { LOCATION_NAME_MAX, LOCATION_RADIUS_MAX, LOCATION_RADIUS_MIN } from "@/lib/locations"

/**
 * A place's own details (CLIENTS_PLAN.md §2.2, §2.5): its name, typed alone
 * ("Maadi branch"), its pin, which every new place must have, and its own
 * check radius, or none for the default.
 */
export const placeSchema = z.object({
    name: z.string().trim().min(1, "Give the location a name").max(LOCATION_NAME_MAX),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(LOCATION_RADIUS_MIN).max(LOCATION_RADIUS_MAX).nullable().optional(),
})

export const createLocationSchema = placeSchema.extend({
    /** Its client; none for a shared location. */
    clientId: z.string().min(1).nullable().optional(),
    /** A Super Admin's company, for a shared location; a client's is its own. */
    companyId: z.string().min(1).optional(),
})

/**
 * A change to one location: its details (any of them; a pin moves as a
 * whole), archiving or restoring it, or making it its client's HQ.
 */
export const updateLocationSchema = z.object({
    id: z.string().min(1),
    name: placeSchema.shape.name.optional(),
    latitude: placeSchema.shape.latitude.optional(),
    longitude: placeSchema.shape.longitude.optional(),
    radiusMeters: placeSchema.shape.radiusMeters,
    archived: z.boolean().optional(),
    hq: z.literal(true).optional(),
}).refine(l => (l.latitude === undefined) === (l.longitude === undefined), { message: "A pin needs both its latitude and its longitude", path: ["latitude"] })

export type PlaceInput = z.infer<typeof placeSchema>
export type CreateLocationInput = z.infer<typeof createLocationSchema>
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>
