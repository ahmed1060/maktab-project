import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import QRCode from "qrcode"
import { readImageHeader } from "./image-header"

/** A RIFF/WEBP container wrapping one chunk, built to the spec by hand. */
function webp(chunkId: string, payload: Buffer): Buffer {
    const head = Buffer.alloc(16)
    head.write("RIFF", 0, "ascii")
    head.writeUInt32LE(4 + 8 + payload.length, 4)
    head.write("WEBP", 8, "ascii")
    head.write(chunkId, 12, "ascii")
    const size = Buffer.alloc(4)
    size.writeUInt32LE(payload.length, 0)
    return Buffer.concat([head, size, payload])
}

function webpExtended(width: number, height: number): Buffer {
    const payload = Buffer.alloc(10)
    const w = width - 1
    const h = height - 1
    payload[4] = w & 0xff; payload[5] = (w >> 8) & 0xff; payload[6] = (w >> 16) & 0xff
    payload[7] = h & 0xff; payload[8] = (h >> 8) & 0xff; payload[9] = (h >> 16) & 0xff
    return webp("VP8X", payload)
}

function webpLossy(width: number, height: number): Buffer {
    const payload = Buffer.alloc(10)
    payload[3] = 0x9d; payload[4] = 0x01; payload[5] = 0x2a
    payload.writeUInt16LE(width, 6)
    payload.writeUInt16LE(height, 8)
    return webp("VP8 ", payload)
}

function webpLossless(width: number, height: number): Buffer {
    const payload = Buffer.alloc(5)
    payload[0] = 0x2f
    payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 1)
    return webp("VP8L", payload)
}

/** A JPEG built from a list of [marker, payload] segments, after the SOI. */
function jpeg(segments: Array<[number, Buffer]>, pad = 0): Buffer {
    const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
    for (const [marker, payload] of segments) {
        // Padding 0xFF bytes before a marker are legal and appear in the wild.
        if (pad > 0) parts.push(Buffer.alloc(pad, 0xff))
        const header = Buffer.alloc(4)
        header[0] = 0xff
        header[1] = marker
        header.writeUInt16BE(payload.length + 2, 2)
        parts.push(header, payload)
    }
    return Buffer.concat(parts)
}

function sofPayload(width: number, height: number): Buffer {
    const p = Buffer.alloc(15)
    p[0] = 8 // sample precision
    p.writeUInt16BE(height, 1)
    p.writeUInt16BE(width, 3)
    return p
}

describe("reading a real image off disk", () => {
    it("reads the JPEG this repo actually ships", () => {
        // Cross-checked against an independent scan of the same file's segment
        // chain: SOF0 at 1024x1024. A fixture built by the same understanding
        // that wrote the parser proves only that the two agree with each other.
        const info = readImageHeader(readFileSync("public/shsd-logo.jpg"))
        expect(info).toEqual({ format: "jpeg", width: 1024, height: 1024 })
    })

    it("reads a PNG produced by a real encoder", async () => {
        const png = await QRCode.toBuffer("nizmo", { width: 321 })
        expect(readImageHeader(png)).toEqual({ format: "png", width: 321, height: 321 })
    })
})

describe("PNG", () => {
    it("rejects a file whose signature is right but whose first chunk is not IHDR", () => {
        const png = Buffer.alloc(24)
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
        png.write("IDAT", 12, "ascii")
        expect(readImageHeader(png)).toBeNull()
    })

    it("rejects a truncated header rather than reading past the end", async () => {
        const png = await QRCode.toBuffer("nizmo", { width: 100 })
        expect(readImageHeader(png.subarray(0, 20))).toBeNull()
    })

    it("rejects a zero dimension, whatever the header claims", () => {
        const png = Buffer.alloc(24)
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
        png.write("IHDR", 12, "ascii")
        png.writeUInt32BE(0, 16)
        png.writeUInt32BE(64, 20)
        expect(readImageHeader(png)).toBeNull()
    })
})

describe("JPEG", () => {
    it("finds the frame header past the metadata segments in front of it", () => {
        // A real JPEG opens with JFIF/EXIF/comment segments; the dimensions are
        // not at a fixed offset, which is the whole reason this walks the chain.
        const file = jpeg([
            [0xe0, Buffer.alloc(14)], // APP0/JFIF
            [0xe1, Buffer.alloc(40)], // APP1/EXIF
            [0xfe, Buffer.alloc(9)], // COM
            [0xc0, sofPayload(640, 480)],
        ])
        expect(readImageHeader(file)).toEqual({ format: "jpeg", width: 640, height: 480 })
    })

    it("is not fooled by the markers that share the SOF range", () => {
        // C4 is a Huffman table, CC an arithmetic-coding table. Both sit inside
        // C0-CF and neither is a frame header; reading one as a frame header
        // yields dimensions out of a coding table.
        const file = jpeg([
            [0xc4, Buffer.alloc(30)],
            [0xcc, Buffer.alloc(6)],
            [0xc2, sofPayload(800, 600)], // progressive
        ])
        expect(readImageHeader(file)).toEqual({ format: "jpeg", width: 800, height: 600 })
    })

    it("skips fill bytes between segments", () => {
        const file = jpeg([[0xe0, Buffer.alloc(14)], [0xc1, sofPayload(120, 90)]], 3)
        expect(readImageHeader(file)).toEqual({ format: "jpeg", width: 120, height: 90 })
    })

    it("stops at the scan rather than reading compressed data as segments", () => {
        // Past SOS the bytes are entropy-coded and mean nothing to this walk.
        const file = Buffer.concat([
            jpeg([[0xe0, Buffer.alloc(14)], [0xda, Buffer.alloc(10)]]),
            Buffer.alloc(400, 0x5a),
        ])
        expect(readImageHeader(file)).toBeNull()
    })

    it("refuses a segment length that would not advance the walk", () => {
        // A length of 0 or 1 counts less than the two bytes it occupies. Left
        // unchecked the offset stands still and the loop runs to the end of the
        // buffer on every malformed upload.
        const file = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, ...Buffer.alloc(40)])
        expect(readImageHeader(file)).toBeNull()
    })
})

describe("WebP", () => {
    it("reads all three payload forms", () => {
        // Different offsets, different byte order, and two of them store their
        // dimensions minus one. Getting any of it wrong is off-by-one, not a
        // crash, so each form needs its own case.
        expect(readImageHeader(webpLossy(300, 200))).toEqual({ format: "webp", width: 300, height: 200 })
        expect(readImageHeader(webpLossless(300, 200))).toEqual({ format: "webp", width: 300, height: 200 })
        expect(readImageHeader(webpExtended(300, 200))).toEqual({ format: "webp", width: 300, height: 200 })
    })

    it("reads the top of each format's 14-bit range", () => {
        expect(readImageHeader(webpLossy(16383, 16383))).toEqual({ format: "webp", width: 16383, height: 16383 })
        expect(readImageHeader(webpLossless(16384, 16384))).toEqual({ format: "webp", width: 16384, height: 16384 })
    })

    it("rejects a RIFF container that is not WebP at all", () => {
        const wav = Buffer.alloc(40)
        wav.write("RIFF", 0, "ascii")
        wav.write("WAVE", 8, "ascii")
        expect(readImageHeader(wav)).toBeNull()
    })

    it("rejects a lossy chunk without its start code", () => {
        const file = webpLossy(300, 200)
        file[23] = 0x00
        expect(readImageHeader(file)).toBeNull()
    })
})

describe("what it refuses", () => {
    it("refuses an SVG, which is the point of reading bytes instead of names", () => {
        // The format this feature must not accept. Renaming it logo.png defeats
        // an extension check and does nothing to a signature check.
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
        expect(readImageHeader(svg)).toBeNull()
    })

    it("refuses the other things a file picker will hand it", () => {
        const cases: Record<string, Buffer> = {
            pdf: Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "binary"),
            gif: Buffer.from("GIF89a" + "\x10\x00\x10\x00"),
            html: Buffer.from("<!doctype html><html><body>hi</body></html>"),
            zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(40)]),
            empty: Buffer.alloc(0),
            noise: Buffer.alloc(64, 0x42),
        }
        for (const [name, bytes] of Object.entries(cases)) {
            expect(readImageHeader(bytes), name).toBeNull()
        }
    })
})
