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
 * The tokens as a stylesheet for the page's head, so it opens in the right
 * colour. `html:root` outranks the default in app/globals.css's `:root`
 * whichever of the two the browser reads last.
 */
export function brandStyleSheet(picked: string | null | undefined): string {
    const { light: l, dark: d } = brandTokens(picked)
    const decls = (t: BrandTokens) => Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';')
    return `html:root{${decls(l)}}html:root[data-theme="dark"]{${decls(d)}}`
}
