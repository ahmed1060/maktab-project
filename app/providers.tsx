'use client'

import { SessionProvider } from "next-auth/react"
import { CompanyProvider } from "@/context/CompanyContext"
import { ToastProvider } from "@/context/ToastContext"

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <CompanyProvider>
                <ToastProvider>
                    {children}
                </ToastProvider>
            </CompanyProvider>
        </SessionProvider>
    )
}
