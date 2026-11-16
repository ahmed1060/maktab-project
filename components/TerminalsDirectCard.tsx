'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { Button, Card, Dialog, Row, StatusBadge } from '@/components/ui'

/**
 * Whether a company's terminals may send their scans straight to Nizmo
 * (ATTENDANCE_PLAN.md §17.8, PR 295): the Super Admin's switch, on the
 * Attendance tab under who sets terminals up, for a company holding the
 * Terminals add-on. Off, a terminal can't be added that way and one set
 * that way is held: it keeps its scans and sends them again.
 *
 * Allowing asks first: what a terminal sends counts towards pay. Stopping
 * asks only when a terminal would be held, and says how many.
 *
 * How many is read from the list Fingerprint terminals shows, under the
 * same key: one added or retired there is counted here at once, and once
 * the switch is saved that list is asked for again, so Add a terminal
 * offers what was just allowed.
 */
export default function TerminalsDirectCard({ companyId, on, onSaved }: {
    companyId: string
    on: boolean
    onSaved: (next: { terminalsDirectAllowed: boolean }) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [saving, setSaving] = useState(false)
    const [asking, setAsking] = useState<'on' | 'off' | null>(null)
    const { data, error, mutate, isValidating } = useSWR(`/api/attendance/devices?companyId=${encodeURIComponent(companyId)}`, fetcher)
    // Read at least once: only then is it known whether turning off would hold a terminal.
    // A load that failed isn't a list with none (Codex on PR 295).
    const read = data !== undefined
    const devices: { connection: string; retiredAt: string | null }[] = data?.data?.devices ?? []
    // The terminals that send straight to Nizmo, retired ones aside: what the switch holds, turned off.
    const terminals = devices.filter(d => d.connection === 'DIRECT' && !d.retiredAt).length
    const count = (words: string) => words.replace('{n}', terminals.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB'))

    /** Whether it saved: a failed save leaves the dialog open, to try again or cancel. */
    const save = async (next: boolean): Promise<boolean> => {
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, tab: 'attendance', terminalsDirectAllowed: next }),
            })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return false
            }
            onSaved({ terminalsDirectAllowed: next })
            void mutate()
            showToast(t('settings_saved_success'), 'success')
            return true
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        } finally {
            setSaving(false)
        }
    }

    const hint = t(on ? 'att_term_direct_on_hint' : 'att_term_direct_off_hint')
    return (
        <Card title={t('att_term_direct_title')}>
            {/* The list couldn't be read: the card says why Turn off waits, with a way to read it again. */}
            {on && !read && !!error && (
                <p className="ui-card-note" role="status">{t('att_term_direct_list_failed')} <Button size="sm" busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></p>
            )}
            <ul className="ui-rows ui-rows-flush" aria-label={t('att_term_direct_title')}>
                <Row
                    title={t('att_term_direct_label')}
                    // In one piece: a row's second line sets its pieces apart.
                    detail={<span>{terminals > 0 ? `${hint} ${count(t('att_term_direct_count'))}` : hint}</span>}
                    end={<>
                        <StatusBadge tone={on ? 'good' : 'neutral'}>{t(on ? 'att_term_setup_on_badge' : 'att_term_setup_off_badge')}</StatusBadge>
                        {/* The short words the other settings' switches use: a row's end
                            holds a button no wider than that on a phone. The question's
                            button says in full what it does. */}
                        {/* Turn off waits for the list: until it's read, nothing says whether a terminal would be held. */}
                        {on
                            ? <Button size="sm" busy={saving} disabled={!read} onClick={() => { if (terminals > 0) setAsking('off'); else void save(false) }}>{t('settings_turn_off')}</Button>
                            : <Button size="sm" variant="primary" disabled={saving} onClick={() => setAsking('on')}>{t('settings_turn_on')}</Button>}
                    </>}
                />
            </ul>
            {/* The building blocks' dialog: it stays open, its button busy,
                until the switch is saved, and open if saving fails. */}
            <Dialog
                open={asking !== null}
                onClose={() => { if (!saving) setAsking(null) }}
                title={t(asking === 'off' ? 'att_term_direct_off_title' : 'att_term_direct_on_title')}
                actions={<>
                    <Button onClick={() => setAsking(null)} disabled={saving}>{t('cancel')}</Button>
                    {/* Not the danger colour: stopping deletes nothing and is undone by allowing it again (DESIGN.md §5.5, Dialog). */}
                    <Button variant="primary" busy={saving} onClick={async () => {
                        if (await save(asking === 'on')) setAsking(null)
                    }}>{t(asking === 'off' ? 'att_term_direct_turn_off' : 'att_term_direct_turn_on')}</Button>
                </>}
            >
                <p>{asking === 'off' ? count(t('att_term_direct_off_msg')) : t('att_term_direct_on_msg')}</p>
            </Dialog>
        </Card>
    )
}
