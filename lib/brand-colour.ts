/**
 * The brand colour: one colour in, every shade the building blocks use worked
 * out from it (DESIGN.md §2.1, UI_PLAN.md §4.6).
 *
 * The colour is a setting — the Super Admin's default, or a company's own — so
 * it can be anything somebody types. Whatever it is, the shades keep their
 * promises: white text on a primary button reads at 4.5:1 or better, the brand
 * as text reads at 4.5:1 on every surface it sits on, and in dark mode a
 * button still stands out from the panel behind it. A colour that can't keep
 * them as chosen is darkened (or, in dark mode, lightened) until it does,
 * keeping its hue.
 */

/** Nizmo's own indigo. White text on it is 4.47:1, so it's used a little darker. */
export const DEFAULT_BRAND = '#6366f1'

/** The surfaces from DESIGN.md §2.2 that brand shades sit on. */
const LIGHT = { page: '#f6f9fc', panel: '#ffffff' }
const DARK = { page: '#0a1220', panel: '#0f1a2b', raised: '#16233a' }
const WHITE = '#ffffff'
/** Text on a dark-mode button too light for white text: the dark page's navy. */
const DARK_INK = '#0a1220'

const TEXT = 4.5
/** A button's edge against what's behind it (WCAG 1.4.11). */
const SHAPE = 3

type Rgb = [number, number, number]

export function isBrandHex(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

/**
 * A colour code as somebody types it — with or without #, three digits or
 * six, any case — as the #rrggbb in lower case that's stored. Null when it
 * isn't a colour code.
 */
export function readBrandHex(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const code = value.trim().replace(/^#/, '').toLowerCase()
    if (/^[0-9a-f]{6}$/.test(code)) return `#${code}`
    if (/^[0-9a-f]{3}$/.test(code)) return `#${[...code].map(c => c + c).join('')}`
    return null
}

/** The colour code a form shows as an example. */
export const EXAMPLE_BRAND_CODE = '#2563eb'

/**
 * The ready-made colours (UI_PLAN.md §4.6), Nizmo's indigo first. Each key
 * names it on screen (brand_preset_<key>). None is close to the error red.
 */
export const BRAND_PRESETS = [
    { key: 'indigo', hex: DEFAULT_BRAND },
    { key: 'blue', hex: '#2563eb' },
    { key: 'cyan', hex: '#0891b2' },
    { key: 'teal', hex: '#0d9488' },
    { key: 'green', hex: '#16a34a' },
    { key: 'orange', hex: '#ea580c' },
    { key: 'purple', hex: '#9333ea' },
    { key: 'navy', hex: '#1e3a8a' },
    { key: 'slate', hex: '#475569' },
] as const

/** The error red the warning compares against: the chart and badge red (app/globals.css --chart-problem). */
const ERROR_RED = '#e11d48'

function hueAndSaturation(c: string): { hue: number; saturation: number } {
    const [r, g, b] = rgb(c).map(v => v / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    const l = (max + min) / 2
    const saturation = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let hue = 0
    if (d !== 0) {
        if (max === r) hue = ((g - b) / d) % 6
        else if (max === g) hue = (b - r) / d + 2
        else hue = (r - g) / d + 4
    }
    return { hue: (hue * 60 + 360) % 360, saturation }
}

/**
 * Close enough to the error red to be mistaken for an error (DESIGN.md
 * §2.1): a hue within 20° of its, and not greyish (35% saturation or more).
 */
export function nearErrorRed(picked: string): boolean {
    if (!isBrandHex(picked)) return false
    const c = hueAndSaturation(picked)
    const red = hueAndSaturation(ERROR_RED)
    const apart = Math.abs(c.hue - red.hue)
    return Math.min(apart, 360 - apart) <= 20 && c.saturation >= 0.35
}

function rgb(hex: string): Rgb {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

function hex(c: Rgb): string {
    return '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

function luminance(c: Rgb): number {
    const [r, g, b] = c.map(v => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/** `share` of `a` over `b`, 0 to 1. */
function mix(a: string, b: string, share: number): string {
    const x = rgb(a), y = rgb(b)
    return hex([0, 1, 2].map(i => x[i] * share + y[i] * (1 - share)) as Rgb)
}

/** Each channel scaled down by `by`, which keeps the hue. */
function darken(c: string, by: number): string {
    return hex(rgb(c).map(v => v * (1 - by)) as Rgb)
}

/**
 * Small steps darker (or towards white) until `ok`. Both ends always pass —
 * black and white reach 21:1 or near it against anything they're tested on —
 * so the loop stops; the cap is only a guard.
 */
function stepUntil(start: string, ok: (c: string) => boolean, step: (c: string) => string): string {
    let c = start
    for (let i = 0; i < 400 && !ok(c); i++) c = step(c)
    return c
}
const darker = (c: string) => darken(c, 0.03)
const lighter = (c: string) => mix(WHITE, c, 0.04)

export type BrandTokenName = '--brand' | '--brand-hover' | '--brand-press' | '--brand-text' | '--brand-tint' | '--brand-tint-strong' | '--on-brand'
export type BrandTokens = Record<BrandTokenName, string>

function light(picked: string): BrandTokens {
    const brand = stepUntil(picked, c => contrast(WHITE, c) >= TEXT, darker)
    const tint = mix(brand, LIGHT.panel, 0.09)
    const tintStrong = mix(brand, LIGHT.panel, 0.14)
    const grounds = [LIGHT.page, LIGHT.panel, tint, tintStrong]
    const text = stepUntil(brand, c => grounds.every(g => contrast(c, g) >= TEXT), darker)
    return {
        '--brand': brand,
        '--brand-hover': darken(brand, 0.08),
        '--brand-press': darken(brand, 0.16),
        '--brand-text': text,
        '--brand-tint': tint,
        '--brand-tint-strong': tintStrong,
        '--on-brand': WHITE,
    }
}

/**
 * Hover and press for white text in dark mode, darker than the fill. Darker
 * is towards the dark panel, and white text and a 3:1 edge on that panel
 * leave a narrow band of shades, so these are half light mode's steps.
 */
const DARK_HOVER = 0.04
const DARK_PRESS = 0.08

function dark(lightBrand: string): BrandTokens {
    // A button keeps the light-mode colour while it stands out from the panel.
    const base = stepUntil(lightBrand, c => contrast(c, DARK.panel) >= SHAPE, lighter)
    // With white text, hover and press go darker, so the fill is lightened
    // until the pressed shade still stands out from the panel too.
    const forWhite = stepUntil(base, c => contrast(darken(c, DARK_PRESS), DARK.panel) >= SHAPE, lighter)
    const white = contrast(WHITE, forWhite) >= TEXT
    // Lightened past where white reads: the text turns dark instead, and
    // hover and press go towards white, away from both the text and the
    // panel, so contrast only grows.
    const fill = white ? forWhite : stepUntil(base, c => contrast(DARK_INK, c) >= TEXT, lighter)
    const on = white ? WHITE : DARK_INK
    const hover = white ? darken(fill, DARK_HOVER) : mix(WHITE, fill, 0.08)
    const press = white ? darken(fill, DARK_PRESS) : mix(WHITE, fill, 0.16)
    const tint = mix(fill, DARK.panel, 0.16)
    const tintStrong = mix(fill, DARK.panel, 0.24)
    const grounds = [DARK.page, DARK.panel, DARK.raised, tint, tintStrong]
    const text = stepUntil(fill, c => grounds.every(g => contrast(c, g) >= TEXT), lighter)
    return {
        '--brand': fill,
        '--brand-hover': hover,
        '--brand-press': press,
        '--brand-text': text,
        '--brand-tint': tint,
        '--brand-tint-strong': tintStrong,
        '--on-brand': on,
    }
}

/** Every brand shade for both themes. Anything that isn't a #rrggbb colour gets the default. */
export function brandTokens(picked: string | null | undefined): { light: BrandTokens; dark: BrandTokens } {
    const base = isBrandHex(picked) ? picked.toLowerCase() : DEFAULT_BRAND
    const l = light(base)
    return { light: l, dark: dark(l['--brand']) }
}

/**
 * Each colour's stylesheet, worked out once and kept: every page asks for
 * the default's, and a company's people for their company's. A few hundred
 * at most, a kilobyte each; past that the store starts again.
 */
const sheets = new Map<string, string>()
const MAX_SHEETS = 256

/**
 * The tokens as a stylesheet for the page's head, so it opens in the right
 * colour. `html:root` outranks the default in app/globals.css's `:root`
 * whichever of the two the browser reads last.
 */
export function brandStyleSheet(picked: string | null | undefined): string {
    const key = isBrandHex(picked) ? picked.toLowerCase() : DEFAULT_BRAND
    const kept = sheets.get(key)
    if (kept !== undefined) return kept
    const { light: l, dark: d } = brandTokens(key)
    // The older pages' shades too (DESIGN.md §2.1), which follow the colour
    // until those pages move onto the building blocks.
    const old = oldPageShades(key)
    const decls = (t: Partial<Record<string, string>>) => Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';')
    const sheet = `html:root{${decls({ ...l, ...old.light })}}html:root[data-theme="dark"]{${decls({ ...d, ...old.dark })}}`
    if (sheets.size >= MAX_SHEETS) sheets.clear()
    sheets.set(key, sheet)
    return sheet
}

/* ── The older pages (DESIGN.md §2.1) ─────────────────────────────────────
   The pages not yet on the building blocks, the side bar and the sign-in
   page have their own look, drawn in Nizmo's indigo and a violet beside it.
   Each of those shades follows the chosen colour: it keeps the distance it
   has from Nizmo's indigo (the same turn of hue, the same share of
   colourfulness, the same step lighter or darker, as the eye sees them),
   measured from the chosen colour instead. Pale shades keep their own
   lightness, so a ground stays a ground. Nizmo's indigo gives exactly the
   shades in app/globals.css.

   Then each keeps the readability it has today: never less than it has with
   Nizmo's indigo, and never asked for more than WCAG's 4.5:1 for text or 3:1
   for a ring or an edge. One that falls short is darkened (on a dark ground,
   lightened) until it doesn't, keeping its hue. */

/* Lightness, colourfulness and hue as the eye sees them (OKLCH), so a step
   lighter is the same step for every hue. */
type Lch = { l: number; c: number; h: number }

const toLinear = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function toLch(c: string): Lch {
    const [r, g, b] = rgb(c).map(toLinear)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 }
}

/** Linear sRGB for a colour, which may be outside what a screen shows. */
function linearOf({ l: L, c, h }: Lch): [number, number, number] {
    const A = c * Math.cos(h * Math.PI / 180), B = c * Math.sin(h * Math.PI / 180)
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
}

/** Back to #rrggbb. A colour too vivid for a screen loses colourfulness, not hue. */
function fromLch(lch: Lch): string {
    const fits = (x: Lch) => linearOf(x).every(v => v >= -1e-6 && v <= 1 + 1e-6)
    let c = lch.c
    if (!fits(lch)) {
        let lo = 0, hi = lch.c
        for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits({ ...lch, c: mid })) lo = mid; else hi = mid }
        c = lo
    }
    return hex(linearOf({ ...lch, c }).map(v => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb)
}

/** `top` at `alpha` over `under`: what a see-through ground looks like. */
function over(top: Rgb, alpha: number, under: string): string {
    const u = rgb(under)
    return hex([0, 1, 2].map(i => top[i] * alpha + u[i] * (1 - alpha)) as Rgb)
}

/** A shade at least this light keeps its lightness (a ground, a pale tint, light text on dark). */
const PALE = 0.75

/** The older pages' grounds (app/globals.css --surface, --surface-subtle, --surface-sunk). */
const OLD_LIGHT = ['#ffffff', '#f8fafc', '#f1f5f9']
const OLD_DARK = ['#161b22', '#1c2128', '#21262d', '#0b0f14']
/** The side bar, dark in both themes (--sidebar-bg), over the page. */
const SIDEBAR_LIGHT: Rgb = [15, 23, 42], SIDEBAR_LIGHT_ALPHA = 0.65
const SIDEBAR_DARK: Rgb = [9, 12, 17], SIDEBAR_DARK_ALPHA = 0.78
const OLD_DARK_PAGE = '#0b0f14'
/** The map's tiles are light in both themes (components/PointPicker.tsx). */
const MAP = ['#ffffff']

/**
 * What a shade is for, which sets what it's held to:
 * - fill: white text sits on it, 4.5:1;
 * - text: it's text on the grounds, 4.5:1;
 * - edge: a focus ring, a highlight bar or a map pin, 3:1 against what's behind;
 * - ground: the page's own colour, pale, held to nothing;
 * - decor: a tint in a gradient, held to nothing.
 */
type Role = 'fill' | 'text' | 'edge' | 'ground' | 'decor'
type Behind = 'pages' | 'sidebar' | 'map'

/**
 * The older pages' shades that follow the brand colour, with their values
 * for Nizmo's indigo, as in app/globals.css. A shade with no dark value is
 * the same in both themes. The info colours, the role badges' colours, the
 * pink glow and the dark mesh behind the page don't follow: like the status
 * colours, they mean something, or are only background.
 */
export const OLD_PAGE_SHADES = [
    { token: '--primary', light: '#6366f1', role: 'fill' },
    { token: '--primary-hover', light: '#4f46e5', role: 'fill' },
    { token: '--accent', light: '#8b5cf6', role: 'fill' },
    { token: '--button-from', light: '#4f46e5', role: 'fill' },
    { token: '--button-to', light: '#7c3aed', role: 'fill' },
    { token: '--hero-from', light: '#4f46e5', role: 'fill' },
    { token: '--hero-to', light: '#764ba2', role: 'fill' },
    { token: '--accent-fill', light: '#942ff5', dark: '#9047ec', role: 'fill' },
    { token: '--brand-primary-text', light: '#4f46e5', dark: '#a5b4fc', role: 'text' },
    { token: '--link', light: '#4f46e5', dark: '#a5b4fc', role: 'text' },
    { token: '--accent-solid-deep', light: '#7c3aed', dark: '#9457e0', role: 'text' },
    { token: '--accent-deep', light: '#4338ca', dark: '#7c6ae0', role: 'text' },
    { token: '--accent-deepest', light: '#3730a3', dark: '#b3a6f2', role: 'text' },
    { token: '--focus-ring', light: '#4338ca', dark: '#a5b4fc', role: 'edge' },
    { token: '--accent-solid', light: '#a855f7', dark: '#a86ef0', role: 'edge' },
    { token: '--map-pin', light: '#4f46e5', role: 'edge', behind: 'map' },
    { token: '--sidebar-ring', light: '#c7d2fe', role: 'edge', behind: 'sidebar' },
    { token: '--sidebar-accent', light: '#a5b4fc', dark: '#3d4b7a', role: 'decor' },
    { token: '--page-bg', light: '#eef2ff', lightOnly: true, role: 'ground' },
] as const satisfies readonly { token: string; light: string; dark?: string; role: Role; behind?: Behind; lightOnly?: boolean }[]

export type OldPageToken = (typeof OLD_PAGE_SHADES)[number]['token']

/** The same distance from `picked` as `shade` is from Nizmo's indigo. */
function follow(shade: string, picked: string): string {
    const from = toLch(DEFAULT_BRAND), to = toLch(picked), s = toLch(shade)
    return fromLch({
        l: s.l >= PALE ? s.l : Math.min(1, Math.max(0, s.l + to.l - from.l)),
        c: s.c * (to.c / from.c),
        h: (s.h + to.h - from.h + 360) % 360,
    })
}

/** What a shade sits on, in a theme, with this brand's page colour. */
function groundsFor(behind: Behind | undefined, theme: 'light' | 'dark', page: string): string[] {
    if (behind === 'map') return MAP
    if (behind === 'sidebar') return theme === 'light'
        ? [over(SIDEBAR_LIGHT, SIDEBAR_LIGHT_ALPHA, page)]
        : [over(SIDEBAR_DARK, SIDEBAR_DARK_ALPHA, OLD_DARK_PAGE)]
    return theme === 'light' ? [...OLD_LIGHT, page] : OLD_DARK
}

/** How readable a shade is, in its role: the weakest contrast that matters. */
function readability(c: string, role: Role, grounds: string[]): number {
    if (role === 'fill') return contrast(WHITE, c)
    return Math.min(...grounds.map(g => contrast(c, g)))
}
const AIM: Record<Role, number> = { fill: TEXT, text: TEXT, edge: SHAPE, ground: 0, decor: 0 }

/** Every older-page shade for `picked`, in each theme. */
export function oldPageShades(picked: string | null | undefined): { light: Record<OldPageToken, string>; dark: Partial<Record<OldPageToken, string>> } {
    const base = isBrandHex(picked) ? picked.toLowerCase() : DEFAULT_BRAND
    const defaultPage = OLD_PAGE_SHADES.find(s => s.token === '--page-bg')!.light
    const page = follow(defaultPage, base)
    const light = {} as Record<OldPageToken, string>
    const dark: Partial<Record<OldPageToken, string>> = {}
    for (const shade of OLD_PAGE_SHADES) {
        const themes: ['light' | 'dark', string][] = [['light', shade.light]]
        if ('dark' in shade) themes.push(['dark', shade.dark])
        for (const [theme, value] of themes) {
            const role: Role = shade.role
            const behind = 'behind' in shade ? shade.behind : undefined
            // Held to what it has with Nizmo's indigo, up to WCAG's aim.
            const need = Math.min(AIM[role], readability(value, role, groundsFor(behind, theme, defaultPage)))
            const grounds = groundsFor(behind, theme, page)
            // Darker on a light ground or under white text; lighter on a dark one.
            const towardsLight = role !== 'fill' && (theme === 'dark' || behind === 'sidebar')
            const c = stepUntil(follow(value, base), x => readability(x, role, grounds) >= need, towardsLight ? lighter : darker)
            if (theme === 'light') light[shade.token] = c
            else dark[shade.token] = c
        }
    }
    return { light, dark }
}
