'use client'

import { SessionProvider } from "next-auth/react"
import { CompanyProvider } from "@/context/CompanyContext"
import { ToastProvider } from "@/context/ToastContext"
import { HeaderProvider } from "@/context/HeaderContext"

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <CompanyProvider>
                <HeaderProvider>
                    <ToastProvider>
                        {children}
                    </ToastProvider>
                </HeaderProvider>
            </CompanyProvider>
        </SessionProvider>
    )
}
