import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Every list route reads page and limit through parsePaging, and every limit
 * a screen asks for fits under that route's cap.
 *
 * Ten routes parsed them with parseInt, so `?limit=abc` reached Prisma as NaN
 * (a 500) and `?limit=999999` had no ceiling. And a limit over a route's cap
 * used to fall back to the default: the Team Leader pickers asked /api/users
 * for 1000 and got 10.
 */
const files = (dir: string, ext: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : [])

/** The route file a screen's path reaches: a `${…}` segment is its folder's [param]. */
function routeFile(route: string): string {
    let dir = "app"
    for (const seg of route.split("/").filter(Boolean)) {
        const param = seg.includes("${") && existsSync(dir) ? readdirSync(dir).find(e => /^\[[^.\]]+\]$/.test(e)) : undefined
        dir = join(dir, param ?? seg)
    }
    return join(dir, "route.ts")
}

describe("list paging", () => {
    it("no route parses page or limit by hand", () => {
        const byHand = files("app/api", "route.ts")
            .filter(f => /parseInt\(searchParams\.get\(['"](page|limit)['"]\)/.test(readFileSync(f, "utf8")))
        expect(byHand).toEqual([])
    })

    it("every limit a screen asks for fits under the route's cap", () => {
        const asked: { screen: string; route: string; limit: number }[] = []
        for (const f of [...files("app", ".tsx"), ...files("components", ".tsx")]) {
            const src = readFileSync(f, "utf8")
            for (const m of src.matchAll(/[`'"](\/api\/[^?`'"]+)\?[^`'"]*\blimit=(\d+)/g)) {
                asked.push({ screen: f, route: m[1], limit: Number(m[2]) })
            }
            // queryParams.set('limit', '1000') before fetch(`/api/users?...`)
            const set = src.match(/set\(['"]limit['"], ['"](\d+)['"]\)[\s\S]{0,400}?fetch\(`(\/api\/[^?`]+)\?/)
            if (set) asked.push({ screen: f, route: set[2], limit: Number(set[1]) })
        }
        expect(asked.length).toBeGreaterThan(5)

        const over = asked.flatMap(({ screen, route, limit }) => {
            const file = routeFile(route)
            if (!existsSync(file)) return [`${screen}: no route file for ${route}`]
            const call = readFileSync(file, "utf8").match(/parsePaging\(searchParams, \d+(?:, (\d+))?\)/)
            if (!call) return [`${file}: doesn't use parsePaging`]
            const cap = Number(call[1] ?? 100)
            return limit > cap ? [`${screen} asks ${route} for ${limit}, capped at ${cap}`] : []
        })
        expect(over).toEqual([])
    })
})
