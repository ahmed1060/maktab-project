'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { CheckCircleIcon, DeviceMobileIcon, HourglassIcon, InfoIcon, LockSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Dialog, EmptyState, Icon, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import type { CheckInDevice } from '@/lib/mobile/native'
import { checkIn, deviceFingerprint, errorCode, registerPhone, type CheckInAnswer } from '@/lib/mobile/check-in-flow'
import { answerKey, checksFace, faceCardNote, faceModelNeeded, faceReady, faceStep, reverifyFirst, setUpFirst, shouldReconcileTemplates, thisPhone, type FaceStatus } from '@/lib/mobile/screen'
import { enrolFace, faceInfo, faceVerifier, settleTemplates, wrappingKey } from '@/lib/mobile/face'
import { FACE_CHECK, faceCheckVerifier } from '@/lib/mobile/face-check/verifier'
import { useFaceCamera } from '@/components/FaceCamera'
import { enablePush, pushPlugin } from '@/lib/mobile/push'
import { send, json } from '../attendance/send'
import { AskPermissionDialog } from '../attendance/RequestsTab'

/**
 * Checking in, inside the Nizmo app (ATTENDANCE_PLAN.md §9). The app opens
 * here. The phone's own plugin holds the key and takes the location; this
 * screen asks the server for a number, has the phone sign it, and shows what
 * became of the check-in. In a browser there's no phone (`device` is null),
 * and it only says to use the app: the browser can't prove where it is
 * (§9.1).
 *
 * A late check-in offers to ask for permission hours on the spot, with the
 * month's balance (§13.6). Where face verification is asked of the person,
 * this is where they consent, set it up, and are checked (§9.5).
 *
 * On the building blocks (UI_PLAN.md §5 step 5, PR 156; DESIGN.md §5.5,
 * Check-in): the page header, the phone's card with Check in and Check out
 * side by side, what became of a check-in as a card with its meaning, and
 * loading, refused and failed each saying so, in the page's digits.
 */

type Phone = { model: string | null; platform: string; keyFingerprint: string }
type LateArrival = NonNullable<Extract<CheckInAnswer, { outcome: 'ACCEPTED' | 'FLAGGED' | 'HELD' }>['late']>
type Balance = { enabled: boolean; remainingMinutes: number; types: string[] }

/** What the phone said when it couldn't do something, as words for the person. */
const DEVICE_ERRORS: Record<string, TranslationKey> = {
    LOCATION_DENIED: 'ci_location_denied',
    LOCATION_UNAVAILABLE: 'ci_location_unavailable',
    KEY_UNAVAILABLE: 'ci_key_failed',
    NO_PHONE_KEY: 'ci_key_failed',
    FACE_CANCELLED: 'face_ci_cancelled',
    CAMERA_DENIED: 'face_ci_camera_denied',
    FACE_MODELS_UNAVAILABLE: 'face_ci_models_failed',
    FACE_MODELS_CORRUPT: 'face_ci_models_failed',
    FACE_NOT_AVAILABLE: 'face_ci_not_available',
    FACE_PLUGIN_TIMEOUT: 'face_ci_not_available',
    LIVENESS_FAILED: 'face_ci_liveness_failed',
}

/** Digits in the page's language, for times such as "08:58" the server gives as text. */
function useDigits() {
    const { locale } = useLanguage()
    return {
        text: (s: string) => (locale === 'ar' ? s.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : s),
        number: (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB'),
    }
}

export default function CheckInScreen({ device }: { device: CheckInDevice | null }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const { data: phoneBody, error: phoneError, isValidating: phoneRetrying, mutate: refreshPhone } = useSWR(device ? '/api/attendance/phone' : null, fetcher)
    const { data: fingerprint, error: keyError, mutate: refreshFingerprint } = useSWR(device ? 'this-phone-key' : null, () => deviceFingerprint(device!))
    const camera = useFaceCamera()
    // The face SDK's plugin when the app has one; otherwise, on a test build, the face check for testing (mobile/FACE_CHECK.md).
    const face = useMemo(() => (device ? faceVerifier() ?? (FACE_CHECK ? faceCheckVerifier(camera.open) : null) : null), [device, camera.open])
    // Which face model this app has: templates approved with another can't be matched, and the face is set up again.
    const { data: faceModel, error: faceModelError } = useSWR(face ? 'this-phone-face-model' : null, async () => (await faceInfo(face!)).modelVersion)
    // Stamped with when it was asked for: an answer from before a photo went can't say the photo never arrived (review on #49).
    const { data: faceBody, error: faceError, mutate: refreshFace } = useSWR(device ? '/api/attendance/face' : null, async (url: string) => {
        const askedAt = Date.now()
        const body = await fetcher(url)
        return body?.data ? { ...body, data: { ...body.data, askedAt } } : body
    })
    const faceStatus = faceBody?.data as FaceStatus | undefined
    const phoneActive = !!fingerprint && (phoneBody?.data as { active: Phone | null } | undefined)?.active?.keyFingerprint === fingerprint
    // Check in waits for these: tapped sooner, the set-up or the face check was skipped (review on #49). The
    // model only when the face check can start. The buttons show once the phone is known, so phoneActive is too.
    const ready = faceReady({ data: faceBody, error: faceError }, face && faceModelNeeded(faceStatus, { phoneActive }) ? { data: faceModel, error: faceModelError } : undefined)
    const [busy, setBusy] = useState<null | 'register' | 'IN' | 'OUT' | 'face'>(null)
    const [answer, setAnswer] = useState<CheckInAnswer | null>(null)
    const [switching, setSwitching] = useState(false)
    const [asking, setAsking] = useState(false)
    const [withdrawing, setWithdrawing] = useState(false)
    const late = answer && answer.outcome !== 'REFUSED' ? answer.late : null
    // The shift's month and policy: a night shift's arrival after midnight is the night before's (review on #61).
    const { data: balanceBody } = useSWR(late ? `/api/attendance/permissions/balance?date=${late.date}` : null, fetcher)

    // Face templates on this phone while face verification isn't in use for
    // the person: the server may have said they are to go, and nothing else
    // would ever ask (review on #27). It says whether to delete or keep them.
    useEffect(() => {
        // Not while a capture or check-in runs: its templates may not have reached the server yet.
        if (!device || !face || !faceStatus || !phoneActive || busy) return
        const quiet = async (url: string, body: unknown) => {
            const r = await send(url, json('POST', body), '')
            if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code })
            return r.body
        }
        // New templates waiting on their photo: kept aside until it is decided, then promoted or dropped (§9.5).
        void settleTemplates(face, faceStatus)
            .then(() => face.info())
            .then(i => (shouldReconcileTemplates(faceStatus, { phoneActive, enrolled: i.enrolled || i.pending }) ? wrappingKey(device, face, quiet) : null))
            .catch(() => {})
    }, [device, face, faceStatus, phoneActive, busy])

    // The face check's models loaded while the person is still on this screen, when the check will be asked for:
    // on a phone they took seconds after the camera had opened.
    const faceInUse = !!faceStatus?.required && !!faceStatus.consent && phoneActive
    useEffect(() => {
        if (face && faceInUse) void face.prepare?.().catch(() => {})
    }, [face, faceInUse])

    const post = async (url: string, body: unknown) => {
        const r = await send(url, json('POST', body), t('ci_failed'))
        // The words for the person; the code for the app to decide on (lib/mobile/face.ts).
        if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code })
        return r.body
    }
    const problem = (e: unknown) => {
        const code = errorCode(e)
        showToast(code && DEVICE_ERRORS[code] ? t(DEVICE_ERRORS[code]) : (e as Error)?.message || t('ci_failed'), 'error')
    }

    const register = async () => {
        setBusy('register')
        try {
            await registerPhone(device!, post)
            showToast(t('ci_registered'), 'success')
            // A new phone has a new key: tell the server where to push to it.
            void enablePush(device!, pushPlugin(), post)
            await Promise.all([refreshFingerprint(), refreshPhone()])
        } catch (e) { problem(e) } finally { setBusy(null); setSwitching(false) }
    }
    const punch = async (direction: 'IN' | 'OUT') => {
        setBusy(direction)
        setAnswer(null)
        try {
            // Asked to re-verify, or no face set up on this phone (a new one): the check-in starts with it
            // (§9.3, §9.5). Not doing it doesn't stop the check-in, which still counts against the approved
            // face, or, with none on this phone, goes for a review.
            if (face && (reverifyFirst(faceStatus, { phoneActive, modelVersion: faceModel }) || setUpFirst(faceStatus, { phoneActive, verifier: true }))) {
                try {
                    await enrolFace(device!, face, post)
                    showToast(t('face_ci_sent'), 'success')
                } catch (e) { if (errorCode(e) !== 'FACE_CANCELLED') problem(e) }
                void refreshFace()
            }
            // Templates from another face model can't be matched, and a replacement waiting for approval has
            // none: no face check, and the server sends the check-in for a review, as with no face check at all.
            setAnswer(await checkIn(device!, post, direction, checksFace(faceStatus, { phoneActive, modelVersion: faceModel }) ? face : null))
        } catch (e) { problem(e) } finally { setBusy(null) }
    }

    const enrol = async () => {
        setBusy('face')
        try {
            await enrolFace(device!, face!, post)
            showToast(t('face_ci_sent'), 'success')
            await refreshFace()
        } catch (e) { problem(e) } finally { setBusy(null) }
    }
    const consent = async (accept: boolean) => {
        setBusy('face')
        try {
            const r = await send('/api/attendance/face/consent', accept ? json('POST', { version: faceStatus!.consentVersion }) : { method: 'DELETE' }, t('error_generic'))
            if (!r.ok) throw new Error(r.error)
            if (!accept) {
                showToast(t('face_ci_withdrawn'), 'success')
                // The key is gone already; the phone deletes what it can no longer read.
                if (face && which?.mine === 'ACTIVE') await wrappingKey(device!, face, post).catch(() => null)
            }
            await refreshFace()
        } catch (e) { problem(e) } finally { setBusy(null) }
    }

    const header = <PageHeader title={t('ci_title')} subtitle={t('ci_hint')} />
    const alone = (body: React.ReactNode, status = false) => <Page>{header}<div className="ui-panel" role={status ? 'status' : undefined}>{body}</div></Page>

    if (session?.user?.role === 'SUPER_ADMIN') return alone(<EmptyState icon={InfoIcon} title={t('ci_not_for_super_admin')} />)
    if (!device) return alone(<EmptyState icon={DeviceMobileIcon} title={t('ci_use_app')} />)
    if (phoneError) {
        // Not in the company's package is the answer; anything else might pass, and is tried again (§5.5).
        if ((phoneError as SWRError).status === 403) return alone(<EmptyState icon={LockSimpleIcon} title={t('ci_not_available')} />)
        return alone(<EmptyState icon={WarningCircleIcon} title={t('ci_load_failed')} detail={(phoneError as SWRError).info?.error}
            action={<Button busy={phoneRetrying} onClick={() => { void refreshPhone() }}>{t('try_again')}</Button>} />)
    }
    const which = thisPhone(phoneBody?.data as { active: Phone | null; pending: Phone | null } | undefined, { fingerprint, failed: !!keyError })
    if (!which) return alone(<EmptyState icon={HourglassIcon} title={t('loading')} />, true)
    const step = faceStep(faceStatus, { phoneActive: which.mine === 'ACTIVE', verifier: !!face, modelVersion: faceModel })
    const { mine, other, keyFailed } = which
    const label = (ph: Phone) => ph.model || t(`audit_value_${ph.platform}` as TranslationKey)
    const working = face && checksFace(faceStatus, { phoneActive, modelVersion: faceModel }) ? t('face_ci_checking') : t('ci_locating')

    return (
        <Page>
            {header}
            <div className="ui-checkin">
                {!mine && (
                    <Card>
                        {keyFailed && <p className="ui-error" role="alert">{t('ci_key_failed')}</p>}
                        <p>{other ? t('ci_other_phone').replaceAll('{model}', label(other)) : t('ci_register_hint')}</p>
                        <div className="ui-card-actions">
                            <Button variant="primary" busy={busy === 'register'} disabled={!!busy} onClick={() => (other ? setSwitching(true) : void register())}>
                                {t(other ? 'ci_switch' : 'ci_register')}
                            </Button>
                        </div>
                    </Card>
                )}

                {mine && (
                    <Card>
                        {mine === 'PENDING' && <p>{t('ci_waiting')}</p>}
                        <div className="ui-checkin-buttons">
                            <Button variant="primary" size="lg" busy={busy === 'IN'} disabled={!!busy || !ready} onClick={() => { void punch('IN') }}>{busy === 'IN' ? working : t('ci_in')}</Button>
                            <Button size="lg" busy={busy === 'OUT'} disabled={!!busy || !ready} onClick={() => { void punch('OUT') }}>{busy === 'OUT' ? working : t('ci_out')}</Button>
                        </div>
                    </Card>
                )}

                {answer && <Answer answer={answer} />}

                {late && <Late late={late} balance={balanceBody?.data as Balance | undefined} onAsk={() => setAsking(true)} />}

                {step && (
                    <FaceCard step={step} active={!!faceStatus?.active} busy={!!busy} working={busy === 'face'}
                        onConsent={() => { void consent(true) }} onWithdraw={() => setWithdrawing(true)} onEnrol={() => { void enrol() }} />
                )}
            </div>
            {camera.element}

            {asking && answer && answer.outcome !== 'REFUSED' && late && (
                <AskPermissionDialog
                    today={answer.at.slice(0, 10)}
                    initial={{ date: late.date, type: 'LATE_ARRIVAL', start: late.ask.start, end: late.ask.end }}
                    onClose={() => setAsking(false)}
                    onDone={() => { setAsking(false); setAnswer(null) }}
                />
            )}

            <Dialog
                open={switching}
                onClose={() => setSwitching(false)}
                title={t('ci_switch')}
                actions={<>
                    <Button onClick={() => setSwitching(false)} disabled={!!busy}>{t('cancel')}</Button>
                    <Button variant="primary" busy={busy === 'register'} disabled={!!busy} onClick={() => { void register() }}>{t('ci_switch')}</Button>
                </>}
            >
                <p>{t('ci_switch_confirm')}</p>
            </Dialog>

            <Dialog
                open={withdrawing}
                onClose={() => setWithdrawing(false)}
                title={t('face_ci_withdraw')}
                actions={<>
                    <Button onClick={() => setWithdrawing(false)} disabled={!!busy}>{t('cancel')}</Button>
                    <Button variant="danger" busy={busy === 'face'} disabled={!!busy} onClick={async () => { await consent(false); setWithdrawing(false) }}>{t('face_ci_withdraw')}</Button>
                </>}
            >
                <p>{t('face_ci_withdraw_confirm')}</p>
            </Dialog>
        </Page>
    )
}

/**
 * What became of the check-in, in the person's words, read out as it comes
 * (DESIGN.md §5.5, Check-in): recorded, with a check in the Good colour;
 * recorded but waiting on someone; or not recorded, and why.
 */
export function Answer({ answer }: { answer: CheckInAnswer }) {
    const { t, locale } = useLanguage()
    const digits = useDigits()
    if (answer.outcome === 'REFUSED') {
        const reason = t(`ci_refusal_${answer.reason}` as TranslationKey)
        return <Card tone="problem" role="status"><p>{t('ci_refused').replace('{reason}', reason)}</p></Card>
    }
    // The reasons listed as the language lists things: ", " read as English inside Arabic (PR 156).
    const reasons = new Intl.ListFormat(locale === 'ar' ? 'ar' : 'en', { type: 'conjunction' })
        .format(answer.reasons.map(r => t(`att_flag_${r}` as TranslationKey)))
    const [before, after = ''] = t(answerKey(answer))
        .replace('{time}', digits.text(answer.at.slice(11, 16)))
        .replace('{reasons}', reasons)
        .split('{place}')
    const accepted = answer.outcome === 'ACCEPTED'
    return (
        <Card tone={accepted ? undefined : 'waiting'} role="status">
            {/* The place's name keeps its own direction: an English one ran into the Arabic sentence (PR 156). */}
            <p className="ui-checkin-answer">{accepted && <Icon icon={CheckCircleIcon} size={20} className="ui-checkin-ok" />}<span>{before}<bdi>{answer.place.name}</bdi>{after}</span></p>
            <p className="ui-card-note">{t('ci_distance').replace('{n}', digits.number(answer.distanceMeters))}</p>
        </Card>
    )
}

/** Arriving late: how late, the month's permission left, and asking for it on the spot (§13.6). */
export function Late({ late, balance, onAsk }: { late: LateArrival; balance: Balance | undefined; onAsk: () => void }) {
    const { t } = useLanguage()
    const digits = useDigits()
    return (
        <Card tone="waiting">
            <p>{t('ci_late').replace('{n}', digits.number(late.minutes)).replace('{start}', digits.text(late.startsAt))}</p>
            {balance?.enabled && <p className="ui-card-note">{t('ci_late_balance').replace('{left}', digits.number(balance.remainingMinutes))}</p>}
            {balance?.enabled && balance.types.includes('LATE_ARRIVAL') && (
                <div className="ui-card-actions"><Button onClick={onAsk}>{t('ci_ask_permission')}</Button></div>
            )}
        </Card>
    )
}

/** Face verification, one step at a time (§9.5): consent, set-up, approval, re-verification. */
function FaceCard({ step, active, busy, working, onConsent, onWithdraw, onEnrol }: {
    step: NonNullable<ReturnType<typeof faceStep>>; active: boolean; busy: boolean; working: boolean
    onConsent: () => void; onWithdraw: () => void; onEnrol: () => void
}) {
    const { t } = useLanguage()
    if (step === 'CONSENT') return (
        <Card title={t('face_consent_title')}>
            <p className="ui-checkin-consent">{t('face_consent_body')}</p>
            <div className="ui-card-actions">
                <Button variant="primary" busy={working} disabled={busy} onClick={onConsent}>{t('face_ci_consent_accept')}</Button>
            </div>
        </Card>
    )
    const text: Record<Exclude<typeof step, 'CONSENT'>, TranslationKey> = {
        // A re-verification waiting: check-ins go on against the approved face.
        WAITING: active ? 'face_ci_waiting_reverify' : 'face_ci_waiting', NEEDS_APP: 'face_ci_needs_app', ENROL: 'face_ci_enrol_hint',
        REJECTED: 'face_ci_rejected', REVERIFY: 'face_ci_reverify_hint', READY: 'face_ci_on', IDLE: 'face_ci_idle',
    }
    const action = step === 'ENROL' || step === 'REJECTED' ? 'face_ci_enrol' : step === 'REVERIFY' ? 'face_ci_reverify' : null
    const note = faceCardNote(step)
    return (
        <Card title={t('face_ci_title')}>
            <p>{t(text[step])}{note ? ` ${t(note)}` : ''}</p>
            <div className="ui-card-actions">
                <Button variant="quiet" disabled={busy} onClick={onWithdraw}>{t('face_ci_withdraw')}</Button>
                {action && <Button variant="primary" busy={working} disabled={busy} onClick={onEnrol}>{t(action)}</Button>}
            </div>
        </Card>
    )
}
