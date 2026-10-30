import { z } from "zod"
import { MAX_MODULE_LABEL_LENGTH, isModuleKey, isValidModuleIcon } from "@/lib/modules"
import { MAX_PAYROLL_DAY } from "@/lib/payday"
import { checkTimeZone } from "@/lib/timezone"
import { ELIGIBLE_SETTINGS_TABS } from "@/lib/company-settings-access"
import { brandColourSchema } from "./brand-colour.schema"

// Mirrors the TrialPreset database enum. Declared here rather than imported
// from @prisma/client so this module stays usable anywhere, including the
// creation form's live end-date preview.
export const trialPresetSchema = z.enum(['TWO_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS', 'ONE_MONTH', 'THREE_MONTHS'])

export const createCompanySchema = z.object({
    name: z.string().min(2, "Company name must be at least 2 characters").max(50),
    // Optional so an existing client that does not send it still works; the
    // service supplies the default rather than leaving the company with no
    // trial at all.
    trialPreset: trialPresetSchema.optional(),
    // Null means grandfathered — unrestricted. A company may be created without
    // a package and assigned one later.
    packageId: z.string().min(1).nullable().optional(),
})

export const updateCompanySchema = z.object({
    id: z.string().min(1, "Company ID is required"),
    name: z.string().min(2).max(50).optional(),
    isBanned: z.boolean().optional(),
    // Company Settings: whether task-location auto-verify runs at all for
    // this company's tasks. See the matching comment on the Company model.
    autoVerifyLocation: z.boolean().optional(),
    // This company's names and emoji for its modules, sent as whole maps
    // rather than one key at a time — the settings form holds all nine and
    // saves them together, so a partial PATCH shape would only invite the two
    // to drift. An empty-string value means "clear this override"; the service
    // drops those rather than storing a module with no name.
    //
    // Unknown keys are rejected here rather than silently dropped the way the
    // read path drops them: a write naming a module that does not exist is a
    // caller bug worth surfacing, while a stored value for a module that has
    // since been removed is just history.
    moduleLabels: z
        .record(z.string(), z.string().max(MAX_MODULE_LABEL_LENGTH))
        .refine((map) => Object.keys(map).every(isModuleKey), {
            message: "Unknown module key",
        })
        .optional()
        .nullable(),
    moduleIcons: z
        .record(z.string(), z.string())
        .refine((map) => Object.keys(map).every(isModuleKey), {
            message: "Unknown module key",
        })
        .refine((map) => Object.values(map).every((icon) => icon === "" || isValidModuleIcon(icon)), {
            message: "Module icons must be a single emoji",
        })
        .optional()
        .nullable(),
    // --- Payroll policy ---
    //
    // These three shipped in P8 as columns with defaults and no way to set
    // them, which meant every company was on day 25 in Africa/Cairo with
    // payslips switched off, permanently. A default is not a decision until
    // somebody can change it.
    payrollDay: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAYROLL_DAY, {
            message:
                `Payroll day must be between 1 and ${MAX_PAYROLL_DAY}. A day that does not occur in ` +
                `every month is a day that moves without anybody deciding it should.`,
        })
        .optional(),
    // Off by default and stays off until somebody turns it on: a payslip is the
    // most sensitive thing this app holds about a person, and "we switched it
    // on for you" is not a sentence anybody wants to hear about their pay.
    payslipsVisible: z.boolean().optional(),
    // 100 means a debt comes out of the next month in full, which is the agreed
    // behaviour; 0 switches recovery off without deleting anybody's debt.
    // Bounded at both ends because a percentage outside 0-100 is not a cap, and
    // a negative one would be an instruction to pay somebody their debt.
    debtRecoveryPercent: z.number().int().min(0).max(100).optional(),
    // Validated rather than merely stored, and validated *here* so the reason
    // reaches the form. checkTimeZone's refusal explains that the crons are
    // global and what that costs a company far behind UTC — a sentence worth
    // showing whoever typed the zone, rather than collapsing to "invalid".
    timezone: z
        .string()
        .min(1)
        .superRefine((zone, ctx) => {
            const verdict = checkTimeZone(zone)
            if (!verdict.ok) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.reason ?? "Unsupported time zone" })
            }
        })
        .optional(),

    // The company's own brand colour (UI_PLAN.md §4.6); null goes back to
    // the system's default.
    brandColour: brandColourSchema.nullable().optional(),

    // Which of its settings the company's own people see (ATTENDANCE_PLAN.md
    // §5.2). Only tabs that may ever be shown: the rest are the Super Admin's.
    adminSettingsEnabled: z.boolean().optional(),
    adminSettingsTabs: z
        .array(z.string())
        .refine((tabs) => tabs.every((tab) => (ELIGIBLE_SETTINGS_TABS as string[]).includes(tab)), {
            message: "That tab cannot be shown to a company",
        })
        .refine((tabs) => new Set(tabs).size === tabs.length, { message: "A tab is listed twice" })
        .optional(),

    // Cash advances (CLIENTS_PLAN.md §7.6): the Super Admin's allowing them,
    // and the Admin's switch. Neither goes off while anyone holds advance
    // money, which CompanyService.update checks.
    cashAdvancesAllowed: z.boolean().optional(),
    cashAdvancesOn: z.boolean().optional(),

    // Trial extension, in days, added on top of whichever preset was chosen.
    // A delta rather than a new total: "give them another week" is how the
    // request always arrives, and the column only ever grows.
    extendTrialDays: z.number().int().min(1).max(365).optional(),
})

export type CreateCompanyInput = z.infer<typeof createCompanySchema>
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>
