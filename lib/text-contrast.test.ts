import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Text at least 4.5:1 against what's behind it (WCAG 1.4.3), in the places
 * Lighthouse found short of it across the dashboard, light theme.
 */

function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
}
// a over white at p (what color-mix(in srgb, a p%, transparent) shows on white)
function tint(a: string, p: number): string {
    return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * p + 255 * (1 - p)).toString(16).padStart(2, '0')).join('')
}

const css = readFileSync("app/globals.css", "utf8")
const light = css.slice(css.indexOf(":root {"))
function token(name: string): string {
    const m = light.match(new RegExp(`\\n\\s*--${name}:\\s*(#[0-9a-fA-F]{6});`))
    if (!m) throw new Error(`--${name} is not a plain colour in the light theme`)
    return m[1]
}

function tsx(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? tsx(p) : p.endsWith(".tsx") ? [p] : []
    })
}

describe("text contrast, light theme", () => {
    it("brand-coloured text reads on white and on the brand's 10% tint", () => {
        const fg = token("brand-primary-text")
        expect(ratio(fg, "#ffffff")).toBeGreaterThanOrEqual(4.5)
        expect(ratio(fg, tint(token("primary"), 0.1))).toBeGreaterThanOrEqual(4.5)
    })

    it("a selected status pill is white on a colour dark enough for it", () => {
        // The Role requests page's own list is on the Requests page's building blocks now (UI_PLAN.md §2.3, part 5b).
        for (const f of ["components/AccessReviews.tsx", "components/RoleChangeRequests.tsx"]) {
            const src = readFileSync(f, "utf8")
            expect(src, f).toContain("background: status === s ? 'var(--button-from)'")
        }
        expect(ratio("#ffffff", token("button-from"))).toBeGreaterThanOrEqual(4.5)
    })

    it("red text on the red tints isn't the bright red", () => {
        const offenders = [...tsx("app"), ...tsx("components")].filter(f =>
            /background: 'var\(--danger-bg(-subtle)?\)',\s*color: 'var\(--danger-solid-hover\)'/.test(readFileSync(f, "utf8")))
        expect(offenders).toEqual([])
        for (const bg of ["danger-bg", "danger-bg-subtle"]) {
            expect(ratio(token("danger-fg-strong"), token(bg))).toBeGreaterThanOrEqual(4.5)
        }
    })

    it("small text isn't faded below 4.5:1", () => {
        // The dates sat on an overdue task's red card too. The Tasks list
        // is on the building blocks now, its overdue rows marked with a red
        // edge and the word "Overdue" (lib/tasks-list.test.ts).
        expect(ratio(token("text-soft"), token("danger-bg"))).toBeGreaterThanOrEqual(4.5)

        const audit = readFileSync("components/AuditLogFilter.tsx", "utf8")
        expect(audit).not.toContain("fontWeight: '800', opacity: 0.5")

        // "Powered by": the fade moved from the whole signature to the large name.
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        const signature = shell.slice(shell.indexOf('className="floating-attribution"') - 900, shell.indexOf("DEFAULT_POWERED_BY_NAME}"))
        expect(signature).not.toMatch(/pointerEvents: 'none',\s*opacity: 0\.7/)
        expect(signature).toMatch(/opacity: 0\.7,\s*fontSize: '1\.35rem'/)
    })
})
