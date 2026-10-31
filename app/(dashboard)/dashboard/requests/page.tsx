import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { askedPage, pageRedirect } from "@/lib/list-page"
import { accountRefusal } from "@/lib/account-refusal"
import { can } from "@/lib/permissions/can"
import { sessionHasModule } from "@/lib/features/require"
import { usedDayOffCredit } from "@/lib/day-off-credit"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import AccessDenied from "@/components/AccessDenied"
import { REQUEST_KINDS, requestFeed, tabsFor, type RequestKind, type RequestsShow, type RequestsTab, type Viewer } from "@/lib/requests/feed"
import RequestsClient from "./RequestsClient"

/**
 * The one Requests page (UI_PLAN.md §2.3): what this person asked for, and
 * what waits on them, from the one feed, which reads each kind of request
 * through its own rules. Its tab, show, kind, search and page are in its
 * address.
 */
export default async function RequestsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
    const searchParams = await props.searchParams
    const session = await getServerSession(authOptions)
    if (!session) redirect("/login")
    const viewer = session.user as unknown as Viewer
    // Refused as the requests API refuses it: suspended, banned, lapsed or
    // under maintenance. This page reads the database itself, past the API.
    if (accountRefusal(viewer)) return <AccessDenied />
    const superAdmin = viewer.role === "SUPER_ADMIN"
    const tabs = tabsFor(viewer)

    let tab: RequestsTab | null = searchParams.tab === "mine" || searchParams.tab === "review" ? searchParams.tab : null
    let show: RequestsShow | null = searchParams.show === "waiting" || searchParams.show === "done" ? searchParams.show : null
    // A notification's request opens on the tab it's on, and with its
    // status: their own on Mine, anyone else's on To review, and Done once
    // it's done, decided or withdrawn. It shows only if the feed has it for
    // them. A day off's too, since its links land here (§2.3, part 2d),
    // permission hours' and a missing punch's (part 3c), and a new check-in
    // phone's (part 4d), a name change's (part 5a) and a role request's (part 5b).
    if (searchParams.highlight && (!tab || !show)) {
        const picked = await prisma.request.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
            ?? await prisma.dayOffRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
            ?? await prisma.permissionRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
            ?? await prisma.missingPunchRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
            ?? await prisma.checkInPhone.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
            ?? await prisma.profileUpdateRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
            // A role request is on Mine for whoever asked, not whose role it would be (part 5b).
            ?? await prisma.roleRequest.findUnique({ where: { id: searchParams.highlight }, select: { requestedById: true, status: true } })
                .then(r => r && ({ userId: r.requestedById, status: r.status }))
        if (picked) {
            tab ??= picked.userId === viewer.id ? "mine" : "review"
            // Waiting is waiting, or started; anything else is done: done, decided, withdrawn, in use or revoked.
            show ??= picked.status === "PENDING" || picked.status === "IN_PROGRESS" ? "waiting" : "done"
        }
    }
    // What waits on them comes first, for whoever has it.
    if (!tab || !tabs[tab]) tab = tabs.review ? "review" : "mine"
    show ??= "waiting"
    const kind = (REQUEST_KINDS as readonly string[]).includes(searchParams.kind ?? "") ? searchParams.kind as RequestKind : ""

    const { asked, page } = askedPage(searchParams.page)
    const limit = 10
    const feed = await requestFeed(viewer, {
        tab, show, kind, page, limit,
        search: searchParams.search?.trim() ?? "",
        personId: tab === "review" ? searchParams.employeeId ?? "" : "",
        // The company the Super Admin picked; nobody else's reach moves with it.
        companyId: superAdmin ? searchParams.companyId || null : null,
        // Day off's dates of leave, offered with it alone (decided on 2026-10-31).
        from: kind === "dayOff" ? searchParams.from ?? "" : "",
        to: kind === "dayOff" ? searchParams.to ?? "" : "",
    })
    const elsewhere = pageRedirect("/dashboard/requests", searchParams, asked, feed.totalPages)
    if (elsewhere) redirect(elsewhere)

    // Asking for a day off, for whoever's role may, in a company with Day off
    // (§2.3, part 2c); their balance shows on Mine, above the list.
    const mayAskDayOff = sessionHasModule({ user: viewer }, 'DAY_OFF') && can(viewer, 'dayoff.request')
    let credit: { remaining: number; used: number } | null = null
    if (mayAskDayOff && tab === "mine") {
        const balance = await prisma.user.findUnique({ where: { id: viewer.id }, select: { dayOffCredit: true, baseDayOffCredit: true } })
        if (balance) credit = { remaining: balance.dayOffCredit, used: usedDayOffCredit(balance.baseDayOffCredit ?? balance.dayOffCredit, balance.dayOffCredit) }
    }

    // Asking for permission hours and reporting a missing punch, for whoever
    // has attendance of their own, as the attendance API's rule
    // (asksForSelf); on Mine, what's left of this month's permission hours,
    // while the policy allows them (§2.3, part 3).
    const mayAskAttendance = sessionHasModule({ user: viewer }, 'ATTENDANCE') && !superAdmin && !!viewer.companyId
    // The company's own day, which the attendance API reads times in: what a
    // missing punch can't be after, and the day both forms start on. The
    // browser's can be a day behind it (found by Codex on PR 131).
    const attendanceToday = mayAskAttendance ? await AttendanceRequestService.todayIn(viewer.companyId!) : null
    let allowance: { left: number; total: number; pending: number; carried: number } | null = null
    if (attendanceToday && tab === "mine") {
        const balance = await AttendanceRequestService.permissionBalance(viewer.companyId!, viewer.id, attendanceToday.slice(0, 7), attendanceToday)
        if (balance.enabled) allowance = {
            left: balance.remainingMinutes,
            total: balance.allowanceMinutes + balance.carriedMinutes,
            pending: balance.pendingMinutes,
            carried: balance.carriedMinutes,
        }
    }

    return (
        <RequestsClient
            rows={feed.rows} total={feed.total} page={page} totalPages={feed.totalPages} kinds={feed.kinds}
            tabs={tabs} tab={tab} show={show} superAdmin={superAdmin} mayAskDayOff={mayAskDayOff} credit={credit}
            mayAskAttendance={mayAskAttendance} attendanceToday={attendanceToday} allowance={allowance}
        />
    )
}
