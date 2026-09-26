import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { Workbook } from "exceljs"
import { generateBulkTaskTemplate } from "./services/template-generator.service"

/**
 * The bulk-task template, generated end to end through exceljs.
 *
 * The only server-side use of exceljs, and until now untested. It matters
 * more than it looks: package.json overrides exceljs's own copy of uuid
 * (8.x, flagged by npm audit) to 11.x, a major version exceljs was never
 * published against. This is what proves the override did not break the one
 * file Admins download.
 */

async function baseFile(): Promise<Buffer> {
    const wb = new Workbook()
    const ws = wb.addWorksheet("Tasks")
    ws.addRow(["Title", "Description", "Vendor Name", "Employee Name", "Deadline Date", "Deadline Time", "Difficulty"])
    ws.addRow(["(instructions)"])
    return Buffer.from(await wb.xlsx.writeBuffer())
}

const users = [
    { firstName: "Laila", lastName: "Fouad", username: "laila", role: "EMPLOYEE" },
    { firstName: "Omar", lastName: "Said", username: "omar", role: "TEAM_LEADER" },
]
const vendors = [{ name: "Delta Supplies", locationName: "Nasr City" }]

async function generated(locale: "en" | "ar", u = users, v = vendors) {
    const out = await generateBulkTaskTemplate(await baseFile(), locale, u, v)
    const wb = new Workbook()
    await wb.xlsx.load(out as any)
    return wb
}

describe("the bulk-task template", () => {
    it("keeps the base sheet and adds the two lookup sheets", async () => {
        const wb = await generated("en")
        expect(wb.worksheets.map(s => s.name)).toEqual(["Tasks", "Users", "Vendors"])
        expect(wb.getWorksheet("Tasks")!.getCell("A1").value).toBe("Title")
    })

    it("lists people as 'First Last (username)', so a shared name stays unambiguous", async () => {
        const users = (await generated("en")).getWorksheet("Users")!
        expect(users.getCell("A2").value).toBe("Laila Fouad (laila)")
        expect(users.getCell("C3").value).toBe("omar")
    })

    it("wires the vendor and employee columns to their lists, for every data row", async () => {
        const tasks = (await generated("en")).getWorksheet("Tasks")!
        for (const row of [3, 52]) {
            expect(tasks.getCell(`C${row}`).dataValidation).toMatchObject({ type: "list", formulae: ["'Vendors'!$A$2:$A$2"] })
            expect(tasks.getCell(`D${row}`).dataValidation).toMatchObject({ type: "list", formulae: ["'Users'!$A$2:$A$3"] })
        }
        expect(tasks.getCell("C53").dataValidation).toBeUndefined()
    })

    it("gives an empty list a one-row range, which spreadsheet apps accept", async () => {
        const tasks = (await generated("en", [], [])).getWorksheet("Tasks")!
        expect(tasks.getCell("D3").dataValidation).toMatchObject({ formulae: ["'Users'!$A$2:$A$2"] })
    })

    it("names the sheets in Arabic, right to left, for an Arabic download", async () => {
        const wb = await generated("ar")
        expect(wb.worksheets.map(s => s.name)).toEqual(["Tasks", "المستخدمين", "الموردين"])
        expect(wb.getWorksheet("المستخدمين")!.views[0]).toMatchObject({ rightToLeft: true })
    })

    it("points an Arabic file's dropdowns at the Arabic sheets, which is where the lists are", async () => {
        // They used to say Users!/Vendors! in every language. In an Arabic
        // file no sheet has either name, so both dropdowns were empty.
        const tasks = (await generated("ar")).getWorksheet("Tasks")!
        expect(tasks.getCell("C3").dataValidation).toMatchObject({ formulae: ["'الموردين'!$A$2:$A$2"] })
        expect(tasks.getCell("D3").dataValidation).toMatchObject({ formulae: ["'المستخدمين'!$A$2:$A$3"] })
    })

    it("refuses a base file with no sheet at all", async () => {
        const empty = Buffer.from(await new Workbook().xlsx.writeBuffer())
        await expect(generateBulkTaskTemplate(empty, "en", users, vendors)).rejects.toThrow()
    })
})

describe("the npm audit fixes stay in place", () => {
    // Each one forces a transitive package onto a release that fixes a
    // published advisory. Dropping one silently brings the advisory back.
    const pkg = JSON.parse(readFileSync("package.json", "utf8"))
    it("overrides the three flagged transitive packages", () => {
        expect(pkg.overrides).toMatchObject({
            mysql2: expect.stringMatching(/^\^3\.(2[4-9]|[3-9]\d)/),
            "deepmerge-ts": expect.stringMatching(/^\^([89]|\d{2,})\./),
            exceljs: { uuid: expect.stringMatching(/^\^1[1-9]\./) },
        })
    })
})
