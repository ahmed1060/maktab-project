import { Socket } from "node:net"
import {
    CMD, FCT_USER, Framer, MAX_CHUNK, USHRT_MAX, commKey, commandPacket, decodeTime, optionValue, parseAttendance, parsePayload,
    parseSizes, parseUsers, type AttendanceRecord, type Packet,
} from "./protocol"

/**
 * One conversation with a ZKTeco terminal over TCP. Commands go one at a
 * time: each is answered before the next is sent. Reads only, apart from
 * clearing the attendance log, which the agent does only when told to and
 * only once everything in it has been delivered (agent/src/sync.ts).
 */

export type ZkOptions = { host: string; port?: number; password?: number; timeoutMs?: number }

export type DeviceInfo = {
    serialNumber: string
    name: string | null
    firmware: string | null
    /** The terminal's own clock, wall time. */
    clock: string
    users: number
    records: number
    recordsCapacity: number
}

export class ZkError extends Error {
    constructor(code: string, readonly detail?: string) {
        super(detail ? `${code}: ${detail}` : code)
        this.name = "ZkError"
    }
}

const cString = (s: string) => Buffer.from(`${s}\0`, "latin1")

export class ZkClient {
    private socket: Socket | null = null
    private framer = new Framer()
    private inbox: Packet[] = []
    private waiting: { resolve: (p: Packet) => void; reject: (e: Error) => void } | null = null
    private failure: Error | null = null
    private sessionId = 0
    private replyId = USHRT_MAX - 1

    constructor(private readonly options: ZkOptions) {}

    private get timeoutMs() {
        return this.options.timeoutMs ?? 10_000
    }

    async connect(): Promise<void> {
        const socket = new Socket()
        this.socket = socket
        socket.setNoDelay(true)
        socket.on("data", chunk => {
            try {
                for (const payload of this.framer.push(chunk)) this.deliver(parsePayload(payload))
            } catch (e) {
                this.fail(e as Error)
            }
        })
        socket.on("error", e => this.fail(new ZkError("ZK_SOCKET", e.message)))
        socket.on("close", () => this.fail(new ZkError("ZK_CLOSED")))
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { socket.destroy(); reject(new ZkError("ZK_CONNECT_TIMEOUT", this.options.host)) }, this.timeoutMs)
            socket.once("error", e => { clearTimeout(timer); reject(new ZkError("ZK_CONNECT", e.message)) })
            socket.connect(this.options.port ?? 4370, this.options.host, () => { clearTimeout(timer); resolve() })
        })
        try {
            const hello = await this.send(CMD.CONNECT)
            this.sessionId = hello.sessionId
            if (hello.command === CMD.ACK_UNAUTH) {
                const auth = await this.send(CMD.AUTH, commKey(this.options.password ?? 0, this.sessionId))
                if (auth.command !== CMD.ACK_OK) throw new ZkError("ZK_AUTH_FAILED", "the terminal refused its comm password")
            } else if (hello.command !== CMD.ACK_OK) {
                throw new ZkError("ZK_CONNECT_REFUSED", String(hello.command))
            }
        } catch (e) {
            // Not left open: a terminal allows few connections at once.
            socket.destroy()
            this.socket = null
            throw e
        }
    }

    async disconnect(): Promise<void> {
        if (!this.socket) return
        try {
            if (!this.failure) await this.send(CMD.EXIT)
        } catch { /* closing anyway */ }
        this.socket.destroy()
        this.socket = null
    }

    async info(): Promise<DeviceInfo> {
        const serialNumber = await this.option("~SerialNumber")
        if (!serialNumber) throw new ZkError("ZK_NO_SERIAL")
        const name = await this.option("~DeviceName").catch(() => null)
        const firmware = await this.firmware().catch(() => null)
        const sizes = await this.sizes()
        return { serialNumber, name, firmware, clock: await this.clock(), users: sizes.users, records: sizes.records, recordsCapacity: sizes.recordsCapacity }
    }

    async option(name: string): Promise<string | null> {
        const reply = await this.send(CMD.OPTIONS_RRQ, cString(name))
        if (reply.command !== CMD.ACK_OK) return null
        return optionValue(reply.data, name)
    }

    async firmware(): Promise<string | null> {
        const reply = await this.send(CMD.GET_VERSION)
        if (reply.command !== CMD.ACK_OK) return null
        const end = reply.data.indexOf(0)
        return reply.data.subarray(0, end === -1 ? reply.data.length : end).toString("latin1").trim() || null
    }

    async clock(): Promise<string> {
        const reply = await this.expectOk(CMD.GET_TIME)
        return decodeTime(reply.data.readUInt32LE(0))
    }

    async sizes() {
        return parseSizes((await this.expectOk(CMD.GET_FREE_SIZES)).data)
    }

    /** Every attendance record the terminal holds, oldest first. */
    async attendance(): Promise<AttendanceRecord[]> {
        const sizes = await this.sizes()
        if (sizes.records === 0) return []
        const data = await this.readBuffer(CMD.ATTLOG_RRQ)
        const total = data.length >= 4 ? data.readUInt32LE(0) : 0
        // The oldest layout names people by slot only; their numbers are in the user table.
        const users = Math.round(total / sizes.records) === 8 && sizes.users > 0 ? parseUsers(await this.readBuffer(CMD.USERTEMP_RRQ, FCT_USER), sizes.users) : []
        return parseAttendance(data, sizes.records, users)
    }

    /** Stops the terminal taking scans, so nothing is added between reading and clearing its log. */
    async disable(): Promise<void> {
        await this.expectOk(CMD.DISABLEDEVICE)
    }

    async enable(): Promise<void> {
        await this.expectOk(CMD.ENABLEDEVICE)
    }

    async clearAttendance(): Promise<void> {
        await this.expectOk(CMD.CLEAR_ATTLOG)
    }

    // --- the wire -------------------------------------------------------------

    /**
     * A buffered read: asks the device to prepare the data, then fetches it
     * in chunks — each answered either directly, or as a size followed by
     * data packets and an acknowledgement — and lets the device free it.
     */
    private async readBuffer(command: number, fct = 0, ext = 0): Promise<Buffer> {
        const request = Buffer.alloc(11)
        request.writeInt8(1, 0)
        request.writeInt16LE(command, 1)
        request.writeInt32LE(fct, 3)
        request.writeInt32LE(ext, 7)
        const prepared = await this.send(CMD.PREPARE_BUFFER, request)
        if (prepared.command === CMD.DATA) return prepared.data
        if (prepared.command !== CMD.ACK_OK || prepared.data.length < 5) throw new ZkError("ZK_BUFFER_REFUSED", String(prepared.command))
        const size = prepared.data.readUInt32LE(1)
        const parts: Buffer[] = []
        for (let start = 0; start < size; start += MAX_CHUNK) parts.push(await this.readChunk(start, Math.min(MAX_CHUNK, size - start)))
        await this.send(CMD.FREE_DATA)
        return Buffer.concat(parts)
    }

    private async readChunk(start: number, size: number): Promise<Buffer> {
        const request = Buffer.alloc(8)
        request.writeInt32LE(start, 0)
        request.writeInt32LE(size, 4)
        const first = await this.send(CMD.READ_BUFFER, request)
        if (first.command === CMD.DATA) return first.data
        if (first.command !== CMD.PREPARE_DATA) throw new ZkError("ZK_CHUNK_REFUSED", String(first.command))
        const expected = first.data.readUInt32LE(0)
        const parts: Buffer[] = []
        let received = 0
        while (received < expected) {
            const p = await this.receive()
            if (p.command !== CMD.DATA) throw new ZkError("ZK_CHUNK_BROKEN", String(p.command))
            parts.push(p.data)
            received += p.data.length
        }
        const ack = await this.receive()
        if (ack.command !== CMD.ACK_OK) throw new ZkError("ZK_CHUNK_UNACKED", String(ack.command))
        return Buffer.concat(parts).subarray(0, expected)
    }

    private async expectOk(command: number, data: Uint8Array = Buffer.alloc(0)): Promise<Packet> {
        const reply = await this.send(command, data)
        if (reply.command !== CMD.ACK_OK && reply.command !== CMD.ACK_DATA) throw new ZkError("ZK_REFUSED", `${command} → ${reply.command}`)
        return reply
    }

    private async send(command: number, data: Uint8Array = Buffer.alloc(0)): Promise<Packet> {
        if (!this.socket) throw new ZkError("ZK_NOT_CONNECTED")
        if (this.failure) throw this.failure
        this.socket.write(commandPacket(command, data, this.sessionId, this.replyId))
        const reply = await this.receive()
        this.replyId = reply.replyId
        return reply
    }

    private receive(): Promise<Packet> {
        const ready = this.inbox.shift()
        if (ready) return Promise.resolve(ready)
        if (this.failure) return Promise.reject(this.failure)
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting = null
                const e = new ZkError("ZK_TIMEOUT", this.options.host)
                this.failure = e
                this.socket?.destroy()
                reject(e)
            }, this.timeoutMs)
            this.waiting = {
                resolve: p => { clearTimeout(timer); resolve(p) },
                reject: e => { clearTimeout(timer); reject(e) },
            }
        })
    }

    private deliver(p: Packet) {
        const w = this.waiting
        if (w) { this.waiting = null; w.resolve(p) } else this.inbox.push(p)
    }

    private fail(e: Error) {
        if (this.failure) return
        this.failure = e
        const w = this.waiting
        this.waiting = null
        w?.reject(e)
    }
}

/** Connects, does the work, and always says goodbye. */
export async function withDevice<T>(options: ZkOptions, work: (zk: ZkClient) => Promise<T>): Promise<T> {
    const zk = new ZkClient(options)
    await zk.connect()
    try {
        return await work(zk)
    } finally {
        await zk.disconnect()
    }
}
