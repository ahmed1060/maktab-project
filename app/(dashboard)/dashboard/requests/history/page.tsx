import { redirect } from "next/navigation"

/**
 * Done requests are on the Requests page now (UI_PLAN.md §2.3): an old link
 * here lands on Done, with the request it picked out.
 */
export default async function RequestsHistoryPage(props: { searchParams: Promise<{ highlight?: string }> }) {
    const { highlight } = await props.searchParams
    redirect(`/dashboard/requests?${new URLSearchParams({ show: 'done', ...(highlight ? { highlight } : {}) })}`)
}
