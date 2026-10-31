import { redirect } from "next/navigation"
import { dayOffAddress } from "@/lib/requests/old-addresses"

/**
 * Day off is on the one Requests page now (UI_PLAN.md §2.3, part 2d): asked
 * for from New request, decided under To review, and one's own on Mine. An
 * old link lands there, on the status it asked for and with the request it
 * picked out. The layout still shows a company without Day off what it is.
 */
export default async function DayOffRequestsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
    redirect(dayOffAddress(await props.searchParams))
}
