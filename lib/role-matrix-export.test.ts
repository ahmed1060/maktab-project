import { describe, it, expect } from "vitest"
import { Workbook } from "exceljs"
import { buildRoleMatrix } from "./role-matrix-export"
import { PERMISSIONS, isReserved, isSplit } from "./permissions/catalogue"
import { permissionLabelKey } from "./permissions/matrix"
import { en } from "./translations/en"

async function read(buffer: Buffer) {
    const book = new Workbook()
    await book.xlsx.load(buffer as any)
    const sheet = book.worksheets[0]
    const rows: (string | null)[][] = []
    sheet.eachRow({ includeEmpty: true }, row => { rows.push((row.values as any[]).slice(1).map(v => v == null ? null : String(v))) })
    return { sheet, rows }
}

const roles = [
    { name: "HR Officer", baseRole: "EMPLOYEE", description: "Leave and people", holders: 2, grants: [{ permission: "dayoff.approve", scope: "COMPANY" }, { permission: "dayoff.view", scope: "COMPANY" }] },
    { name: "Team Leader", builtIn: "TEAM_LEADER", baseRole: "TEAM_LEADER", description: null, holders: 5, grants: [{ permission: "dayoff.approve", scope: "TEAM" }] },
]

describe("the role matrix for the contract", () => {
    it("has a column per role and the scope in each cell", async () => {
        const { rows } = await read(await buildRoleMatrix({ companyName: "Acme", roles, locale: "en", at: new Date("2026-09-27T00:00:00Z") }))
        expect(rows[0][0]).toBe("Acme")
        expect(rows[3].slice(2, 4)).toEqual(["HR Officer", "Team Leader"])
        expect(rows[4][2]).toBe("Employee · 2 people")
        const approve = rows.find(r => r[0] === "Approve leave")!
        expect(approve.slice(2, 4)).toEqual(["Whole company", "Their team"])
        const salary = rows.find(r => r[0] === "Change salaries")!
        expect(salary.slice(1, 4)).toEqual(["Moves money", "—", "—"])
    })

    it("lists every permission a role can hold, held or not", async () => {
        const { rows } = await read(await buildRoleMatrix({ companyName: "Acme", roles, locale: "en", at: new Date() }))
        const firstColumn = rows.map(r => r[0])
        const all = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]
        // One nothing checks yet is not in the matrix, so not in the contract,
        // and one split into parts is there as its parts (PR 365).
        const shown = all.filter(p => !isReserved(p) && !isSplit(p))
        const label = (p: keyof typeof PERMISSIONS) => (en as any)[permissionLabelKey(p)]
        for (const permission of all) {
            // Counted by its words: one renamed as a split into one keeps them
            // for its new name (locations.add, PR 378), shown once, for that.
            const rowsWithIt = firstColumn.filter(v => v === label(permission)).length
            expect(rowsWithIt, permission).toBe(shown.filter(p => label(p) === label(permission)).length)
            if (shown.includes(permission)) expect(rowsWithIt, permission).toBe(1)
        }
        expect(firstColumn).not.toContain(label("locations.manage"))
    })

    it("reads right to left in Arabic, in Arabic", async () => {
        const { sheet, rows } = await read(await buildRoleMatrix({ companyName: "Acme", roles, locale: "ar", at: new Date() }))
        expect(sheet.views[0].rightToLeft).toBe(true)
        expect(rows.find(r => r[0] === "الموافقة على الإجازات")!.slice(2, 4)).toEqual(["الشركة كاملة", "الفريق"])
    })

    it("names a built-in role in the sheet's language, and any other as it was named", async () => {
        const { rows } = await read(await buildRoleMatrix({ companyName: "Acme", roles, locale: "ar", at: new Date() }))
        expect(rows[3].slice(2, 4)).toEqual(["HR Officer", "قائد فريق"])
    })
})
