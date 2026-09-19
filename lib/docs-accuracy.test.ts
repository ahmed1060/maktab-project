import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The setup docs must not recommend the command that broke the database.
 *
 * README.md, DATABASE_SETUP.md and TROUBLESHOOTING.md all told the reader to
 * run `prisma db push` after changing the schema. That applies changes without
 * recording a migration, and it is how six objects came to exist in production
 * that no migration created — Task.companyId, Obligation.companyId, both
 * sessionVersion columns, and the RateLimit and _ObligationAssignees tables.
 * `migrate deploy` could no longer rebuild the database from empty, and the
 * whole history had to be squashed into one baseline to recover.
 *
 * The instruction outlived the incident because nothing was checking. This
 * checks.
 */

const DOCS = ["README.md", "DATABASE_SETUP.md", "TROUBLESHOOTING.md"]

/** Strip blockquote callouts — the warnings must be free to name the command. */
function instructions(markdown: string): string {
    return markdown
        .split("\n")
        .filter(line => !line.trimStart().startsWith(">"))
        .join("\n")
}

describe("the docs do not recommend prisma db push", () => {
    for (const doc of DOCS) {
        it(`${doc} only mentions it to warn against it`, () => {
            const source = readFileSync(doc, "utf8")
            expect(instructions(source)).not.toMatch(/prisma db push/)
        })
    }

    it("still warns about it somewhere, rather than going quiet", () => {
        // Deleting the instruction is not the same as recording why. The next
        // person reaches for db push because it is the obvious command.
        const all = DOCS.map(d => readFileSync(d, "utf8")).join("\n")
        expect(all).toMatch(/db push/)
        expect(all).toMatch(/without recording a migration/)
    })
})

describe("the docs name the environment variables the code actually reads", () => {
    it("uses POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING", () => {
        // prisma.config.ts and lib/prisma.ts read these. The docs named
        // DATABASE_URL and DIRECT_URL, which nothing has read for some time —
        // so anyone following them set two variables that did nothing.
        const config = readFileSync("prisma.config.ts", "utf8")
        const client = readFileSync("lib/prisma.ts", "utf8")
        expect(config).toMatch(/POSTGRES_URL_NON_POOLING/)
        expect(client).toMatch(/POSTGRES_PRISMA_URL/)

        for (const doc of DOCS) {
            const source = readFileSync(doc, "utf8")
            expect(source, `${doc} still names a variable nothing reads`)
                .not.toMatch(/\bDIRECT_URL\b/)
        }
    })
})
