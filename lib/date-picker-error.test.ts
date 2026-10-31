import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * A date picker shown as a field says what's wrong with it as a field does
 * (DESIGN.md §5.3): the error under it, and read out with it. Its trigger is a
 * button, which takes no aria-invalid, so the error alone says it. Asking for
 * a day off without one is the first form that needs it (UI_PLAN.md §2.3,
 * part 2c).
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))

const describedError = (html: string) => {
    const trigger = html.match(/<button[^>]*class="ui-input ui-date-trigger"[^>]*>/)?.[0] ?? ""
    const id = trigger.match(/aria-describedby="([^"]+)"/)?.[1]
    return { trigger, error: id ? html.match(new RegExp(`<span id="${id.replace(/[:]/g, "\\:")}" class="ui-error">([^<]*)<`))?.[1] : undefined }
}

describe("a date picker's error", () => {
    it("is under the single day's picker, and read with it", async () => {
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const html = renderToStaticMarkup(h(DatePickerSingle, { asField: true, label: "Date", value: "", onChange: () => {}, error: "Pick a day" }))
        const { trigger, error } = describedError(html)
        expect(trigger).not.toContain("aria-invalid")
        expect(error).toBe("Pick a day")
    })

    it("is under the range's picker too", async () => {
        const { default: DateRangePicker } = await import("@/components/DateRangePicker")
        const html = renderToStaticMarkup(h(DateRangePicker, { asField: true, label: "Dates", dateFrom: "", dateTo: "", onChange: () => {}, error: "Pick the days" }))
        const { error } = describedError(html)
        expect(error).toBe("Pick the days")
    })

    it("isn't there when there's nothing wrong", async () => {
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const html = renderToStaticMarkup(h(DatePickerSingle, { asField: true, label: "Date", value: "", onChange: () => {} }))
        expect(html).not.toContain("aria-describedby")
        expect(html).not.toContain("ui-error")
    })
})
