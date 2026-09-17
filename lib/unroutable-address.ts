/**
 * Addresses that cannot reach a person, and are not allowed to try.
 *
 * Demo and seeded accounts need email addresses. Any address that looks
 * plausible is an address that might be somebody's, and a test payslip landing
 * in a stranger's inbox is not a bug you get to fix afterwards — the message
 * has already arrived. So demo data uses the reserved names the IETF set aside
 * for exactly this, and the mail layer refuses to send to them rather than
 * relying on nobody ever pressing the wrong button.
 *
 * RFC 2606 and RFC 6761 reserve these. `.invalid` is the one to reach for: it
 * is guaranteed never to resolve, so a message to it cannot be delivered even
 * by accident. The others are reserved too and equally cannot reach a person —
 * the example.* domains do resolve, to IANA's own servers, so a message there
 * bounces rather than arriving, which is the same outcome by a different route.
 */

/** Reserved top-level domains. Nothing under them belongs to anybody. */
export const RESERVED_TLDS = ["invalid", "test", "example", "localhost"] as const

/** Reserved second-level domains, kept by IANA for documentation. */
export const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"] as const

/** The domain demo data uses. One place, so a seed and a guard cannot drift. */
export const DEMO_EMAIL_DOMAIN = "nizmo-demo.invalid"

/**
 * True when nothing sent here could ever reach a person.
 *
 * Deliberately conservative about what counts as an address: anything this
 * cannot parse is treated as unroutable, because an address the mail layer
 * cannot understand is not one it should be handing to a mail server either.
 */
export function isUnroutableAddress(address: string | null | undefined): boolean {
    if (typeof address !== "string") return true

    const trimmed = address.trim().toLowerCase()
    const at = trimmed.lastIndexOf("@")
    // No domain part at all, or an empty one on either side.
    if (at <= 0 || at === trimmed.length - 1) return true

    const domain = trimmed.slice(at + 1).replace(/\.$/, "")
    if (domain.length === 0) return true

    if ((RESERVED_DOMAINS as readonly string[]).includes(domain)) return true

    // A bare hostname with no dot — "root@localhost" — reaches the machine it
    // was typed on and nowhere else.
    if (!domain.includes(".")) return true

    const tld = domain.slice(domain.lastIndexOf(".") + 1)
    return (RESERVED_TLDS as readonly string[]).includes(tld)
}

/** An address for a seeded person, guaranteed to be unroutable. */
export function demoAddress(localPart: string): string {
    const safe = localPart.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
    if (!safe) throw new Error(`Cannot build a demo address from ${JSON.stringify(localPart)}`)
    return `${safe}@${DEMO_EMAIL_DOMAIN}`
}
