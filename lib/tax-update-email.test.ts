import { describe, it, expect, afterEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { brandTokens } from "./brand-colour"
import { taxUpdateEmail, type TaxUpdateEmailFacts } from "./tax-update-email"

/**
 * The update email (CLIENT_PORTAL_PLAN.md §4.4, §12 step 11b; DESIGN.md
 * §5.5, The update email; PR 351): its words in each language, as agreed
 * with the owner on 2026-11-20, who it's from, and where its link goes.
 * Sending it when an upload is saved, against a real Postgres, is in
 * lib/tax-update-email.db.test.ts.
 */

const SIGN_IN = "https://nizmo.vercel.app/login"
const PRIVACY = "https://nizmo.vercel.app/privacy"
const FACTS: TaxUpdateEmailFacts = {
    language: "en",
    person: { name: "Mona Fouad", email: "mona@client.co" },
    office: "Al Amal Accounting",
    client: "Al Noor Trading",
    asOf: "2026-11-17",
    sender: { name: "Amal One", email: "amal@office.co" },
    signIn: SIGN_IN,
    privacy: PRIVACY,
    brand: null,
}
const email = (more: Partial<TaxUpdateEmailFacts> = {}) => taxUpdateEmail({ ...FACTS, ...more })
const arabic = (more: Partial<TaxUpdateEmailFacts> = {}) => email({ language: "ar", person: { name: "منى فؤاد", email: "mona@client.co" }, office: "مكتب الأمل", client: "شركة النور", sender: { name: "أمل علي", email: "amal@office.co" }, ...more })

// Each name is kept whole in the plain text by marks that can't be seen
// (DESIGN.md §3.2); the lines are compared without them.
const ISOLATES = new RegExp(`[${String.fromCharCode(0x2068)}${String.fromCharCode(0x2069)}]`, "g")
const lines = (text: string) => text.replace(ISOLATES, "").split("\n")

describe("the update email in English", () => {
    it("has its subject and every line as agreed", () => {
        const sent = email()
        expect(sent.subject).toBe("The tax position of Al Noor Trading was updated")
        expect(lines(sent.text)).toEqual([
            "Hello Mona Fouad,",
            "",
            "Al Amal Accounting updated the tax position of Al Noor Trading on Nizmo. The figures are as of 17 November 2026.",
            "",
            "To see it, sign in:",
            SIGN_IN,
            "",
            "For any questions, please contact Amal One at Al Amal Accounting.",
            "",
            "Sent through Nizmo on behalf of Al Amal Accounting.",
            `Privacy policy: ${PRIVACY}`,
        ])
    })

    it("has the same words in its HTML, with the button and the link written out to copy", () => {
        const { html } = email()
        for (const words of [
            "Hello <bdi>Mona Fouad</bdi>,",
            "<bdi>Al Amal Accounting</bdi> updated the tax position of <bdi>Al Noor Trading</bdi> on Nizmo. The figures are as of 17 November 2026.",
            "To see it, sign in:",
            ">Sign in</a>",
            "If the button doesn't open, copy this link into your browser:",
            "For any questions, please contact <bdi>Amal One</bdi> at <bdi>Al Amal Accounting</bdi>.",
            "Sent through Nizmo on behalf of <bdi>Al Amal Accounting</bdi>.",
            ">Privacy policy</a>",
        ]) expect(html, words).toContain(words.replace(/'/g, "&#39;"))
        expect(html).toMatch(/<html lang="en" dir="ltr">/)
    })
})

describe("the update email in Arabic", () => {
    it("has its subject and every line as agreed, with the day in Arabic digits", () => {
        const sent = arabic()
        expect(sent.subject).toBe("تحديث الموقف الضريبي لـشركة النور")
        expect(lines(sent.text)).toEqual([
            "مرحبًا منى فؤاد،",
            "",
            "تم تحديث الموقف الضريبي لـشركة النور على Nizmo من مكتب الأمل، والأرقام حتى تاريخ ١٧ نوفمبر ٢٠٢٦.",
            "",
            "للاطلاع عليه، يُرجى تسجيل الدخول:",
            SIGN_IN,
            "",
            "للاستفسار، يُرجى التواصل مع أمل علي من مكتب الأمل.",
            "",
            "أُرسلت هذه الرسالة عبر Nizmo نيابةً عن مكتب الأمل.",
            `سياسة الخصوصية: ${PRIVACY}`,
        ])
    })

    it("has the same words in its HTML, right to left, with the link left to right", () => {
        const { html } = arabic()
        for (const words of [
            "مرحبًا <bdi>منى فؤاد</bdi>،",
            "تم تحديث الموقف الضريبي لـ<bdi>شركة النور</bdi> على Nizmo من <bdi>مكتب الأمل</bdi>، والأرقام حتى تاريخ ١٧ نوفمبر ٢٠٢٦.",
            "للاطلاع عليه، يُرجى تسجيل الدخول:",
            ">تسجيل الدخول</a>",
            "إذا لم يفتح الزر، يمكن نسخ هذا الرابط في المتصفح:",
            "للاستفسار، يُرجى التواصل مع <bdi>أمل علي</bdi> من <bdi>مكتب الأمل</bdi>.",
            "أُرسلت هذه الرسالة عبر Nizmo نيابةً عن <bdi>مكتب الأمل</bdi>.",
            ">سياسة الخصوصية</a>",
        ]) expect(html, words).toContain(words)
        expect(html).toMatch(/<html lang="ar" dir="rtl">/)
        expect(html).toMatch(new RegExp(`<a href="${SIGN_IN}" dir="ltr"`))
    })

    it("is in Arabic alone: no English but Nizmo's name, the links and what the office named", () => {
        const { text, subject } = arabic()
        const left = (subject + text).replace(ISOLATES, "").replace(/https:\/\/\S+/g, "").replace(/Nizmo/g, "")
        expect(left).not.toMatch(/[A-Za-z]/)
    })

    it("speaks to the person without a masculine command", () => {
        const { text } = arabic()
        for (const masculine of [/(^|\s)سجّ?ل /, /(^|\s)اطّ?لع/, /(^|\s)افتح/, /(^|\s)انسخ/, /(^|\s)تواصل مع/, /(^|\s)اضغط/]) expect(text, String(masculine)).not.toMatch(masculine)
    })
})

describe("in either language", () => {
    const TZ = process.env.TZ
    afterEach(() => {
        if (TZ === undefined) delete process.env.TZ
        else process.env.TZ = TZ
    })

    it("writes the day the figures are from as the day it is, wherever the server is", () => {
        // A day kept without a time, written in a time zone behind UTC, was the day before.
        process.env.TZ = "America/New_York"
        expect(lines(email({ asOf: "2026-01-01" }).text)[2]).toMatch(/as of 1 January 2026\.$/)
        expect(lines(arabic({ asOf: "2026-12-31" }).text)[2]).toMatch(/حتى تاريخ ٣١ ديسمبر ٢٠٢٦\.$/)
    })

    it("says no amount: the only figures in it are the day's", () => {
        for (const sent of [email(), arabic()]) {
            const left = (sent.subject + sent.text + sent.html).replace(/https:\/\/\S+?(?=["\s<]|$)/g, "").replace(/17 November 2026|١٧ نوفمبر ٢٠٢٦/g, "")
            // What's left of the HTML's own code, its sizes, colours and escaped letters, aside.
            const words = left.replace(/<[^>]*>/g, " ").replace(/&#?\w+;/g, " ")
            expect(words).not.toMatch(/[0-9٠-٩]/)
        }
    })

    it("is from the office, by its name, and a reply goes to whoever uploaded the file", () => {
        const sent = email()
        expect(sent.fromName).toBe("Al Amal Accounting")
        expect(sent.replyTo).toEqual({ name: "Amal One", address: "amal@office.co" })
    })

    it("uploaded by a Super Admin, who isn't one of the office's people, has no reply address and names the office alone", () => {
        const sent = email({ sender: null })
        expect(sent.replyTo).toBeNull()
        expect(lines(sent.text)).toContain("For any questions, please contact Al Amal Accounting.")
        expect(sent.html).toContain("For any questions, please contact <bdi>Al Amal Accounting</bdi>.")
        expect(lines(arabic({ sender: null }).text)).toContain("للاستفسار، يُرجى التواصل مع مكتب الأمل.")
    })

    it("keeps every name as text, never as part of the email's code", () => {
        const sent = email({ office: `<img src=x onerror="alert(1)">&Co`, client: "A & B <Trading>", person: { name: "Mona \"M\" O'Neil", email: "mona@client.co" } })
        expect(sent.html).not.toContain("<img")
        expect(sent.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;Co")
        expect(sent.html).toContain("A &amp; B &lt;Trading&gt;")
        expect(sent.html).toContain("Mona &quot;M&quot; O&#39;Neil")
        expect(sent.text).toContain("A & B <Trading>")
    })

    it("keeps a name with a line break in it on one line, in the subject and the sender's name too", () => {
        const sent = email({ office: "Al Amal\r\nBcc: someone@else.co", client: "Al Noor\nTrading" })
        expect(sent.subject).toBe("The tax position of Al Noor Trading was updated")
        expect(sent.fromName).toBe("Al Amal Bcc: someone@else.co")
        expect(sent.subject + sent.fromName).not.toMatch(/[\r\n]/)
    })

    it("carries the sign-in link on the button and written out, and the privacy policy's", () => {
        const { html } = email()
        expect(html.match(new RegExp(`href="${SIGN_IN}"`, "g"))).toHaveLength(2)
        expect(html).toContain(`href="${PRIVACY}"`)
    })

    it("draws the button, the office's initial and the links in the default brand colour, as the invitation", () => {
        for (const brand of [null, "#0f766e"]) {
            const { light } = brandTokens(brand)
            const { html } = email({ brand })
            expect(html).toContain(`background:${light["--brand"]}`)
            expect(html).toContain(`color:${light["--on-brand"]}`)
            expect(html).toContain(`color:${light["--brand-text"]}`)
        }
        expect(email().html).toMatch(/<td aria-hidden="true"[^>]*>A<\/td>/)
    })

    it("has a button at least 48px tall, and is at most 600px wide", () => {
        const { html } = email()
        const button = html.slice(html.indexOf(`<a href="${SIGN_IN}"`), html.indexOf(">Sign in</a>"))
        const [, top, bottom] = /padding:(\d+)px \d+px (\d+)px/.exec(button) ?? []
        const [, line] = /line-height:(\d+)px/.exec(button) ?? []
        expect(Number(top) + Number(line) + Number(bottom)).toBeGreaterThanOrEqual(48)
        expect(html).toContain("max-width:600px")
    })
})

describe("the route that saves an upload", () => {
    const route = () => readFileSync("app/api/tax-claims/upload/route.ts", "utf8")

    it("gives the sign-in link Nizmo's own address", () => {
        expect(route()).toContain("saveTaxFile(session.user as any, body, new Date(), appOrigin(req.url))")
    })

    it("stops within a minute, its emails sent or given up", () => {
        expect(/^export const maxDuration = (\d+)$/m.exec(route())?.[1]).toBe("60")
    })

    it("gives up on the emails with time to answer before the route stops (found by Codex on PR 351)", () => {
        const service = readFileSync("lib/services/tax-update-email.service.ts", "utf8")
        const within = Number(/^export const TAX_EMAILS_WITHIN_MS = ([\d_]+)$/m.exec(service)?.[1].replace(/_/g, ""))
        const limit = Number(/^export const maxDuration = (\d+)$/m.exec(route())?.[1]) * 1000
        // Counted from the upload's start, and at least 10 seconds left to log what wasn't sent and answer.
        expect(within).toBeGreaterThan(0)
        expect(within).toBeLessThanOrEqual(limit - 10_000)
        const save = readFileSync("lib/services/tax-claim.service.ts", "utf8")
        expect(save).toMatch(/export async function saveTaxFile\([^\n]*, sendBy: number = Date\.now\(\) \+ TAX_EMAILS_WITHIN_MS\): Promise/)
        expect(save).toContain("sendTaxUpdateEmails(email, user, client.id, origin, sendBy)")
    })
})

describe("the migration", () => {
    const NAME = "20270116000000_tax_position_emailed_on"
    const sql = () => readFileSync(`prisma/migrations/${NAME}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")

    it("only adds the day the client was last emailed", () => {
        expect(sql().split(";").map(statement => statement.replace(/\s+/g, " ").trim()).filter(Boolean)).toEqual([
            `ALTER TABLE "ClientTaxPosition" ADD COLUMN "emailedOn" DATE`,
        ])
    })

    it("comes after the update email's switch", () => {
        const names = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort()
        expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20270115000000_company_tax_update_emails"))
    })

    it("is in the schema as the migration has it", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const from = schema.indexOf("model ClientTaxPosition {")
        const model = schema.slice(from, schema.indexOf("\n}", from))
        expect(model).toMatch(/\n  emailedOn\s+DateTime\?\s+@db\.Date\n/)
    })
})
