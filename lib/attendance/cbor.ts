/**
 * Just enough CBOR (RFC 8949) to read Apple's App Attest objects: maps,
 * arrays, byte and text strings, integers, simple values. Definite lengths
 * only, which is all Apple sends. Anything else is refused rather than
 * guessed at: this reads data from a phone.
 */

/** A malformed object from a phone: caught by the verifier, never an answer of its own. */
export class CborError extends Error {}

export type Cbor = number | bigint | string | Buffer | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>

export function decodeCbor(data: Buffer): Cbor {
    const { value, end } = item(data, 0, 0)
    if (end !== data.length) throw new CborError("CBOR_TRAILING_BYTES")
    return value
}

const MAX_DEPTH = 16

function item(data: Buffer, at: number, depth: number): { value: Cbor; end: number } {
    if (depth > MAX_DEPTH) throw new CborError("CBOR_TOO_DEEP")
    if (at >= data.length) throw new CborError("CBOR_TRUNCATED")
    const head = data[at]
    const major = head >> 5
    const { n, end: afterHead } = argument(data, at, head & 0x1f)
    switch (major) {
        case 0: return { value: n, end: afterHead }
        case 1: return { value: typeof n === "bigint" ? BigInt(-1) - n : -1 - n, end: afterHead }
        case 2:
        case 3: {
            const length = Number(n)
            const end = afterHead + length
            if (end > data.length) throw new CborError("CBOR_TRUNCATED")
            const bytes = data.subarray(afterHead, end)
            return { value: major === 2 ? Buffer.from(bytes) : bytes.toString("utf8"), end }
        }
        case 4: {
            const out: Cbor[] = []
            let end = afterHead
            for (let i = 0; i < Number(n); i++) {
                const next = item(data, end, depth + 1)
                out.push(next.value)
                end = next.end
            }
            return { value: out, end }
        }
        case 5: {
            const out = new Map<Cbor, Cbor>()
            let end = afterHead
            for (let i = 0; i < Number(n); i++) {
                const key = item(data, end, depth + 1)
                const value = item(data, key.end, depth + 1)
                out.set(key.value, value.value)
                end = value.end
            }
            return { value: out, end }
        }
        case 7: {
            const simple = head & 0x1f
            if (simple === 20) return { value: false, end: at + 1 }
            if (simple === 21) return { value: true, end: at + 1 }
            if (simple === 22) return { value: null, end: at + 1 }
            if (simple === 23) return { value: undefined, end: at + 1 }
            throw new CborError("CBOR_UNSUPPORTED")
        }
        default:
            // Tags (6) and anything indefinite: not in App Attest objects.
            throw new CborError("CBOR_UNSUPPORTED")
    }
}

function argument(data: Buffer, at: number, info: number): { n: number | bigint; end: number } {
    if (info < 24) return { n: info, end: at + 1 }
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0
    if (!size) throw new CborError("CBOR_UNSUPPORTED")
    if (at + 1 + size > data.length) throw new CborError("CBOR_TRUNCATED")
    if (size === 8) {
        const big = data.readBigUInt64BE(at + 1)
        return { n: big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big, end: at + 9 }
    }
    return { n: data.readUIntBE(at + 1, size), end: at + 1 + size }
}
