import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import { BellIcon, CalendarBlankIcon, UserCircleIcon } from "@phosphor-icons/react/ssr"
import { ITEM_ICONS } from "./side-bar-icons"

/**
 * A notification's icon, in its circle on the bell's panel (DESIGN.md §5.1):
 * its subject's, the side bar's where its subject has a page there, so a
 * task's is Tasks' and a punch's is Attendance's; a calendar for a day off,
 * a person for a name change, and the bell for anything else.
 *
 * Attendance and a day off come before requests, as ATTENDANCE_REQUEST and
 * DAY_OFF_REQUEST also contain REQUEST.
 */
export function noticeIcon(type: string): PhosphorIcon {
    const t = type.toUpperCase()
    if (t.startsWith("ATTENDANCE") || t === "LATE_ARRIVAL") return ITEM_ICONS.attendance
    if (t.includes("DAY_OFF")) return CalendarBlankIcon
    if (t.includes("TASK")) return ITEM_ICONS.tasks
    if (t.includes("OBLIGATION")) return ITEM_ICONS.obligations
    if (t.includes("BONUS") || t.includes("DEDUCTION")) return ITEM_ICONS.payroll
    if (t.startsWith("ROLE_")) return ITEM_ICONS.rolesAndAccess
    if (t.includes("SUBSCRIPTION")) return ITEM_ICONS.packages
    if (t.includes("PROFILE")) return UserCircleIcon
    if (t.includes("TEAM")) return ITEM_ICONS.employees
    // A note on a record (lib/services/record.service.ts).
    if (t.includes("NOTE")) return ITEM_ICONS.records
    if (t.includes("REQUEST")) return ITEM_ICONS.requests
    return BellIcon
}
