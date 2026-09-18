import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, resolve } from "node:path"

/**
 * Nothing in the browser bundle may reach the database client.
 *
 * DashboardShell imported one string constant from SystemSettingsService, and
 * that one import pulled Prisma into the client graph behind it. Under Prisma 5
 * this was invisible: the client package stubbed itself out for the browser, so
 * the build passed and the only cost was dead weight in the bundle. Under
 * Prisma 7 the driver adapter reaches real node-postgres, which asks webpack
 * for `fs` and `dns`, and the build stops.
 *
 * The lesson is not "that one import" — it is that a client component reaching
 * server-only code failed silently for as long as the bundler was willing to
 * paper over it. So this walks the import graph rather than checking the one
 * file, and reports the whole chain when it finds one.
 */

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, out)
        else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path)
    }
    return out
}

/** Resolve an import specifier to a file in this repo, or null if it leaves it. */
function resolveLocal(specifier: string, fromFile: string): string | null {
    let base: string
    if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2))
    else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier)
    else return null // a package, not our code

    for (const candidate of [
        base, `${base}.ts`, `${base}.tsx`,
        join(base, "index.ts"), join(base, "index.tsx"),
    ]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    return null
}

function importsOf(file: string): string[] {
    const source = readFileSync(file, "utf8")
    const found: string[] = []
    // Covers `import x from "y"`, `import "y"`, and `export ... from "y"`.
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]/g)) {
        found.push(m[1])
    }
    for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) found.push(m[1])
    return found
}

const SOURCES = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib")), ...walk(join(ROOT, "context"))]
const CLIENT_ENTRIES = SOURCES.filter(f => /^\s*['"]use client['"]/.test(readFileSync(f, "utf8")))
const FORBIDDEN = resolve(ROOT, "lib/prisma.ts")

/** Breadth-first from one client entry; returns the chain that reaches Prisma. */
function chainToPrisma(entry: string): string[] | null {
    const seen = new Set<string>([entry])
    const queue: string[][] = [[entry]]

    while (queue.length) {
        const chain = queue.shift()!
        const file = chain[chain.length - 1]
        for (const specifier of importsOf(file)) {
            const target = resolveLocal(specifier, file)
            if (!target || seen.has(target)) continue
            if (target === FORBIDDEN) return [...chain, target]
            seen.add(target)
            queue.push([...chain, target])
        }
    }
    return null
}

describe("the browser bundle cannot reach the database", () => {
    it("finds client components to check", () => {
        // Vacuous otherwise: no entries means no chains means a passing test.
        expect(CLIENT_ENTRIES.length).toBeGreaterThan(20)
        expect(existsSync(FORBIDDEN)).toBe(true)
    })

    it("has no 'use client' file that imports its way to lib/prisma", () => {
        const offenders = CLIENT_ENTRIES
            .map(entry => chainToPrisma(entry))
            .filter((chain): chain is string[] => chain !== null)
            .map(chain => chain.map(f => f.replace(`${ROOT}/`, "")).join("\n      → "))

        expect(offenders, `client code reaching the database:\n\n  ${offenders.join("\n\n  ")}`).toEqual([])
    })
})
