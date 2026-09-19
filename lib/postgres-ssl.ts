import { parse } from "pg-connection-string"
import { rootCertificates } from "node:tls"
import type { PoolConfig } from "pg"

/**
 * Turning a Supabase connection URL into node-postgres pool settings.
 *
 * This exists because of one silent behaviour change in the Prisma 7 upgrade,
 * which took the preview deployment's login down and would have taken
 * production's down the same way.
 *
 * Prisma 5 connected through its own Rust engine, which reads `sslmode=require`
 * the way libpq does: encrypt the connection, do not check who is on the other
 * end. Prisma 7 connects through node-postgres, and pg-connection-string reads
 * the same `sslmode=require` as `verify-full`. Supabase presents a chain signed
 * by their own root, which is in nobody's trust store, so every query died with:
 *
 *     Error opening a TLS connection: self-signed certificate in certificate chain
 *     code: P1011   DriverAdapterError: TlsConnectionError
 *
 * The easy fix is rejectUnauthorized: false, which reproduces Prisma 5's
 * behaviour exactly and is what most of the internet suggests. This does not do
 * that. The certificate is now actually verified — against Supabase's published
 * root, pinned below, alongside Node's built-in roots so a host with an ordinary
 * public certificate still validates normally. That is strictly better than what
 * this app ran on before the upgrade, rather than a restoration of it.
 *
 * Two smaller things the same parsing step has to handle:
 *
 *  - `pgbouncer=true` and `connection_limit=1` are Prisma's own query
 *    parameters. node-postgres does not know them. They are dropped rather than
 *    forwarded — a stray unknown key reaching the server as a startup parameter
 *    is a connection error, not a warning.
 *
 *  - `connect_timeout` is libpq's spelling, in seconds. node-postgres wants
 *    connectionTimeoutMillis and silently ignores the other, which would leave a
 *    hung connect with no ceiling inside a function that has one.
 *
 *  - `sslmode` is read here rather than by pg-connection-string, and taken out
 *    of the string before it is handed over. See the comment at the parse.
 *
 * An explicit `ssl` cannot simply be passed alongside `connectionString`: pg
 * resolves the URL's sslmode first and the option is ignored. So the URL is
 * parsed here and the fields are handed over individually.
 */

// Supabase Root 2021 CA — the issuer of the certificate their database and
// pooler endpoints present. Valid until 2031-04-26. Inlined rather than read
// from a file because a file has to survive serverless bundling and this has to
// work on the first request, in a function whose working directory is not
// something to rely on.
const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`

export function poolConfigFrom(connectionString: string, extra: PoolConfig = {}): PoolConfig {
    // pg-connection-string reads `sslmode` itself, and for every mode but
    // verify-full it prints a process warning saying the mode will change
    // meaning in its next major version. That warning fires once per process,
    // so on a serverless platform it fires on every cold start — it was the
    // single loudest thing in production's error log, with real failures to be
    // found underneath it.
    //
    // Silencing it by writing sslmode=verify-full into DATABASE_URL would work,
    // but it would leave this file's behaviour depending on a setting nobody
    // can see from here. The mode is read here instead and removed before the
    // string is handed over. Nothing is lost: the only thing the library's
    // reading was ever used for is the yes-or-no below, and the TLS settings
    // are written out in full either way. It also means the semantics change
    // the warning announces cannot quietly reach this connection.
    const queryAt = connectionString.indexOf("?")
    const params = new URLSearchParams(queryAt === -1 ? "" : connectionString.slice(queryAt + 1))
    const sslmode = params.get("sslmode")?.trim().toLowerCase() ?? null
    params.delete("sslmode")
    const remaining = params.toString()
    const base = queryAt === -1 ? connectionString : connectionString.slice(0, queryAt)
    const parsed = parse(remaining ? `${base}?${remaining}` : base)

    const config: PoolConfig = {
        host: parsed.host ?? undefined,
        port: parsed.port ? Number(parsed.port) : undefined,
        user: parsed.user ?? undefined,
        password: parsed.password ?? undefined,
        database: parsed.database ?? undefined,
        ...extra,
    }

    // Only when the URL asked for TLS. A plain local postgres has no sslmode and
    // must stay unencrypted, or development and the tests stop working. Every
    // mode other than `disable` gets the same treatment — a verified connection
    // against the pinned root — because the weaker modes exist to tolerate a
    // certificate this code already knows how to check.
    // pg-connection-string turns `ssl=1`/`ssl=true` into true and `ssl=0` into
    // false, but leaves `ssl=false` as the string "false" — which is truthy, and
    // would have quietly forced TLS onto a URL that asked for the opposite. It
    // is spelled out here rather than relying on truthiness.
    const sslParam = parsed.ssl
    const askedForTls =
        sslmode !== null ? sslmode !== "disable" : sslParam === true || sslParam === "true"

    if (askedForTls) {
        config.ssl = {
            rejectUnauthorized: true,
            ca: [...rootCertificates, SUPABASE_ROOT_CA],
        }
    } else if (sslmode !== null || sslParam !== undefined) {
        // Asked for, and asked against: sslmode=disable, ssl=0, ssl=false.
        config.ssl = false
    }

    const connectSeconds = Number((parsed as Record<string, unknown>).connect_timeout)
    if (Number.isFinite(connectSeconds) && connectSeconds > 0) {
        config.connectionTimeoutMillis = connectSeconds * 1000
    }

    return config
}
