'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Step-up confirmation for high-risk actions (ROLES_PLAN.md §6.15), for every
 * screen at once.
 *
 * A high-risk route answers 403 with `code: STEP_UP_REQUIRED` when the session
 * has not confirmed recently. This catches that answer, asks for the
 * authenticator code, has the server check it (a session update — the server
 * writes the time into the signed token, never the browser), and sends the
 * original request again; the screen that asked gets that second answer and
 * never knows. Cancelling hands it the refusal. `MFA_ENROL_REQUIRED` says to
 * set up two-factor authentication first.
 */

type Ask = { kind: 'code' | 'enrol'; minutes: number; resolve: (confirmed: boolean) => void }

export default function StepUpInterceptor() {
    const { t } = useLanguage()
    const { data: current, update } = useSession()
    const [ask, setAsk] = useState<Ask | null>(null)
    const [code, setCode] = useState('')
    const [wrong, setWrong] = useState(false)
    const [checking, setChecking] = useState(false)
    // The latest update() for the patched fetch, which is installed once.
    const updateRef = useRef(update)
    useEffect(() => { updateRef.current = update }, [update])
    // What the session said before asking: a confirmation is a new time, not
    // one compared against this browser's clock, which may not agree.
    const previousRef = useRef<number | null>(null)
    useEffect(() => { previousRef.current = (current?.user as { stepUpAt?: number | null } | undefined)?.stepUpAt ?? null }, [current])

    useEffect(() => {
        const { fetch: inner } = window
        const waitFor = (kind: Ask['kind'], minutes: number) =>
            new Promise<boolean>(resolve => setAsk({ kind, minutes, resolve }))

        window.fetch = async (input, init) => {
            // A Request's body can be read once; keep a copy to send again.
            const again = input instanceof Request ? input.clone() : input
            const res = await inner(input, init)
            if (res.status !== 403) return res
            const body = await res.clone().json().catch(() => null)
            if (body?.code === 'MFA_ENROL_REQUIRED') {
                await waitFor('enrol', body.minutes ?? 60)
                return res
            }
            if (body?.code !== 'STEP_UP_REQUIRED') return res
            const confirmed = await waitFor('code', body.minutes ?? 60)
            return confirmed ? inner(again, init) : res
        }
        return () => { window.fetch = inner }
    }, [])

    const close = (confirmed: boolean) => {
        ask?.resolve(confirmed)
        setAsk(null)
        setCode('')
        setWrong(false)
    }

    const confirm = async (e: React.FormEvent) => {
        e.preventDefault()
        setChecking(true)
        setWrong(false)
        try {
            const session = await updateRef.current({ stepUpCode: code.trim() })
            const at = (session?.user as { stepUpAt?: number | null } | undefined)?.stepUpAt
            if (at && at !== previousRef.current) close(true)
            else setWrong(true)
        } finally {
            setChecking(false)
        }
    }

    if (!ask) return null
    if (ask.kind === 'enrol') {
        return (
            <Modal isOpen onClose={() => close(false)} title={t('step_up_enrol_title')}>
                <p style={{ marginTop: 0 }}>{t('step_up_enrol_hint')}</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={() => close(false)}>{t('roles_cancel')}</button>
                    <Link className="btn btn-primary" href="/dashboard/security-settings" onClick={() => close(false)} style={{ textDecoration: 'none' }}>{t('step_up_enrol_go')}</Link>
                </div>
            </Modal>
        )
    }
    return (
        <Modal isOpen onClose={() => close(false)} title={t('step_up_title')}>
            <form onSubmit={confirm}>
                <p style={{ marginTop: 0 }}>{t('step_up_hint').replace('{minutes}', String(ask.minutes))}</p>
                <label htmlFor="step-up-code" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.85rem' }}>{t('step_up_code')}</label>
                <input
                    id="step-up-code"
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={8}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    style={{ letterSpacing: '0.3em', maxWidth: '12rem' }}
                />
                {wrong && <p style={{ color: 'var(--danger-fg)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{t('step_up_wrong')}</p>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                    <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={() => close(false)}>{t('roles_cancel')}</button>
                    <button type="submit" className="btn btn-primary" disabled={checking || code.trim().length < 6}>{t('step_up_confirm')}</button>
                </div>
            </form>
        </Modal>
    )
}
