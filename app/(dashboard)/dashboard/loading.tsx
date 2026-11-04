'use client'

import { HourglassIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { EmptyState, Page } from '@/components/ui'

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
// It was the old spinner, of its own making (PR 190).
export default function DashboardLoading() {
    const { t } = useLanguage()
    return (
        <Page>
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        </Page>
    )
}
