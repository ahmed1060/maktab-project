import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The plain email's HTML (lib/email.ts; PR 325): payslips, final
 * settlements and subscription notices carry names people type, an
 * employee's or a company's, and each line goes into the HTML as text, never
 * as part of its code. The plain-text part keeps every line as written.
 * Nothing here reaches a mail server.
 */

const sendMail = vi.hoisted(() => vi.fn<(message: Record<string, unknown>) => Promise<object>>(async () => ({})))
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }))

describe("the plain email", () => {
    beforeEach(() => {
        vi.resetModules()
        sendMail.mockClear()
        vi.stubEnv("GMAIL_USER", "nizmo.sends@gmail.co")
        vi.stubEnv("GMAIL_APP_PASSWORD", "test-only")
    })
    afterEach(() => vi.unstubAllEnvs())

    const sent = async (text: string) => {
        const { sendPlainEmail } = await import("./email")
        expect(await sendPlainEmail("mona@client.co", "Payslip", text)).toBe("SENT")
        return sendMail.mock.calls[0][0] as { text: string; html: string }
    }

    it("writes each line into its HTML as text, never as part of its code", async () => {
        const line = `Hello <img src=x onerror="alert(1)">&Co 'Mona' "M",`
        const { html } = await sent(`${line}\n\nYour payslip is ready.`)
        expect(html).not.toContain("<img")
        expect(html).toContain("Hello &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;Co &#39;Mona&#39; &quot;M&quot;,")
        expect(html).toContain(">Your payslip is ready.</p>")
    })

    it("keeps the plain text as it's written", async () => {
        const text = "Final settlement for A & B <Trading>\n\nNothing is outstanding."
        expect((await sent(text)).text).toBe(text)
    })

    it("still leaves a gap for an empty line", async () => {
        const { html } = await sent("One\n\nTwo")
        expect(html.match(/<p /g)).toHaveLength(2)
        expect(html).toContain('<div style="height: 12px;"></div>')
    })

    it("escapes with the helper the invitation's email uses", () => {
        // The office's emails share their frame and its escaping since the update email came (PR 351).
        for (const file of ["lib/email.ts", "lib/office-email.ts"]) {
            expect(readFileSync(file, "utf8"), file).toContain('import { escapeHtml } from "./html-text"')
        }
        for (const file of ["lib/client-invitation-email.ts", "lib/tax-update-email.ts"]) {
            expect(readFileSync(file, "utf8"), file).toMatch(/import \{[^}]*\bescape\b[^}]*\} from "\.\/office-email"/)
        }
    })
})
