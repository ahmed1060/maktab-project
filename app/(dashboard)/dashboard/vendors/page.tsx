import { redirect } from 'next/navigation'

/**
 * Vendors became Clients (CLIENTS_PLAN.md §0.1). Kept as a redirect rather
 * than deleted: the old address is in links already sent, bookmarks and
 * browser histories.
 */
export default function MovedPage() {
    redirect('/dashboard/clients')
}
