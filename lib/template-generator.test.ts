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
    ws.addRow(["Title", "Description", "Client Name", "Employee Name", "Deadline Date", "Deadline Time", "Difficulty"])
    ws.addRow(["(instructions)"])
    return Buffer.from(await wb.xlsx.writeBuffer())
}

const users = [
    { firstName: "Laila", lastName: "Fouad", username: "laila", role: "EMPLOYEE" },
    { firstName: "Omar", lastName: "Said", username: "omar", role: "TEAM_LEADER" },
]
const clients = [{ name: "Delta Supplies", locationName: "Nasr City" }]
const locations = [
    { id: "loc-hq", label: "Delta Supplies - Nasr City", client: "Delta Supplies" },
    { id: "loc-port", label: "Port gate", client: null },
]

async function generated(locale: "en" | "ar", u = users, v = clients, l = locations) {
    const out = await generateBulkTaskTemplate(await baseFile(), locale, u, v, l)
    const wb = new Workbook()
    await wb.xlsx.load(out as any)
    return wb
}

describe("the bulk-task template", () => {
    it("keeps the base sheet and adds the two lookup sheets", async () => {
        const wb = await generated("en")
        expect(wb.worksheets.map(s => s.name)).toEqual(["Tasks", "Users", "Clients", "Locations"])
        expect(wb.getWorksheet("Tasks")!.getCell("A1").value).toBe("Title")
    })

    it("lists people as 'First Last (username)', so a shared name stays unambiguous", async () => {
        const users = (await generated("en")).getWorksheet("Users")!
        expect(users.getCell("A2").value).toBe("Laila Fouad (laila)")
        expect(users.getCell("C3").value).toBe("omar")
    })

    it("wires the client and employee columns to their lists, for every data row", async () => {
        const tasks = (await generated("en")).getWorksheet("Tasks")!
        for (const row of [3, 52]) {
            expect(tasks.getCell(`C${row}`).dataValidation).toMatchObject({ type: "list", formulae: ["'Clients'!$A$2:$A$2"] })
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
        expect(wb.worksheets.map(s => s.name)).toEqual(["Tasks", "المستخدمين", "الموردين", "المواقع"])
        expect(wb.getWorksheet("المستخدمين")!.views[0]).toMatchObject({ rightToLeft: true })
    })

    it("points an Arabic file's dropdowns at the Arabic sheets, which is where the lists are", async () => {
        // They used to say Users!/Clients! in every language. In an Arabic
        // file no sheet has either name, so both dropdowns were empty.
        const tasks = (await generated("ar")).getWorksheet("Tasks")!
        expect(tasks.getCell("C3").dataValidation).toMatchObject({ formulae: ["'الموردين'!$A$2:$A$2"] })
        expect(tasks.getCell("D3").dataValidation).toMatchObject({ formulae: ["'المستخدمين'!$A$2:$A$3"] })
    })

    it("lists the locations by name, each with its client, and the location each names in a hidden column", async () => {
        // CLIENTS_PLAN.md §2.7: the upload finds a row's location by this
        // column, never by matching the name.
        const sheet = (await generated("en")).getWorksheet("Locations")!
        expect([2, 3].map(r => [sheet.getCell(`A${r}`).value, sheet.getCell(`B${r}`).value, sheet.getCell(`C${r}`).value])).toEqual([
            ["Delta Supplies - Nasr City", "Delta Supplies", "loc-hq"],
            ["Port gate", "Shared", "loc-port"],
        ])
        expect(sheet.getColumn(3).hidden).toBe(true)
    })

    it("adds a Location column after the base file's own, headed as they are, wired to the list for every data row", async () => {
        const tasks = (await generated("en")).getWorksheet("Tasks")!
        expect(tasks.getCell("H1").value).toBe("Location")
        expect(tasks.getCell("H2").value).toBe("Pick from the list. Left empty, it's the client's HQ.")
        for (const row of [3, 52]) expect(tasks.getCell(`H${row}`).dataValidation).toMatchObject({ type: "list", formulae: ["'Locations'!$A$2:$A$3"] })
        const ar = (await generated("ar")).getWorksheet("Tasks")!
        expect(ar.getCell("H3").dataValidation).toMatchObject({ formulae: ["'المواقع'!$A$2:$A$3"] })
    })

    it("refuses a base file with no sheet at all", async () => {
        const empty = Buffer.from(await new Workbook().xlsx.writeBuffer())
        await expect(generateBulkTaskTemplate(empty, "en", users, clients)).rejects.toThrow()
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
