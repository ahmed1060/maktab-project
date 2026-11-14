import { z } from "zod"

/** A terminal brand as the Super Admin saves it (ATTENDANCE_PLAN.md §17.9). The service trims and checks the rest. */
export const terminalBrandSchema = z.object({
    name: z.string().max(60),
    protocol: z.enum(["ZKTECO", "HIKVISION"]),
    notesEn: z.string().max(500).nullable().optional(),
    notesAr: z.string().max(500).nullable().optional(),
})
