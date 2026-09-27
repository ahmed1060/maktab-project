import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Every action, entity type and detail the code writes to the audit log has
 * a label in both languages, so the audit log never shows a raw code; so does
 * every coded value in the schema (lib/audit-details.ts). Read from the
 * source: the actions passed to AuditLogService.log, the `audit` option of
 * withStandardHandler, rows written with auditLog.create, and the helpers
 * that pass an action through (role requests' audit(), salary undoAdjustment()).
 */

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
        const path = join(dir, f)
        if (statSync(path).isDirectory()) return f === "node_modules" || f === ".next" ? [] : files(path)
        return path.endsWith(".ts") && !path.includes(".test.") ? [path] : []
    })
}

/** The codes an expression can be: a literal, or either branch of a condition. */
function codes(node: ts.Node | undefined, out: Set<string>) {
    if (!node) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (/^[A-Z][A-Z_]+$/.test(node.text)) out.add(node.text)
    } else if (ts.isConditionalExpression(node)) {
        codes(node.whenTrue, out)
        codes(node.whenFalse, out)
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
        codes(node.expression, out)
    }
}

const property = (node: ts.Node | undefined, name: string) =>
    node && ts.isObjectLiteralExpression(node)
        ? node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === name)?.initializer
        : undefined

/** Every field name an object written as details can have, nested ones and spread ones included. */
function fields(node: ts.Node | undefined, out: Set<string>) {
    if (!node) return
    if (ts.isObjectLiteralExpression(node)) {
        for (const p of node.properties) {
            if (ts.isSpreadAssignment(p)) { fields(p.expression, out); continue }
            if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) out.add(p.name.text)
            if (ts.isPropertyAssignment(p)) fields(p.initializer, out)
        }
    } else if (ts.isConditionalExpression(node)) {
        fields(node.whenTrue, out)
        fields(node.whenFalse, out)
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isBinaryExpression(node)) {
        ts.forEachChild(node, child => fields(child, out))
    }
}

function written() {
    const actions = new Set<string>(), entities = new Set<string>(), details = new Set<string>()
    for (const file of [...files("lib"), ...files("app")]) {
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                const callee = node.expression.getText(source)
                if (/(AuditLogService|this)\.log$/.test(callee) && node.arguments.length >= 3) {
                    codes(node.arguments[0], actions)
                    codes(node.arguments[1], entities)
                    fields(property(node.arguments[3], "details"), details)
                }
                if (callee === "audit") codes(node.arguments[0], actions)
                if (/undoAdjustment$/.test(callee)) codes(node.arguments[4], actions)
                if (/auditLog\.create$/.test(callee)) {
                    const data = property(node.arguments[0], "data")
                    codes(property(data, "action"), actions)
                    codes(property(data, "entityType"), entities)
                    fields(property(data, "details"), details)
                }
            }
            if (ts.isPropertyAssignment(node) && node.name.getText(source) === "audit") {
                codes(property(node.initializer, "action"), actions)
                codes(property(node.initializer, "entityType"), entities)
            }
            ts.forEachChild(node, visit)
        }
        visit(source)
    }
    return { actions, entities, details }
}

/** Every value of every enum in the schema: the codes details carry. */
function enumValues() {
    const out = new Set<string>()
    for (const [, body] of readFileSync("prisma/schema.prisma", "utf8").matchAll(/^enum \w+ \{([^}]*)\}/gm)) {
        for (const line of body.split("\n")) {
            const value = line.trim().split(/\s/)[0]
            if (/^[A-Z][A-Z0-9_]*$/.test(value)) out.add(value)
        }
    }
    return out
}

describe("the audit log's labels", () => {
    const { actions, entities, details } = written()
    const missing = (prefix: string, names: Set<string>) =>
        [...names].flatMap(n => [
            ...((en as Record<string, string>)[prefix + n] ? [] : [`en ${prefix}${n}`]),
            ...((ar as Record<string, string>)[prefix + n] ? [] : [`ar ${prefix}${n}`]),
        ])

    it("finds what the code writes", () => {
        // A floor, so a change to how the code is read that finds nothing fails here.
        expect(actions.size).toBeGreaterThan(100)
        expect(entities.size).toBeGreaterThan(20)
        expect(actions).toContain("CONFIGURE_ACCESS_REVIEW")
        expect(actions).toContain("REVERSE_SALARY_ADJUSTMENT")
        expect(entities).toContain("ROLE_TEMPLATE")
        expect(details.size).toBeGreaterThan(100)
        expect(details).toContain("separationOfDuties")
        expect(enumValues()).toContain("CHANGE_REQUESTED")
    })

    it("names every action in both languages", () => {
        expect(missing("audit_action_", actions)).toEqual([])
    })

    it("names every entity type in both languages", () => {
        expect(missing("audit_entity_", entities)).toEqual([])
    })

    it("names every detail the code writes, in both languages", () => {
        expect(missing("audit_field_", details)).toEqual([])
    })

    it("labels every coded value in the schema, in both languages", () => {
        expect(missing("audit_value_", enumValues())).toEqual([])
    })
})
