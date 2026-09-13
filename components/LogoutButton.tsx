'use client'
import { signOut } from "next-auth/react"

export default function LogoutButton() {
    return (
        <button
            onClick={() => signOut()}
            style={{
                background: 'var(--veil-10)',
                border: 'none',
                color: 'var(--text-on-accent)',
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                width: '100%'
            }}
        >
            Sign Out
        </button>
    )
}
