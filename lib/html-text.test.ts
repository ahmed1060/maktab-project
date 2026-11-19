import { describe, it, expect } from "vitest"
import { escapeHtml } from "./html-text"

/** Text as text in an email's HTML (lib/html-text.ts; PR 325). */
describe("escapeHtml", () => {
    it("writes the five characters HTML reads as code as text", () => {
        expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;")
    })

    it("leaves everything else as it is, Arabic included", () => {
        expect(escapeHtml("مكتب الأمل للمحاسبة 72")).toBe("مكتب الأمل للمحاسبة 72")
    })

    it("escapes an ampersand once, so text that looks escaped stays text", () => {
        expect(escapeHtml("&amp;")).toBe("&amp;amp;")
    })
})
