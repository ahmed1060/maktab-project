'use client'
import { signOut } from "next-auth/react"

export default function LogoutButton() {
    return (
        <button
            onClick={() => signOut()}
            style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: 'white',
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
