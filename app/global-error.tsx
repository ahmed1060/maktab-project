'use client'

import { useEffect, useState } from 'react'

// The last-resort net: fires only for a crash Next.js can't recover from
// inside the normal tree — e.g. RootLayout itself throwing — which is
// exactly the case DashboardErrorBoundary and the (auth) layout's boundary
// can't catch, since neither has mounted yet. Without this file, that case
// fell straight through to Next's own default, unbranded error page. Can't
// rely on any app context here (Providers/translations haven't mounted
// either) — deliberately plain, self-contained markup only.
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    const [ref, setRef] = useState<string | null>(null)

    useEffect(() => {
        console.error('[GlobalError]', error)
        fetch('/api/system/log-client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: error?.message,
                stack: error?.stack,
                route: typeof window !== 'undefined' ? window.location.pathname : undefined,
            }),
        })
            .then(res => res.json())
            .then(data => { if (data?.data?.ref) setRef(data.data.ref) })
            .catch(() => { })
    }, [error])

    return (
        <html>
            <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', background: 'var(--surface-subtle)' }}>
                <div style={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2rem',
                }}>
                    <div style={{
                        maxWidth: '420px',
                        textAlign: 'center',
                        background: 'var(--surface)',
                        borderRadius: '1.5rem',
                        padding: '2.5rem 2rem',
                        boxShadow: '0 20px 25px -5px var(--shadow-weak)',
                    }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>⚠️</div>
                        <h2 style={{ color: 'var(--text-main)', marginBottom: '1rem', fontWeight: 800 }}>Something went wrong</h2>
                        <p style={{ color: 'var(--text-soft)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                            The app hit an unexpected error and couldn&apos;t recover on its own.
                        </p>
                        {ref && (
                            <p style={{ color: 'var(--text-faint)', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                                If this keeps happening, share this reference with your admin: <b>{ref}</b>
                            </p>
                        )}
                        <button
                            onClick={() => reset()}
                            style={{
                                padding: '0.75rem 1.5rem',
                                fontWeight: 'bold',
                                borderRadius: '0.5rem',
                                border: 'none',
                                background: 'var(--info-solid)',
                                color: 'var(--text-on-accent)',
                                cursor: 'pointer',
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    )
}
