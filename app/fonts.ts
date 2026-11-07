import { Outfit, Inter, Noto_Sans_Arabic } from 'next/font/google'

/**
 * The typefaces, downloaded at build time and served from this site, defined
 * once for every page that draws its own <html>: the root layout, and the
 * screen when the app itself broke (app/global-error.tsx), which Next draws
 * without it. A font definitions file, as Next's docs have it: each call is a
 * font of its own, so the same one is loaded once and imported where needed.
 *
 * Before, globals.css @imported them from Google Fonts: a stylesheet that
 * blocked the first paint of every page (about 0.8 s on a phone) before the
 * fonts themselves could even be asked for, and that the CSP's style-src
 * didn't allow. next/font also sizes the fallback to match, so text doesn't
 * jump when the font arrives.
 */
const outfit = Outfit({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700'], display: 'swap', variable: '--font-outfit' })
const inter = Inter({ subsets: ['latin'], weight: ['300', '400', '500', '600'], display: 'swap', variable: '--font-inter' })
// Arabic for the building blocks (DESIGN.md §3.1); before it the app loaded
// none, so Arabic took whatever each device had. Not preloaded: only the
// building blocks use it so far, and an English page would fetch it for
// nothing. The browser asks for it the first time Arabic text needs it.
const notoArabic = Noto_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '500', '600'], display: 'swap', preload: false, variable: '--font-noto-arabic' })

/** The three as CSS variables, for <html>'s class (globals.css reads them). */
export const fontVariables = `${outfit.variable} ${inter.variable} ${notoArabic.variable}`
