'use client'

import { SessionProvider } from "next-auth/react"
import { CompanyProvider } from "@/context/CompanyContext"

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <CompanyProvider>
                {children}
            </CompanyProvider>
        </SessionProvider>
    )
}
