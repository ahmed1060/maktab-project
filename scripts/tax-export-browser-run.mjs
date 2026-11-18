// Tries the tax portal's export button in a browser (CLIENT_PORTAL_PLAN.md §10, §15, PR 318).
//
// The button runs on another site's page, so the tests that run on every push can't try what it
// does there. This presses its bookmark in Chromium, on a page laid out like the portal's that
// holds made-up claims (lib/tax-export-fixtures/portal.html), and checks what §15 lists. When every
// check passes, it keeps the files the button saved, and the fingerprint of the button's code, in
// lib/tax-export-fixtures. lib/tax-export-button.test.ts reads those files with Nizmo's reader on
// every push, and fails where the code is no longer what was tried here.
//
// After any change to lib/tax-export-button.ts:  node scripts/tax-export-browser-run.mjs
//
// It needs Playwright and its Chromium, which the app doesn't use: a copy installed for all
// projects is found. Where a check fails, nothing is kept.

import { execFileSync, execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURES = path.join(ROOT, "lib", "tax-export-fixtures")
const require = createRequire(import.meta.url)

/** Playwright: the project's if it has one, or else the copy installed for all projects. */
function playwright() {
    const places = [
        () => require("playwright"),
        () => createRequire(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "from.js"))("playwright"),
    ]
    for (const find of places) {
        try {
            return find()
        } catch {
            // The next place.
        }
    }
    console.error("This needs Playwright and its Chromium: npm install -g playwright, then npx playwright install chromium.")
    process.exit(2)
}

// The button's code and its bookmark, as the app has them.
const ASK = 'import { TAX_EXPORT_CODE, taxExportBookmark } from "./lib/tax-export-button"; process.stdout.write(JSON.stringify({ code: TAX_EXPORT_CODE, bookmark: taxExportBookmark() }))'
const { code, bookmark } = JSON.parse(execFileSync(process.execPath, [require.resolve("tsx/cli"), "-e", ASK], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }))

// Half past midnight in Cairo on the 18th, when UTC's day is still the 17th: a file's name has Cairo's (§10).
const CLOCK = "2026-11-17T22:30:00.000Z"
const DAY = "2026-11-18"
const UTC_DAY = "2026-11-17"

const ALEF = "شركة ألف للتجارة"
const BAA = "شركة باء للتوريدات"
const JEEM = "شركة جيم للمقاولات"
const UNNAMED = "غير محدد"
const NUMBER = "رقم المطالبة"
const AMOUNT = "قيمة المطالبة"
const STATUS = "حالة المطالبة"
const STARTS = "بداية الفترة الضريبية"
const DUE = "آخر موعد للسداد قبل الغرامة"
const WAITING = "في انتظار السداد"
const PARTLY = "مسدد جزئياً"
const PAID = "مسدد"
const OLDER = "etaClaimsExport_v1"
/** Company Alef's claims as a file has them: each one's number and what's left of it. */
const EVERY = "000111000001=13723.26 000111000002=7029.42 000111000003=13195.5 000111000004=9.45 000111000005=500 111000000006=1250"
/** What's left of a claim paid in part, as the portal shows it: the original struck through, with what's left after it. */
const left = remaining => `<span><s>21,088.26</s></span><span>${remaining}</span>`

/** What's checked, by name. lib/tax-export-button.test.ts has the same list: a check taken out here fails there. */
const CHECKS = [
    "bookmark-runs",
    "one-page",
    "every-page",
    "count-matches",
    "numbers-as-text",
    "days-are-cairos",
    "pressed-twice",
    "download-at-once",
    "seen-again-takes-now",
    "drawn-again-gathers-again",
    "left-open-gathers-again",
    "download-waits-for-pages",
    "page-never-comes",
    "new-visit-starts-again",
    "nothing-kept",
    "filter-first",
    "filter-changed",
    "partly-paid",
    "changed-a-moment-ago",
    "same-count-filter",
    "same-count-filter-pages",
    "by-hand-never-saved",
    "count-not-the-tables",
    "short-of-the-count",
    "other-company-same-tab",
    "older-copy-removed",
    "older-copy-replaced",
    "clear",
    "no-company",
    "no-table",
    "file-name-cairo-day",
    "sends-nothing",
]
const failed = new Set()
const tried = new Set()
function check(name, what, ok, found = "") {
    if (!CHECKS.includes(name)) throw new Error(`no such check: ${name}`)
    tried.add(name)
    if (!ok) failed.add(name)
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${what}${ok || found === "" ? "" : `\n      found: ${found}`}`)
}

const sha256 = data => createHash("sha256").update(data).digest("hex")
/** A text file's fingerprint, whichever line ends it was checked out with. */
const print = text => sha256(text.replace(/\r\n/g, "\n"))
const temp = mkdtempSync(path.join(tmpdir(), "tax-export-"))

const { chromium } = playwright()
const browser = await chromium.launch()
const context = await browser.newContext({ acceptDownloads: true })
await context.clock.install({ time: new Date(CLOCK) })
// The name the button gives each file it saves: headless Chromium doesn't pass on one that isn't in Latin letters.
// And the rows it holds at that moment, which are the file's: each claim's number and what's left of it.
await context.addInitScript(() => {
    window.__savedAs = []
    window.__savedOf = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
            window.__savedAs.push(this.download)
            window.__savedOf.push(window.__etaX.state().rows.map(row => `${row.cells["رقم المطالبة"].v}=${row.cells["قيمة المطالبة"].v}`).join(" "))
        }
        return click.call(this)
    }
})
const page = await context.newPage()
const portal = readFileSync(path.join(FIXTURES, "portal.html"), "utf8")
await page.route("https://portal.test/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: portal }))
/** Everything the page asked for, from anywhere. */
const requested = []
page.on("request", request => requested.push(request.url()))
/** What the button asked or said in the browser's own boxes, each answered OK unless a check has it answered no. */
const said = []
let agreed = true
page.on("dialog", dialog => {
    said.push(dialog.message())
    void (agreed ? dialog.accept() : dialog.dismiss())
})

const open = query => page.goto(`https://portal.test/payments${query}`)
/** As a bookmark does: the page is sent to the javascript: address. */
async function press() {
    await page.evaluate(address => {
        location.href = address
    }, bookmark)
    await page.waitForSelector("#etax-panel", { state: "visible", timeout: 10000 })
}
const kept = () => page.evaluate(() => window.__etaX.state())
const numbers = async () => (await kept()).rows.map(row => row.cells["رقم المطالبة"].v).join(" ")
/** A claim's amount as the button holds it. */
const amountOf = async number => ((await kept()).rows.find(row => row.cells[NUMBER].v === number) || { cells: {} }).cells[AMOUNT]
/** How many times the portal was asked for a page. */
const turns = () => page.evaluate(() => window.turns)
/** What the browser keeps for the portal's site. */
const inBrowser = () => page.evaluate(() => Object.keys(localStorage))
/** Whether something comes to be so on the page, in a few seconds. */
const comes = (so, given) => page.waitForFunction(so, given, { timeout: 5000 }).then(() => true, () => false)
const company = () => page.inputValue("#etax-co")
const says = () => page.locator("#etax-info").innerText()
const total = shown => page.waitForFunction(text => document.getElementById("tot").textContent === text, `إجمالي النتائج: ${shown}`, { timeout: 10000 })
/** Whether the button comes to hold this many rows, done with the pages, and still does once what follows a change on the page has settled. */
async function holds(count) {
    const idle = () => page
        .waitForFunction(rows => window.__etaX && window.__etaX.state().rows.length === rows && !document.querySelector("#etax-all").disabled, count, { timeout: 30000 })
        .then(() => true, () => false)
    if (!(await idle())) return false
    await page.waitForTimeout(1500)
    return idle()
}
const gathered = async count => {
    const text = await says()
    return text.includes(`صفوف الشركة دي: ${count}`) && text.includes(`اتجمعت كل النتائج (${count})`)
}

/** The files the button saved, in the order they're kept. */
const saved = []
async function save(file) {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#etax-dl")])
    const to = path.join(temp, file)
    await download.saveAs(to)
    const { names, rows, utcDay } = await page.evaluate(() => ({ names: window.__savedAs, rows: window.__savedOf, utcDay: new Date().toISOString().slice(0, 10) }))
    return { file, savedAs: names[names.length - 1], held: rows[rows.length - 1], utcDay, bytes: readFileSync(to) }
}

try {
    // ---- One company, on one page.
    await open("?company=b")
    const start = await page.evaluate(() => Date.now())
    await page.waitForTimeout(400)
    if (!(new Date(start).toISOString().startsWith("2026-11-17T22:3") && (await page.evaluate(() => Date.now())) > start)) throw new Error("the browser's clock isn't the one set, or stands still")

    await press()
    check("bookmark-runs", "pressed, the bookmark's javascript: address runs the button: its panel comes up, with the company from the page's title", (await page.isVisible("#etax-panel")) && (await company()) === BAA, await company())
    const one = await holds(1)
    let state = await kept()
    check("one-page", "one company's one page is gathered as soon as it's pressed", one && state.rows.length === 1 && state.rows[0].company === BAA && (await numbers()) === "000222000009", JSON.stringify(state.rows.map(row => [row.company, row.cells[NUMBER].v])))
    check("count-matches", "its panel says all were gathered where the count is the portal's total (1)", await gathered(1), await says())
    saved.push(await save("one-page.xlsx"))
    check("nothing-kept", "nothing is kept in the browser once its rows are gathered and its file saved", (await inBrowser()).length === 0, (await inBrowser()).join(" "))

    // ---- Another company on a new visit, its claims on three pages.
    await open("?company=a")
    await press()
    const all = await holds(6)
    state = await kept()
    check("every-page", "every page is gathered by itself, in the portal's order", all && state.rows.every(row => row.company === ALEF) && (await numbers()) === "000111000001 000111000002 000111000003 000111000004 000111000005 111000000006", await numbers())
    check("count-matches", "and where the count is the total of three pages (6)", await gathered(6), await says())
    check("numbers-as-text", "every claim's number is kept as text, the one with no zero at its start too", state.rows.length === 6 && state.rows.every(row => row.cells[NUMBER].t === "s" && typeof row.cells[NUMBER].v === "string"), JSON.stringify(state.rows.map(row => row.cells[NUMBER])))
    const days = state.rows.map(row => `${row.cells[DUE].t}:${row.cells[DUE].v}`).join(" ")
    const periods = state.rows.map(row => `${row.cells[STARTS].t}:${row.cells[STARTS].v}`).join(" ")
    check("days-are-cairos", "a day is the one the page shows, which is Cairo's, and a dash is an empty cell", days === "d:2026-04-30 d:2026-04-30 d:2025-04-30 d:2025-12-15 d:2024-04-30 d:2026-01-31" && periods === "d:2025-01-01 d:2025-01-01 d:2024-01-01 s: d:2023-01-01 d:2025-12-01", `${days} | ${periods}`)

    await page.evaluate(() => { window.__etaX.pressedBefore = true })
    await press()
    const twice = await holds(6)
    const same = await page.evaluate(() => window.__etaX.pressedBefore === true && document.querySelectorAll("#etax-panel").length === 1)
    check("pressed-twice", "pressed again, the copy that's up gathers again, and no row is there twice", twice && same && new Set((await numbers()).split(" ")).size === 6, `${await numbers()} | the same copy: ${same}`)

    // ---- Download, with every page gathered a moment ago and nothing drawn on the page since.
    let asked = await turns()
    const whole = await save("every-page.xlsx")
    saved.push(whole)
    check("download-at-once", "Download saves at once what was gathered whole a moment ago: no page is asked for again", (await turns()) === asked && whole.held === EVERY, `pages asked for: ${(await turns()) - asked} | ${whole.held}`)
    const twin = await save("every-page-again.xlsx")
    check("download-at-once", "and again, as saving a file draws nothing on the portal's page", (await turns()) === asked && twin.bytes.equals(whole.bytes), `pages asked for: ${(await turns()) - asked}`)

    // ---- The portal shows another amount for a claim on the screen.
    await page.evaluate(() => window.leaves("111000000006", "900.00", true))
    const now = await comes(number => { const row = window.__etaX.state().rows.find(found => found.cells["رقم المطالبة"].v === number); return !!row && row.cells["قيمة المطالبة"].v === 900 }, "111000000006")
    check("seen-again-takes-now", "a claim seen again takes the amount the portal shows now, and isn't there twice", now && (await numbers()) === "000111000001 000111000002 000111000003 000111000004 000111000005 111000000006", `${JSON.stringify(await amountOf("111000000006"))} | ${await numbers()}`)

    // ---- And for one on another page: the portal drew its table again, so Download gathers every page again first.
    await page.evaluate(cell => window.leaves("000111000001", cell, false), left("5,000.00"))
    asked = await turns()
    const again = await save("gathered-again.xlsx")
    saved.push(again)
    let first = await amountOf("000111000001")
    check("drawn-again-gathers-again", "the portal drew its table again since: Download gathers every page again first, and its file has what the portal shows now", (await turns()) - asked === 3 && again.held === "000111000001=5000 000111000002=7029.42 000111000003=13195.5 000111000004=9.45 000111000005=500 111000000006=900" && !!first && first.orig === 21088.26, `pages asked for: ${(await turns()) - asked} | ${again.held} | ${JSON.stringify(first)}`)

    // ---- The page left open: a claim is paid elsewhere, and nothing is drawn.
    await page.evaluate(() => window.leaves("000111000002", "6,000.00", false))
    await page.clock.fastForward(6 * 60 * 1000)
    asked = await turns()
    const idle = await save("left-open.xlsx")
    check("left-open-gathers-again", "the page left open for more than five minutes: Download gathers every page again first", (await turns()) - asked === 3 && idle.held === "000111000001=5000 000111000002=6000 000111000003=13195.5 000111000004=9.45 000111000005=500 111000000006=900", `pages asked for: ${(await turns()) - asked} | ${idle.held}`)

    // ---- Another company opened in the same tab: the portal changes the page without loading it again.
    await page.evaluate(() => window.openCompany("b"))
    const moved = await holds(1)
    state = await kept()
    const tab = await save("same-tab.xlsx")
    check("other-company-same-tab", "another company opened in the same tab: it starts again by itself, and its file is that company's own", moved && state.rows.length === 1 && state.rows[0].company === BAA && (await company()) === BAA && (await gathered(1)) && tab.savedAs === saved[0].savedAs && tab.bytes.equals(saved[0].bytes), `${JSON.stringify(state.rows.map(row => row.company))} ${tab.savedAs}`)

    // ---- Download pressed while the pages are still being gathered.
    await open("?company=a")
    await press()
    const early = await save("early.xlsx")
    check("download-waits-for-pages", "Download pressed while the pages are being gathered waits for the last of them: its file has every page", early.held === EVERY && early.bytes.equals(whole.bytes) && (await holds(6)), early.held)
    // A claim is paid elsewhere, Gather all pages is pressed, and Download at once after it, with the first page not yet back.
    await page.evaluate(() => window.leaves("000111000003", "10,000.00", false))
    await page.click("#etax-all")
    const started = await save("started.xlsx")
    check("download-waits-for-pages", "and pressed as a gathering starts, it waits for that one: its file has what that gathering finds", started.held === EVERY.replace("=13195.5 ", "=10000 ") && (await holds(6)), started.held)
    // Pressed twice while it gathers: one file.
    await open("?company=a")
    await press()
    let files = 0
    const count = () => { files++ }
    page.on("download", count)
    await page.dblclick("#etax-dl")
    const both = await holds(6)
    await page.waitForTimeout(1500)
    page.off("download", count)
    check("download-waits-for-pages", "and pressed twice while it gathers, it saves one file", both && files === 1, `files: ${files}`)

    // ---- A later day, with as many claims as before: what was left of one is less.
    await open("?company=a&later=1")
    await press()
    const later = await holds(6)
    first = await amountOf("000111000001")
    check("new-visit-starts-again", "a new visit starts from nothing: a claim has what the portal shows now, not what it showed on the last visit", later && !!first && first.v === 5000 && first.orig === 21088.26, JSON.stringify(first))

    // ---- A page that never comes.
    await open("?company=a&stuck=2")
    await press()
    await page.waitForTimeout(600)
    await page.clock.fastForward(21000)
    const stuck = await comes(() => document.querySelector("#etax-info").innerText.includes("الصفحة 2 ماحمّلتش"))
    said.length = 0
    let file = false
    let none = page.waitForEvent("download", { timeout: 4000 }).then(() => { file = true }, () => {})
    await page.click("#etax-dl")
    await page.waitForTimeout(600)
    await page.clock.fastForward(21000)
    await none
    check("page-never-comes", "a page that never comes: its panel says so, and Download gathers again and saves no file with pages missing", stuck && !file && said.length === 0 && (await says()).includes("الصفحة 2 ماحمّلتش"), `${await says()} | ${said.join(" | ")} | file: ${file}`)

    // ---- A filter chosen before pressing.
    await open("?company=a")
    await page.selectOption("#f", WAITING)
    await total(4)
    await press()
    const waiting = await holds(4)
    state = await kept()
    check("filter-first", "a filter chosen before pressing: the file holds the filtered claims alone, from every page, the count matching the filtered total", waiting && (await numbers()) === "000111000002 000111000003 000111000004 111000000006" && state.rows.every(row => row.cells[STATUS].v === WAITING) && (await gathered(4)), `${await numbers()} | ${await says()}`)
    saved.push(await save("filter-waiting.xlsx"))

    // ---- A later day, with the same filter and as many claims: one of them paid since, and a new one waiting.
    await open("?company=a&later=2")
    await page.selectOption("#f", WAITING)
    await total(4)
    await press()
    const others = await holds(4)
    check("new-visit-starts-again", "and it holds the claims the portal shows now: the one paid since isn't among them, though as many wait as before", others && (await numbers()) === "000111000003 000111000004 111000000006 000111000007", await numbers())

    // ---- The filter changed on the same company.
    await open("?company=a")
    await page.selectOption("#f", WAITING)
    await total(4)
    await press()
    await holds(4)
    await page.selectOption("#f", PARTLY)
    const partly = await holds(1)
    state = await kept()
    check("filter-changed", "the filter changed on the same company: it starts again by itself, with the new filter's claims alone", partly && (await numbers()) === "000111000001" && (await gathered(1)), `${await numbers()} | ${await says()}`)
    const amount = state.rows[0] && state.rows[0].cells[AMOUNT]
    check("partly-paid", "a claim paid in part: what's left of it, with the original it was struck from", !!amount && amount.t === "n" && amount.v === 13723.26 && amount.orig === 21088.26, JSON.stringify(amount))
    saved.push(await save("filter-partly-paid.xlsx"))

    // ---- Changed again, to a filter that shows as many claims, and Download pressed before the button has read the page again.
    await page.selectOption("#f", PAID)
    const drawn = await comes(() => document.getElementById("tb").textContent.includes("000111000005"))
    const quick = await save("quick.xlsx")
    check("changed-a-moment-ago", "Download pressed a moment after the portal drew another filter's claim: its file has that claim, read from the screen then", drawn && quick.held === "000111000005=500", quick.held)
    const paid = await holds(1)
    state = await kept()
    check("same-count-filter", "the filter changed to one that shows as many claims: it starts again all the same, with the new filter's claim alone", paid && (await numbers()) === "000111000005" && state.rows[0].cells[STATUS].v === PAID && (await gathered(1)), `${await numbers()} | ${await says()}`)

    // ---- The same on more than one page.
    await open("?company=c")
    await page.selectOption("#f", PAID)
    await total(3)
    await press()
    const three = (await holds(3)) && (await numbers()) === "000444000002 000444000004 000444000006"
    await page.selectOption("#f", WAITING)
    const shown = await holds(2)
    check("same-count-filter-pages", "on more than one page: it starts again with the new filter's page on the screen, and its panel says how many are missing", three && shown && (await numbers()) === "000444000001 000444000003" && (await says()).includes("ناقص 1 من 3"), `${await numbers()} | ${await says()}`)
    const pages = await save("same-count-pages.xlsx")
    saved.push(pages)
    state = await kept()
    check("same-count-filter-pages", "and Download gathers every page of it first: its file has the new filter's claims alone", (await numbers()) === "000444000001 000444000003 000444000005" && state.rows.every(row => row.cells[STATUS].v === WAITING && row.company === JEEM) && (await gathered(3)), `${await numbers()} | ${await says()}`)

    // ---- Rows of two filters gathered by hand, their count the portal's total.
    await open("?company=c")
    await page.selectOption("#f", PAID)
    await total(3)
    await press()
    await holds(3)
    await page.click("#etax-clr")
    await holds(1)
    await page.selectOption("#f", WAITING)
    const mixed = await holds(3)
    state = await kept()
    const looked = mixed && (await gathered(3)) && state.rows.map(row => row.cells[STATUS].v).join(" ") === `${PAID} ${WAITING} ${WAITING}`
    const hand = await save("by-hand.xlsx")
    check("by-hand-never-saved", "rows of two filters gathered by hand, their count the portal's total: Download gathers every page again, and its file has the filter's claims alone", looked && hand.bytes.equals(pages.bytes) && (await numbers()) === "000444000001 000444000003 000444000005", `two filters' rows held, the count looking right: ${looked} | ${await numbers()}`)

    // ---- A count on the page that isn't the table's.
    await open("?company=a&total=1")
    await press()
    const counted = await holds(6)
    const warned = (await says()).includes("أكتر من إجمالي النتائج (1)")
    said.length = 0
    const miscounted = await save("miscounted.xlsx")
    check("count-not-the-tables", "a count that can't be the table's, with more rows on one page than it: no row is let go for it, its panel warns, and Download asks before it saves every page", counted && warned && said.join(" | ") === "الصفوف (6) أكتر من إجمالي النتائج (1). تنزيل الملف برضه؟" && miscounted.held === EVERY && miscounted.bytes.equals(whole.bytes), `${miscounted.held} | ${await says()} | ${said.join(" | ")}`)

    // ---- Fewer rows than the portal counts, even gathered again.
    await open("?company=a&total=7")
    await press()
    const short = (await holds(6)) && (await says()).includes("ناقص 1 من 7")
    said.length = 0
    agreed = false
    file = false
    none = page.waitForEvent("download", { timeout: 6000 }).then(() => { file = true }, () => {})
    await page.click("#etax-dl")
    await none
    agreed = true
    const asks = "ناقص 1 من 7 نتيجة. تنزيل الملف برضه؟"
    const refused = !file && said.join(" | ") === asks
    said.length = 0
    const anyway = await save("short.xlsx")
    check("short-of-the-count", "fewer rows than the portal counts, even gathered again: Download asks first, saves nothing where the answer is no, and saves them where it's yes", short && refused && said.join(" | ") === asks && anyway.held === EVERY, `asked, and no file on a no: ${refused} | ${said.join(" | ")} | ${anyway.held}`)

    // ---- What an older copy kept in the browser: a claim's number as a number.
    await open("?company=a")
    await page.evaluate(([key, alef, number]) => {
        localStorage.setItem(key, JSON.stringify({ headers: [number], rows: [{ key: `${alef}|111000000006`, company: alef, cells: { [number]: { t: "n", v: 111000000006 } } }] }))
    }, [OLDER, ALEF, NUMBER])
    await press()
    const fresh = await holds(6)
    state = await kept()
    check("older-copy-removed", "what an older copy kept is removed from the browser, and none of it is read", fresh && (await inBrowser()).length === 0 && state.rows.every(row => row.cells[NUMBER].t === "s"), (await inBrowser()).join(" "))

    // ---- Clear.
    said.length = 0
    await page.click("#etax-clr")
    const cleared = await holds(2)
    check("clear", "Clear asks first, then keeps what's on the screen alone, and its panel says how many are missing", said.join(" | ") === "مسح كل الصفوف المتجمعة؟" && cleared && (await says()).includes("ناقص 4 من 6"), `${said.join(" | ")} | ${await says()}`)
    await page.click("#etax-all")
    check("clear", "and Gather all pages gathers them again", (await holds(6)) && (await gathered(6)), await says())

    // ---- An older copy already up on the page: it kept a claim's number as a number, and knows no way to be stopped.
    await open("?company=a")
    await page.evaluate(() => {
        const panel = document.createElement("div")
        panel.id = "etax-panel"
        panel.textContent = "an older copy"
        document.body.appendChild(panel)
        window.__older = { gathered: 0 }
        window.__etaX = { collect() { window.__older.gathered++ }, grabAll() { window.__older.gathered++ }, state() { return { headers: [], rows: [] } } }
    })
    await page.evaluate(address => { location.href = address }, bookmark)
    const took = (await comes(() => !!window.__etaX && typeof window.__etaX.v === "string")) && (await holds(6))
    state = await kept()
    let older = await page.evaluate(() => ({ gathered: window.__older.gathered, panels: document.querySelectorAll("#etax-panel").length, own: !!document.querySelector("#etax-panel #etax-dl") }))
    check("older-copy-replaced", "pressed where an older copy is up: this one takes its place, the older one's panel goes and it isn't asked to gather, and numbers are text", took && older.gathered === 0 && older.panels === 1 && older.own && state.rows.length === 6 && state.rows.every(row => row.cells[NUMBER].t === "s"), JSON.stringify(older))

    // ---- Another copy that can be stopped, as this one can.
    await page.evaluate(() => {
        const mine = window.__etaX
        window.__older = { stopped: 0, gathered: 0 }
        window.__etaX = { v: "another copy", stop() { window.__older.stopped++; mine.stop() }, collect() { window.__older.gathered++ }, grabAll() { window.__older.gathered++ }, state: mine.state }
    })
    await page.evaluate(address => { location.href = address }, bookmark)
    const next = (await comes(() => !!window.__etaX && typeof window.__etaX.v === "string" && window.__etaX.v !== "another copy")) && (await holds(6))
    older = await page.evaluate(() => ({ ...window.__older, panels: document.querySelectorAll("#etax-panel").length }))
    check("older-copy-replaced", "and another copy that can be stopped is stopped first: its panel goes, and it gathers no more", next && older.stopped === 1 && older.gathered === 0 && older.panels === 1, JSON.stringify(older))

    // ---- Stopped while it gathers its pages.
    await open("?company=a")
    await press()
    await page.evaluate(() => window.__etaX.stop())
    asked = await turns()
    await page.waitForTimeout(1500)
    older = await page.evaluate(() => ({ panels: document.querySelectorAll("#etax-panel").length, rows: window.__etaX.state().rows.length }))
    check("older-copy-replaced", "and one stopped while it gathers its pages asks the portal for no more of them", asked === 1 && (await turns()) === 1 && older.panels === 0, `pages asked for: ${await turns()} | ${JSON.stringify(older)}`)

    // ---- A page that names no company.
    await open("?company=none")
    await press()
    const unnamed = await holds(1)
    state = await kept()
    check("no-company", "a page that names no company: its rows have the word for none, which its file's name has too", unnamed && state.rows[0].company === UNNAMED && (await company()) === "", JSON.stringify(state.rows.map(row => row.company)))
    saved.push(await save("no-company.xlsx"))

    // ---- A page with no table, and nothing gathered.
    await open("?table=none")
    await press()
    await page.waitForTimeout(800)
    said.length = 0
    file = false
    none = page.waitForEvent("download", { timeout: 2000 }).then(() => { file = true }, () => {})
    await page.click("#etax-dl")
    await none
    check("no-table", "a page with no table: its panel says so, and Download says there's nothing and saves no file", (await says()).includes("مش لاقي جدول في الصفحة دي") && said.join(" | ") === "مفيش صفوف متجمعة" && !file, `${await says()} | ${said.join(" | ")} | file: ${file}`)
    check("nothing-kept", "and nothing is in the browser at the end of it all", (await inBrowser()).length === 0, (await inBrowser()).join(" "))

    // ---- Every file's name, and what left the page.
    const names = saved.map(({ file: kind, savedAs }) => `${kind}=${savedAs}`).join(" | ")
    const expected = [["one-page.xlsx", BAA], ["every-page.xlsx", ALEF], ["gathered-again.xlsx", ALEF], ["filter-waiting.xlsx", ALEF], ["filter-partly-paid.xlsx", ALEF], ["same-count-pages.xlsx", JEEM], ["no-company.xlsx", UNNAMED]].map(([kind, name]) => `${kind}=مطالبات - ${name} - ${DAY}.xlsx`).join(" | ")
    check("file-name-cairo-day", "each file is named for its company and Cairo's day, when UTC's is still the day before", names === expected && saved.every(({ utcDay }) => utcDay === UTC_DAY), `${names} | UTC: ${saved.map(({ utcDay }) => utcDay).join(" ")}`)

    const elsewhere = requested.filter(address => !address.startsWith("https://portal.test/") && !address.startsWith("blob:https://portal.test/"))
    check("sends-nothing", "nothing left the page: the page's own loads and the files it saved are all that was asked for", requested.length > 0 && elsewhere.length === 0, elsewhere.join(" "))
} catch (error) {
    console.error(error)
    failed.add("the run itself")
}

const version = browser.version()
await browser.close()

const untried = CHECKS.filter(name => !tried.has(name))
if (failed.size || untried.length) {
    rmSync(temp, { recursive: true, force: true })
    console.error(`\nNot kept. Failed: ${[...failed].join(", ") || "none"}. Not tried: ${untried.join(", ") || "none"}.`)
    process.exit(1)
}

for (const { file, bytes } of saved) writeFileSync(path.join(FIXTURES, file), bytes)
rmSync(temp, { recursive: true, force: true })
const run = {
    code: sha256(code),
    // The page it was tried on, and this run: a change to either is tried again too.
    page: print(portal),
    script: print(readFileSync(fileURLToPath(import.meta.url), "utf8")),
    browser: `Chromium ${version}`,
    clock: CLOCK,
    day: DAY,
    checks: CHECKS,
    files: saved.map(({ file, savedAs, bytes }) => ({ file, savedAs, sha256: sha256(bytes) })),
}
writeFileSync(path.join(FIXTURES, "run.json"), `${JSON.stringify(run, null, 4)}\n`)
console.log(`\nAll ${CHECKS.length} checks passed in Chromium ${version}. Kept in lib/tax-export-fixtures: run.json, ${saved.map(({ file }) => file).join(", ")}.`)
