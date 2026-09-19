import { describe, it, expect } from "vitest"
import { X509Certificate } from "node:crypto"
import { rootCertificates } from "node:tls"
import { poolConfigFrom } from "./postgres-ssl"

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
})
