import './globals.css'
import { Providers } from './providers'
import { cookies } from 'next/headers'
import { Locale } from '@/lib/translations'

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

  return (
    <html lang={initialLocale} dir={dir}>
      <body>
        <Providers initialLocale={initialLocale}>{children}</Providers>
      </body>
    </html>
  )
}
