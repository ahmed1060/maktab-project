'use client'

import { useLanguage } from '@/context/LanguageContext'
import { wordDiff } from '@/lib/word-diff'

/**
 * What an edit changed (DESIGN.md §5.5, "What an edit changed"; PR 218): the
 * text as it is now, word by word (lib/word-diff.ts), taken out struck
 * through and put in underlined, each in its meaning's colours. A key above
 * names each mark the text has, and screen readers hear "Removed:" or
 * "Added:" before each.
 *
 * The text keeps its own direction (DESIGN.md §7). The marks' words are the
 * page's, with the page's direction, so they never decide the text's.
 */
export default function DiffViewer({ oldText, newText }: { oldText: string | null; newText: string | null }) {
    const { t, locale } = useLanguage()
    const parts = wordDiff(oldText, newText)
    if (!parts.length) return null
    const dir = locale === 'ar' ? 'rtl' : 'ltr'
    const removed = parts.some(part => part.kind === 'removed')
    const added = parts.some(part => part.kind === 'added')
    return (
        <div className="ui-diff">
            {(removed || added) && (
                // For the eye: screen readers hear each mark's word in the text.
                <div className="ui-diff-key" aria-hidden="true">
                    {removed && <span className="ui-diff-removed">{t('diff_removed')}</span>}
                    {added && <span className="ui-diff-added">{t('diff_added')}</span>}
                </div>
            )}
            <div className="ui-diff-text" dir="auto">
                {parts.map((part, i) => part.kind === 'same' ? part.text
                    : part.kind === 'removed'
                        ? <del key={i} className="ui-diff-removed"><span className="ui-visually-hidden" dir={dir}>{`${t('diff_removed')}: `}</span>{part.text}</del>
                        : <ins key={i} className="ui-diff-added"><span className="ui-visually-hidden" dir={dir}>{`${t('diff_added')}: `}</span>{part.text}</ins>)}
            </div>
        </div>
    )
}
