import { BlockList, isIP } from "node:net"

/**
 * An office's public IP addresses (ATTENDANCE_PLAN.md §9.4): each entry one
 * address ("203.0.113.7") or a range in CIDR form ("203.0.113.0/28"), IPv4
 * or IPv6. A check-in at a location that has any must come from one of them.
 */

export const MAX_IP_RANGES = 20

/** An IPv4 address as IPv6 shows it ("::ffff:203.0.113.7"), as itself. */
const unmapped = (ip: string) => /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip

/** The entry as written back, or null when it is not an address or range. */
export function normaliseIpRange(entry: string): string | null {
    const [address, prefix, ...rest] = entry.trim().split("/")
    if (rest.length > 0 || !address) return null
    const ip = unmapped(address)
    const family = isIP(ip)
    if (!family) return null
    if (prefix === undefined) return ip
    if (!/^\d{1,3}$/.test(prefix)) return null
    const bits = Number(prefix)
    if (bits > (family === 4 ? 32 : 128)) return null
    return `${ip}/${bits}`
}

/** Whether this address is one of these entries. Entries that do not parse are ignored. */
export function ipInRanges(ip: string, ranges: readonly string[]): boolean {
    const address = unmapped(ip.trim())
    const family = isIP(address)
    if (!family) return false
    const list = new BlockList()
    for (const entry of ranges) {
        const range = normaliseIpRange(entry)
        if (!range) continue
        const [base, prefix] = range.split("/")
        const type = isIP(base) === 4 ? "ipv4" : "ipv6"
        if (prefix === undefined) list.addAddress(base, type)
        else list.addSubnet(base, Number(prefix), type)
    }
    return list.check(address, family === 4 ? "ipv4" : "ipv6")
}
