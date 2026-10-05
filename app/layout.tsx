import './globals.css'
import { Providers } from './providers'
import { cookies, headers } from 'next/headers'
import { Outfit, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { resolveLocale } from '@/lib/locale'
import { en } from '@/lib/translations/en'
import { ar } from '@/lib/translations/ar'
import { parseTheme, themeAttribute, THEME_COOKIE } from '@/lib/theme'

// The two typefaces, downloaded at build time and served from this site.
// Before, globals.css @imported them from Google Fonts: a stylesheet
// that blocked the first paint of every page (about 0.8 s on a phone) before
// the fonts themselves could even be asked for, and that the CSP's style-src
// didn't allow. next/font also sizes the fallback to match, so text doesn't
// jump when the font arrives.
const outfit = Outfit({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700'], display: 'swap', variable: '--font-outfit' })
const inter = Inter({ subsets: ['latin'], weight: ['300', '400', '500', '600'], display: 'swap', variable: '--font-inter' })

export const metadata = {
  title: 'Nizmo',
  description: 'Operations platform for companies — tasks, workforce, leave, payroll and clients in one system.',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // cookies() is async since Next 15, which makes this layout async too.
  const cookieStore = await cookies()
  const initialLocale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value, (await headers()).get('accept-language'))
  const dir = initialLocale === 'ar' ? 'rtl' : 'ltr'

  // Resolved here, server-side, exactly as the locale is — and for the same
  // reason. A client-side-only toggle paints the light theme first and then
  // repaints, which is a white flash on every single page load and is worse
  // than having no dark mode at all.
  //
  // The cookie rather than the session, because this has to work on pages with
  // no session: the login screen, forgot-password. The signed-in preference is
  // written to the cookie when it changes, so the two stay in step.
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value)
  const themeAttr = themeAttribute(theme)

  // F-24: resolved here, server-side, and passed down as a plain prop
  // rather than imported inside a Client Component — this is a Server
  // Component, so importing both dictionaries costs nothing in the
  // client bundle; only the one matching initialLocale actually crosses
  // the server/client boundary as serialized data.
  const initialDict = initialLocale === 'ar' ? ar : en

  return (
    <html lang={initialLocale} dir={dir} data-theme={themeAttr} className={`${outfit.variable} ${inter.variable}`}>
      <body>
        <Providers initialLocale={initialLocale} initialDict={initialDict} initialTheme={theme} themeChosen={cookieStore.has(THEME_COOKIE)}>{children}</Providers>
        <Analytics />
        {/* Speed Insights reports the route pattern, not the URL: its
            computeRoute substitutes the dynamic segments back in, so
            /dashboard/employees/<uuid> is sent as /dashboard/employees/[id]
            and no employee id leaves the browser. Worth stating, because this
            app's routes are full of identifiers and a field-metrics tool that
            reported raw paths would be exporting them to a third party.

            Both scripts are same-origin (/_vercel/...), so the Report-Only CSP
            in next.config.mjs already covers them under 'self' — no directive
            change, and nothing new to allow if that policy is ever enforced. */}
        <SpeedInsights />
      </body>
    </html>
  )
}
