import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A person's profile onto the building blocks, in parts (UI_PLAN.md §5 step
 * 5, the pages left). Part 1, PR 191: its page, its photo, and what it says
 * while a name change waits. It was a glass card of its own making: a title
 * of its own, a drawn man or woman for someone with no photo, a window of
 * its own to see the photo larger before it could be changed, and a yellow
 * box for the name change.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "loading", update: async () => null }) }))
// What next/image draws is next/image's; the photo's place in the page is this.
vi.mock("next/image", () => ({ default: (p: { src: string; alt: string; width: number; height: number }) => h("img", { src: p.src, alt: p.alt, width: p.width, height: p.height }) }))

beforeEach(() => { state.locale = "en" })
afterEach(() => vi.unstubAllGlobals())

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const render = (el: ReactElement) => renderToStaticMarkup(el)
const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
const CSS = readFileSync("components/ui/ui.css", "utf8")
/** One rule of the building blocks' stylesheet. */
function rule(selector: string) {
    const start = CSS.search(new RegExp(`\\n\\s*${selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")} \\{`))
    expect(start, selector).toBeGreaterThan(-1)
    return CSS.slice(start, CSS.indexOf("}", start))
}
const MONA = "Mona Ali"

describe("a person's profile, as a page", () => {
    it("is someone else's under their name, saying what the page is, with a way back to Employees", async () => {
        const { ProfileHeader } = await import("@/components/profile/ProfileFrame")
        const html = render(h(ProfileHeader, { own: false, editing: false, name: MONA }))
        expect(html).toMatch(/<a(?=[^>]*class="ui-back-link")(?=[^>]*href="\/dashboard\/employees")[^>]*>/)
        expect(html).toContain(`${esc(en.employees)}</a>`)
        // The name keeps its own direction, inside the page's.
        expect(html).toContain(`<h1 class="ui-page-title"><bdi>${MONA}</bdi></h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.employee_profile)}</p>`)
    })

    it("says when it's being edited", async () => {
        const { ProfileHeader } = await import("@/components/profile/ProfileFrame")
        expect(render(h(ProfileHeader, { own: false, editing: true, name: MONA }))).toContain(`<p class="ui-page-subtitle">${esc(en.edit_employee_title)}</p>`)
    })

    it("is My profile for one's own, opened from the account menu, with nowhere to go back to", async () => {
        const { ProfileHeader } = await import("@/components/profile/ProfileFrame")
        for (const editing of [true, false]) {
            const html = render(h(ProfileHeader, { own: true, editing, name: MONA }))
            expect(html).toContain(`<h1 class="ui-page-title">${esc(en.my_profile)}</h1>`)
            expect(html).not.toContain("ui-back-link")
            expect(html).not.toContain("ui-page-subtitle")
        }
    })

    it("says what the page is, with the way back, while it loads, before the name has come", async () => {
        const { ProfileHeader } = await import("@/components/profile/ProfileFrame")
        const html = render(h(ProfileHeader, { own: false, editing: false, name: null }))
        expect(html).toMatch(/<a(?=[^>]*class="ui-back-link")(?=[^>]*href="\/dashboard\/employees")[^>]*>/)
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.employee_profile)}</h1>`)
        expect(html).not.toContain("ui-page-subtitle")
        // Its header from the start, whose profile it is known from the layout, and the panel where the profile will be.
        expect(FORM).toMatch(/if \(loading\) \{\s*return \(\s*<Page>\s*<ProfileHeader own=\{own\} editing=\{!seeing\} name=\{null\} \/>\s*<div className="ui-panel" role="status"><EmptyState icon=\{HourglassIcon\} title=\{t\('loading'\)\} \/><\/div>\s*<\/Page>/)
        expect(FORM).toContain("const own = userId === viewer?.id")
    })

    it("says so in Arabic too", async () => {
        state.locale = "ar"
        const { ProfileHeader } = await import("@/components/profile/ProfileFrame")
        const html = render(h(ProfileHeader, { own: false, editing: false, name: "منى علي" }))
        expect(html).toContain(`${ar.employees}</a>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${ar.employee_profile}</p>`)
        expect(render(h(ProfileHeader, { own: true, editing: true, name: "منى علي" }))).toContain(`<h1 class="ui-page-title">${ar.my_profile}</h1>`)
    })

    it("is the form's frame, where it was a glass card with a title of its own", () => {
        expect(FORM).toContain("<Page>")
        // The form's, and the view's (part 2, PR 192), each its own.
        expect(FORM).toContain("<ProfileHeader own={own} editing name={name} />")
        expect(FORM).toMatch(/<ProfileHeader own=\{own\} editing=\{false\} name=\{name\}/)
        expect(FORM).not.toContain("glass-card")
        expect(FORM).not.toMatch(/<h1\b/)
        // Its card holds the photo and the form.
        expect(FORM).toMatch(/<Card>\s*<ProfilePhoto/)
    })

    it("says its words in sentence case, as the account menu's My profile does now", () => {
        expect(en.employee_profile).toBe("Employee profile")
        expect(en.edit_employee_title).toBe("Edit employee")
        expect(en.my_profile).toBe("My profile")
        // "Profile" alone was its own title, and nothing else's.
        expect(en).not.toHaveProperty("profile_title")
        expect(ar).not.toHaveProperty("profile_title")
    })
})

describe("their photo", () => {
    it("fills a circle 96px across", async () => {
        const { Photo } = await import("@/components/ui")
        const html = render(h(Photo, { name: MONA, src: "https://x.supabase.co/storage/v1/object/public/app-assets/a.png", alt: "Mona's photo" }))
        // React's server rendering puts a preload for the image ahead of it.
        expect(html).toContain('<span class="ui-photo"><img src="https://x.supabase.co/storage/v1/object/public/app-assets/a.png" alt="Mona&#x27;s photo" width="96" height="96"/></span>')
        const circle = rule(".ui-photo")
        for (const decl of ["width: 96px;", "height: 96px;", "border-radius: 50%;", "overflow: hidden;", "background: var(--brand-tint-strong);", "color: var(--brand-text);"]) expect(circle, decl).toContain(decl)
        expect(rule(".ui-photo img")).toContain("object-fit: cover;")
    })

    // Browser flows (PR 191): on a computer, the picker's dashed box ran on
    // past the form under it, to the card's far side.
    it("keeps to the form's width, with what changes it", () => {
        expect(rule(".ui-photo-row")).toContain("max-width: 640px;")
        expect(rule(".ui-form")).toContain("max-width: 640px;")
    })

    it("is their initials when they have none, as an avatar's, never a drawing chosen by their gender", async () => {
        const { Photo } = await import("@/components/ui")
        // Beside their name, so the initials are hidden from screen readers.
        expect(render(h(Photo, { name: MONA, src: null, alt: "Mona's photo" }))).toBe('<span class="ui-photo" aria-hidden="true">MA</span>')
        expect(render(h(Photo, { name: "منى علي", src: null, alt: "" }))).toBe('<span class="ui-photo" aria-hidden="true">م‌ع</span>')
        expect(FORM).not.toMatch(/👨|👩/u)
        expect(FORM).not.toMatch(/gender === 'MALE' \?/)
    })

    it("offers Upload a photo where it can be changed, with which kinds, how large, and that it's saved at once", async () => {
        const { PhotoRow } = await import("@/components/profile/ProfilePhoto")
        const html = render(h(PhotoRow, { name: MONA, src: null, canChange: true, uploading: false, error: null, onFiles: () => {}, onRemove: () => {} }))
        expect(html).toContain('<div class="ui-photo-row">')
        expect(html).toMatch(new RegExp(`<div class="ui-file-drop"><button type="button" class="ui-btn ui-btn-secondary">(?:(?!</button>).)*${esc(en.profile_photo_upload)}</button><span class="ui-hint">${esc(en.profile_photo_hint)}</span>`, "s"))
        expect(html).toContain('accept=".jpg,.jpeg,.png,.gif,.webp"')
        expect(html).not.toMatch(/<input[^>]*multiple/)
        // Nothing to remove yet.
        expect(html).not.toContain(esc(en.profile_photo_remove))
        expect(en.profile_photo_hint).toBe("JPG, PNG, GIF or WebP, up to 4\u00A0MB. It's saved as soon as it's uploaded.")
    })

    // Web interface audit (PR 191): on a phone in Arabic, the hint broke
    // between "4" and its unit, "ميجابايت" alone on the next line.
    // In Arabic its number is in Arabic digits, as the page's others are,
    // where it was a 4 among them (browser flows, PR 193).
    it("keeps a size together on one line, its number with its unit", () => {
        for (const key of ["profile_photo_hint", "profile_photo_too_large"] as const) {
            expect(en[key], key).toContain("4\u00A0MB")
            expect(ar[key], key).toContain("٤\u00A0ميجابايت")
            expect(ar[key], key).not.toMatch(/[0-9]/)
        }
    })

    it("offers Change photo once there's one, and Remove photo as a quiet button", async () => {
        const { PhotoRow } = await import("@/components/profile/ProfilePhoto")
        const html = render(h(PhotoRow, { name: MONA, src: "https://x.supabase.co/storage/v1/object/public/app-assets/a.png", canChange: true, uploading: false, error: null, onFiles: () => {}, onRemove: () => {} }))
        expect(html).toMatch(new RegExp(`class="ui-btn ui-btn-secondary">(?:(?!</button>).)*${esc(en.profile_photo_change)}</button>`, "s"))
        expect(html).toContain(`<button type="button" class="ui-btn ui-btn-quiet">${esc(en.profile_photo_remove)}</button>`)
        // The photo is named for screen readers, as the page is about them.
        expect(html).toContain(`alt="${esc(en.profile_photo_of.replace("{name}", MONA))}"`)
    })

    it("offers nothing to change where it can't be, as on the view of someone else's", async () => {
        const { PhotoRow } = await import("@/components/profile/ProfilePhoto")
        const html = render(h(PhotoRow, { name: MONA, src: "https://x.supabase.co/a.png", canChange: false, uploading: false, error: null, onFiles: () => {}, onRemove: () => {} }))
        expect(html).not.toContain("<button")
        expect(html).not.toContain("ui-file-drop")
        // The form's can change; the view's, its details' (part 2, PR 192), can't.
        expect(FORM).toMatch(/<ProfilePhoto[^>]* canChange own=/)
        expect(readFileSync("components/profile/ProfileView.tsx", "utf8")).toContain("<PhotoRow name={name} src={photo} canChange={false}")
    })

    it("says while it's sent, which a screen reader hears, with the picker and Remove photo off", async () => {
        const { PhotoRow } = await import("@/components/profile/ProfilePhoto")
        const idle = render(h(PhotoRow, { name: MONA, src: "https://x.supabase.co/a.png", canChange: true, uploading: false, error: null, onFiles: () => {}, onRemove: () => {} }))
        // There from the start, so what it then says is heard.
        expect(idle).toContain('<p class="ui-hint" role="status"></p>')
        const busy = render(h(PhotoRow, { name: MONA, src: "https://x.supabase.co/a.png", canChange: true, uploading: true, error: null, onFiles: () => {}, onRemove: () => {} }))
        expect(busy).toContain(`<p class="ui-hint" role="status">${esc(en.profile_photo_uploading)}</p>`)
        expect(busy).toMatch(/<button type="button" class="ui-btn ui-btn-secondary" disabled="">/)
        expect(busy).toContain(`<button type="button" class="ui-btn ui-btn-quiet" disabled="">${esc(en.profile_photo_remove)}</button>`)
    })

    it("says under the picker what's wrong", async () => {
        const { PhotoRow } = await import("@/components/profile/ProfilePhoto")
        const html = render(h(PhotoRow, { name: MONA, src: null, canChange: true, uploading: false, error: en.profile_photo_too_large, onFiles: () => {}, onRemove: () => {} }))
        expect(html).toContain(`<p class="ui-error" role="alert">${esc(en.profile_photo_too_large)}</p>`)
    })
})

describe("a photo picked", () => {
    it("is checked before it's sent, against what the upload route takes", async () => {
        const { photoProblem, PHOTO_ACCEPT, PHOTO_MAX_BYTES } = await import("@/lib/profile-photo")
        const route = readFileSync("app/api/upload/route.ts", "utf8")
        expect(route).toContain(`const MAX_SIZE = 4 * 1024 * 1024 // 4MB`)
        expect(PHOTO_MAX_BYTES).toBe(4 * 1024 * 1024)
        // The route's image kinds, and nothing it would refuse.
        for (const ext of PHOTO_ACCEPT.split(",")) expect(route, ext).toContain(`'${ext}'`)
        expect(PHOTO_ACCEPT).toBe(".jpg,.jpeg,.png,.gif,.webp")

        expect(photoProblem({ name: "me.JPG", size: 1000 })).toBeNull()
        expect(photoProblem({ name: "me.webp", size: PHOTO_MAX_BYTES })).toBeNull()
        expect(photoProblem({ name: "me.png", size: PHOTO_MAX_BYTES + 1 })).toBe("profile_photo_too_large")
        // An image the route doesn't take, and a file that's no image.
        for (const name of ["me.heic", "me.avif", "me.svg", "cv.pdf", "noext"]) expect(photoProblem({ name, size: 1000 }), name).toBe("profile_photo_wrong_type")
    })

    it("is theirs only once it's saved: a refused save says so, and keeps the photo they had", async () => {
        const { savePhoto } = await import("@/lib/profile-photo")
        const file = new File(["x"], "me.png", { type: "image/png" })
        const calls: { url: string; init: RequestInit }[] = []
        const answers: Response[] = [
            new Response(JSON.stringify({ success: true, data: { url: "https://x.supabase.co/new.png" } }), { status: 200 }),
            new Response(JSON.stringify({ success: false, error: "You can't change this person." }), { status: 403 }),
        ]
        vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return answers.shift()! }))
        expect(await savePhoto("u1", file, "fallback")).toEqual({ error: "You can't change this person." })
        expect(calls.map(c => [c.url, c.init.method])).toEqual([["/api/upload", "POST"], ["/api/users", "PUT"]])
        expect(JSON.parse(String(calls[1].init.body))).toEqual({ id: "u1", avatar: "https://x.supabase.co/new.png" })
        // The form keeps the photo it had: only a saved one is handed back.
        expect(readFileSync("components/profile/ProfilePhoto.tsx", "utf8")).toMatch(/if \('error' in saved\) \{[^}]*setError\(saved\.error\)[^}]*return[^}]*\}\s*onChange\(saved\.url\)/)
    })

    it("hands back the photo once it's saved, sent once and never again", async () => {
        const { savePhoto } = await import("@/lib/profile-photo")
        const answers = [
            new Response(JSON.stringify({ success: true, data: { url: "https://x.supabase.co/new.png" } }), { status: 200 }),
            new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
        ]
        const fetchMock = vi.fn(async () => answers.shift()!)
        vi.stubGlobal("fetch", fetchMock)
        expect(await savePhoto("u1", new File(["x"], "me.png"), "fallback")).toEqual({ url: "https://x.supabase.co/new.png" })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it("says it couldn't be saved when the upload didn't come back, or the connection failed", async () => {
        const { savePhoto } = await import("@/lib/profile-photo")
        vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })))
        expect(await savePhoto("u1", new File(["x"], "me.png"), "fallback")).toEqual({ error: "fallback" })
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch") }))
        expect(await savePhoto("u1", new File(["x"], "me.png"), "fallback")).toEqual({ error: "fallback" })
        // Uploaded, with no address in the answer: nothing to save.
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })))
        expect(await savePhoto("u1", new File(["x"], "me.png"), "fallback")).toEqual({ error: "fallback" })
    })

    it("is removed only once that's saved too", async () => {
        const { removePhoto } = await import("@/lib/profile-photo")
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: false, error: "No." }), { status: 403 }))
        vi.stubGlobal("fetch", fetchMock)
        expect(await removePhoto("u1", "fallback")).toEqual({ error: "No." })
        expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ id: "u1", avatar: null })
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })))
        expect(await removePhoto("u1", "fallback")).toEqual({ ok: true })
    })

    it("asks before it's removed, over the page now the photo's window is gone", () => {
        const src = readFileSync("components/profile/ProfilePhoto.tsx", "utf8")
        const sf = ts.createSourceFile("p.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const asked: Map<string, string>[] = []
        const visit = (n: ts.Node) => {
            if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "ConfirmDialog") {
                asked.push(new Map(n.attributes.properties.filter(ts.isJsxAttribute).map(p => [p.name.getText(sf), p.initializer ? p.initializer.getText(sf) : "true"])))
            }
            ts.forEachChild(n, visit)
        }
        visit(sf)
        expect(asked).toHaveLength(1)
        expect(asked[0].get("title")).toBe("{t('profile_photo_remove')}")
        expect(asked[0].get("confirmLabel")).toBe("{t('profile_photo_remove')}")
        expect(asked[0].get("body")).toBe("{t('profile_photo_remove_question')}")
        expect(asked[0].has("danger")).toBe(true)
        expect(asked[0].has("overModal")).toBe(false)
        // The window of its own making is gone, with its way of opening.
        expect(FORM).not.toMatch(/showAvatarModal|avatarDialog|manage_photo_title|view_photo/)
    })

    it("says what's wrong in words for anyone in Arabic, and in sentence case", () => {
        for (const key of ["profile_photo_upload", "profile_photo_change", "profile_photo_remove", "profile_photo_remove_question", "profile_photo_hint", "profile_photo_too_large", "profile_photo_wrong_type", "profile_photo_uploading", "profile_photo_saved", "profile_photo_removed", "profile_photo_failed", "profile_photo_remove_failed", "profile_photo_of"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/(^|\s)(اختر|حاول|ارفع|أعد|انتظر|تحقق)(\s|$)|هل أنت متأكد|هل تريد/)
        }
        expect(en.profile_photo_remove_question).not.toMatch(/\byour\b/i)
    })

    // Web interface audit (PR 191): each said what was wrong, and left what
    // to do about it to be worked out.
    it("says what to do about a file that can't be used", () => {
        expect(en.profile_photo_too_large).toBe("The photo is larger than 4\u00A0MB. Choose a smaller one.")
        expect(en.profile_photo_wrong_type).toBe("That file can't be used. Choose a JPG, PNG, GIF or WebP photo.")
        expect(ar.profile_photo_too_large).toContain("يُرجى اختيار صورة أصغر")
        expect(ar.profile_photo_wrong_type).toContain("يُرجى اختيار صورة JPG أو PNG أو GIF أو WebP")
    })

    it("takes the old window's words with it", () => {
        for (const key of ["manage_photo_title", "view_photo", "add_photo", "change_button", "upload_button", "reset_button", "uploading_photo", "uploading_in_progress", "resetting_in_progress",
            "profile_picture_label", "photo_updated_success", "photo_upload_failed", "photo_reset_success", "photo_reset_failed", "reset_photo_title", "reset_photo_warning"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})

describe("a name change waiting", () => {
    it("is a card waiting on someone, with the name asked for, and the request on the Requests page", async () => {
        const { NameChangeWaiting } = await import("@/components/profile/ProfileFrame")
        const html = render(h(NameChangeWaiting, { name: MONA, requestId: "r1" }))
        expect(html).toMatch(/^<section class="ui-panel ui-card" data-tone="waiting">/)
        expect(html).toContain(`<h2 class="ui-card-title">${esc(en.name_change_waiting_title)}</h2>`)
        expect(html).toMatch(/<a(?=[^>]*href="\/dashboard\/requests\?kind=nameChange&amp;highlight=r1")[^>]*>/)
        const [before, after] = en.name_change_waiting_body.split("{name}")
        expect(html).toContain(`<p>${esc(before)}<bdi>${MONA}</bdi>${esc(after)}</p>`)
    })

    it("opens the kind's list when it's just been asked for, before it has an id", async () => {
        const { NameChangeWaiting } = await import("@/components/profile/ProfileFrame")
        expect(render(h(NameChangeWaiting, { name: MONA }))).toMatch(/<a(?=[^>]*href="\/dashboard\/requests\?kind=nameChange")[^>]*>/)
    })

    it("is the form's, where it was a yellow box of its own making", () => {
        expect(FORM).toContain("<NameChangeWaiting name={`${pendingRequest.newFirstName} ${pendingRequest.newLastName}`.trim()} requestId={pendingRequest.id} />")
        expect(FORM).not.toContain("--warn-bg-yellow-subtle")
        for (const key of ["name_change_request_pending", "requested_label"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })

    // Found reading the code (PR 191): the list gives whoever may decide name
    // changes the company's waiting ones, unless it's asked whose. Someone
    // who may, on an employee's or a team leader's footing in a role of the
    // company's, saw the first of them on their own profile, whoever's it
    // was, as their own name change waiting.
    it("is their own, asked for by whose it is, never the first of the company's", () => {
        expect(FORM).toContain("fetchRetrying(`/api/profile-requests?status=PENDING&userId=${encodeURIComponent(userId)}`)")
        expect(FORM).not.toContain("fetchRetrying(`/api/profile-requests?status=PENDING`)")
        // Whose, for one who may decide them; anyone else is given only their own.
        const route = readFileSync("app/api/profile-requests/route.ts", "utf8")
        expect(route).toContain("if (!isAdmin) {\n        where.userId = session.user.id")
        expect(route).toContain("if (targetUserId) where.userId = targetUserId")
    })

    it("says so in Arabic in words for anyone", () => {
        for (const key of ["name_change_waiting_title", "name_change_waiting_body", "name_change_waiting_open"] as const) {
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/طلبتَ|انتظر/)
        }
        expect(ar.name_change_waiting_body).toContain("{name}")
    })
})
