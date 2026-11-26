'use client'
import { useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Dialog, DialogActions } from '@/components/ui'
import { apiErrorText } from '@/lib/api-error-text'
import { monthLabel, ownerRefusal } from '@/lib/owners'

/** A text with {name} in it, the name kept whole in either direction. */
function Named({ text, name }: { text: string; name: string }) {
    const [before, after] = text.split('{name}')
    return <>{before}<bdi>{name}</bdi>{after}</>
}

type OpenWork = { kind: 'task' | 'obligation'; id: string; title: string }

/**
 * Adding someone to the owners, or removing them (LATER_CHANGES_PLAN.md
 * §7.3, PR 426): the building blocks' dialog, under their name, saying what
 * changes from this month, then asking. Refused, it says why above the
 * buttons, and names the work still open that's to be moved first.
 */
export function OwnerDialog({ userId, name, owner, month, onClose, onDone }: {
    userId: string
    name: string
    /** Whether they're an owner now: the dialog takes it off. */
    owner: boolean
    /** This month in the company's calendar, 'YYYY-MM'. */
    month: string
    onClose: () => void
    onDone: (owner: boolean) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [error, setError] = useState<string | null>(null)
    const [work, setWork] = useState<OpenWork[]>([])
    const [busy, setBusy] = useState(false)
    const when = monthLabel(month, locale)

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        setWork([])
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(userId)}/owner`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ owner: !owner }),
            })
            const text = await res.text()
            let body: { success?: boolean; code?: string; work?: OpenWork[] } | null = null
            try { body = JSON.parse(text) } catch { body = null }
            if (res.ok && body?.success) {
                showToast(t(owner ? 'owner_removed' : 'owner_added').replace('{name}', name).replace('{month}', when), 'success')
                onDone(!owner)
                return
            }
            const refused = ownerRefusal(body?.code)
            if (refused) {
                setError(t(refused))
                setWork(body?.work ?? [])
            } else setError(apiErrorText(text, t('error_generic')))
        } catch {
            setError(t('error_generic'))
        } finally {
            setBusy(false)
        }
    }

    const cancel = () => { if (!busy) onClose() }

    return (
        <Dialog open onClose={cancel} title={<Named text={t(owner ? 'owner_remove_title' : 'owner_add_title')} name={name} />}>
            <form className="ui-form" noValidate onSubmit={submit}>
                <p>{t(owner ? 'owner_remove_says' : 'owner_add_says').replace('{month}', when)}</p>
                {error && (
                    <div className="ui-error" role="alert">
                        <p>{error}</p>
                        {work.length > 0 && (
                            <ul>
                                {work.map(w => {
                                    // The title as it was typed, whole in either direction, where the words put it.
                                    const [before, after] = t(w.kind === 'task' ? 'owner_work_task' : 'owner_work_obligation').split('{title}')
                                    return <li key={`${w.kind}:${w.id}`}>{before}<bdi dir="auto">{w.title}</bdi>{after}</li>
                                })}
                            </ul>
                        )}
                    </div>
                )}
                <DialogActions>
                    <Button onClick={cancel} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t(owner ? 'owner_remove' : 'owner_add')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
