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
    const sideBar = readFileSync("components/SideBar.tsx", "utf8")
    const css = readFileSync("app/globals.css", "utf8")
    const ui = readFileSync("components/ui/ui.css", "utf8")

    it("is decided by CSS, so the first paint is already right", () => {
        expect(shell).toContain('<main className="shell-main"')
        // The side bar is in the page's flow on a computer, beside it, so the
        // page keeps no margin in step with its width (DESIGN.md §5.1).
        expect(shell).not.toContain("--shell-sidebar")
        expect(css).not.toContain("margin-inline-start: var(--shell-sidebar")
        // Nothing the script works out after the page has run moves it.
        expect(sideBar).not.toMatch(/style=\{/)
        expect(shell).not.toMatch(/transform: \(isMobile/)
        expect(shell).not.toMatch(/\.\.\.\(isMobile\s*\? \{\s*position: 'static'/)
    })

    it("takes the side bar out of the page below 1024px, out of sight", () => {
        const phone = ui.slice(ui.indexOf(".ui-side-bar {"))
        expect(phone).toMatch(/@media \(max-width: 1023px\) \{\s*\.ui-side-bar \{[^}]*position: fixed;[^}]*transform: translateX\(-100%\);/)
        expect(phone).toMatch(/\[dir="rtl"\] \.ui-side-bar \{\s*transform: translateX\(100%\);/)
    })
})

describe("cards that load their own data", () => {
    it.each([
        ["components/TerminalsHealthCard.tsx", "att_term_health_title"],
    ])("%s holds its place while it loads", (f, title) => {
        const src = readFileSync(f, "utf8")
        expect(src).not.toMatch(/if \(!(rows|data)\) return null/)
        const start = src.search(/if \(!(rows|data)(\) \{| \|\|)/)
        expect(start).toBeGreaterThan(-1)
        const loading = src.slice(start, start + 900)
        expect(loading).toContain(`t('${title}')`)
        expect(loading).toContain("t('loading')")
    })

    // The face card on System settings, on the building blocks since its part 4b: one card, loading or
    // loaded, each part holding the room of the most it can show (Reserve) where it held it by hand.
    const face = readFileSync("components/FaceSystemSwitch.tsx", "utf8")
    const css = readFileSync("components/ui/ui.css", "utf8")

    it("Reserve keeps every alternative in one cell, hidden but for what shows", () => {
        expect(css).toMatch(/\.ui-reserve \{\s*display: grid;\s*\}/)
        expect(css).toMatch(/\.ui-reserve > \* \{\s*grid-area: 1 \/ 1;/)
        expect(css).toMatch(/\.ui-reserve-room \{\s*visibility: hidden;\s*\}/)
    })

    it("the face card is the same card loading, failed or loaded, and stays on an error (Codex review on #43)", () => {
        // A heading and one line grew to the whole card when the status came (Branding moved 158px on a
        // phone), and an error took the card away (124px the other way). Measured in Chromium after: 0px.
        expect(face).not.toContain("if (error) return null")
        expect(face).not.toMatch(/if \(!data[^\n]*\) \{?\s*return/)
        // It waits for the purge record too, as it would push the card when it came.
        expect(face).toContain("const ready = !!data && (purgeBody !== undefined || !!purgeError)")
        // The state line is as tall as its longest, whichever shows, the failure among them.
        expect(face).toContain(`<Reserve className="ui-state-line" room={[...STATES.map(stateLine), failedLine]}>`)
        expect(face).toContain(`{state ? stateLine(state) : error ? <span role="status">{failedLine}</span> : <span className="ui-card-note" role="status">{t('loading')}</span>}`)
    })

    it("the face card doesn't wait for the rotation's status, and keeps its place instead (Codex review on #49)", () => {
        // The status reads every stored photo. Waited for, it held Pause and purge back: usable after 9.2 s with the
        // status taking 8 s, measured in Chromium; now after 2.5 s on a phone, Branding still moving 0px.
        expect(face).not.toContain("settled(rekeyBody, rekeyError)")
        expect(face).not.toMatch(/const ready = [^\n]*rekey/)
        // The card's own status says whether a rotation is on, at once.
        const route = readFileSync("app/api/system-settings/face/route.ts", "utf8")
        expect(route).toContain("rotating: FacePhotoKeyService.rotating()")
        // Whatever the rotation's own answer says meanwhile: one kept from before it began says there is none.
        expect(face).toContain("const rotationWaiting = !!data?.data.rotating && !rotation\n")
        const section = face.slice(face.indexOf("{(rotation || rotationWaiting) && ("))
        expect(section).toContain("t('face_rekey_load_failed')")
        expect(section).toContain(`<Reserve className="ui-card-lines"`)
    })

    it("the rotation's section is as tall as the most it can show, done included (Codex review on #49)", () => {
        // Kept to the button's layout, the done line every load shows once all are moved still moved Branding
        // (16px at 412px, 32px at 1350px), and the other layouts up to 56px.
        expect(face).toContain(`<Reserve className="ui-card-lines" room={[<>{leftLines(0, 0, false)}{unreadable(0)}</>, <>{doneLine}{unreadable(0)}</>, sameKeyLine]}>`)
        // What shows is drawn by the same lines, so a copy can't drift from them.
        expect(face).toContain("{rotation.previous > 0 ? leftLines(left, rotation.total, true) : doneLine}")
        expect(face).toContain("{rotation.unreadable > 0 && unreadable(rotation.unreadable)}")
    })

    it("the face card's controls are as tall as the most any state shows, wrapped too (Codex review on #49)", () => {
        // One button high, the placeholder still let "Pause" and "Pause and purge", two rows on a 320px phone,
        // push Branding 48px down when they came. Measured in Chromium after: 0px at 320, 412 and 1350px.
        expect(face).toContain(`<Reserve className="ui-card-actions" room={[...STATES.map(s => buttons(s, false)), protectedOnly, tryAgain(false, () => {})]}>`)
        // The buttons shown are the same list, so a copy can't drift from them.
        expect(face).toContain("{state ? (canChange ? buttons(state, true) : protectedOnly) : error && tryAgain(isValidating, () => { void mutate() })}")
        expect(face).toContain("ON: [{ variant: 'secondary', label: 'face_sys_pause', action: 'PAUSED' }, { variant: 'danger', label: 'face_purge', action: 'PURGE' }],")
        // Wrapped, a row of buttons stays inside the card.
        expect(css).toMatch(/\.ui-card-actions \{\s*display: flex;\s*flex-wrap: wrap;/)
    })
})
