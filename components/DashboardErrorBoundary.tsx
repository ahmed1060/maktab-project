'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { reportClientError } from '@/lib/client-error-report'
import { clearStorageKeepingPhone } from '@/lib/mobile/kept-storage'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    ref: string | null
}

export default class DashboardErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        ref: null
    }

    public static getDerivedStateFromError(error: Error): Partial<State> {
        console.error('[ErrorBoundary] Error caught:', error.message)
        return { hasError: true }
    }

    private handleReset = () => {
        // Clear potentially corrupted state, but not what the phone keeps about itself
        document.cookie = 'NEXT_LOCALE=en;path=/;max-age=31536000'
        clearStorageKeepingPhone(localStorage)
        window.location.reload()
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Full error log:', error, errorInfo)
        // Best-effort — this is a diagnostic report, not something the
        // already-broken screen should wait on or fail harder over.
        reportClientError(error, undefined, errorInfo.componentStack || undefined)
            .then(ref => { if (ref) this.setState({ ref }) })
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '2rem',
                    textAlign: 'center',
                    background: 'var(--veil-60)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: '1.5rem',
                    border: '1px solid var(--veil-40)',
                    margin: '2rem',
                    boxShadow: '0 20px 25px -5px var(--shadow-weak)'
                }}>
                    <div aria-hidden="true" style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>⚠️</div>
                    <h2 style={{ color: 'var(--text-main)', marginBottom: '1rem', fontWeight: '800' }}>Something went wrong</h2>
                    <p style={{ color: 'var(--text-soft)', marginBottom: '2rem', lineHeight: '1.6' }}>
                        A client-side exception has occurred in this section.<br />
                        This is often caused by a loading mismatch or a session error.
                    </p>
                    {this.state.ref && (
                        <p style={{ color: 'var(--text-faint)', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                            If this keeps happening, share this reference with your admin: <b>{this.state.ref}</b>
                        </p>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                        <button
                            onClick={() => window.location.reload()}
                            className="btn btn-primary"
                            style={{ padding: '0.75rem 1.5rem', fontWeight: 'bold' }}
                        >
                            Reload Page
                        </button>
                        <button
                            onClick={this.handleReset}
                            className="btn"
                            style={{
                                padding: '0.75rem 1.5rem',
                                background: 'var(--danger-bg)',
                                color: 'var(--danger-fg)',
                                fontWeight: 'bold',
                                border: '1px solid var(--danger-border)'
                            }}
                        >
                            Reset Settings & Reload
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
