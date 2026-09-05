import './globals.css'
import { Providers } from './providers'
import { cookies } from 'next/headers'
import { Analytics } from '@vercel/analytics/next'
import type { Locale } from '@/lib/translations'
import { en } from '@/lib/translations/en'
import { ar } from '@/lib/translations/ar'

export const metadata = {
  title: 'Task Manager',
  description: 'Employee Task Management System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = cookies()
  const initialLocale = (cookieStore.get('NEXT_LOCALE')?.value || 'en') as Locale
  const dir = initialLocale === 'ar' ? 'rtl' : 'ltr'

  // F-24: resolved here, server-side, and passed down as a plain prop
  // rather than imported inside a Client Component — this is a Server
  // Component, so importing both dictionaries costs nothing in the
  // client bundle; only the one matching initialLocale actually crosses
  // the server/client boundary as serialized data.
  const initialDict = initialLocale === 'ar' ? ar : en

  return (
    <html lang={initialLocale} dir={dir}>
      <body>
        <Providers initialLocale={initialLocale} initialDict={initialDict}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  )
}
