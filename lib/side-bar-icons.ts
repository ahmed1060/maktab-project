import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import {
    ArrowsLeftRightIcon,
    BuildingsIcon,
    CalendarBlankIcon,
    CheckSquareIcon,
    ClipboardTextIcon,
    ClockIcon,
    CoinsIcon,
    FileTextIcon,
    FoldersIcon,
    GearSixIcon,
    HandshakeIcon,
    HeartbeatIcon,
    IdentificationBadgeIcon,
    ListChecksIcon,
    MagnifyingGlassIcon,
    MapPinIcon,
    MapTrifoldIcon,
    PackageIcon,
    PushPinIcon,
    ReceiptIcon,
    ShieldCheckIcon,
    SquaresFourIcon,
    StackIcon,
    TrayIcon,
    UsersIcon,
    UsersThreeIcon,
    WalletIcon,
} from '@phosphor-icons/react/ssr'
import type { SideBarItemKey } from './side-bar'

/**
 * Each side bar item's icon (DESIGN.md §6), as the mock-up of the app's
 * frame the product owner approved on 2026-11-05 has them: regular, and
 * filled for the item of the page you're on.
 *
 * Apart from lib/side-bar.ts and lib/modules.ts, which the server reads too
 * and which say nothing about drawing. A module's icon here is the one a
 * company sees unless it chose its own, an emoji (lib/modules.ts), until
 * companies choose theirs from these.
 */
export const ITEM_ICONS: Record<SideBarItemKey, PhosphorIcon> = {
    // A company's.
    dashboard: SquaresFourIcon,
    checkIn: MapPinIcon,
    tasks: CheckSquareIcon,
    obligations: PushPinIcon,
    clients: HandshakeIcon,
    locations: MapTrifoldIcon,
    records: FoldersIcon,
    employees: UsersIcon,
    attendance: ClockIcon,
    myAttendance: ClockIcon,
    requests: TrayIcon,
    costs: CoinsIcon,
    payroll: ReceiptIcon,
    myPayslips: FileTextIcon,
    myCashAdvance: WalletIcon,
    rolesAndAccess: IdentificationBadgeIcon,
    savedLists: ListChecksIcon,
    companySettings: GearSixIcon,
    // The Super Admin's.
    companies: BuildingsIcon,
    packages: PackageIcon,
    allUsers: UsersThreeIcon,
    roleTemplates: StackIcon,
    policyTemplates: ClockIcon,
    publicHolidays: CalendarBlankIcon,
    superAdmins: ShieldCheckIcon,
    roleChanges: ArrowsLeftRightIcon,
    accessReviews: ListChecksIcon,
    whoCan: MagnifyingGlassIcon,
    checkIns: MapPinIcon,
    auditLogs: ClipboardTextIcon,
    systemHealth: HeartbeatIcon,
    systemSettings: GearSixIcon,
}
