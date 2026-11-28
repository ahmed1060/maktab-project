import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import * as locations from "./locations"

/**
 * A location's check radius, only in its own form (LATER_CHANGES_PLAN.md
 * §7.22; DESIGN.md §5.3, A place on the map): the form's default is the
 * system's distance, as the server sends it, and the radius is never in a
 * list or a client's form. What the server sends to whom is
 * lib/location-radius.db.test.ts's.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
// The map stands for itself: the circle it's given is what's checked.
vi.mock("@/components/PointPicker", () => ({ default: ({ radius }: { radius: number }) => h("div", { "data-ring": String(radius) }) }))
vi.mock("@/components/locations/PlaceSearch", () => ({ default: () => null }))

const read = (file: string) => stripComments(readFileSync(file, "utf8"))

async function fields(props: { radius?: string; defaultRadius?: number; withRadius?: boolean }) {
    const PlaceFields = (await import("@/components/locations/PlaceFields")).default
    return renderToStaticMarkup(h(PlaceFields, {
        draft: { name: "Port gate", point: "30.0444, 31.2357", radius: props.radius ?? "" },
        onChange: () => {},
        errors: {},
        ...(props.defaultRadius !== undefined ? { defaultRadius: props.defaultRadius } : {}),
        ...(props.withRadius !== undefined ? { withRadius: props.withRadius } : {}),
    }))
}

describe("the location's own form", () => {
    it("takes the system's distance as the default: its hint, its placeholder, and the circle while it's empty", async () => {
        state.locale = "en"
        const html = await fields({ defaultRadius: 30 })
        expect(html).toContain("How far from the pin still counts as there: 20 to 5,000 m. Left empty, it&#x27;s 30 m.")
        expect(html).toContain('placeholder="30"')
        expect(html).toContain('data-ring="30"')
        expect(html).not.toContain("70")
    })

    it("draws the circle at the radius typed", async () => {
        expect(await fields({ defaultRadius: 30, radius: "100" })).toContain('data-ring="100"')
    })

    it("says the default in the page's digits", async () => {
        state.locale = "ar"
        const html = await fields({ defaultRadius: 30 })
        expect(html).toContain("إذا تُرك فارغًا فهو ٣٠ م.")
        state.locale = "en"
    })

    it("says only the range, with no circle, before the default is known", async () => {
        const html = await fields({})
        expect(html).toContain("How far from the pin still counts as there: 20 to 5,000 m.<")
        expect(html.match(/<input[^>]*name="radius"[^>]*>/)?.[0]).not.toContain("placeholder=")
        expect(html).toContain('data-ring="0"')
    })

    it("has no radius and no circle where it isn't asked for", async () => {
        const html = await fields({ defaultRadius: 30, withRadius: false })
        expect(html).not.toContain('name="radius"')
        expect(html).not.toContain(en.location_radius)
        expect(html).toContain('data-ring="0"')
    })
})

describe("where the default comes from", () => {
    it("is what the list and the task's picker read, handed to the form", () => {
        const list = read("components/locations/LocationsList.tsx")
        expect(list).toContain("const defaultRadius: number | undefined = result?.data?.defaultRadiusMeters")
        expect(list.match(/<LocationForm [^\n]*defaultRadius=\{defaultRadius\}/g)?.length).toBe(2)
        expect(read("components/locations/TaskPlacePicker.tsx")).toContain("defaultRadius={list?.defaultRadiusMeters}")
        const form = read("components/locations/LocationForm.tsx")
        expect(form).toMatch(/<Form [^\n]*defaultRadius=\{defaultRadius\} \/>/)
        expect(form).toMatch(/<PlaceFields [^\n]*defaultRadius=\{defaultRadius\} \/>/)
        expect(read("app/api/locations/route.ts")).toContain("...(result.defaultRadiusMeters !== undefined ? { defaultRadiusMeters: result.defaultRadiusMeters } : {})")
    })

    it("is never a number of the form's own", () => {
        expect(locations).not.toHaveProperty("LOCATION_RADIUS_DEFAULT")
        expect(locations).not.toHaveProperty("radiusOf")
        expect(read("components/locations/PlaceFields.tsx")).not.toMatch(/\b70\b/)
    })
})

describe("everywhere else", () => {
    it("the lists of locations have no radius", () => {
        const list = read("components/locations/LocationsList.tsx")
        expect(list).not.toContain("radiusMeters")
        expect(list).not.toContain("locations_col_radius")
        expect(list).not.toContain("MapPinAreaIcon")
    })

    it("a client's form has its HQ's name and pin alone, and sends no radius", () => {
        const page = read("app/(dashboard)/dashboard/clients/page.tsx")
        expect(page).toMatch(/<PlaceFields[\s\S]*?withRadius=\{false\}[\s\S]*?\/>/)
        expect(page).toContain("hq: { name: place.name, latitude: place.latitude, longitude: place.longitude }")
        expect(page).toContain("locations: { id: string; name: string; latitude: number | null; longitude: number | null }[")
        expect(page).toContain("if (hq) return draftOf({ ...hq, radiusMeters: null })")
    })

    it("the clients' route doesn't send an HQ's radius", () => {
        expect(read("app/api/clients/route.ts")).not.toContain("radiusMeters")
    })
})

describe("the words", () => {
    it("say the default and the range, in both languages, and the list's radius words are gone", () => {
        expect(en.location_radius_hint).toBe("How far from the pin still counts as there: 20 to 5,000 m. Left empty, it's {n} m.")
        expect(en.location_radius_hint_range).toBe("How far from the pin still counts as there: 20 to 5,000 m.")
        expect(ar.location_radius_hint).toBe("أبعد مسافة من الموقع تُحسب عنده: من ٢٠ إلى ٥٠٠٠ م. إذا تُرك فارغًا فهو {n} م.")
        expect(ar.location_radius_hint_range).toBe("أبعد مسافة من الموقع تُحسب عنده: من ٢٠ إلى ٥٠٠٠ م.")
        for (const key of ["locations_col_radius", "locations_radius_default", "locations_radius_value"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
