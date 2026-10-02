import { createServer, type Server, type Socket } from "node:net"
import { CMD, Framer, USHRT_MAX, checksum, commKey, encodeTime, frame, parsePayload, type AttendanceRecord } from "../src/zk/protocol"

/**
 * A simulated ZKTeco terminal, for tests: the part of the protocol the agent
 * speaks, answered the way the devices answer it. It checks every packet's
 * checksum as the reference implementations compute it, so a client that
 * frames differently from a real device fails here too.
 *
 * Large reads go through the buffered path (prepare, chunked read, free),
 * with a chunk sent as a size, several data packets and an acknowledgement;
 * replies can be split into small TCP writes to exercise the framing.
 */

export type FakeDeviceState = {
    serialNumber: string
    name: string
    firmware: string
    clock: string
    password: number
    /** 40 (text user numbers), 16 (numeric) or 8 (slot only). */
    recordSize: 8 | 16 | 40
    users: { uid: number; userNumber: string; name: string }[]
    records: AttendanceRecord[]
    recordsCapacity: number
    disabled: boolean
    /** Replies above this size go through the buffered path. */
    directLimit: number
    /** Data packets within a chunk are at most this big. */
    packetLimit: number
    /** Write replies a few bytes at a time. */
    dribble: boolean
    /** Every command received, by code. */
    log: number[]
    /** A packet whose checksum did not match. */
    badChecksums: number
}

export function fakeState(overrides: Partial<FakeDeviceState> = {}): FakeDeviceState {
    return {
        serialNumber: "SIM-0001", name: "Simulated K40", firmware: "Ver 6.60 Sep 2026", clock: "2026-10-01T09:30:00", password: 0,
        recordSize: 40, users: [], records: [], recordsCapacity: 100_000, disabled: false,
        directLimit: 1024, packetLimit: 4096, dribble: false, log: [], badChecksums: 0,
        ...overrides,
    }
}

function encodeRecords(s: FakeDeviceState): Buffer {
    const rows = s.records.map(r => {
        const b = Buffer.alloc(s.recordSize)
        if (s.recordSize === 8) {
            b.writeUInt16LE(r.uid, 0); b[2] = r.status; b.writeUInt32LE(encodeTime(r.at), 3); b[7] = r.punch
        } else if (s.recordSize === 16) {
            b.writeUInt32LE(Number(r.userNumber), 0); b.writeUInt32LE(encodeTime(r.at), 4); b[8] = r.status; b[9] = r.punch
        } else {
            b.writeUInt16LE(r.uid, 0); b.write(r.userNumber, 2, 24, "latin1"); b[26] = r.status; b.writeUInt32LE(encodeTime(r.at), 27); b[31] = r.punch
        }
        return b
    })
    const body = Buffer.concat(rows)
    const total = Buffer.alloc(4)
    total.writeUInt32LE(body.length)
    return Buffer.concat([total, body])
}

function encodeUsers(s: FakeDeviceState): Buffer {
    // 72-byte entries, as current firmware sends them.
    const rows = s.users.map(u => {
        const b = Buffer.alloc(72)
        b.writeUInt16LE(u.uid, 0); b.write(u.name, 11, 24, "latin1"); b.write(u.userNumber, 48, 24, "latin1")
        return b
    })
    const body = Buffer.concat(rows)
    const total = Buffer.alloc(4)
    total.writeUInt32LE(body.length)
    return Buffer.concat([total, body])
}

export class FakeZkDevice {
    private server: Server
    port = 0
    readonly state: FakeDeviceState

    constructor(overrides: Partial<FakeDeviceState> = {}) {
        this.state = fakeState(overrides)
        this.server = createServer(socket => this.session(socket))
    }

    async start(): Promise<number> {
        await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve))
        this.port = (this.server.address() as { port: number }).port
        return this.port
    }

    async stop(): Promise<void> {
        await new Promise<void>(resolve => this.server.close(() => resolve()))
    }

    private session(socket: Socket) {
        const s = this.state
        const framer = new Framer()
        const sessionId = 0x2b5f
        let authed = s.password === 0
        let prepared: Buffer | null = null

        const reply = (command: number, replyId: number, data: Buffer = Buffer.alloc(0)) => {
            const payload = Buffer.alloc(8 + data.length)
            payload.writeUInt16LE(command, 0)
            payload.writeUInt16LE(sessionId, 4)
            payload.writeUInt16LE(replyId, 6)
            data.copy(payload, 8)
            payload.writeUInt16LE(checksum(payload), 2)
            const bytes = frame(payload)
            if (!s.dribble) return socket.write(bytes)
            for (let i = 0; i < bytes.length; i += 3) socket.write(bytes.subarray(i, i + 3))
        }

        socket.on("data", chunk => {
            for (const raw of framer.push(chunk)) {
                const p = parsePayload(raw)
                s.log.push(p.command)
                // The reference checksum: over the header with the counter one behind.
                const check = Buffer.from(raw)
                check.writeUInt16LE(0, 2)
                check.writeUInt16LE((p.replyId + USHRT_MAX - 1) % USHRT_MAX, 6)
                if (checksum(check) !== p.checksum) s.badChecksums++
                const r = p.replyId
                if (p.command === CMD.CONNECT) { reply(authed ? CMD.ACK_OK : CMD.ACK_UNAUTH, r); continue }
                if (p.command === CMD.AUTH) {
                    authed = p.data.equals(commKey(s.password, sessionId))
                    reply(authed ? CMD.ACK_OK : CMD.ACK_UNAUTH, r)
                    continue
                }
                if (!authed) { reply(CMD.ACK_UNAUTH, r); continue }
                switch (p.command) {
                    case CMD.EXIT: reply(CMD.ACK_OK, r); socket.end(); break
                    case CMD.OPTIONS_RRQ: {
                        const raw = p.data.toString("latin1"), name = raw.includes("\0") ? raw.slice(0, raw.indexOf("\0")) : raw
                        const value = name === "~SerialNumber" ? s.serialNumber : name === "~DeviceName" ? s.name : null
                        if (value === null) reply(CMD.ACK_ERROR, r)
                        else reply(CMD.ACK_OK, r, Buffer.from(`${name}=${value}\0`, "latin1"))
                        break
                    }
                    case CMD.GET_VERSION: reply(CMD.ACK_OK, r, Buffer.from(`${s.firmware}\0`, "latin1")); break
                    case CMD.GET_TIME: { const b = Buffer.alloc(4); b.writeUInt32LE(encodeTime(s.clock)); reply(CMD.ACK_OK, r, b); break }
                    case CMD.GET_FREE_SIZES: {
                        const b = Buffer.alloc(80)
                        b.writeInt32LE(s.users.length, 16); b.writeInt32LE(s.records.length, 32); b.writeInt32LE(s.recordsCapacity, 64)
                        reply(CMD.ACK_OK, r, b)
                        break
                    }
                    case CMD.PREPARE_BUFFER: {
                        const what = p.data.readInt16LE(1)
                        const data = what === CMD.ATTLOG_RRQ ? encodeRecords(s) : what === CMD.USERTEMP_RRQ ? encodeUsers(s) : Buffer.alloc(0)
                        if (data.length <= s.directLimit) { reply(CMD.DATA, r, data); break }
                        prepared = data
                        const ack = Buffer.alloc(5); ack.writeUInt32LE(data.length, 1)
                        reply(CMD.ACK_OK, r, ack)
                        break
                    }
                    case CMD.READ_BUFFER: {
                        if (!prepared) { reply(CMD.ACK_ERROR, r); break }
                        const start = p.data.readInt32LE(0), size = p.data.readInt32LE(4)
                        const chunk = prepared.subarray(start, start + size)
                        if (chunk.length <= s.directLimit) { reply(CMD.DATA, r, chunk); break }
                        const head = Buffer.alloc(4); head.writeUInt32LE(chunk.length)
                        reply(CMD.PREPARE_DATA, r, head)
                        for (let o = 0; o < chunk.length; o += s.packetLimit) reply(CMD.DATA, r, chunk.subarray(o, o + s.packetLimit))
                        reply(CMD.ACK_OK, r)
                        break
                    }
                    case CMD.FREE_DATA: prepared = null; reply(CMD.ACK_OK, r); break
                    case CMD.DISABLEDEVICE: s.disabled = true; reply(CMD.ACK_OK, r); break
                    case CMD.ENABLEDEVICE: s.disabled = false; reply(CMD.ACK_OK, r); break
                    case CMD.CLEAR_ATTLOG: s.records = []; reply(CMD.ACK_OK, r); break
                    default: reply(CMD.ACK_ERROR, r)
                }
            }
        })
        socket.on("error", () => {})
    }

    /** A scan, as the terminal would record it — refused while disabled. */
    scan(userNumber: string, at: string, uid = Number(userNumber) || 1) {
        if (this.state.disabled) return false
        this.state.records.push({ uid, userNumber, at, status: 1, punch: 0 })
        return true
    }
}
