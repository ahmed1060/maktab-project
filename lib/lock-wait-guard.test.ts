import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { posix } from "node:path"
import ts from "typescript"
import { LOCK_WAIT } from "@/lib/services/attendance-lock"

/**
 * Every transaction that takes the company-month locks waits as long as an
 * import may hold them (LOCK_WAIT, lib/services/attendance-lock.ts;
 * ATTENDANCE_PLAN.md §12.1). An import holds a month's lock for up to its own
 * minute, and Prisma's five seconds left a writer behind it failing instead of
 * going next: found on approving (review on PR 12) and on asking for a day off
 * (Codex review on PR 431), and then looked for everywhere, here.
 *
 * Read from the code. A function takes the locks if it calls lockMonths, or a
 * function that does, through any number of calls. A function is its file's
 * (an import is followed to the file it comes from, re-exports too), and a
 * method is its class's. A transaction takes them if its callback calls any
 * of those, or is one of them. Its time is the timeout it's given: LOCK_WAIT,
 * an object spreading it, or a number; Prisma's five seconds without one.
 */

type Source = { file: string; text: string }
type Transaction = { at: string; in: string | null; timeout: number }
type Imported = { module: string | null; name: string }

const PRISMA_TIMEOUT = 5_000

/** The imports, which hold the locks: LOCK_WAIT is sized from their minute. */
const IMPORTS = ["AttendancePunchService.importRows", "AttendanceIngestService.punches", "AttendanceIngestService.fromTerminal"]
const IMPORT_MINUTE = 60_000

const parse = (s: Source) => ts.createSourceFile(s.file, s.text, ts.ScriptTarget.Latest, true, s.file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const isFunction = (n: ts.Node | undefined): n is ts.ArrowFunction | ts.FunctionExpression => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))

const isTransaction = (n: ts.Node): n is ts.CallExpression =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "$transaction"
    && (isFunction(n.arguments[0]) || (!!n.arguments[0] && ts.isIdentifier(n.arguments[0])))

/** `await import("x")`, as `const { a } = await import("x")` has it. */
const dynamicImportOf = (n: ts.Expression | undefined): string | null => {
    if (!n || !ts.isAwaitExpression(n) || !ts.isCallExpression(n.expression)) return null
    const call = n.expression
    return call.expression.kind === ts.SyntaxKind.ImportKeyword && call.arguments[0] && ts.isStringLiteral(call.arguments[0]) ? call.arguments[0].text : null
}

/** The timeout a transaction's options give it, the last one said winning, as an object literal reads. */
const timeoutOf = (options: ts.Expression | undefined, lockWait: number): number => {
    if (!options) return PRISMA_TIMEOUT
    if (ts.isIdentifier(options)) return options.text === "LOCK_WAIT" ? lockWait : PRISMA_TIMEOUT
    if (!ts.isObjectLiteralExpression(options)) return PRISMA_TIMEOUT
    let timeout = PRISMA_TIMEOUT
    for (const p of options.properties) {
        if (ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression) && p.expression.text === "LOCK_WAIT") timeout = lockWait
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "timeout" && ts.isNumericLiteral(p.initializer)) timeout = Number(p.initializer.text.replace(/_/g, ""))
    }
    return timeout
}

/** Every transaction that takes the month locks: where, in which function, and for how long it may wait. */
function lockingTransactions(sources: readonly Source[], lockMonths: string, lockWait: number): Transaction[] {
    const files = new Set(sources.map(s => s.file))
    const moduleFile = (from: string, spec: string): string | null => {
        const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? posix.normalize(posix.join(posix.dirname(from), spec)) : null
        if (base === null) return null
        return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(f => files.has(f)) ?? null
    }

    const declared = new Map<string, Set<string>>()
    const imports = new Map<string, Map<string, Imported>>()
    const reexports = new Map<string, Map<string, Imported>>()
    const parsed = sources.map(s => ({ file: s.file, sf: parse(s) }))

    // What each file declares, imports and re-exports.
    for (const { file, sf } of parsed) {
        const names = new Set<string>()
        const theirs = new Map<string, Imported>()
        const passed = new Map<string, Imported>()
        const visit = (n: ts.Node) => {
            if (ts.isFunctionDeclaration(n) && n.name) names.add(n.name.text)
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFunction(n.initializer)) names.add(n.name.text)
            if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
                const target = moduleFile(file, n.moduleSpecifier.text)
                for (const el of n.importClause.namedBindings.elements) theirs.set(el.name.text, { module: target, name: (el.propertyName ?? el.name).text })
            }
            if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name)) {
                const dynamic = dynamicImportOf(n.initializer)
                const target = dynamic === null ? null : moduleFile(file, dynamic)
                if (dynamic !== null) for (const el of n.name.elements) {
                    if (!ts.isIdentifier(el.name)) continue
                    const name = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text
                    theirs.set(el.name.text, { module: target, name })
                }
            }
            if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && n.exportClause && ts.isNamedExports(n.exportClause)) {
                const target = moduleFile(file, n.moduleSpecifier.text)
                for (const el of n.exportClause.elements) passed.set(el.name.text, { module: target, name: (el.propertyName ?? el.name).text })
            }
            ts.forEachChild(n, visit)
        }
        visit(sf)
        declared.set(file, names)
        imports.set(file, theirs)
        reexports.set(file, passed)
    }

    /** The key of a function as it's called from a file: its own file's, or followed to where it's from. */
    const functionKey = (file: string, name: string): string => {
        if (declared.get(file)?.has(name)) return `${file}#${name}`
        let at = imports.get(file)?.get(name)
        for (let hops = 0; at && at.module && hops < 5; hops++) {
            if (declared.get(at.module)?.has(at.name)) return `${at.module}#${at.name}`
            at = reexports.get(at.module)?.get(at.name)
        }
        return `?#${name}`
    }
    const callsUnder = (file: string, node: ts.Node, inClass: string | null): Set<string> => {
        const keys = new Set<string>()
        const visit = (n: ts.Node) => {
            if (ts.isCallExpression(n)) {
                const callee = n.expression
                if (ts.isIdentifier(callee)) keys.add(functionKey(file, callee.text))
                else if (ts.isPropertyAccessExpression(callee) && callee.expression.kind === ts.SyntaxKind.ThisKeyword && inClass) keys.add(`${inClass}.${callee.name.text}`)
                else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) keys.add(`${callee.expression.text}.${callee.name.text}`)
            }
            ts.forEachChild(n, visit)
        }
        visit(node)
        return keys
    }

    // Each function's calls, and each transaction's, with the function it's in.
    const functions = new Map<string, Set<string>>()
    const add = (key: string, calls: Set<string>) => functions.set(key, new Set([...(functions.get(key) ?? []), ...calls]))
    const transactions: (Transaction & { calls: Set<string> })[] = []
    for (const { file, sf } of parsed) {
        const visit = (n: ts.Node, inClass: string | null, inFunction: string | null) => {
            let here = inFunction
            if (ts.isFunctionDeclaration(n) && n.name && n.body) add(here = `${file}#${n.name.text}`, callsUnder(file, n.body, inClass))
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFunction(n.initializer)) add(`${file}#${n.name.text}`, callsUnder(file, n.initializer.body, inClass))
            if (ts.isMethodDeclaration(n) && inClass && n.body && (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name))) add(here = `${inClass}.${n.name.text}`, callsUnder(file, n.body, inClass))
            if (isTransaction(n)) {
                const work = n.arguments[0]
                const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
                transactions.push({
                    at: `${file}:${line + 1}`, in: inFunction, timeout: timeoutOf(n.arguments[1], lockWait),
                    calls: ts.isIdentifier(work) ? new Set([functionKey(file, work.text)]) : callsUnder(file, work, inClass),
                })
            }
            const nextClass = ts.isClassDeclaration(n) && n.name ? n.name.text : inClass
            ts.forEachChild(n, c => visit(c, nextClass, here))
        }
        visit(sf, null, null)
    }

    // Which functions take the locks, through any number of calls.
    const locking = new Set([lockMonths])
    for (let grew = true; grew;) {
        grew = false
        for (const [key, calls] of functions) {
            if (!locking.has(key) && [...calls].some(c => locking.has(c))) { locking.add(key); grew = true }
        }
    }
    return transactions.filter(t => [...t.calls].some(c => locking.has(c))).map(({ at, in: inFunction, timeout }) => ({ at, in: inFunction, timeout }))
}

const sourcesUnder = (dir: string): Source[] =>
    (readdirSync(dir, { recursive: true }) as string[])
        .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("node_modules"))
        .map(f => ({ file: `${dir}/${f}`, text: readFileSync(`${dir}/${f}`, "utf8") }))

describe("the guard itself", () => {
    it("finds a transaction taking the locks directly, through a helper, an import, a re-export, another file's class and this", () => {
        const writer = [
            /* 1 */ 'import { lockMonths } from "./lock"',
            /* 2 */ 'import { lockMonths as lm } from "./barrel"',
            /* 3 */ 'const run = (x) => x',
            /* 4 */ 'async function openMonths(tx) { await lockMonths(tx, "c", []) }',
            /* 5 */ 'const work = async (tx) => openMonths(tx)',
            /* 6 */ 'export class Writer {',
            /* 7 */ '  static async direct() { return prisma.$transaction(async tx => { await lockMonths(tx, "c", []) }) }',
            /* 8 */ '  static async helper() { return prisma.$transaction(async tx => { await openMonths(tx) }) }',
            /* 9 */ '  static async other() { return prisma.$transaction(async tx => { await Engine.rebuild(tx) }) }',
            /* 10 */ '  static async own(tx) { await openMonths(tx) }',
            /* 11 */ '  static async viaThis() { return prisma.$transaction(async tx => { await this.own(tx) }) }',
            /* 12 */ '  static async dynamic() { return prisma.$transaction(async tx => { const { lockDateMonths } = await import("./lock"); await lockDateMonths(tx) }) }',
            /* 13 */ '  static async passed() { return prisma.$transaction(async tx => { await lm(tx, "c", []) }) }',
            /* 14 */ '  static async named() { return prisma.$transaction(work, { timeout: 60_000 }) }',
            /* 15 */ '  static async waits() { return prisma.$transaction(async tx => { await openMonths(tx) }, LOCK_WAIT) }',
            /* 16 */ '  static async spread() { return prisma.$transaction(async tx => { await openMonths(tx) }, { maxWait: 10_000, ...LOCK_WAIT }) }',
            /* 17 */ '  static async longer() { return prisma.$transaction(async tx => { await openMonths(tx) }, { timeout: 120_000 }) }',
            /* 18 */ '  static async shorter() { return prisma.$transaction(async tx => { await openMonths(tx) }, { ...LOCK_WAIT, timeout: 30_000 }) }',
            /* 19 */ '  static async sameName() { return prisma.$transaction(async tx => { run(tx) }) }',
            /* 20 */ '  static async array() { return prisma.$transaction([prisma.user.count()]) }',
            /* 21 */ '}',
        ].join("\n")
        const found = lockingTransactions([
            { file: "lock.ts", text: "export async function lockMonths(tx, c, m) {}\nexport async function lockDateMonths(tx, c, d) { await lockMonths(tx, c, d) }" },
            { file: "barrel.ts", text: 'export { lockMonths } from "./lock"' },
            // Its own run takes the locks; the writer's run, of the same name, doesn't.
            { file: "other.ts", text: 'import { lockMonths } from "./lock"\nconst run = (tx) => lockMonths(tx, "c", [])' },
            { file: "engine.ts", text: 'import { lockDateMonths } from "./lock"\nexport class Engine { static async rebuild(tx) { await lockDateMonths(tx, "c", []) } }' },
            { file: "writer.ts", text: writer },
        ], "lock.ts#lockMonths", 90_000)
        expect(found).toEqual([
            { at: "writer.ts:7", in: "Writer.direct", timeout: 5_000 },
            { at: "writer.ts:8", in: "Writer.helper", timeout: 5_000 },
            { at: "writer.ts:9", in: "Writer.other", timeout: 5_000 },
            { at: "writer.ts:11", in: "Writer.viaThis", timeout: 5_000 },
            { at: "writer.ts:12", in: "Writer.dynamic", timeout: 5_000 },
            { at: "writer.ts:13", in: "Writer.passed", timeout: 5_000 },
            { at: "writer.ts:14", in: "Writer.named", timeout: 60_000 },
            { at: "writer.ts:15", in: "Writer.waits", timeout: 90_000 },
            { at: "writer.ts:16", in: "Writer.spread", timeout: 90_000 },
            { at: "writer.ts:17", in: "Writer.longer", timeout: 120_000 },
            { at: "writer.ts:18", in: "Writer.shorter", timeout: 30_000 },
        ])
    })
})

describe("every transaction that takes the company-month locks", () => {
    const found = lockingTransactions([...sourcesUnder("lib"), ...sourcesUnder("app")], "lib/services/attendance-lock.ts#lockMonths", LOCK_WAIT.timeout)

    it("is found where they're known to be taken", () => {
        const files = new Set(found.map(t => t.at.replace(/:\d+$/, "")))
        for (const f of ["lib/services/payroll-run.service.ts", "lib/services/attendance-punch.service.ts", "lib/services/settlement.service.ts", "lib/services/day-off.service.ts", "lib/services/mission-request.service.ts", "lib/services/attendance-request.service.ts"]) expect(files).toContain(f)
    })

    it("in an import, holds them for the import's minute, which LOCK_WAIT is longer than", () => {
        for (const name of IMPORTS) {
            const theirs = found.filter(t => t.in === name)
            expect(theirs.length, name).toBeGreaterThan(0)
            for (const t of theirs) expect(t.timeout, t.at).toBe(IMPORT_MINUTE)
        }
        expect(LOCK_WAIT.timeout).toBeGreaterThan(IMPORT_MINUTE)
    })

    it("anywhere else, waits as long as an import may hold them", () => {
        expect(found.filter(t => !IMPORTS.includes(t.in ?? "") && t.timeout < LOCK_WAIT.timeout).map(t => `${t.at} (${t.in})`)).toEqual([])
    })
})
