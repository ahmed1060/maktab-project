import { describe, it, expect, vi, afterEach } from "vitest"
import { X509Certificate } from "node:crypto"
import { rootCertificates } from "node:tls"
import { createRequire } from "node:module"
import { poolConfigFrom } from "./postgres-ssl"

const require_ = createRequire(import.meta.url)

/**
 * The TLS change that took the preview deployment down.
 *
 * Prisma 5's Rust engine read `sslmode=require` as "encrypt, do not verify".
 * node-postgres reads it as `verify-full`, and Supabase's chain is signed by
 * their own root, so every query failed with P1011 / TlsConnectionError. The
 * fix is not to stop verifying — it is to trust the right root.
 */

const SUPABASE = "postgres://u:p@db.abc.supabase.co:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1&connect_timeout=15"

describe("a Supabase URL becomes pool settings that can actually connect", () => {
    const config = poolConfigFrom(SUPABASE, { max: 1 })

    it("keeps the parts pg needs", () => {
        expect(config.host).toBe("db.abc.supabase.co")
        expect(config.port).toBe(6543)
        expect(config.user).toBe("u")
        expect(config.database).toBe("postgres")
        expect(config.max).toBe(1)
    })

    it("verifies the certificate rather than switching verification off", () => {
        const ssl = config.ssl as { rejectUnauthorized: boolean; ca: string[] }
        // The whole point. rejectUnauthorized: false would also make the error
        // go away, and would be a downgrade dressed up as a fix.
        expect(ssl.rejectUnauthorized).toBe(true)
    })

    it("trusts Supabase's own root, by name and not by counting", () => {
        const ssl = config.ssl as { ca: string[] }
        // Named specifically. An earlier version of this test asserted that the
        // list held a PEM and was longer than fifty entries — both of which
        // Node's built-in roots satisfy on their own, so deleting the Supabase
        // certificate left it passing. A guard that cannot fail is not a guard.
        const subjects = ssl.ca.map(pem => {
            try { return new X509Certificate(pem).subject } catch { return "" }
        })
        expect(subjects.some(s => s.includes("Supabase Root 2021 CA"))).toBe(true)
    })

    it("keeps Node's built-in roots alongside it", () => {
        // Otherwise setting `ca` replaces the trust store outright and any host
        // with an ordinary public certificate stops validating.
        const ssl = config.ssl as { ca: string[] }
        expect(ssl.ca.length).toBe(rootCertificates.length + 1)
    })

    it("carries the connect timeout across to the name pg reads", () => {
        // libpq spells it connect_timeout, in seconds; pg only honours
        // connectionTimeoutMillis and ignores the other without saying so.
        expect(config.connectionTimeoutMillis).toBe(15_000)
    })

    it("drops Prisma's own query parameters", () => {
        // Unknown keys reaching the server as startup parameters are a
        // connection error, not a warning.
        expect(config).not.toHaveProperty("pgbouncer")
        expect(config).not.toHaveProperty("connection_limit")
    })
})

describe("a plain local database is left unencrypted", () => {
    it("does not force TLS on a URL that never asked for it", () => {
        // Development and every test that touches a real database run against a
        // local postgres with no TLS at all. Forcing ssl here would break them.
        const config = poolConfigFrom("postgresql://prisma@127.0.0.1:54329/nizmo")
        expect(config.ssl).toBeUndefined()
        expect(config.host).toBe("127.0.0.1")
    })

    it("honours an explicit sslmode=disable", () => {
        expect(poolConfigFrom("postgresql://u@h:5432/d?sslmode=disable").ssl).toBe(false)
    })

    it("reads ssl=false as no, not as a non-empty string", () => {
        // pg-connection-string leaves this one as the string "false", which is
        // truthy. Deciding TLS by truthiness would turn it on for a URL that
        // said the opposite.
        expect(poolConfigFrom("postgresql://u@h:5432/d?ssl=false").ssl).toBe(false)
        expect(poolConfigFrom("postgresql://u@h:5432/d?ssl=0").ssl).toBe(false)
    })

    it("still honours ssl=true for a host that has no sslmode", () => {
        const ssl = poolConfigFrom("postgresql://u@h:5432/d?ssl=true").ssl as { rejectUnauthorized: boolean }
        expect(ssl.rejectUnauthorized).toBe(true)
    })
})

describe("the sslmode warning stays out of the production error log", () => {
    /**
     * pg-connection-string prints a process warning for every sslmode but
     * verify-full, announcing that the mode will mean something weaker in its
     * next major version. It fires once per process, which on a serverless
     * platform is once per cold start, and it was the loudest thing in the
     * production error log by an order of magnitude.
     *
     * The warning fires once per process, and that latch lives in the library's
     * module scope — in Node's require cache, where vi.resetModules() does not
     * reach. So the first test clears that cache itself before asking the
     * library to warn. The second test does not go near the latch at all, for
     * the reason written above it.
     */
    function freshLibrary() {
        delete require_.cache[require_.resolve("pg-connection-string")]
    }

    afterEach(() => {
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it("the library really does warn, so the test below means something", async () => {
        // The break-test, kept in the suite rather than run once by hand. If a
        // version bump drops the notice, the guard below has quietly stopped
        // guarding anything, and this says so instead of staying green.
        freshLibrary()
        const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {})
        require_("pg-connection-string")(SUPABASE)
        expect(warn).toHaveBeenCalled()
        expect(String(warn.mock.calls[0][0])).toContain("sslmode")
    })

    it("hands the library a connection string with no sslmode in it", async () => {
        // This is the guard, and it is deliberately not written as "assert no
        // warning is emitted". That version was tried and could not fail:
        // re-importing this module after clearing the require cache still gave
        // it the library instance vitest had already resolved, latch spent, so
        // the reintroduced bug sailed through green. Asserting on the string
        // actually handed over needs no latch and no module surgery, and a
        // failure names what broke rather than only that something did.
        freshLibrary()
        vi.resetModules()
        const seen: string[] = []
        vi.doMock("pg-connection-string", async importOriginal => {
            const actual = await importOriginal<typeof import("pg-connection-string")>()
            return { ...actual, parse: (str: string) => (seen.push(str), actual.parse(str)) }
        })
        const { poolConfigFrom: fresh } = await import("./postgres-ssl")
        fresh(SUPABASE)
        vi.doUnmock("pg-connection-string")
        expect(seen).toHaveLength(1)
        expect(seen[0]).not.toContain("sslmode")
        // The neighbours have to survive the removal.
        expect(seen[0]).toContain("connect_timeout=15")
        expect(seen[0]).toContain("db.abc.supabase.co:6543")
    })

    it("still reaches the same TLS settings whichever mode asked for TLS", () => {
        // The mode is read here now, so every mode has to be handled here too.
        // require, prefer and verify-ca all exist to tolerate a certificate
        // this code already knows how to verify, so they get the verified
        // connection rather than a weaker one.
        for (const mode of ["require", "prefer", "verify-ca", "verify-full"]) {
            const ssl = poolConfigFrom(`postgres://u:p@db.abc.supabase.co:6543/postgres?sslmode=${mode}`)
                .ssl as { rejectUnauthorized: boolean }
            expect(ssl.rejectUnauthorized, mode).toBe(true)
        }
    })

    it("leaves the rest of the query string alone", () => {
        expect(poolConfigFrom(SUPABASE).connectionTimeoutMillis).toBe(15_000)
        expect(poolConfigFrom("postgres://u:p@h:5432/d?connect_timeout=9").connectionTimeoutMillis).toBe(9_000)
    })
})
