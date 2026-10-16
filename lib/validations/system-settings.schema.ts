import { z } from "zod"
import { checkTimeZone } from "@/lib/timezone"
import { brandColourSchema } from "./brand-colour.schema"

/** What the Super Admin may change in System Settings (app/api/system-settings). */
export const updateSystemSettingsSchema = z.object({
    locationVerifyRadiusMeters: z.number().int().min(1).max(10000).optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceMessage: z.string().max(500).nullable().optional(),
    showPoweredBy: z.boolean().optional(),
    poweredByName: z.string().max(40).optional(),
    // The calendar zone for anybody with no company — a Super Admin, mostly.
    // Same validation as a company's own zone, and for the same reason: the
    // crons are global, so a zone far behind UTC cannot be served correctly and
    // should be refused where somebody can read why.
    defaultTimezone: z
        .string()
        .min(1)
        .superRefine((zone, ctx) => {
            const verdict = checkTimeZone(zone)
            if (!verdict.ok) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.reason ?? "Unsupported time zone" })
            }
        })
        .optional(),
    // How long a step-up MFA confirmation lasts (ROLES_PLAN.md §6.15). The
    // database holds the same bounds.
    stepUpMinutes: z.number().int().min(5).max(480).optional(),
    // The default brand colour (UI_PLAN.md §4.6). Never empty: the default
    // is always a colour, so the sign-in page always has one.
    brandColour: brandColourSchema.optional(),
}).refine(data => Object.keys(data).length > 0, { message: "No fields to update" })
