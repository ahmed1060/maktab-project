import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import type { Actor } from "@/lib/permissions/can"
import type { SettingsExposure } from "@/lib/company-settings-access"
import { mayTerminals } from "./terminals-access"

/**
 * Which of the add-ons' sections the Attendance settings tab shows this
 * person (ATTENDANCE_PLAN.md §16; FIRST_CHANGES_PLAN.md §5, PR 361), sent
 * with the tab's calendar so that the tab asks only for what it will be
 * given:
 * - Fingerprint terminals, for a company holding the Terminals add-on, to
 *   whoever may set them up (§17.10);
 * - the places people check in at, for a company holding the Mobile App
 *   add-on, to everyone who sees the tab.
 *
 * Each section's own routes answer the same (./terminals-access.ts,
 * ./mobile-access.ts), and the sections still hide themselves if refused.
 */
export function addOnSections(actor: Actor, company: SettingsExposure & { terminalsSetupByCompany: boolean }) {
    const bundles = resolveBundles(company.package)
    return {
        terminals: hasBundle(bundles, "ATTENDANCE_TERMINALS") && mayTerminals(actor, company),
        mobileApp: hasBundle(bundles, "ATTENDANCE_MOBILE"),
    }
}
