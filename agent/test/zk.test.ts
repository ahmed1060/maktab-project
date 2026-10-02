import { describe, it, expect, afterEach } from "vitest"
import { createServer } from "node:net"
import { CMD, Framer, commKey, commandPacket, decodeTime, encodeTime, frame, USHRT_MAX } from "../src/zk/protocol"
import { ZkClient, withDevice } from "../src/zk/client"
import { FakeZkDevice } from "./fake-zk-device"

/**
 * The ZKTeco protocol. The byte-exact expectations below were produced by
 * the reference implementation's own helpers (pyzk's create_header,
 * create_checksum, make_commkey and encode_time, ported to Python as
 * written), independently of this code: a mistake in porting them shows here
 * rather than agreeing with itself through the simulated terminal.
 */

describe("the wire format, byte for byte", () => {
    it("frames commands exactly as the reference implementation does", () => {
        expect(commandPacket(CMD.CONNECT, Buffer.alloc(0), 0, USHRT_MAX - 1).toString("hex")).toBe("5050827d08000000e80317fc00000000")
        expect(commandPacket(CMD.OPTIONS_RRQ, Buffer.from("~SerialNumber\0", "latin1"), 0x1234, 7).toString("hex"))
            .toBe("5050827d160000000b00b5a4341208007e53657269616c4e756d62657200")
        const buffer = Buffer.alloc(11)
        buffer.writeInt8(1, 0); buffer.writeInt16LE(CMD.ATTLOG_RRQ, 1)
        expect(commandPacket(CMD.PREPARE_BUFFER, buffer, 0x1234, 8).toString("hex")).toBe("5050827d13000000df05e2da34120900010d000000000000000000")
        // An odd length, and the reply counter wrapping.
        expect(commandPacket(CMD.READ_BUFFER, Buffer.from([1, 2, 3]), 0xfffe, 65533).toString("hex")).toBe("5050827d0b000000e0051df8fefffeff010203")
    })

    it("makes a password key as the reference implementation does", () => {
        expect(commKey(123456, 0x2b5f).toString("hex")).toBe("267f32d2")
        expect(commKey(0, 1).toString("hex")).toBe("617d3279")
        expect(commKey(4294967295, 65535).toString("hex")).toBe("617d3286")
    })

    it("packs the device's time as the reference implementation does, and back", () => {
        expect(encodeTime("2026-10-01T09:12:05")).toBe(859799525)
        expect(encodeTime("2000-01-01T00:00:00")).toBe(0)
        expect(encodeTime("2099-12-31T23:59:59")).toBe(3214079999)
        for (const t of ["2026-10-01T09:12:05", "2000-01-01T00:00:00", "2099-12-31T23:59:59", "2024-02-29T12:00:00"]) expect(decodeTime(encodeTime(t))).toBe(t)
    })

    it("reassembles packets however the stream is cut", () => {
        const a = frame(Buffer.from("0123456789", "latin1")), b = frame(Buffer.from("abcdefgh", "latin1"))
        const stream = Buffer.concat([a, b])
        const framer = new Framer()
        const out: string[] = []
        for (let i = 0; i < stream.length; i += 3) for (const p of framer.push(stream.subarray(i, i + 3))) out.push(p.toString("latin1"))
        expect(out).toEqual(["0123456789", "abcdefgh"])
        expect(() => new Framer().push(Buffer.from("garbage!"))).toThrow("ZK_BAD_FRAME")
    })
})

describe("talking to a terminal", () => {
    let device: FakeZkDevice
    const at = (n: number) => decodeTime(encodeTime("2026-09-01T08:00:00") + n * 61)
    afterEach(async () => { await device?.stop() })

    it("reads what the terminal is: serial number, name, firmware, clock and how full it is", async () => {
        device = new FakeZkDevice({ records: [{ uid: 1, userNumber: "7", at: at(0), status: 1, punch: 0 }] })
        const port = await device.start()
        const info = await withDevice({ host: "127.0.0.1", port }, zk => zk.info())
        expect(info).toEqual({ serialNumber: "SIM-0001", name: "Simulated K40", firmware: "Ver 6.60 Sep 2026", clock: "2026-10-01T09:30:00", users: 0, records: 1, recordsCapacity: 100000 })
        expect(device.state.badChecksums).toBe(0)
        expect(device.state.log.at(-1)).toBe(CMD.EXIT)
    })

    it("reads a small log in one reply, and a large one in chunks, in the order it was written", async () => {
        device = new FakeZkDevice()
        for (let i = 0; i < 3; i++) device.scan(String(100 + i), at(i))
        const port = await device.start()
        const small = await withDevice({ host: "127.0.0.1", port }, zk => zk.attendance())
        expect(small.map(r => [r.userNumber, r.at])).toEqual([["100", at(0)], ["101", at(1)], ["102", at(2)]])

        // 5,000 records of 40 bytes: more than three chunks, each sent as several packets.
        device.state.records = []
        for (let i = 0; i < 5000; i++) device.scan(String(i % 300), at(i))
        const large = await withDevice({ host: "127.0.0.1", port }, zk => zk.attendance())
        expect(large).toHaveLength(5000)
        expect(large[0]).toMatchObject({ userNumber: "0", at: at(0) })
        expect(large[4999]).toMatchObject({ userNumber: String(4999 % 300), at: at(4999) })
        expect(device.state.log.filter(c => c === CMD.READ_BUFFER).length).toBe(4)
        expect(device.state.log).toContain(CMD.FREE_DATA)
        expect(device.state.badChecksums).toBe(0)
    })

    it("copes with replies arriving a few bytes at a time", async () => {
        device = new FakeZkDevice({ dribble: true, directLimit: 64, packetLimit: 50 })
        for (let i = 0; i < 20; i++) device.scan(String(i), at(i))
        const port = await device.start()
        const records = await withDevice({ host: "127.0.0.1", port }, zk => zk.attendance())
        expect(records.map(r => r.userNumber)).toEqual(Array.from({ length: 20 }, (_, i) => String(i)))
    })

    it("reads the older record layouts: numeric user numbers, and slots named from the user table", async () => {
        device = new FakeZkDevice({ recordSize: 16 })
        device.scan("40123", at(0))
        let port = await device.start()
        expect((await withDevice({ host: "127.0.0.1", port }, zk => zk.attendance()))[0]).toMatchObject({ userNumber: "40123", at: at(0) })
        await device.stop()

        device = new FakeZkDevice({ recordSize: 8, users: [{ uid: 3, userNumber: "E-17", name: "Omar" }] })
        device.scan("E-17", at(1), 3)
        device.scan("?", at(2), 9) // a slot with no user: its number is the slot
        port = await device.start()
        const records = await withDevice({ host: "127.0.0.1", port }, zk => zk.attendance())
        expect(records.map(r => [r.userNumber, r.at])).toEqual([["E-17", at(1)], ["9", at(2)]])
    })

    it("signs in to a terminal with a comm password, and says plainly when it is wrong", async () => {
        device = new FakeZkDevice({ password: 123456 })
        const port = await device.start()
        expect((await withDevice({ host: "127.0.0.1", port, password: 123456 }, zk => zk.info())).serialNumber).toBe("SIM-0001")
        await expect(withDevice({ host: "127.0.0.1", port, password: 1 }, zk => zk.info())).rejects.toThrow("ZK_AUTH_FAILED")
    })

    it("clears the log only between disabling and enabling the terminal", async () => {
        device = new FakeZkDevice()
        device.scan("7", at(0))
        const port = await device.start()
        await withDevice({ host: "127.0.0.1", port }, async zk => {
            await zk.disable()
            expect(device.scan("8", at(1))).toBe(false)
            await zk.clearAttendance()
            await zk.enable()
        })
        expect(device.state.records).toEqual([])
        expect(device.state.disabled).toBe(false)
    })

    it("gives up on a terminal that does not answer, or is not there", async () => {
        // Accepts and reads, never replies.
        const silent = createServer(socket => socket.resume())
        await new Promise<void>(r => silent.listen(0, "127.0.0.1", r))
        const port = (silent.address() as { port: number }).port
        await expect(new ZkClient({ host: "127.0.0.1", port, timeoutMs: 300 }).connect()).rejects.toThrow("ZK_TIMEOUT")
        await new Promise<void>(r => silent.close(() => r()))
        await expect(new ZkClient({ host: "127.0.0.1", port, timeoutMs: 300 }).connect()).rejects.toThrow(/ZK_CONNECT/)
    })
})
