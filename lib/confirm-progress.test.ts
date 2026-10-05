import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import ts from "typescript"
import { stripComments } from "./strip-comments"

/**
 * The confirm dialog shows the work it started. Every delete, approve and
 * reject confirmation goes through ConfirmModal, and only 3 of its 43 data
 * confirmations showed anything while the request was out: the dialog had no
 * way to, and most callers closed it before their request had even left.
 */

describe("ConfirmModal", () => {
    const src = stripComments(readFileSync("components/ConfirmModal.tsx", "utf8"))

    it("waits for the promise its onConfirm returns, and says it is working", () => {
        expect(src).toMatch(/onConfirm: \(reason\?: string\) => unknown/)
        expect(src).toMatch(/typeof \(work as Promise<unknown>\)\.then !== 'function'/)
        expect(src).toMatch(/setWorking\(true\)/)
        expect(src).toMatch(/\.finally\(\(\) => setWorking\(false\)\)/)
        expect(src).toMatch(/aria-busy=\{busy \|\| undefined\}/)
    })

    it("can't be cancelled or confirmed twice while it works", () => {
        expect(src).toMatch(/const cancel = \(\) => \{ if \(!busy\) onCancel\(\) \}/)
        expect(src).toMatch(/useDialog\(isOpen, cancel\)/)
        expect(src).toMatch(/onClick=\{cancel\}\s+disabled=\{busy\}/)
        expect(src).toMatch(/if \(busy\) return/)
    })
})

/** Each ConfirmModal's onConfirm, with the local function it calls inlined. */
function confirmHandlers() {
    const files = execSync("grep -rl '<ConfirmModal' app components --include=*.tsx").toString().trim().split("\n")
    const found: { where: string; text: string }[] = []
    for (const file of files) {
        const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const fns = new Map<string, string>()
        const collect = (n: ts.Node) => {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) fns.set(n.name.text, n.initializer.getText(sf))
            ts.forEachChild(n, collect)
        }
        collect(sf)
        const visit = (n: ts.Node) => {
            if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "ConfirmModal") {
                const attr = n.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === "onConfirm") as ts.JsxAttribute
                const expr = (attr.initializer as ts.JsxExpression).expression!
                let text = expr.getText(sf)
                if (ts.isIdentifier(expr)) text = fns.get(expr.text) ?? text
                found.push({ where: `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`, text: stripComments(text) })
            }
            ts.forEachChild(n, visit)
        }
        visit(sf)
    }
    return found
}

describe("every confirmation", () => {
    // Leaving a tab with unsaved changes: it navigates, there is nothing to wait for.
    const NOT_WORK = ["components/CompanySettingsTabs.tsx"]
    const handlers = confirmHandlers().filter(h => !NOT_WORK.some(f => h.where.startsWith(f)))

    it("finds them all", () => {
        expect(handlers.length).toBeGreaterThan(40)
    })

    it("keeps its dialog open until the work is done", () => {
        // A dialog closed before the first await is a click that seems to do
        // nothing: the dialog is gone and the answer hasn't come yet.
        const closesFirst = handlers.filter(({ text }) => {
            const close = text.search(/\bset\w+\((null|false)\)/)
            const wait = text.search(/\bawait\b/)
            return close >= 0 && (wait < 0 || close < wait) && !/finally \{[^}]*set\w+\((null|false)\)/.test(text.slice(0, close + 40))
        }).map(h => h.where)
        expect(closesFirst).toEqual([])
    })
})
