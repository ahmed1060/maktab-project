'use client'

import type { ReactNode } from 'react'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon } from './Icon'

/**
 * The pages to offer: the first, the last, and the current one with its
 * neighbours; `null` where pages are skipped. Never more than seven entries,
 * so the row fits a phone.
 */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
    const near = [page - 1, page, page + 1].filter(p => p > 1 && p < pageCount)
    // At either end, show three in a row so the row keeps its length.
    const middle = page <= 3 ? [2, 3, 4] : page >= pageCount - 2 ? [pageCount - 3, pageCount - 2, pageCount - 1] : near
    const out: (number | null)[] = [1]
    if (middle[0] > 2) out.push(null)
    out.push(...middle)
    if (middle[middle.length - 1] < pageCount - 1) out.push(null)
    out.push(pageCount)
    return out
}

/**
 * A list's footer (DESIGN.md §5.4): how many items, on the start side, and the
 * pages on the end side. Previous and next point the reading direction's way.
 * On a phone the numbers give way to "Page 2 of 9" between previous and next,
 * which fits however many pages there are at full touch size.
 */
export function Pager({ page, pageCount, onPage, summary }: {
    page: number
    pageCount: number
    onPage: (page: number) => void
    /** Such as "18 tasks". */
    summary?: ReactNode
}) {
    const { t, locale } = useLanguage()
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const label = (p: number) => t('ui_page_of').replace('{page}', num(p)).replace('{pages}', num(pageCount))
    return (
        <div className="ui-pager">
            <span>{summary}</span>
            {pageCount > 1 && (
                <nav className="ui-pager-pages" aria-label={label(page)}>
                    <button type="button" className="ui-pager-page" aria-label={t('previous_page')} disabled={page <= 1} onClick={() => onPage(page - 1)}>
                        <Icon icon={CaretLeftIcon} size={16} directional />
                    </button>
                    <span className="ui-pager-numbers">
                        {pageWindow(page, pageCount).map((p, i) => p === null
                            ? <span key={`gap-${i}`} className="ui-pager-gap" aria-hidden="true">…</span>
                            : (
                                <button key={p} type="button" className="ui-pager-page" aria-label={label(p)} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>
                                    {num(p)}
                                </button>
                            ))}
                    </span>
                    {/* A phone has no room for the numbers: where you are, between previous and next. */}
                    <span className="ui-pager-where" aria-hidden="true">{label(page)}</span>
                    <button type="button" className="ui-pager-page" aria-label={t('next_page')} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
                        <Icon icon={CaretRightIcon} size={16} directional />
                    </button>
                </nav>
            )}
        </div>
    )
}
