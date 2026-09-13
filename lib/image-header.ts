/**
 * Reads an image's real format and pixel dimensions out of its own bytes.
 *
 * Two jobs, and the second is the reason this exists rather than a size check.
 *
 * The obvious one is enforcing a dimension cap: a 6000×6000 logo is a valid
 * PNG that happens to cost every page load a few megabytes of decode.
 *
 * The one that matters more is that this is a **content check, not a name
 * check**. `/api/upload` validates the extension, and lib/storage.ts derives
 * the stored content-type from that extension precisely because `file.type` is
 * whatever the client claims. But the extension is client-supplied too. An SVG
 * renamed to logo.png is refused here because it has no PNG signature — which
 * is what actually keeps a `<script>`-carrying document out of a bucket that
 * serves its files publicly. Refusing ".svg" by name alone never did that.
 *
 * Returns null for anything it cannot positively identify. That is deliberate:
 * an allow-list of three formats it can parse, and everything else — including
 * formats that are perfectly legitimate — is somebody else's problem.
 */

export type ImageInfo = {
    format: "png" | "jpeg" | "webp"
    width: number
    height: number
}

/** PNG: an 8-byte signature, then an IHDR chunk whose payload starts with w/h. */
function readPng(b: Buffer): ImageInfo | null {
    if (b.length < 24) return null
    const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < SIGNATURE.length; i++) {
        if (b[i] !== SIGNATURE[i]) return null
    }
    // The first chunk of a PNG must be IHDR. If it is not, this is not a PNG
    // we are willing to vouch for.
    if (b.toString("ascii", 12, 16) !== "IHDR") return null
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/**
 * JPEG: a chain of segments. Dimensions live in whichever Start Of Frame
 * marker this file happens to use — there are eleven, varying by compression
 * (baseline, progressive, arithmetic, lossless), and a file has exactly one.
 */
function readJpeg(b: Buffer): ImageInfo | null {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null

    let offset = 2
    while (offset + 9 < b.length) {
        // Segments are 0xFF then a marker byte. Padding 0xFF bytes between
        // segments are legal and must be skipped rather than treated as one.
        if (b[offset] !== 0xff) return null
        let marker = b[offset + 1]
        while (marker === 0xff && offset + 2 < b.length) {
            offset++
            marker = b[offset + 1]
        }

        // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the
        // range but are not frame headers.
        const isStartOfFrame =
            marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

        if (isStartOfFrame) {
            // length(2) precision(1) height(2) width(2)
            return {
                format: "jpeg",
                height: b.readUInt16BE(offset + 5),
                width: b.readUInt16BE(offset + 7),
            }
        }

        // Start of Scan means the entropy-coded image data begins; there is no
        // frame header after it, so stop rather than read compressed bytes as
        // if they were segment lengths.
        if (marker === 0xda) return null

        const length = b.readUInt16BE(offset + 2)
        // A segment length counts its own two bytes, so anything under 2 is
        // malformed and would make this loop stand still or walk backwards.
        if (length < 2) return null
        offset += 2 + length
    }
    return null
}

/**
 * WebP: a RIFF container with three possible payloads. Dimensions sit in a
 * different place, in a different byte order, in each one — and the extended
 * form (VP8X) is the only one that carries a canvas size, which is what an
 * animated or alpha-channel WebP reports as its real size.
 */
function readWebp(b: Buffer): ImageInfo | null {
    // Enough for the container header and the chunk id; each branch below then
    // checks what its own layout needs. A single up-front length covering the
    // largest of them would reject a valid lossless file, whose dimensions sit
    // five bytes earlier than a lossy one's.
    if (b.length < 16) return null
    if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null

    const chunk = b.toString("ascii", 12, 16)

    if (chunk === "VP8X") {
        if (b.length < 30) return null
        // 4 bytes of flags, then canvas width-1 and height-1 as 24-bit LE.
        const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16))
        const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16))
        return { format: "webp", width, height }
    }

    if (chunk === "VP8 ") {
        // Lossy: a 3-byte frame tag, a 3-byte start code, then 14-bit LE w/h.
        if (b.length < 30) return null
        if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
        return {
            format: "webp",
            width: b.readUInt16LE(26) & 0x3fff,
            height: b.readUInt16LE(28) & 0x3fff,
        }
    }

    if (chunk === "VP8L") {
        // Lossless: a 0x2F signature, then width-1 and height-1 packed as two
        // 14-bit fields across four bytes, low bits first.
        if (b.length < 25) return null
        if (b[20] !== 0x2f) return null
        const bits = b.readUInt32LE(21)
        return {
            format: "webp",
            width: 1 + (bits & 0x3fff),
            height: 1 + ((bits >> 14) & 0x3fff),
        }
    }

    return null
}

/** The real format and size of an image, or null if it is not one we accept. */
export function readImageHeader(bytes: Buffer): ImageInfo | null {
    const info = readPng(bytes) || readJpeg(bytes) || readWebp(bytes)
    if (!info) return null
    // A zero dimension is not a picture, whatever the header says.
    if (info.width <= 0 || info.height <= 0) return null
    return info
}
