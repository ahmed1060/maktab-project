import { X509Certificate } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * A terminal's own certificate, signed by nobody, as a Hikvision terminal
 * has: made with openssl for the test, in a folder of its own, and never
 * kept (PR 302).
 */
export function selfSigned(name = "DS-K1T341AM"): { cert: string; key: string; fingerprint: string } {
    const dir = mkdtempSync(join(tmpdir(), "hik-tls-"))
    try {
        execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", `/CN=${name}`,
            "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" })
        const cert = readFileSync(join(dir, "cert.pem"), "utf8")
        return { cert, key: readFileSync(join(dir, "key.pem"), "utf8"), fingerprint: new X509Certificate(cert).fingerprint256 }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}
