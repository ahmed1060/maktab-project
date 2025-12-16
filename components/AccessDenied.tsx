'use client'
import Link from 'next/link'

export default function AccessDenied() {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            textAlign: 'center',
            padding: '2rem'
        }}>
            <div style={{
                fontSize: '4rem',
                marginBottom: '1rem'
            }}>
                🚫
            </div>
            <h1 style={{
                fontSize: '2rem',
                fontWeight: 'bold',
                color: '#1e293b',
                marginBottom: '1rem'
            }}>
                Access Restricted
            </h1>
            <p style={{
                color: '#64748b',
                marginBottom: '2rem',
                maxWidth: '400px',
                lineHeight: '1.6'
            }}>
                You do not have permission to view this page. Please contact your administrator if you believe this is an error.
            </p>
            <Link
                href="/dashboard"
                className="btn btn-primary"
                style={{
                    textDecoration: 'none',
                    padding: '0.75rem 2rem',
                    borderRadius: '0.5rem',
                    fontWeight: 600
                }}
            >
                Back to Dashboard
            </Link>
        </div>
    )
}
