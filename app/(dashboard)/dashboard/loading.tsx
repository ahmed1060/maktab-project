'use client'

import { PageLoading } from '@/components/PageLoading'

// Next.js shows this automatically the instant a navigation to any
// /dashboard/* route starts, while that route's server component does its
// (now-parallelized, but still real) data fetching — instead of the
// previous nothing-at-all gap between click and the page appearing, which
// is what made an otherwise-normal-latency navigation feel stuck. Applies
// to every route nested under this segment that doesn't define its own
// more specific loading.tsx.
//
// It says so as every page does while it loads (DESIGN.md §5.5): the panel
// with the hourglass, where the page will be, which a screen reader hears.
// It was the old spinner, of its own making (PR 190). The frame around the
// page says the same while it waits (components/PageLoading.tsx, PR 221).
export default function DashboardLoading() {
    return <PageLoading />
}
