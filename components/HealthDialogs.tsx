'use client'

import { useState, type ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { fileSize } from '@/lib/record-files'
import { Button, Dialog, DialogActions, Field, TextInput } from '@/components/ui'

/**
 * System health's questions and its report of unused files (UI_PLAN.md §5
 * step 5, Operations part 3a), on the building blocks where they were the
 * old confirmation window and a box of the page's own making.
 */

/**
 * Asks before one of the page's actions. One that can't be undone, such as
 * restoring a backup, asks for a word typed first (DESIGN.md §5.5, Dialog):
 * the word as the code has it, left to right in both languages, and the main
 * button off until it's typed as shown. A form, so Enter is the main button.
 */
export function ConfirmHealthAction({ title, body, word, danger = false, confirmLabel, busy, onConfirm, onCancel }: {
    title: ReactNode
    /** What it does, in a sentence or two. */
    body: ReactNode
    /** The word to type first, where it can't be undone. */
    word?: string
    /** It deletes or replaces something, so its button is in the danger colour. */
    danger?: boolean
    confirmLabel: ReactNode
    busy: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    const { t } = useLanguage()
    const [typed, setTyped] = useState('')
    const ready = !word || typed === word
    const [before, after] = t('health_type_word').split('{word}')
    return (
        // Once it's under way it can't be called off, so it can't look as if it was (Codex on PR 176).
        <Dialog open onClose={() => { if (!busy) onCancel() }} title={title}>
            <form className="ui-form" onSubmit={e => {
                e.preventDefault()
                if (ready && !busy) onConfirm()
            }}>
                <p>{body}</p>
                {word && (
                    <Field label={<>{before}<bdi dir="ltr" translate="no">{word}</bdi>{after}</>}>{p => (
                        <TextInput {...p} name="confirmWord" dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                            value={typed} onChange={e => setTyped(e.target.value)} />
                    )}</Field>
                )}
                <DialogActions>
                    <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!ready} busy={busy}>{confirmLabel}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * A list's answer, for the picker that asked for it: one closed since stays
 * closed, and an older answer doesn't replace a newer one asked for. The
 * answer opened a picker closed while it loaded, over whatever came next
 * (Codex on PR 176).
 */
export function answerFor<T extends { request: number }>(current: T | null, answer: T): T | null {
    return current?.request === answer.request ? answer : current
}

export type OrphanSweep = { orphaned: number; total: number; bytes: number; orphans: string[] }

/**
 * What a look for unused files found, in place under the stored files'
 * count, before anything is deleted: the point is that somebody reads the
 * paths first, and a dialog is the wrong shape for a list that runs long.
 * The files nothing refers to, how many and how much, each path as it's
 * stored; deleting them asks again, for a word typed.
 */
export function OrphanReport({ report, busy, onDelete, onClose }: {
    report: OrphanSweep
    busy: boolean
    onDelete: () => void
    onClose: () => void
}) {
    const { t, locale } = useLanguage()
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    return (
        <div className="ui-card-report">
            <h3 className="ui-subsection-title">{t('orphan_report_title')}</h3>
            {report.orphaned === 0 ? (
                <p className="ui-hint" role="status">{t('orphan_report_none')}</p>
            ) : (
                <>
                    {/* Said when it appears; the list itself isn't read out. */}
                    <p className="ui-hint" role="status">
                        {t('health_orphans_found').replace('{count}', num(report.orphaned)).replace('{total}', num(report.total)).replace('{size}', fileSize(report.bytes, locale))}
                    </p>
                    {/* It scrolls within itself, so it takes focus to be scrolled from the keyboard. */}
                    <ul className="ui-report ui-report-scroll" tabIndex={0} aria-label={t('orphan_report_title')}>
                        {report.orphans.map(path => <li key={path}><bdi dir="ltr" translate="no">{path}</bdi></li>)}
                    </ul>
                </>
            )}
            <div className="ui-card-actions">
                <Button onClick={onClose}>{t(report.orphaned === 0 ? 'close' : 'cancel')}</Button>
                {report.orphaned > 0 && <Button variant="danger" onClick={onDelete} busy={busy}>{t('orphan_report_delete')}</Button>}
            </div>
        </div>
    )
}
