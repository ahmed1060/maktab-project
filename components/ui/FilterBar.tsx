'use client'

import { useId, useState, type ReactNode } from 'react'
import { FunnelSimpleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon } from './Icon'

/**
 * The filter bar (DESIGN.md §5.3): a search that takes the spare width, the
 * page's filters, and Reset filters on the end side.
 *
 * On a phone the filters fold away behind a Filters button that says how many
 * are on; it shows them below the search and hides them again. They're the
 * same elements in both layouts, never a second copy.
 */
export function FilterBar({ search, children, activeCount = 0, onReset }: {
    search: ReactNode
    /** The filters, each a Field with `hideLabel`. */
    children?: ReactNode
    /** How many filters are set, for the phone's Filters button. */
    activeCount?: number
    onReset?: () => void
}) {
    const { t, locale } = useLanguage()
    const [open, setOpen] = useState(false)
    const id = useId()
    return (
        <div className="ui-panel ui-filterbar" data-open={open}>
            <div className="ui-filterbar-search">{search}</div>
            {children && (
                <button type="button" className="ui-btn ui-btn-secondary ui-filterbar-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
                    <Icon icon={FunnelSimpleIcon} />
                    {t('filters')}
                    {activeCount > 0 && <span className="ui-filterbar-count">{activeCount.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</span>}
                </button>
            )}
            {children && <div id={id} className="ui-filterbar-filters">{children}</div>}
            {onReset && <button type="button" className="ui-btn ui-btn-quiet ui-filterbar-reset" onClick={onReset}>{t('ui_reset_filters')}</button>}
        </div>
    )
}
