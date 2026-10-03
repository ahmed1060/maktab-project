import { z } from "zod"
import { MAX_IP_RANGES } from "@/lib/attendance/ip-ranges"
import { partialWithoutDefaults } from "./partial-update"

/**
 * A work location's fields as the screen sends them. The service checks what
 * they mean (a real point, a radius in range, addresses that parse) and
 * answers with a code the person can act on.
 */
const fields = {
    name: z.string().max(80),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    radiusMeters: z.number().int(),
    officeIpRanges: z.array(z.string().max(64)).max(MAX_IP_RANGES),
    everyone: z.boolean(),
}

export const locationSchema = z.object({
    companyId: z.string().optional(),
    ...fields,
    officeIpRanges: fields.officeIpRanges.optional(),
    everyone: fields.everyone.optional(),
})

export const locationUpdateSchema = partialWithoutDefaults(z.object(fields))

export const locationPeopleSchema = z.object({ userIds: z.array(z.string().max(64)).max(5000) })
