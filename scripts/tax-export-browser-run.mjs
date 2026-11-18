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
const UNNAMED = "غير محدد"
const NUMBER = "رقم المطالبة"
const AMOUNT = "قيمة المطالبة"
const STATUS = "حالة المطالبة"
const STARTS = "بداية الفترة الضريبية"
const DUE = "آخر موعد للسداد قبل الغرامة"
const WAITING = "في انتظار السداد"
const PARTLY = "مسدد جزئياً"
const OLDER = "etaClaimsExport_v1"
const NOW = "etaClaimsExport_v2"

/** What's checked, by name. lib/tax-export-button.test.ts has the same list: a check taken out here fails there. */
const CHECKS = [
    "bookmark-runs",
    "one-page",
    "every-page",
    "count-matches",
    "numbers-as-text",
    "days-are-cairos",
    "pressed-twice",
    "filter-first",
    "filter-changed",
    "partly-paid",
    "same-filter-again",
    "other-filter-new-visit",
    "other-company-same-tab",
    "other-company-new-visit",
    "older-copy-removed",
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
await context.addInitScript(() => {
    window.__savedAs = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__savedAs.push(this.download)
        return click.call(this)
    }
})
const page = await context.newPage()
const portal = readFileSync(path.join(FIXTURES, "portal.html"), "utf8")
await page.route("https://portal.test/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: portal }))
/** Everything the page asked for, from anywhere. */
const asked = []
page.on("request", request => asked.push(request.url()))
/** What the button asked or said in the browser's own boxes, each answered OK. */
const said = []
page.on("dialog", dialog => {
    said.push(dialog.message())
    void dialog.accept()
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
    const { names, utcDay } = await page.evaluate(() => ({ names: window.__savedAs, utcDay: new Date().toISOString().slice(0, 10) }))
    return { file, savedAs: names[names.length - 1], utcDay, bytes: readFileSync(to) }
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

    // ---- Another company on a new visit, its claims on three pages.
    await open("?company=a")
    const last = await page.evaluate(key => JSON.parse(localStorage.getItem(key)) || { rows: [] }, NOW)
    await press()
    const all = await holds(6)
    state = await kept()
    check("other-company-new-visit", "another company on a new visit: what the browser kept of the last one goes by itself", last.rows.length === 1 && last.rows[0].company === BAA && all && state.rows.every(row => row.company === ALEF), JSON.stringify(state.rows.map(row => row.company)))
    check("every-page", "every page is gathered by itself, in the portal's order", all && (await numbers()) === "000111000001 000111000002 000111000003 000111000004 000111000005 111000000006", await numbers())
    check("count-matches", "and where the count is the total of three pages (6)", await gathered(6), await says())
    check("numbers-as-text", "every claim's number is kept as text, the one with no zero at its start too", state.rows.length === 6 && state.rows.every(row => row.cells[NUMBER].t === "s" && typeof row.cells[NUMBER].v === "string"), JSON.stringify(state.rows.map(row => row.cells[NUMBER])))
    const days = state.rows.map(row => `${row.cells[DUE].t}:${row.cells[DUE].v}`).join(" ")
    const periods = state.rows.map(row => `${row.cells[STARTS].t}:${row.cells[STARTS].v}`).join(" ")
    check("days-are-cairos", "a day is the one the page shows, which is Cairo's, and a dash is an empty cell", days === "d:2026-04-30 d:2026-04-30 d:2025-04-30 d:2025-12-15 d:2024-04-30 d:2026-01-31" && periods === "d:2025-01-01 d:2025-01-01 d:2024-01-01 s: d:2023-01-01 d:2025-12-01", `${days} | ${periods}`)

    await press()
    const twice = await holds(6)
    check("pressed-twice", "pressed again, it gathers again and no row is there twice", twice && new Set((await numbers()).split(" ")).size === 6, await numbers())
    saved.push(await save("every-page.xlsx"))

    // ---- Another company opened in the same tab: the portal changes the page without loading it again.
    await page.evaluate(() => window.openCompany("b"))
    const moved = await holds(1)
    state = await kept()
    const again = await save("same-tab.xlsx")
    check("other-company-same-tab", "another company opened in the same tab: it starts again by itself, and its file is that company's own", moved && state.rows.length === 1 && state.rows[0].company === BAA && (await company()) === BAA && (await gathered(1)) && again.savedAs === saved[0].savedAs && again.bytes.equals(saved[0].bytes), `${JSON.stringify(state.rows.map(row => row.company))} ${again.savedAs}`)

    // ---- A filter chosen before pressing.
    await open("?company=a")
    await page.selectOption("#f", WAITING)
    await total(4)
    await press()
    const waiting = await holds(4)
    state = await kept()
    check("filter-first", "a filter chosen before pressing: the file holds the filtered claims alone, from every page, the count matching the filtered total", waiting && (await numbers()) === "000111000002 000111000003 000111000004 111000000006" && state.rows.every(row => row.cells[STATUS].v === WAITING) && (await gathered(4)), `${await numbers()} | ${await says()}`)
    saved.push(await save("filter-waiting.xlsx"))

    // ---- The filter changed on the same company.
    await page.selectOption("#f", PARTLY)
    const partly = await holds(1)
    state = await kept()
    check("filter-changed", "the filter changed on the same company: it starts again by itself, with the new filter's claims alone", partly && (await numbers()) === "000111000001" && (await gathered(1)), `${await numbers()} | ${await says()}`)
    const amount = state.rows[0] && state.rows[0].cells[AMOUNT]
    check("partly-paid", "a claim paid in part: what's left of it, with the original it was struck from", !!amount && amount.t === "n" && amount.v === 13723.26 && amount.orig === 21088.26, JSON.stringify(amount))
    saved.push(await save("filter-partly-paid.xlsx"))

    // ---- New visits: with the same filter, then with another.
    await open("?company=a")
    await page.selectOption("#f", PARTLY)
    await total(1)
    await press()
    check("same-filter-again", "a new visit with the same filter keeps what was gathered, with no row twice", (await holds(1)) && (await numbers()) === "000111000001", await numbers())

    await open("?company=a")
    await press()
    check("other-filter-new-visit", "a new visit with another filter starts again, and gathers what's shown now", (await holds(6)) && (await numbers()).split(" ").length === 6, await numbers())

    // ---- What the copy before this one kept: a claim's number as a number.
    await open("?company=a")
    await page.evaluate(([key, alef, number]) => {
        localStorage.setItem(key, JSON.stringify({ headers: [number], rows: [{ key: `${alef}|111000000006`, company: alef, cells: { [number]: { t: "n", v: 111000000006 } } }] }))
    }, [OLDER, ALEF, NUMBER])
    await press()
    const fresh = await holds(6)
    state = await kept()
    const left = await page.evaluate(([older, now]) => ({ older: localStorage.getItem(older), now: (JSON.parse(localStorage.getItem(now)) || { rows: [] }).rows.length }), [OLDER, NOW])
    check("older-copy-removed", "what the copy before it kept is removed from the browser, and none of it is read", fresh && left.older === null && left.now === 6 && state.rows.every(row => row.cells[NUMBER].t === "s"), JSON.stringify(left))

    // ---- Clear.
    said.length = 0
    await page.click("#etax-clr")
    const cleared = await holds(2)
    check("clear", "Clear asks first, then keeps what's on the screen alone, and its panel says how many are missing", said.join(" | ") === "مسح كل الصفوف المتجمعة؟" && cleared && (await says()).includes("ناقص 4 من 6"), `${said.join(" | ")} | ${await says()}`)
    await page.click("#etax-all")
    check("clear", "and Gather all pages gathers them again", (await holds(6)) && (await gathered(6)), await says())

    // ---- A page that names no company.
    await open("?company=none")
    await press()
    const unnamed = await holds(1)
    state = await kept()
    check("no-company", "a page that names no company: its rows have the word for none, which its file's name has too", unnamed && state.rows[0].company === UNNAMED && (await company()) === "", JSON.stringify(state.rows.map(row => row.company)))
    saved.push(await save("no-company.xlsx"))

    // ---- A page with no table, and nothing gathered.
    await open("?table=none")
    await page.evaluate(() => localStorage.clear())
    await press()
    await page.waitForTimeout(800)
    said.length = 0
    let file = false
    const none = page.waitForEvent("download", { timeout: 2000 }).then(() => { file = true }, () => {})
    await page.click("#etax-dl")
    await none
    check("no-table", "a page with no table: its panel says so, and Download says there's nothing and saves no file", (await says()).includes("مش لاقي جدول في الصفحة دي") && said.join(" | ") === "مفيش صفوف متجمعة" && !file, `${await says()} | ${said.join(" | ")} | file: ${file}`)

    // ---- Every file's name, and what left the page.
    const names = saved.map(({ file: kind, savedAs }) => `${kind}=${savedAs}`).join(" | ")
    const expected = [["one-page.xlsx", BAA], ["every-page.xlsx", ALEF], ["filter-waiting.xlsx", ALEF], ["filter-partly-paid.xlsx", ALEF], ["no-company.xlsx", UNNAMED]].map(([kind, name]) => `${kind}=مطالبات - ${name} - ${DAY}.xlsx`).join(" | ")
    check("file-name-cairo-day", "each file is named for its company and Cairo's day, when UTC's is still the day before", names === expected && saved.every(({ utcDay }) => utcDay === UTC_DAY), `${names} | UTC: ${saved.map(({ utcDay }) => utcDay).join(" ")}`)

    const elsewhere = asked.filter(address => !address.startsWith("https://portal.test/") && !address.startsWith("blob:https://portal.test/"))
    check("sends-nothing", "nothing left the page: the page's own loads and the files it saved are all that was asked for", asked.length > 0 && elsewhere.length === 0, elsewhere.join(" "))
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
