'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { checkInDevice, inNativeApp } from '@/lib/mobile/native'
import { checkIn, deviceFingerprint, registerPhone, type CheckInAnswer } from '@/lib/mobile/check-in-flow'
import { answerKey, thisPhone } from '@/lib/mobile/screen'
import { send, json } from '../attendance/send'
import { AskPermissionModal } from '../attendance/RequestsTab'

/**
 * Checking in, inside the Nizmo app (ATTENDANCE_PLAN.md §9). The app opens
 * here. The phone's own plugin holds the key and takes the location; this
 * page asks the server for a number, has the phone sign it, and shows what
 * became of the check-in. In a browser it only says to use the app: the
 * browser can't prove where it is (§9.1).
 *
 * A late check-in offers to ask for permission hours on the spot, with the
 * month's balance (§13.6).
 */

type Phone = { model: string | null; platform: string; keyFingerprint: string }

const box = { padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '0.75rem' } as const
const soft = { color: 'var(--text-soft)', fontSize: '0.85rem' } as const
const big = { padding: '1.1rem', fontSize: '1.1rem', borderRadius: '1rem', flex: '1 1 10rem' } as const

const subscribeNever = () => () => {}

/** What the phone said when it couldn't do something, as words for the person. */
const DEVICE_ERRORS: Record<string, TranslationKey> = {
    LOCATION_DENIED: 'ci_location_denied',
    LOCATION_UNAVAILABLE: 'ci_location_unavailable',
    KEY_UNAVAILABLE: 'ci_key_failed',
    NO_PHONE_KEY: 'ci_key_failed',
}

export default function CheckInPage() {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session } = useSession()
    // Read once the page is in the browser: the server can't know it's inside the app.
    const native = useSyncExternalStore(subscribeNever, inNativeApp, () => false)
    const device = useMemo(() => (native ? checkInDevice() : null), [native])
    const { data: phoneBody, error: phoneError, mutate: refreshPhone } = useSWR(device ? '/api/attendance/phone' : null, fetcher)
    const { data: fingerprint, error: keyError, mutate: refreshFingerprint } = useSWR(device ? 'this-phone-key' : null, () => deviceFingerprint(device!))
    const [busy, setBusy] = useState<null | 'register' | 'IN' | 'OUT'>(null)
    const [answer, setAnswer] = useState<CheckInAnswer | null>(null)
    const [switching, setSwitching] = useState(false)
    const [asking, setAsking] = useState(false)
    const late = answer && answer.outcome !== 'REFUSED' ? answer.late : null
    const { data: balanceBody } = useSWR(late && answer?.outcome !== 'REFUSED' ? `/api/attendance/permissions/balance?date=${answer!.at.slice(0, 10)}` : null, fetcher)

    useEffect(() => {
        setTitle(t('ci_title'))
        setSubtitle(t('ci_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    const post = async (url: string, body: unknown) => {
        const r = await send(url, json('POST', body), t('ci_failed'))
        if (!r.ok) throw new Error(r.error)
        return r.body
    }
    const problem = (e: unknown) => {
        const code = (e as { code?: string })?.code ?? (e as Error)?.message
        showToast(code && DEVICE_ERRORS[code] ? t(DEVICE_ERRORS[code]) : (e as Error)?.message || t('ci_failed'), 'error')
    }

    const register = async () => {
        setSwitching(false)
        setBusy('register')
        try {
            await registerPhone(device!, post)
            showToast(t('ci_registered'), 'success')
            await Promise.all([refreshFingerprint(), refreshPhone()])
        } catch (e) { problem(e) } finally { setBusy(null) }
    }
    const punch = async (direction: 'IN' | 'OUT') => {
        setBusy(direction)
        setAnswer(null)
        try {
            setAnswer(await checkIn(device!, post, direction))
        } catch (e) { problem(e) } finally { setBusy(null) }
    }

    if (session?.user?.role === 'SUPER_ADMIN') return <section className="glass" style={box}><p style={{ margin: 0 }}>{t('ci_not_for_super_admin')}</p></section>
    if (!device) return (
        <section className="glass" style={box}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>📲 {t('ci_title')}</h2>
            <p style={{ margin: 0 }}>{t('ci_use_app')}</p>
        </section>
    )
    if (phoneError) return <section className="glass" style={box}><p style={{ margin: 0 }}>{phoneError.status === 403 ? t('ci_not_available') : t('error_generic')}</p></section>
    const which = thisPhone(phoneBody?.data as { active: Phone | null; pending: Phone | null } | undefined, { fingerprint, failed: !!keyError })
    if (!which) return <LoadingSpinner />
    const { mine, other, keyFailed } = which
    const label = (ph: Phone) => ph.model || t(`audit_value_${ph.platform}` as TranslationKey)

    return (
        <div style={{ display: 'grid', gap: '1rem', maxWidth: '36rem' }}>
            {!mine && (
                <section className="glass" style={box}>
                    {keyFailed && <p role="alert" style={{ margin: 0, color: 'var(--danger-fg)' }}>{t('ci_key_failed')}</p>}
                    <p style={{ margin: 0 }}>{other ? t('ci_other_phone').replaceAll('{model}', label(other)) : t('ci_register_hint')}</p>
                    <button className="btn btn-primary" style={big} disabled={!!busy} onClick={() => (other ? setSwitching(true) : register())}>
                        {busy === 'register' ? '…' : t(other ? 'ci_switch' : 'ci_register')}
                    </button>
                </section>
            )}

            {mine && (
                <section className="glass" style={box}>
                    {mine === 'PENDING' && <p style={{ margin: 0, ...soft }}>{t('ci_waiting')}</p>}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" style={big} disabled={!!busy} onClick={() => punch('IN')}>{busy === 'IN' ? t('ci_locating') : t('ci_in')}</button>
                        <button className="btn btn-secondary" style={big} disabled={!!busy} onClick={() => punch('OUT')}>{busy === 'OUT' ? t('ci_locating') : t('ci_out')}</button>
                    </div>
                </section>
            )}

            {answer && <Answer answer={answer} />}

            {late && answer?.outcome !== 'REFUSED' && (
                <section className="glass" style={{ ...box, borderInlineStart: '4px solid var(--warn-solid)' }}>
                    <p style={{ margin: 0 }}>{t('ci_late').replace('{n}', String(late.minutes)).replace('{start}', late.startsAt)}</p>
                    {balanceBody?.data?.enabled && <p style={{ margin: 0, ...soft }}>{t('ci_late_balance').replace('{left}', String(balanceBody.data.remainingMinutes))}</p>}
                    {balanceBody?.data?.enabled && balanceBody.data.types.includes('LATE_ARRIVAL') && (
                        <button className="btn btn-secondary" onClick={() => setAsking(true)}>{t('ci_ask_permission')}</button>
                    )}
                </section>
            )}

            {asking && answer && answer.outcome !== 'REFUSED' && late && (
                <AskPermissionModal
                    today={answer.at.slice(0, 10)}
                    initial={{ date: answer.at.slice(0, 10), type: 'LATE_ARRIVAL', start: late.startsAt.slice(0, 5), end: answer.at.slice(11, 16) }}
                    onClose={() => setAsking(false)}
                    onDone={() => { setAsking(false); setAnswer(null) }}
                />
            )}

            <ConfirmModal
                isOpen={switching}
                title={t('ci_switch')}
                message={t('ci_switch_confirm')}
                confirmText={t('ci_switch')}
                onConfirm={register}
                onCancel={() => setSwitching(false)}
            />
        </div>
    )
}

/** What became of the check-in, in the person's words. */
function Answer({ answer }: { answer: CheckInAnswer }) {
    const { t } = useLanguage()
    if (answer.outcome === 'REFUSED') {
        const reason = t(`ci_refusal_${answer.reason}` as TranslationKey)
        return <section className="glass" role="status" style={{ ...box, color: 'var(--danger-fg)' }}>{t('ci_refused').replace('{reason}', reason)}</section>
    }
    const fill = (key: TranslationKey) => t(key)
        .replace('{time}', answer.at.slice(11, 16))
        .replace('{place}', answer.place.name)
        .replace('{reasons}', answer.reasons.map(r => t(`att_flag_${r}` as TranslationKey)).join(', '))
    const key: TranslationKey = answerKey(answer)
    return (
        <section className="glass" role="status" style={{ ...box, color: answer.outcome === 'ACCEPTED' ? 'var(--ok-fg)' : undefined }}>
            <p style={{ margin: 0 }}>{answer.outcome === 'ACCEPTED' ? '✅ ' : '🕒 '}{fill(key)}</p>
            <p style={{ margin: 0, ...soft }}>{t('ci_distance').replace('{n}', String(answer.distanceMeters))}</p>
        </section>
    )
}
