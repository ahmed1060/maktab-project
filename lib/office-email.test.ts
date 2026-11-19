import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * An email sent from Nizmo's address on an office's behalf, as the
 * invitation's is (lib/email.ts; CLIENT_PORTAL_PLAN.md §5.2; PR 325): under
 * the office's name, to the person by name, with a reply to whoever in the
 * office sent it, or none. Nothing here reaches a mail server.
 */

const sendMail = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }))

const MESSAGE = {
    to: { name: "Mona Fouad", address: "mona@client.co" },
    fromName: "Al Amal Accounting",
    replyTo: { name: "Amal One", address: "amal@office.co" },
    subject: "Invitation to the tax position of Al Noor Trading",
    text: "Hello",
    html: "<p>Hello</p>",
}

describe("an email sent on an office's behalf", () => {
    beforeEach(() => {
        vi.resetModules()
        sendMail.mockClear()
        vi.spyOn(console, "warn").mockImplementation(() => {})
    })
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
    })

    const configured = async () => {
        vi.stubEnv("GMAIL_USER", "nizmo.sends@gmail.co")
        vi.stubEnv("GMAIL_APP_PASSWORD", "test-only")
        return import("./email")
    }

    it("is from the office by name, at Nizmo's address, to the person by name, with a reply to whoever sent it", async () => {
        const { sendOfficeEmail } = await configured()
        expect(await sendOfficeEmail(MESSAGE)).toBe("SENT")
        expect(sendMail).toHaveBeenCalledWith({
            from: { name: "Al Amal Accounting", address: "nizmo.sends@gmail.co" },
            to: { name: "Mona Fouad", address: "mona@client.co" },
            replyTo: { name: "Amal One", address: "amal@office.co" },
            subject: MESSAGE.subject,
            text: "Hello",
            html: "<p>Hello</p>",
        })
    })

    it("has no reply address where none is given", async () => {
        const { sendOfficeEmail } = await configured()
        await sendOfficeEmail({ ...MESSAGE, replyTo: null })
        expect(sendMail.mock.calls[0]).not.toHaveProperty("0.replyTo")
    })

    it("is never sent to an address kept for examples, whether or not email is set up", async () => {
        const { sendOfficeEmail } = await configured()
        expect(await sendOfficeEmail({ ...MESSAGE, to: { name: "Demo", address: "demo@client.example" } })).toBe("SKIPPED_UNROUTABLE")
        vi.resetModules()
        vi.unstubAllEnvs()
        vi.stubEnv("GMAIL_USER", "")
        vi.stubEnv("GMAIL_APP_PASSWORD", "")
        const unconfigured = await import("./email")
        expect(await unconfigured.sendOfficeEmail({ ...MESSAGE, to: { name: "Demo", address: "demo@shots.test" } })).toBe("SKIPPED_UNROUTABLE")
        expect(sendMail).not.toHaveBeenCalled()
    })

    it("fails, sending nothing, where email isn't set up", async () => {
        vi.stubEnv("GMAIL_USER", "")
        vi.stubEnv("GMAIL_APP_PASSWORD", "")
        const { sendOfficeEmail } = await import("./email")
        await expect(sendOfficeEmail(MESSAGE)).rejects.toThrow("EMAIL_NOT_CONFIGURED")
        expect(sendMail).not.toHaveBeenCalled()
    })
})
