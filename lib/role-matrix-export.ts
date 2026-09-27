import { Workbook } from "exceljs"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import type { Locale, TranslationKey } from "@/lib/translations"
import { isPermission, type Permission, type Scope } from "@/lib/permissions/catalogue"
import { BUILT_IN_LABEL, roleLabel } from "@/lib/role-label"
import { PERMISSION_GROUPS, permissionLabelKey, groupLabelKey, scopeLabelKey, riskLabelKey } from "@/lib/permissions/matrix"

/**
 * A company's roles as a sheet for the contract (ROLES_PLAN.md §6.10): one
 * column per role, one row per permission, the scope in the cell. The client
 * signs it off as an annex, and when a dispute comes up — "our HR Officer
 * should have been able to…" — both sides are looking at the same document.
 *
 * Every permission in the catalogue has a row, held or not, so what a role
 * cannot do is on the page as plainly as what it can.
 */

export type ExportRole = {
    name: string
    builtIn?: string | null
    baseRole: string
    description: string | null
    holders: number
    grants: { permission: string; scope: string }[]
}

const FIRST_ROLE_COLUMN = 3 // A: permission, B: risk

export async function buildRoleMatrix(input: { companyName: string; roles: ExportRole[]; locale: Locale; at: Date }): Promise<Buffer> {
    const dict = (input.locale === "ar" ? ar : en) as Record<string, string>
    const t = (key: TranslationKey) => dict[key] ?? key

    const book = new Workbook()
    const sheet = book.addWorksheet(t("roles_title"), { views: [{ rightToLeft: input.locale === "ar", state: "frozen", xSplit: 2, ySplit: 5 }] })

    sheet.getCell(1, 1).value = input.companyName
    sheet.getCell(1, 1).font = { bold: true, size: 14 }
    sheet.getCell(2, 1).value = input.at.toISOString().slice(0, 10)

    // Row 4: role names; row 5: what kind of role, and how many hold it.
    sheet.getCell(4, 1).value = t("who_can_permission")
    input.roles.forEach((role, i) => {
        const column = FIRST_ROLE_COLUMN + i
        const name = roleLabel(role, t)
        sheet.getCell(4, column).value = name
        sheet.getCell(5, column).value = `${t(BUILT_IN_LABEL[role.baseRole as keyof typeof BUILT_IN_LABEL] ?? "role_employee")} · ${t("roles_holders").replace("{count}", String(role.holders))}`
        sheet.getColumn(column).width = Math.max(14, name.length + 4)
    })
    sheet.getRow(4).font = { bold: true }
    sheet.getColumn(1).width = 42
    sheet.getColumn(2).width = 18

    const scopeOf = input.roles.map(role => new Map(role.grants.filter(g => isPermission(g.permission)).map(g => [g.permission, g.scope as Scope])))

    let row = 6
    for (const group of PERMISSION_GROUPS) {
        sheet.getCell(row, 1).value = t(groupLabelKey(group.key))
        sheet.getRow(row).font = { bold: true }
        sheet.getRow(row).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFF5" } }
        row++
        for (const permission of group.permissions as Permission[]) {
            sheet.getCell(row, 1).value = t(permissionLabelKey(permission))
            const risk = riskLabelKey(permission)
            if (risk) sheet.getCell(row, 2).value = t(risk)
            scopeOf.forEach((held, i) => {
                const scope = held.get(permission)
                sheet.getCell(row, FIRST_ROLE_COLUMN + i).value = scope ? t(scopeLabelKey(scope)) : "—"
            })
            row++
        }
    }

    // Each role's description under the matrix, for what a name leaves out.
    row++
    for (const role of input.roles.filter(r => r.description)) {
        sheet.getCell(row, 1).value = roleLabel(role, t)
        sheet.getCell(row, 1).font = { bold: true }
        sheet.getCell(row, 2).value = role.description
        row++
    }

    return Buffer.from(await book.xlsx.writeBuffer())
}
