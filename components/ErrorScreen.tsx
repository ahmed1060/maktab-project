'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { reportClientError } from '@/lib/client-error-report'
import { startAgain, type ErrorScreenWords } from '@/lib/error-screen'

/**
 * What a page that broke says, and the app itself when it broke (DESIGN.md
 * §5.5, "A page that broke" and "When the app itself broke"; PR 219): in a
 * panel, as an empty state, the warning icon, what happened and what to do,
 * Reload page and Start again, and the logged failure's reference under them.
 *
 * Its words are given, as the screen when the app itself broke has no
 * dictionary to read them from (lib/error-screen.ts). The building blocks it
 * uses are imported one at a time, as that screen is in every page's code.
 */

// One report for each failure, however often its screen is drawn: React draws
// it twice while it's being built, and both would wait on the same reference.
const reports = new WeakMap<object, Promise<string | null>>()

export function reportOnce(error: unknown): Promise<string | null> {
    if (typeof error !== 'object' || error === null) return reportClientError(error)
    let report = reports.get(error)
    if (!report) {
        report = reportClientError(error)
        reports.set(error, report)
    }
    return report
}

export function ErrorScreen({ error, words }: { error: unknown; words: ErrorScreenWords }) {
    const [reference, setReference] = useState<string | null>(null)
    const title = useRef<HTMLHeadingElement>(null)

    // Where the page was, so a keyboard carries on from there, and screen readers hear it at once.
    useEffect(() => {
        title.current?.focus()
    }, [])

    // Logged through the app's one report, for both the error log and Sentry
    // (lib/client-error-report.ts); its reference shows once it's there.
    useEffect(() => {
        let shown = true
        void reportOnce(error).then(ref => { if (shown && ref) setReference(ref) })
        return () => { shown = false }
    }, [error])

    return <ErrorScreenView words={words} reference={reference} titleRef={title} />
}

export function ErrorScreenView({ words, reference, titleRef }: { words: ErrorScreenWords; reference: string | null; titleRef?: Ref<HTMLHeadingElement> }) {
    const [before, after] = words.error_screen_reference.split('{ref}')
    return (
        <div className="ui-panel">
            <div className="ui-empty">
                <Icon icon={WarningCircleIcon} size={40} />
                <h1 ref={titleRef} tabIndex={-1} className="ui-empty-title ui-error-title">{words.error_screen_title}</h1>
                <p className="ui-empty-detail">{words.error_screen_detail}</p>
                <div className="ui-form-actions ui-error-actions">
                    <Button variant="primary" onClick={() => window.location.reload()}>{words.error_screen_reload}</Button>
                    <Button onClick={() => startAgain()}>{words.error_screen_start_again}</Button>
                </div>
                {/* As it was made, in Western letters and digits, which a browser's translation leaves as it is. */}
                {reference && <p className="ui-empty-detail ui-error-reference">{before}<span className="ui-error-code" translate="no" dir="ltr">{reference}</span>{after}</p>}
            </div>
        </div>
    )
}
