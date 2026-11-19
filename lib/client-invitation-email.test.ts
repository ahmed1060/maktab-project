import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { brandTokens } from "./brand-colour"
import { appOrigin, PRODUCTION_ORIGIN } from "./app-origin"
import { invitationEmail, type InvitationEmailFacts } from "./client-invitation-email"

/**
 * The invitation's email (CLIENT_PORTAL_PLAN.md §5.2, §12 step 6b-2;
 * DESIGN.md §5.5, The invitation's email; PR 325): its words in each
 * language, as agreed with the owner on the design canvas, who it's from,
 * and the address its link is to. Sending it on Add person and on Resend
 * invitation, against a real Postgres, is in
 * lib/client-invitation-email.db.test.ts.
 */

const TOKEN = "a".repeat(43)
const LINK = `https://nizmo.vercel.app/invitation#${TOKEN}`
const FACTS: InvitationEmailFacts = {
    language: "en",
    person: { name: "Mona Fouad", email: "mona@client.co" },
    office: "Al Amal Accounting",
    client: "Al Noor Trading",
    sender: { name: "Amal One", email: "amal@office.co" },
    link: LINK,
    privacy: "https://nizmo.vercel.app/privacy",
    resent: false,
    brand: null,
}
const email = (more: Partial<InvitationEmailFacts> = {}) => invitationEmail({ ...FACTS, ...more })

// Each name is kept whole in the plain text by marks that can't be seen
// (DESIGN.md §3.2); the lines are compared without them.
const ISOLATES = new RegExp(`[${String.fromCharCode(0x2068)}${String.fromCharCode(0x2069)}]`, "g")
const lines = (text: string) => text.replace(ISOLATES, "").split("\n")

describe("the invitation's email in English", () => {
    it("has its subject and every line as agreed", () => {
        const sent = email()
        expect(sent.subject).toBe("Invitation to the tax position of Al Noor Trading")
        expect(lines(sent.text)).toEqual([
            "Hello Mona Fouad,",
            "",
            "Al Amal Accounting invited you to the tax position of Al Noor Trading on Nizmo.",
            "",
            "To set your password, open this link:",
            LINK,
            "",
            "This link works once, for 72 hours. Once your password is set, you sign in with mona@client.co.",
            "",
            "If you weren't expecting this, you can ignore this email. The account can't be used until a password is set.",
            "",
            "For any questions, please contact Amal One at Al Amal Accounting.",
            "",
            "Sent through Nizmo on behalf of Al Amal Accounting.",
            "Privacy policy: https://nizmo.vercel.app/privacy",
        ])
    })

    it("has the same words in its HTML, with the button and the link written out to copy", () => {
        const { html } = email()
        for (const words of [
            "Hello <bdi>Mona Fouad</bdi>,",
            "<bdi>Al Amal Accounting</bdi> invited you to the tax position of <bdi>Al Noor Trading</bdi> on Nizmo.",
            "To set your password, open this link:",
            ">Set password</a>",
            "If the button doesn't open, copy this link into your browser:",
            "This link works once, for 72 hours. Once your password is set, you sign in with <bdi dir=\"ltr\">mona@client.co</bdi>.",
            "If you weren't expecting this, you can ignore this email. The account can't be used until a password is set.",
            "For any questions, please contact <bdi>Amal One</bdi> at <bdi>Al Amal Accounting</bdi>.",
            "Sent through Nizmo on behalf of <bdi>Al Amal Accounting</bdi>.",
            ">Privacy policy</a>",
        ]) expect(html, words).toContain(words.replace(/'/g, "&#39;"))
        expect(html).toMatch(/<html lang="en" dir="ltr">/)
    })
})

describe("the invitation's email in Arabic", () => {
    const arabic = (more: Partial<InvitationEmailFacts> = {}) => email({ language: "ar", person: { name: "منى فؤاد", email: "mona@client.co" }, office: "مكتب الأمل", client: "شركة النور", sender: { name: "أمل علي", email: "amal@office.co" }, ...more })

    it("has its subject and every line as agreed, with the hours in Arabic digits", () => {
        const sent = arabic()
        expect(sent.subject).toBe("دعوة لمتابعة الموقف الضريبي لـشركة النور")
        expect(lines(sent.text)).toEqual([
            "مرحبًا منى فؤاد،",
            "",
            "دعوة من مكتب الأمل لمتابعة الموقف الضريبي لـشركة النور على Nizmo.",
            "",
            "لتعيين كلمة المرور، يُرجى فتح الرابط التالي:",
            LINK,
            "",
            "الرابط صالح لمرة واحدة، لمدة ٧٢ ساعة. وبعد تعيين كلمة المرور، يكون تسجيل الدخول بالبريد الإلكتروني mona@client.co.",
            "",
            "إذا لم تكن هذه الدعوة متوقعة، يمكن تجاهل هذه الرسالة، ولا يمكن استخدام الحساب قبل تعيين كلمة المرور.",
            "",
            "للاستفسار، يُرجى التواصل مع أمل علي من مكتب الأمل.",
            "",
            "أُرسلت هذه الرسالة عبر Nizmo نيابةً عن مكتب الأمل.",
            "سياسة الخصوصية: https://nizmo.vercel.app/privacy",
        ])
    })

    it("has the same words in its HTML, right to left, with the link and the email left to right", () => {
        const { html } = arabic()
        for (const words of [
            "مرحبًا <bdi>منى فؤاد</bdi>،",
            "دعوة من <bdi>مكتب الأمل</bdi> لمتابعة الموقف الضريبي لـ<bdi>شركة النور</bdi> على Nizmo.",
            ">تعيين كلمة المرور</a>",
            "إذا لم يفتح الزر، يمكن نسخ هذا الرابط في المتصفح:",
            "الرابط صالح لمرة واحدة، لمدة ٧٢ ساعة. وبعد تعيين كلمة المرور، يكون تسجيل الدخول بالبريد الإلكتروني <bdi dir=\"ltr\">mona@client.co</bdi>.",
            "للاستفسار، يُرجى التواصل مع <bdi>أمل علي</bdi> من <bdi>مكتب الأمل</bdi>.",
            "أُرسلت هذه الرسالة عبر Nizmo نيابةً عن <bdi>مكتب الأمل</bdi>.",
            ">سياسة الخصوصية</a>",
        ]) expect(html, words).toContain(words)
        expect(html).toMatch(/<html lang="ar" dir="rtl">/)
        expect(html).toMatch(new RegExp(`<a href="${LINK}" dir="ltr"`))
    })

    it("is in Arabic alone: no English but Nizmo's name, the link, the email and what the office named", () => {
        const { text, subject } = arabic()
        const left = (subject + text).replace(ISOLATES, "").replace(/https:\/\/\S+/g, "").replace("mona@client.co", "").replace(/Nizmo/g, "")
        expect(left).not.toMatch(/[A-Za-z]/)
    })

    it("speaks to the person without a masculine command", () => {
        const { text } = arabic({ resent: true })
        // تجاهل is left out: it's the verbal noun the email says too.
        for (const masculine of [/(^|\s)افتح/, /(^|\s)انسخ/, /(^|\s)تواصل مع/, /(^|\s)اضغط/, /(^|\s)اتبع/]) expect(text, String(masculine)).not.toMatch(masculine)
    })
})

describe("in either language", () => {
    it("says, sent again, that an earlier link no longer works, and not the first time", () => {
        expect(email().text).not.toContain("earlier")
        expect(lines(email({ resent: true }).text)).toContain("Any earlier invitation link no longer works.")
        expect(email({ resent: true }).html).toContain("Any earlier invitation link no longer works.")
        expect(email({ language: "ar" }).text).not.toContain("سابق")
        expect(lines(email({ language: "ar", resent: true }).text)).toContain("أي رابط دعوة سابق لم يعد صالحًا.")
    })

    it("is from the office, by its name, and a reply goes to whoever sent it", () => {
        const sent = email()
        expect(sent.fromName).toBe("Al Amal Accounting")
        expect(sent.replyTo).toEqual({ name: "Amal One", address: "amal@office.co" })
    })

    it("sent by a Super Admin, who isn't one of the office's people, has no reply address and names the office alone", () => {
        const sent = email({ sender: null })
        expect(sent.replyTo).toBeNull()
        expect(lines(sent.text)).toContain("For any questions, please contact Al Amal Accounting.")
        expect(sent.html).toContain("For any questions, please contact <bdi>Al Amal Accounting</bdi>.")
        expect(lines(email({ language: "ar", office: "مكتب الأمل", sender: null }).text)).toContain("للاستفسار، يُرجى التواصل مع مكتب الأمل.")
    })

    it("keeps every name as text, never as part of the email's code", () => {
        const sent = email({ office: `<img src=x onerror="alert(1)">&Co`, client: "A & B <Trading>", person: { name: "Mona \"M\" O'Neil", email: "mona@client.co" } })
        expect(sent.html).not.toContain("<img")
        expect(sent.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;Co")
        expect(sent.html).toContain("A &amp; B &lt;Trading&gt;")
        expect(sent.html).toContain("Mona &quot;M&quot; O&#39;Neil")
        // The plain text is text: kept as it's named.
        expect(sent.text).toContain("A & B <Trading>")
    })

    it("keeps a name with a line break in it on one line, in the subject and the sender's name too", () => {
        const sent = email({ office: "Al Amal\r\nBcc: someone@else.co", client: "Al Noor\nTrading" })
        expect(sent.subject).toBe("Invitation to the tax position of Al Noor Trading")
        expect(sent.fromName).toBe("Al Amal Bcc: someone@else.co")
        expect(sent.subject + sent.fromName).not.toMatch(/[\r\n]/)
    })

    it("carries its link on the button and written out, and the privacy policy's", () => {
        const { html } = email()
        expect(html.match(new RegExp(`href="${LINK}"`, "g"))).toHaveLength(2)
        expect(html).toContain('href="https://nizmo.vercel.app/privacy"')
    })

    it("draws the button, the office's initial and the links in the default brand colour, as the Set password page", () => {
        for (const brand of [null, "#0f766e"]) {
            const { light } = brandTokens(brand)
            const { html } = email({ brand })
            expect(html).toContain(`background:${light["--brand"]}`)
            expect(html).toContain(`color:${light["--on-brand"]}`)
            expect(html).toContain(`color:${light["--brand-text"]}`)
        }
        // The office's initial, which a reader of the page needn't hear.
        expect(email().html).toMatch(/<td aria-hidden="true"[^>]*>A<\/td>/)
        expect(email({ office: "مكتب الأمل" }).html).toMatch(/<td aria-hidden="true"[^>]*>م<\/td>/)
    })

    it("has a button at least 48px tall, and is at most 600px wide", () => {
        const { html } = email()
        const button = html.slice(html.indexOf(`<a href="${LINK}"`), html.indexOf(">Set password</a>"))
        const [, top, bottom] = /padding:(\d+)px \d+px (\d+)px/.exec(button) ?? []
        const [, line] = /line-height:(\d+)px/.exec(button) ?? []
        expect(Number(top) + Number(line) + Number(bottom)).toBeGreaterThanOrEqual(48)
        expect(html).toContain("max-width:600px")
    })
})

describe("the link's address", () => {
    it("is Nizmo's own in production, whatever the request says", () => {
        expect(PRODUCTION_ORIGIN).toBe("https://nizmo.vercel.app")
        for (const url of ["https://nizmo.vercel.app/api/client-accounts", "https://evil.example/api/client-accounts", "http://localhost:3000/x"]) {
            expect(appOrigin(url, { VERCEL_ENV: "production", VERCEL_URL: "maktab-project-abc-shsd.vercel.app" }), url).toBe(PRODUCTION_ORIGIN)
        }
    })

    it("is a preview's own on a preview", () => {
        expect(appOrigin("https://evil.example/x", { VERCEL_ENV: "preview", VERCEL_URL: "maktab-project-abc-shsd.vercel.app" })).toBe("https://maktab-project-abc-shsd.vercel.app")
        // Anything that isn't a preview's address is never a link's.
        for (const VERCEL_URL of ["evil.example", "evil.example/x.vercel.app", "", undefined]) {
            expect(appOrigin("https://evil.example/x", { VERCEL_ENV: "preview", VERCEL_URL }), String(VERCEL_URL)).toBe(PRODUCTION_ORIGIN)
        }
    })

    it("is the computer's own only where Nizmo runs on it, and Nizmo's anywhere else", () => {
        expect(appOrigin("http://localhost:3104/api/client-accounts", {})).toBe("http://localhost:3104")
        expect(appOrigin("http://127.0.0.1:3000/api/client-accounts", {})).toBe("http://127.0.0.1:3000")
        for (const url of ["https://evil.example/api/client-accounts", "http://localhost.evil.example/x", "not an address", ""]) {
            expect(appOrigin(url, {}), url).toBe(PRODUCTION_ORIGIN)
        }
    })
})

describe("the routes that send it", () => {
    const add = () => readFileSync("app/api/client-accounts/route.ts", "utf8")
    const resend = () => readFileSync("app/api/client-accounts/[id]/invitation/route.ts", "utf8")

    it("give the link Nizmo's own address", () => {
        expect(add()).toContain("appOrigin(req.url)")
        expect(resend()).toContain("appOrigin(req.url)")
    })

    it("send an invitation again only with the step-up confirmation, up to 5 times an hour for each person", () => {
        const source = resend()
        expect(source).toMatch(/export const POST = withStandardHandler\(/)
        expect(source).toContain('{ permission: "client_accounts.manage" }')
        const service = source.indexOf("await resendClientInvitation(")
        expect(source.indexOf('await assertStepUp(session, "client_accounts.manage")')).toBeGreaterThan(0)
        expect(source.indexOf('await assertStepUp(session, "client_accounts.manage")')).toBeLessThan(service)
        expect(source).toContain("RateLimiter.getLimitData(`invitation-resend:${params.id}`, 5, 60 * 60 * 1000)")
        expect(source.indexOf("getLimitData")).toBeLessThan(service)
        expect(source).toContain("resetHeldBack(resetAt)")
    })
})

describe("the migration", () => {
    const sql = () => readFileSync("prisma/migrations/20270108000000_client_account_language/migration.sql", "utf8")

    it("only adds: the language each account keeps, Arabic for the ones there already, and only Arabic or English", () => {
        expect(sql().split("\n").filter(line => /^[A-Z]/.test(line))).toEqual([
            `ALTER TABLE "ClientAccount" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'ar';`,
            `ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_language_known" CHECK ("language" IN ('ar', 'en'));`,
        ])
    })

    it("is the schema's", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const model = schema.slice(schema.indexOf("model ClientAccount {"))
        expect(model.slice(0, model.indexOf("\n}"))).toMatch(/\n  language\s+String\s+@default\("ar"\)/)
    })
})

describe("the page that sets the password", () => {
    it("opens in the language the person was invited in", () => {
        const page = readFileSync("app/(auth)/invitation/page.tsx", "utf8")
        expect(page).toContain("setLanguage(invited.language)")
        // Once for each link read, from the page as it's drawn then: the
        // open() an earlier link's hashchange calls has the language the
        // page first opened in. And not while a switch is under way, which
        // takes no other (found by this PR's browser flow).
        expect(page).toContain("if (!invited || isChangingLocale || languageFor.current === invited) return")
        expect(page).toContain("}, [invited, isChangingLocale])")
    })
})
