import LoadingSpinner from "@/components/LoadingSpinner"

// Next.js shows this automatically the instant a navigation to any
// /dashboard/* route starts, while that route's server component does its
// (now-parallelized, but still real) data fetching — instead of the
// previous nothing-at-all gap between click and the page appearing, which
// is what made an otherwise-normal-latency navigation feel stuck. Applies
// to every route nested under this segment that doesn't define its own
// more specific loading.tsx.
export default function DashboardLoading() {
    return <LoadingSpinner />
}
