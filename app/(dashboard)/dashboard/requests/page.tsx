import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { askedPage, pageRedirect } from "@/lib/list-page"
import { accountRefusal } from "@/lib/account-refusal"
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
    // it's done. It shows only if the feed has it for them.
    if (searchParams.highlight && (!tab || !show)) {
        const picked = await prisma.request.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })
        if (picked) {
            tab ??= picked.userId === viewer.id ? "mine" : "review"
            show ??= picked.status === "COMPLETED" ? "done" : "waiting"
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
    })
    const elsewhere = pageRedirect("/dashboard/requests", searchParams, asked, feed.totalPages)
    if (elsewhere) redirect(elsewhere)

    return (
        <RequestsClient
            rows={feed.rows} total={feed.total} page={page} totalPages={feed.totalPages} kinds={feed.kinds}
            tabs={tabs} tab={tab} show={show} superAdmin={superAdmin}
        />
    )
}
