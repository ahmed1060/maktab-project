import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Pages don't jump while they load (Lighthouse: Cumulative Layout Shift). The
 * worst were 0.85 on a phone, where the first paint was the desktop layout
 * and the page then slid 270px into place, and 0.2 to 0.26 on the Super
 * Admin's health and settings pages, where a card appeared late and pushed
 * the others along.
 */
describe("the dashboard's layout on a phone", () => {
    const shell = readFileSync("components/DashboardShell.tsx", "utf8")
    const css = readFileSync("app/globals.css", "utf8")

    it("is decided by CSS, so the first paint is already right", () => {
        expect(shell).toContain('<main className="shell-main"')
        expect(shell).toContain("['--shell-sidebar' as string]: sidebarWidth")
        expect(shell).not.toMatch(/marginLeft'\]: \(!isMobile\)/)
        expect(shell).toContain('className="glass-dark shell-aside"')
        expect(shell).not.toMatch(/transform: \(isMobile && !isSidebarOpen\)/)
        expect(shell).not.toMatch(/\.\.\.\(isMobile\s*\? \{\s*position: 'static'/)
    })

    it("hides the sidebar and drops the margin below 1024px", () => {
        const phone = css.slice(css.indexOf(".shell-main {"), css.indexOf("/* Responsive Utilities */"))
        expect(phone).toContain("margin-inline-start: var(--shell-sidebar, 270px);")
        expect(phone).toMatch(/@media \(max-width: 1023px\) \{[\s\S]*\.shell-main \{\s*margin-inline-start: 0;[\s\S]*\.shell-aside:not\(\[data-open="true"\]\) \{\s*transform: translateX\(-100%\);[\s\S]*\.shell-aside\[data-rtl="true"\]:not\(\[data-open="true"\]\) \{\s*transform: translateX\(100%\);/)
    })
})

describe("cards that load their own data", () => {
    it.each([
        ["components/TerminalsHealthCard.tsx", "att_term_health_title"],
        ["components/FaceSystemSwitch.tsx", "face_sys_title"],
    ])("%s holds its place while it loads", (f, title) => {
        const src = readFileSync(f, "utf8")
        expect(src).not.toMatch(/if \(!(rows|data)\) return null/)
        const start = src.search(/if \(!(rows|data)(\) \{| \|\|)/)
        expect(start).toBeGreaterThan(-1)
        const loading = src.slice(start, start + 900)
        expect(loading).toContain(`t('${title}')`)
        expect(loading).toContain("t('loading')")
    })

    it("the face card holds the loaded card's footprint, and stays on an error (Codex review on #43)", () => {
        // A heading and one line grew to the whole card when the status came (Branding moved 158px on a
        // phone), and an error took the card away (124px the other way). Measured in Chromium after: 0px.
        const src = readFileSync("components/FaceSystemSwitch.tsx", "utf8")
        expect(src).not.toContain("if (error) return null")
        const start = src.indexOf("if (!data ||")
        const shell = src.slice(start, src.indexOf("const { state, canChange } = data.data"))
        // It waits for the purge record and the rotation too, as they'd push the card when they came.
        expect(shell).toContain("if (!data || !settled(purgeBody, purgeError) || !settled(rekeyBody, rekeyError))")
        expect(shell).toContain("<p style={HINT}>{t('face_sys_hint')}</p>")
        expect(shell).toContain("<StateLine text={error ? t('error_generic') : t('loading')}")
        expect(shell).toContain("<Controls />")
        // The loaded card has the same rows, the controls in the same box.
        const card = src.slice(src.indexOf("const tone ="))
        expect(card).toContain("<p style={HINT}>{t('face_sys_hint')}</p>")
        expect(card).toContain("<StateLine text={t(`face_sys_state_${state}`)} color={tone} />")
        expect(card).toContain("<Controls>")
        // The state line is as tall as its longest text, whichever shows.
        expect(src).toMatch(/STATES\.map\(s => <span key=\{s\} aria-hidden="true" style=\{\{ gridArea: '1 \/ 1', visibility: 'hidden' \}\}>/)
    })

    it("the face card's controls are as tall as the most any state shows, wrapped too (Codex review on #49)", () => {
        // One button high, the placeholder still let "Pause" and "Pause and purge", two rows on a 320px phone,
        // push Branding 48px down when they came. Measured in Chromium after: 0px at 320, 412 and 1350px.
        const src = readFileSync("components/FaceSystemSwitch.tsx", "utf8")
        const controls = src.slice(src.indexOf("function Controls("), src.indexOf("type Rekey ="))
        // A hidden copy of every state's buttons, in the same cell as what shows.
        expect(controls).toContain("{STATES.map(s => (")
        expect(controls).toContain(`<div key={s} aria-hidden="true" style={{ ...CONTROLS, gridArea: '1 / 1', visibility: 'hidden' }}>`)
        expect(controls).toContain("{BUTTONS[s].map(b => <span key={b.action} className={b.cls}>{t(b.label)}</span>)}")
        expect(controls).toContain("<div style={{ ...CONTROLS, gridArea: '1 / 1' }}>{children}</div>")
        // The buttons shown are the same list, so a copy can't drift from them.
        expect(src).toContain("{canChange ? BUTTONS[state].map(b => (")
        expect(src).toContain("ON: [{ cls: 'btn btn-secondary', label: 'face_sys_pause', action: 'PAUSED' }, { cls: 'btn btn-danger', label: 'face_purge', action: 'PURGE' }],")
    })
})
