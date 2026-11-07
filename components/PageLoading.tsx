'use client'

import { HourglassIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { EmptyState, Page } from '@/components/ui'

/**
 * A page of the dashboard on its way (DESIGN.md §5.5, Loading): the panel
 * with the hourglass and "Loading…", where the page will be, which a screen
 * reader hears. The same screen whether the page itself waits
 * (app/(dashboard)/dashboard/loading.tsx) or the frame around it does
 * (app/(dashboard)/layout.tsx), which said "Loading section..." in English,
 * in classes no stylesheet had, until PR 221.
 */
export function PageLoading() {
    const { t } = useLanguage()
    return (
        <Page>
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        </Page>
    )
}
