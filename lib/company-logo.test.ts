import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import QRCode from "qrcode"
import {
    MAX_LOGO_BYTES,
    MAX_LOGO_DIMENSION,
    MIN_LOGO_DIMENSION,
    bucketPathFor,
    logoExtension,
    validateLogo,
} from "./company-logo"

/** A PNG header claiming any size, with padding to a chosen byte length. */
function pngClaiming(width: number, height: number, totalBytes = 64): Buffer {
    const b = Buffer.alloc(Math.max(totalBytes, 24))
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
    b.write("IHDR", 12, "ascii")
    b.writeUInt32BE(width, 16)
    b.writeUInt32BE(height, 20)
    return b
}

describe("accepting a logo", () => {
    it("accepts an ordinary PNG", async () => {
        const png = await QRCode.toBuffer("nizmo", { width: 256 })
        expect(validateLogo(png)).toEqual({ ok: true, info: { format: "png", width: 256, height: 256 } })
    })

    it("accepts a JPG, which is what most customers actually have", () => {
        // Transparency is not required, and that is a decision rather than an
        // oversight: the sidebar is dark in both themes, so a transparent logo
        // with dark artwork would be just as invisible as an opaque white one.
        // The plate is what makes either readable, and it makes JPG fine.
        const info = validateLogo(readFileSync("public/shsd-logo.jpg"))
        expect(info).toEqual({ ok: true, info: { format: "jpeg", width: 1024, height: 1024 } })
    })
})

describe("refusing a logo", () => {
    it("refuses an SVG even when it is called logo.png", () => {
        // The one refusal the plan asked for by name. It holds because the
        // check reads bytes: nothing about this call knows or cares what the
        // file was named, which is the only version of the check that works,
        // since the name is chosen by whoever is uploading.
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/users")</script></svg>')
        expect(validateLogo(svg)).toEqual({ ok: false, reason: "unreadable" })
    })

    it("refuses an empty file", () => {
        expect(validateLogo(Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" })
    })

    it("refuses a file over the size cap before decoding anything", () => {
        // Size is checked first on purpose: a 50 MB upload should be refused on
        // its length, not after its header has been walked.
        const huge = Buffer.alloc(MAX_LOGO_BYTES + 1)
        expect(validateLogo(huge)).toEqual({ ok: false, reason: "too_large", bytes: MAX_LOGO_BYTES + 1 })
    })

    it("refuses an image that is too many pixels even when the file is small", () => {
        // The case a size cap alone misses: a mostly-flat 6000x6000 PNG
        // compresses to a few kilobytes and still costs every page load its
        // decode. Rendered at 2rem, nobody sees the difference.
        const result = validateLogo(pngClaiming(6000, 6000))
        expect(result).toEqual({
            ok: false,
            reason: "too_big_pixels",
            info: { format: "png", width: 6000, height: 6000 },
        })
    })

    it("refuses something too small to be a logo", () => {
        const result = validateLogo(pngClaiming(1, 1))
        expect(result.ok).toBe(false)
        expect(result.ok === false && result.reason).toBe("too_small_pixels")
    })

    it("accepts exactly the bounds, and refuses one step past each", () => {
        expect(validateLogo(pngClaiming(MAX_LOGO_DIMENSION, MAX_LOGO_DIMENSION)).ok).toBe(true)
        expect(validateLogo(pngClaiming(MAX_LOGO_DIMENSION + 1, MAX_LOGO_DIMENSION)).ok).toBe(false)
        expect(validateLogo(pngClaiming(MIN_LOGO_DIMENSION, MIN_LOGO_DIMENSION)).ok).toBe(true)
        expect(validateLogo(pngClaiming(MIN_LOGO_DIMENSION, MIN_LOGO_DIMENSION - 1)).ok).toBe(false)
    })

    it("refuses the file types a picker will happily offer", () => {
        const cases: Record<string, Buffer> = {
            pdf: Buffer.from("%PDF-1.7\n"),
            gif: Buffer.from("GIF89a\x10\x00\x10\x00"),
            html: Buffer.from("<!doctype html><html></html>"),
            ico: Buffer.from([0x00, 0x00, 0x01, 0x00, ...Buffer.alloc(40)]),
        }
        for (const [name, bytes] of Object.entries(cases)) {
            expect(validateLogo(bytes).ok, name).toBe(false)
        }
    })
})

describe("storing it", () => {
    it("names the file from the detected format, not the uploaded name", () => {
        // lib/storage.ts derives the stored content-type from the extension, so
        // this is what stops a mislabelled upload being served back under a
        // content-type that does not match its bytes.
        expect(logoExtension("png")).toBe(".png")
        expect(logoExtension("webp")).toBe(".webp")
        expect(logoExtension("jpeg")).toBe(".jpg")
    })

    it("finds the bucket path behind a stored URL so the old file can go", () => {
        expect(bucketPathFor("https://x.supabase.co/storage/v1/object/public/app-assets/c1/logos/9-ab.png"))
            .toBe("c1/logos/9-ab.png")
    })

    it("answers null for anything that is not one of our bucket URLs", () => {
        // Never hand a delete a path derived from a URL this app did not mint.
        for (const url of [null, undefined, "", "https://evil.example/app-assets", "https://x/app-assets/"]) {
            expect(bucketPathFor(url), String(url)).toBeNull()
        }
    })
})
