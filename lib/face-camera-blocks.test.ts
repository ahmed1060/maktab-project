import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createElement, createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import type { Progress } from "@/lib/mobile/face-check/liveness"

/**
 * The face check's camera and a flagged check-in's face photos on the
 * building blocks (DESIGN.md §5.5, "The face check's camera" and "Face
 * photos"). The camera's step, its Close and its tick were characters, its
 * turn gauge was placed with left and right, and it took no focus as it
 * opened: Tab walked the page behind it, and Escape did nothing. A flagged
 * check-in's photos were in the older pages' window. How the camera starts
 * and stops is lib/mobile/face-check/camera.test.ts's.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key, locale: "en" }) }))

const SRC = readFileSync("components/FaceCamera.tsx", "utf8")
const PHOTO = readFileSync("components/FacePhoto.tsx", "utf8")
const UI = readFileSync("components/ui/ui.css", "utf8")
const GLOBALS = readFileSync("app/globals.css", "utf8")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}
/** The camera's block in ui.css. */
const block = () => {
    const start = UI.indexOf("/* ── The face check's camera (§5.5) ── */")
    if (start < 0) throw new Error("no block for the face check's camera")
    return UI.slice(start, UI.indexOf("/* ── end of the face check's camera ── */", start))
}

const steps = (current: "TURN" | "BLINK"): Progress["steps"] => [
    { challenge: "TURN", done: current === "BLINK", current: current === "TURN" },
    { challenge: "BLINK", done: false, current: current === "BLINK" },
]
const screen = async (over: Partial<{ line: string; progress: Progress | null; ring: number; tone: "ink" | "done" | "warn"; done: boolean }> = {}) => {
    const { CameraScreen } = await import("@/components/FaceCamera")
    return renderToStaticMarkup(createElement(CameraScreen, {
        video: createRef<HTMLVideoElement>(), line: "face_cam_center", progress: null, ring: 0, tone: "ink", done: false, onClose: () => {}, ...over,
    }))
}

describe("the face check's camera", () => {
    it("is a dialog named Face check, by the building blocks' useDialog: it takes the focus, keeps Tab in and closes on Escape", async () => {
        const html = await screen()
        expect(html).toMatch(/^<div role="dialog" data-dialog="[^"]+" aria-modal="true" aria-label="face_cam_title" tabindex="-1" class="ui-camera">/)
        expect(SRC).toContain("const dialog = useDialog(true, onClose, { label: t('face_cam_title') })")
        expect(SRC).toContain('<div {...dialog.panelProps} className="ui-camera">')
    })

    it("shows the picture mirrored, the oval, the picture dimmed outside it, and the ring, drawn by ui.css", async () => {
        const html = await screen({ ring: 0.5 })
        // React writes playsInline as it's spelled; HTML reads attribute names in any case.
        expect(html).toContain('<video class="ui-camera-video" playsInline="" muted=""></video>')
        expect(html).toContain('<svg aria-hidden="true" class="ui-camera-guide" viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice">')
        expect(html).toContain('<rect class="ui-camera-mask-show" x="-50" y="-50" width="200" height="233"></rect>')
        expect(html).toContain('<ellipse class="ui-camera-mask-hide" cx="50" cy="58" rx="31" ry="41"></ellipse>')
        expect(html).toContain('<rect class="ui-camera-dim" x="-50" y="-50" width="200" height="233" mask="url(#ui-camera-cutout)"></rect>')
        expect(html).toContain('<ellipse class="ui-camera-oval" cx="50" cy="58" rx="31" ry="41"></ellipse>')
        // Half done: half the ring, in the ink.
        expect(html).toMatch(/<path class="ui-camera-ring" data-tone="ink" d="M 50 17 [^"]+" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="50" opacity="1"><\/path>/)
        expect(rule(".ui-camera-video")).toContain("transform: scaleX(-1);")
        expect(rule(".ui-camera-video")).toContain("object-fit: cover;")
    })

    it("draws no ring before the looks start, and the whole ring with a tick once done", async () => {
        expect(await screen({ ring: 0 })).toContain('stroke-dashoffset="100" opacity="0"')
        const done = await screen({ ring: 1, tone: "done", done: true })
        expect(done).toContain('data-tone="done"')
        expect(done).toContain('stroke-dashoffset="0" opacity="1"')
        // The tick is an icon in a circle, not a character.
        expect(done).toMatch(/<div aria-hidden="true" class="ui-camera-tick"><svg [^>]*class="ui-icon"[^>]*aria-hidden="true"/)
        expect(await screen()).not.toContain("ui-camera-tick")
        expect(await screen({ ring: 1, tone: "warn" })).toContain('data-tone="warn"')
    })

    it("has Close, an X named for what it does, on the start side at the top, and the test version's pill on the end side", async () => {
        const html = await screen()
        expect(html).toMatch(/<div class="ui-camera-top"><button type="button" class="ui-camera-close" aria-label="close"><svg [^>]*class="ui-icon"[^>]*aria-hidden="true"/)
        expect(html).toContain('<p class="ui-camera-note">face_cam_prototype</p>')
        expect(rule(".ui-camera-top")).toContain("justify-content: space-between;")
    })

    it("says what to do on one line at the bottom, heard by screen readers", async () => {
        expect(await screen({ line: "Hold still…" })).toMatch(/<div class="ui-camera-bottom"><p role="status" class="ui-camera-line">Hold still…<\/p><\/div><\/div>$/)
    })

    it("shows a turn's step with its icon beside its name, the time left, and how far the head is turned, not mirrored in Arabic", async () => {
        const html = await screen({ progress: { steps: steps("TURN"), timeLeft: 0.6, turnAmount: 0.5, eyes: null } })
        expect(html).toMatch(/<div class="ui-camera-step"><div class="ui-camera-step-head"><svg [^>]*class="ui-icon"[^>]*aria-hidden="true"[^>]*>.*?<\/svg><span>face_cam_step_TURN<\/span>/)
        expect(html).toContain('<span aria-hidden="true" class="ui-camera-time" style="--left:0.6"><span></span></span>')
        expect(html).toContain('<div aria-hidden="true" class="ui-camera-turn" dir="ltr"><span class="ui-camera-turn-mark"></span><span class="ui-camera-turn-mark"></span><span class="ui-camera-turn-dot" style="--turn:0.5"></span></div>')
    })

    it("marks the time left late in its last quarter, and the dot once the head is turned far enough", async () => {
        const html = await screen({ progress: { steps: steps("TURN"), timeLeft: 0.2, turnAmount: -1, eyes: null } })
        expect(html).toContain('<span aria-hidden="true" class="ui-camera-time" data-late="true" style="--left:0.2">')
        expect(html).toContain('<span class="ui-camera-turn-dot" data-enough="true" style="--turn:-1"></span>')
        // No face: the marks, and no dot.
        expect(await screen({ progress: { steps: steps("TURN"), timeLeft: 0.6, turnAmount: null, eyes: null } })).toContain('<span class="ui-camera-turn-mark"></span></div>')
    })

    it("shows closing the eyes with a closed eye and its name, and no gauge", async () => {
        const html = await screen({ progress: { steps: steps("BLINK"), timeLeft: 0.9, turnAmount: 0.1, eyes: 0.3 } })
        expect(html).toContain("<span>face_cam_step_BLINK</span>")
        expect(html).not.toContain("ui-camera-turn")
        // A different icon from the turn's.
        const turn = await screen({ progress: { steps: steps("TURN"), timeLeft: 0.9, turnAmount: 0.1, eyes: 0.3 } })
        const icon = (s: string) => s.match(/<div class="ui-camera-step-head">(<svg.*?<\/svg>)/)?.[1]
        expect(icon(html)).toBeTruthy()
        expect(icon(html)).not.toBe(icon(turn))
        expect(SRC).toContain("const STEP_ICON: Record<Progress['steps'][number]['challenge'], PhosphorIcon> = { TURN: ArrowsHorizontalIcon, BLINK: EyeClosedIcon }")
    })

    it("shows no step card while the check has no doubts", async () => {
        expect(await screen({ progress: { steps: steps("TURN").map(s => ({ ...s, current: false })), timeLeft: 1, turnAmount: 0, eyes: 0 } })).not.toContain("ui-camera-step")
    })

    it("is drawn by ui.css alone: no styles typed in but the two shares, no characters for icons, no direction of its own", () => {
        const styles = SRC.match(/style=\{[^}]*\}/g) ?? []
        expect(styles).toEqual([
            "style={{ ['--left' as string]: progress.timeLeft }",
            "style={{ ['--turn' as string]: progress.turnAmount }",
        ])
        for (const gone of ["'✕'", ">✕<", ">✓<", "'↔'", "'◡'", "direction:", "face-cam", "zIndex", "position: 'absolute'", "color-mix("]) expect(SRC, gone).not.toContain(gone)
        expect(SRC).toContain("import { ArrowsHorizontalIcon, CheckIcon, EyeClosedIcon, XIcon } from '@phosphor-icons/react/ssr'")
    })
})

describe("the camera's line", () => {
    const t = (dict: Record<string, string>) => (key: string) => dict[key]

    it("says how far the first download has got in the page's digits", async () => {
        const { cameraLine } = await import("@/components/FaceCamera")
        expect(cameraLine(t(en), "en", { prompt: "LOADING", download: 0.456, retry: false })).toBe("Downloading the face check, the first time only: 45%")
        expect(cameraLine(t(ar), "ar", { prompt: "LOADING", download: 0.456, retry: false })).toContain("٤٥٪")
        expect(cameraLine(t(ar), "ar", { prompt: "LOADING", download: 0.456, retry: false })).not.toMatch(/[0-9]/)
    })

    it("says a step starts again over anything else, and otherwise what the check asks", async () => {
        const { cameraLine } = await import("@/components/FaceCamera")
        expect(cameraLine(t(en), "en", { prompt: "TURN_HEAD", download: null, retry: true })).toBe(en.face_cam_slow)
        expect(cameraLine(t(en), "en", { prompt: "LOADING", download: null, retry: false })).toBe(en.face_cam_loading)
        expect(cameraLine(t(en), "en", { prompt: "BLINK", download: 0.5, retry: false })).toBe(en.face_cam_blink)
    })

    it("holds the share's own sign, not one typed after it", () => {
        expect(en.face_cam_download).toBe("Downloading the face check, the first time only: {pct}")
        expect(ar.face_cam_download).toBe("جارٍ تنزيل التحقق من الوجه، في المرة الأولى فقط: {pct}")
    })
})

describe("the camera's look (ui.css)", () => {
    it("fills the screen above the page, dark in both themes", () => {
        const r = rule(".ui-camera")
        for (const line of ["position: fixed;", "inset: 0;", "z-index: 10000;", "overflow: hidden;", "background: var(--cam-ground);", "color: var(--cam-ink);"]) expect(r, line).toContain(line)
    })

    it("dims the picture outside the oval, and draws the ring in the ink, the done or the warning colour", () => {
        expect(rule(".ui-camera-dim")).toContain("fill: color-mix(in srgb, var(--cam-ground) 72%, transparent);")
        expect(rule(".ui-camera-ring")).toContain("stroke: var(--cam-ink);")
        expect(rule('.ui-camera-ring[data-tone="done"]')).toContain("stroke: var(--cam-done);")
        expect(rule('.ui-camera-ring[data-tone="warn"]')).toContain("stroke: var(--cam-warn);")
    })

    it("puts its words, the step card and Close on the picture dimmed to 55%, which holds 4.5:1 over the lightest picture", () => {
        for (const s of [".ui-camera-close", ".ui-camera-note", ".ui-camera-step", ".ui-camera-line"]) {
            expect(rule(s), s).toContain("background: color-mix(in srgb, var(--cam-ground) 55%, transparent);")
        }
        // The lightest picture is white: white words on 55% black over it.
        const veil = 255 * 0.45
        const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        expect(1.05 / (lin(veil) + 0.05)).toBeGreaterThanOrEqual(4.5)
        expect(rule(".ui-camera-note")).not.toContain("80%")
    })

    it("has a 44px Close with a 2px ring in the ink for the keyboard", () => {
        const r = rule(".ui-camera-close")
        expect(r).toContain("inline-size: 44px;")
        expect(r).toContain("block-size: 44px;")
        expect(rule(".ui-camera-close:focus-visible")).toContain("outline: 2px solid var(--cam-ink);")
    })

    it("draws the tick in the ground's colour on the done colour, 9:1, where it was white on green, 2.3:1", () => {
        const r = rule(".ui-camera-tick")
        expect(r).toContain("background: var(--cam-done);")
        expect(r).toContain("color: var(--cam-ground);")
        expect(r).toContain("animation: ui-camera-pop 350ms cubic-bezier(0.2, 1.4, 0.4, 1) both;")
    })

    it("keeps clear of a phone's notch and home bar", () => {
        expect(rule(".ui-camera-top")).toContain("padding-block-start: max(env(safe-area-inset-top), var(--space-3));")
        expect(rule(".ui-camera-bottom")).toContain("padding-block-end: max(env(safe-area-inset-bottom), var(--space-6));")
    })

    it("places the time left and the turn's dot from their shares, the dot in the done colour once far enough", () => {
        expect(rule(".ui-camera-time > span")).toContain("inline-size: calc(var(--left) * 100%);")
        expect(rule(".ui-camera-time[data-late] > span")).toContain("background: var(--cam-warn);")
        expect(rule(".ui-camera-turn-dot")).toContain("inset-inline-start: calc(50% - var(--turn) * 40%);")
        expect(rule(".ui-camera-turn-dot[data-enough]")).toContain("background: var(--cam-done);")
    })

    it("uses logical properties and tokens only", () => {
        const css = block()
        expect(css).not.toMatch(/(^|[\s;{])(left|right|margin-left|margin-right|padding-left|padding-right|width|height|top|bottom):/m)
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
        expect(css).not.toMatch(/\d(\.\d+)?rem\b/)
    })

    it("moves at once with \"reduce motion\": the ring, the time left and the dot, and the tick is just there", () => {
        // The shared block, the one that stills the donut's arcs.
        const start = UI.lastIndexOf("@media (prefers-reduced-motion: reduce) {", UI.indexOf("  .ui-donut-arc,"))
        const block = UI.slice(start, UI.indexOf("\n}\n", start))
        for (const s of [".ui-camera-ring", ".ui-camera-time > span", ".ui-camera-turn-dot", ".ui-camera-tick"]) expect(block, s).toContain(s)
        // The tick's pop moved from app/globals.css.
        expect(GLOBALS).not.toContain("face-cam-tick")
        expect(GLOBALS).not.toContain("face-cam-pop")
    })
})

describe("the camera's words", () => {
    it("show each step's name, which was never shown", () => {
        expect(SRC).toContain("t(`face_cam_step_${step}`)")
        expect([en.face_cam_step_TURN, en.face_cam_step_BLINK]).toEqual(["Turn", "Close eyes"])
    })

    it("no longer speak to one person in the masculine in Arabic, and the app doesn't speak as 'we'", () => {
        const keys = ["face_cam_face", "face_cam_turn", "face_cam_back", "face_cam_blink", "face_cam_open", "face_cam_still", "face_cam_one", "face_cam_center", "face_cam_upright", "face_cam_closer", "face_cam_farther"] as const
        for (const k of keys) expect(ar[k], k).toMatch(/^يُرجى /)
        const all = keys.map(k => ar[k]).join(" ") + " " + ar.face_cam_slow
        for (const gone of ["انظر", "أدر رأسك", "أغمض عينيك", "افتح", "اثبت", "ضع وجهك", "أمسك", "اقترب", "ابتعد", "لنجرّب", "رأسك", "عينيك", "وجهك", "هاتفك"]) expect(all, gone).not.toContain(gone)
        expect(en.face_cam_slow).toBe("That took too long. This step starts again.")
        expect(ar.face_cam_slow).toBe("استغرق ذلك وقتًا طويلًا. تبدأ هذه الخطوة من جديد.")
        expect(ar.face_cam_turn).toBe("يُرجى إدارة الرأس ببطء قليلًا إلى أحد الجانبين، حتى تصل النقطة إلى علامة خضراء.")
        expect(ar.face_cam_blink).toBe("يُرجى إغماض العينين لحظة ثم فتحهما.")
    })
})

describe("a flagged check-in's face photos", () => {
    it("are in the building blocks' dialog, with Close, as a phone has no Escape key", () => {
        expect(PHOTO).toContain("export function FlaggedFaceDialog({ punchId, name, onClose }")
        expect(PHOTO).toContain("<Dialog open onClose={onClose} title={t('face_review_title').replace('{name}', name)}")
        expect(PHOTO).toContain("actions={<Button onClick={onClose}>{t('close')}</Button>}")
        expect(PHOTO).toContain("<p>{t('face_flag_compare')}</p>")
        expect(PHOTO).toContain('<div className="ui-face-photos">')
        expect(PHOTO).toContain("import { Button, Dialog } from '@/components/ui'")
    })

    it("are no longer in the older pages' window, with its colours", () => {
        for (const gone of ["@/components/Modal", "<Modal", "FlaggedFaceModal", "--text-soft", "style="]) expect(PHOTO, gone).not.toContain(gone)
    })

    it("open from the Requests page and Check-ins as the dialog", () => {
        for (const page of ["app/(dashboard)/dashboard/requests/RequestsClient.tsx", "app/(dashboard)/dashboard/check-ins/page.tsx"]) {
            const s = readFileSync(page, "utf8")
            expect(s, page).toContain("import { FlaggedFaceDialog } from '@/components/FacePhoto'")
            expect(s, page).toContain("<FlaggedFaceDialog punchId={faceOf.id}")
            expect(s, page).not.toContain("FlaggedFaceModal")
        }
    })
})
