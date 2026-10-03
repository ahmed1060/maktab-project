import { describe, it, expect } from "vitest"
import { ipInRanges, normaliseIpRange } from "./ip-ranges"

describe("office IP ranges (§9.4)", () => {
    it("accepts an address or a CIDR range, IPv4 or IPv6, and nothing else", () => {
        expect(normaliseIpRange(" 203.0.113.7 ")).toBe("203.0.113.7")
        expect(normaliseIpRange("203.0.113.0/28")).toBe("203.0.113.0/28")
        expect(normaliseIpRange("2001:db8::/48")).toBe("2001:db8::/48")
        expect(normaliseIpRange("::ffff:203.0.113.7")).toBe("203.0.113.7")
        for (const bad of ["", "office", "203.0.113", "203.0.113.7/33", "2001:db8::/129", "203.0.113.0/2a", "1.2.3.4/8/8", "300.1.1.1"]) {
            expect(normaliseIpRange(bad), bad).toBeNull()
        }
    })

    it("matches an address against single addresses and ranges", () => {
        const office = ["203.0.113.7", "198.51.100.0/24", "2001:db8:1::/48"]
        expect(ipInRanges("203.0.113.7", office)).toBe(true)
        expect(ipInRanges("203.0.113.8", office)).toBe(false)
        expect(ipInRanges("198.51.100.200", office)).toBe(true)
        expect(ipInRanges("198.51.101.1", office)).toBe(false)
        expect(ipInRanges("2001:db8:1:ffff::1", office)).toBe(true)
        expect(ipInRanges("2001:db8:2::1", office)).toBe(false)
        // An IPv4 address as an IPv6 socket reports it.
        expect(ipInRanges("::ffff:198.51.100.9", office)).toBe(true)
        expect(ipInRanges("not an address", office)).toBe(false)
        expect(ipInRanges("203.0.113.7", [])).toBe(false)
    })
})
