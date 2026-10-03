/**
 * The ZKTeco terminal protocol over TCP (port 4370), as the widely used open
 * implementations speak it (pyzk). Pure functions: framing, checksums, the
 * device's packed time, the password key, and the record layouts. The socket
 * is in client.ts.
 *
 * Every packet on the wire is an 8-byte TCP prefix — 0x50 0x50 0x82 0x7D and
 * the payload's length — then the payload: an 8-byte header (command,
 * checksum, session, reply counter, all little-endian 16-bit) and the data.
 */

export const CMD = {
    CONNECT: 1000,
    EXIT: 1001,
    ENABLEDEVICE: 1002,
    DISABLEDEVICE: 1003,
    AUTH: 1102,
    GET_VERSION: 1100,
    OPTIONS_RRQ: 11,
    USERTEMP_RRQ: 9,
    ATTLOG_RRQ: 13,
    CLEAR_ATTLOG: 15,
    GET_FREE_SIZES: 50,
    GET_TIME: 201,
    PREPARE_DATA: 1500,
    DATA: 1501,
    FREE_DATA: 1502,
    PREPARE_BUFFER: 1503,
    READ_BUFFER: 1504,
    ACK_OK: 2000,
    ACK_ERROR: 2001,
    ACK_DATA: 2002,
    ACK_UNAUTH: 2005,
} as const

/** Users, when reading the user table (only needed for the oldest record layout). */
export const FCT_USER = 5

export const USHRT_MAX = 65535
export const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d])
/** The largest piece of a buffered read the device is asked for at once. */
export const MAX_CHUNK = 0xffc0

/** The device's checksum: a ones'-complement sum of 16-bit little-endian words. */
export function checksum(bytes: Uint8Array): number {
    let sum = 0
    let i = 0
    for (; i + 1 < bytes.length; i += 2) {
        sum += bytes[i] | (bytes[i + 1] << 8)
        if (sum > USHRT_MAX) sum -= USHRT_MAX
    }
    if (i < bytes.length) sum += bytes[bytes.length - 1]
    while (sum > USHRT_MAX) sum -= USHRT_MAX
    sum = ~sum
    while (sum < 0) sum += USHRT_MAX
    return sum & 0xffff
}

/**
 * One command packet, framed for TCP. As the reference implementations do,
 * the checksum is taken over the header with the reply counter as it was,
 * and the packet carries the counter advanced by one; devices expect that.
 */
export function commandPacket(command: number, data: Uint8Array, sessionId: number, replyId: number): Buffer {
    const unsigned = Buffer.alloc(8 + data.length)
    unsigned.writeUInt16LE(command, 0)
    unsigned.writeUInt16LE(0, 2)
    unsigned.writeUInt16LE(sessionId, 4)
    unsigned.writeUInt16LE(replyId, 6)
    Buffer.from(data).copy(unsigned, 8)
    const sum = checksum(unsigned)
    let next = replyId + 1
    if (next >= USHRT_MAX) next -= USHRT_MAX
    const payload = Buffer.alloc(8 + data.length)
    payload.writeUInt16LE(command, 0)
    payload.writeUInt16LE(sum, 2)
    payload.writeUInt16LE(sessionId, 4)
    payload.writeUInt16LE(next, 6)
    Buffer.from(data).copy(payload, 8)
    return frame(payload)
}

/** The TCP prefix around a payload. */
export function frame(payload: Buffer): Buffer {
    const prefix = Buffer.alloc(8)
    TCP_MAGIC.copy(prefix, 0)
    prefix.writeUInt32LE(payload.length, 4)
    return Buffer.concat([prefix, payload])
}

export type Packet = { command: number; checksum: number; sessionId: number; replyId: number; data: Buffer }

export function parsePayload(payload: Buffer): Packet {
    if (payload.length < 8) throw new Error("ZK_SHORT_PACKET")
    return {
        command: payload.readUInt16LE(0),
        checksum: payload.readUInt16LE(2),
        sessionId: payload.readUInt16LE(4),
        replyId: payload.readUInt16LE(6),
        data: payload.subarray(8),
    }
}

/**
 * Splits a TCP byte stream into payloads. Feed it whatever arrives; it
 * returns the complete payloads and keeps the rest for the next call.
 */
export class Framer {
    private pending = Buffer.alloc(0)

    push(chunk: Buffer): Buffer[] {
        this.pending = Buffer.concat([this.pending, chunk])
        const out: Buffer[] = []
        while (this.pending.length >= 8) {
            if (!this.pending.subarray(0, 4).equals(TCP_MAGIC)) throw new Error("ZK_BAD_FRAME")
            const length = this.pending.readUInt32LE(4)
            if (this.pending.length < 8 + length) break
            out.push(this.pending.subarray(8, 8 + length))
            this.pending = this.pending.subarray(8 + length)
        }
        return out
    }
}

/** A wall-clock time as the device packs it into 32 bits: years from 2000, months of 31 days. */
export function encodeTime(local: string): number {
    const [d, t] = local.split("T")
    const [year, month, day] = d.split("-").map(Number)
    const [hour, minute, second] = t.split(":").map(Number)
    return (((year % 100) * 12 * 31 + (month - 1) * 31 + day - 1) * 86400 + (hour * 60 + minute) * 60 + second) >>> 0
}

/** The device's packed time, as "YYYY-MM-DDTHH:mm:ss" on its own clock. */
export function decodeTime(packed: number): string {
    let t = packed
    const second = t % 60; t = Math.floor(t / 60)
    const minute = t % 60; t = Math.floor(t / 60)
    const hour = t % 24; t = Math.floor(t / 24)
    const day = (t % 31) + 1; t = Math.floor(t / 31)
    const month = (t % 12) + 1; t = Math.floor(t / 12)
    const year = t + 2000
    const p = (n: number, w = 2) => String(n).padStart(w, "0")
    return `${p(year, 4)}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:${p(second)}`
}

/** The key a password-protected device expects in reply to CMD_AUTH, from its numeric comm password and the session. */
export function commKey(password: number, sessionId: number, ticks = 50): Buffer {
    // The password's 32 bits, reversed, plus the session — modulo 2³².
    let k = 0
    for (let i = 0; i < 32; i++) k = ((k << 1) | ((password >>> i) & 1)) >>> 0
    k = (k + sessionId) % 0x100000000
    const b = Buffer.alloc(4)
    b.writeUInt32LE(k)
    const x = [b[0] ^ 0x5a, b[1] ^ 0x4b, b[2] ^ 0x53, b[3] ^ 0x4f] // "ZKSO"
    // Swap the two 16-bit halves.
    const swapped = [x[2], x[3], x[0], x[1]]
    const B = ticks & 0xff
    return Buffer.from([swapped[0] ^ B, swapped[1] ^ B, B, swapped[3] ^ B])
}

/** A null-terminated string field. */
const text = (b: Buffer) => {
    const end = b.indexOf(0)
    return b.subarray(0, end === -1 ? b.length : end).toString("latin1").trim()
}

export type AttendanceRecord = { uid: number; userNumber: string; at: string; status: number; punch: number }
export type User = { uid: number; userNumber: string; name: string }

/**
 * The user table, after its 4-byte total: entries of 28 bytes (older
 * firmware) or 72 bytes. Needed only to name the people in the oldest,
 * 8-byte attendance records, which carry the internal slot number alone.
 */
export function parseUsers(data: Buffer, userCount: number): User[] {
    if (data.length < 4 || userCount === 0) return []
    const total = data.readUInt32LE(0)
    const body = data.subarray(4, 4 + total)
    const size = Math.round(total / userCount)
    const users: User[] = []
    for (let o = 0; o + size <= body.length; o += size) {
        const e = body.subarray(o, o + size)
        if (size === 28) users.push({ uid: e.readUInt16LE(0), name: text(e.subarray(8, 16)), userNumber: String(e.readUInt32LE(24)) })
        else users.push({ uid: e.readUInt16LE(0), name: text(e.subarray(11, 35)), userNumber: text(e.subarray(48, 72)) })
    }
    return users
}

/**
 * The attendance log, after its 4-byte total, in the order the device wrote
 * it. Three layouts by record size: 8 bytes (slot number only), 16 bytes
 * (numeric user number), 40 bytes (user number as text, the usual one).
 */
export function parseAttendance(data: Buffer, recordCount: number, users: User[] = []): AttendanceRecord[] {
    if (data.length < 4 || recordCount === 0) return []
    const total = data.readUInt32LE(0)
    const body = data.subarray(4, 4 + total)
    const size = Math.round(total / recordCount)
    const byUid = new Map(users.map(u => [u.uid, u.userNumber]))
    const out: AttendanceRecord[] = []
    for (let o = 0; o + size <= body.length; o += size) {
        const r = body.subarray(o, o + size)
        if (size === 8) {
            const uid = r.readUInt16LE(0)
            out.push({ uid, userNumber: byUid.get(uid) ?? String(uid), status: r[2], at: decodeTime(r.readUInt32LE(3)), punch: r[7] })
        } else if (size === 16) {
            out.push({ uid: 0, userNumber: String(r.readUInt32LE(0)), at: decodeTime(r.readUInt32LE(4)), status: r[8], punch: r[9] })
        } else {
            out.push({ uid: r.readUInt16LE(0), userNumber: text(r.subarray(2, 26)), status: r[26], at: decodeTime(r.readUInt32LE(27)), punch: r[31] })
        }
    }
    return out
}

/** What CMD_GET_FREE_SIZES says, from its twenty 32-bit fields. */
export function parseSizes(data: Buffer) {
    const f = (i: number) => (data.length >= (i + 1) * 4 ? data.readInt32LE(i * 4) : 0)
    return { users: f(4), fingers: f(6), records: f(8), cards: f(12), fingersCapacity: f(14), usersCapacity: f(15), recordsCapacity: f(16) }
}

/** An option the device answers as "~Name=value". */
export function optionValue(data: Buffer, name: string): string | null {
    const s = text(data)
    const prefix = `${name}=`
    return s.startsWith(prefix) ? s.slice(prefix.length) : null
}
