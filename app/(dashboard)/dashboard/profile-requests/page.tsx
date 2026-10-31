import { redirect } from "next/navigation"

/**
 * Name changes are asked for on one's profile and decided on the one Requests
 * page now (UI_PLAN.md §2.3, part 5a): an old link here lands on them there,
 * with the request it picked out. The page decides the tab: one's own on
 * Mine, everyone else's under To review.
 */
export default async function ProfileRequestsPage(props: { searchParams: Promise<{ highlight?: string }> }) {
    const { highlight } = await props.searchParams
    redirect(`/dashboard/requests?${new URLSearchParams({ kind: 'nameChange', ...(highlight ? { highlight } : {}) })}`)
}
