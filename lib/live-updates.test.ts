import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { liveTopics, onlineTopics, LiveDrawer, LiveWants, LEAVE_AFTER_MS, type LiveTopic } from "./live-updates"
import { LiveConnection, RENEW_BEFORE_MS, RETRY_MS, type LiveChannel, type LiveClient } from "./live-connection"
import { realtimeClaims, signRealtimeToken, REALTIME_TOKEN_SECONDS } from "./realtime-token"

/**
 * Live updates, part 1 (REALTIME_PLAN.md): who may hear which signals, the
 * token that lets them, and a screen drawn once for signals close together.
 * The database's side, the triggers and the channels' rules, against a real
 * Postgres in live-updates.db.test.ts.
 */

const read = (path: string) => readFileSync(path, "utf8")
const part = (token: string, i: number) => JSON.parse(Buffer.from(token.split(".")[i], "base64url").toString())

describe("what a person may hear", () => {
    it("is their company's tasks and their own notices", () => {
        expect(liveTopics({ id: "u1", role: "EMPLOYEE", companyId: "c1" }, null)).toEqual([
            { kind: "tasks", topic: "tasks:c1" },
            { kind: "notices", topic: "notices:u1" },
        ])
    })

    it("is their own company's, whatever company is in view, for anyone but the Super Admin", () => {
        expect(liveTopics({ id: "a1", role: "ADMIN", companyId: "c1" }, "c2")[0]).toEqual({ kind: "tasks", topic: "tasks:c1" })
    })

    it("is the company in view's tasks for the Super Admin, if one is, and their own notices", () => {
        expect(liveTopics({ id: "sa1", role: "SUPER_ADMIN", companyId: null }, "c2")).toEqual([
            { kind: "tasks", topic: "tasks:c2" },
            { kind: "notices", topic: "notices:sa1" },
        ])
        expect(liveTopics({ id: "sa1", role: "SUPER_ADMIN", companyId: null }, null)).toEqual([{ kind: "notices", topic: "notices:sa1" }])
    })

    it("is only their notices without a company", () => {
        expect(liveTopics({ id: "u9", role: "EMPLOYEE", companyId: null }, null)).toEqual([{ kind: "notices", topic: "notices:u9" }])
    })
})

// Part 6b: who's online is heard only while a screen that shows it is open,
// on a channel for each company, so a coming or going is heard by the one to
// three people looking, not by every tab.
describe("whose comings and goings a list hears", () => {
    it("is their own company's for anyone but the Super Admin, whoever is listed", () => {
        expect(onlineTopics({ id: "a1", role: "ADMIN", companyId: "c1" }, null, ["c1", "c1"])).toEqual(["online:c1"])
        expect(onlineTopics({ id: "a1", role: "ADMIN", companyId: "c1" }, "c2", [])).toEqual(["online:c1"])
        expect(onlineTopics({ id: "u9", role: "EMPLOYEE", companyId: null }, null, [])).toEqual([])
    })

    it("is the company shown's for the Super Admin, so an empty Online filter still hears someone come", () => {
        expect(onlineTopics({ id: "sa1", role: "SUPER_ADMIN", companyId: null }, "c2", [])).toEqual(["online:c2"])
    })

    // One channel for every company was turned down: each signal is counted
    // as it's sent, listened to or not (REALTIME_PLAN.md, part 6b).
    it("is each company on the page for the Super Admin's lists of everyone, once each", () => {
        expect(onlineTopics({ id: "sa1", role: "SUPER_ADMIN", companyId: null }, null, ["c2", "c1", null, undefined, "c2"])).toEqual(["online:c1", "online:c2"])
        expect(onlineTopics({ id: "sa1", role: "SUPER_ADMIN", companyId: null }, null, [])).toEqual([])
    })
})

describe("the channels screens want", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const watching = (wants: LiveWants) => {
        const seen: string[] = []
        wants.watch((topic, wanted) => seen.push(`${wanted ? "join" : "leave"} ${topic}`))
        return seen
    }

    it("are joined once each, however many screens want them, and left a few seconds after the last lets go", () => {
        const wants = new LiveWants()
        const seen = watching(wants)
        const first = wants.want("online:c1")
        const second = wants.want("online:c1")
        expect(seen).toEqual(["join online:c1"])
        expect(wants.topics()).toEqual(["online:c1"])
        first()
        first()
        vi.advanceTimersByTime(LEAVE_AFTER_MS)
        expect(seen).toEqual(["join online:c1"])
        second()
        vi.advanceTimersByTime(LEAVE_AFTER_MS - 1)
        expect(seen).toEqual(["join online:c1"])
        vi.advanceTimersByTime(1)
        expect(seen).toEqual(["join online:c1", "leave online:c1"])
        expect(wants.topics()).toEqual([])
    })

    // React mounts a screen twice in development, letting go between, and a
    // list's next page may want the same company: a channel being left
    // can't be joined again until Supabase has closed it.
    it("are kept when wanted again before they're left", () => {
        const wants = new LiveWants()
        const seen = watching(wants)
        wants.want("online:c1")()
        const again = wants.want("online:c1")
        vi.advanceTimersByTime(LEAVE_AFTER_MS * 2)
        expect(seen).toEqual(["join online:c1"])
        again()
        vi.advanceTimersByTime(LEAVE_AFTER_MS)
        expect(seen).toEqual(["join online:c1", "leave online:c1"])
    })

    it("are told to no watcher once it's stopped watching", () => {
        const wants = new LiveWants()
        const seen: string[] = []
        const stop = wants.watch(topic => seen.push(topic))
        stop()
        wants.want("online:c1")
        expect(seen).toEqual([])
    })
})

describe("the token", () => {
    const NOW = 1_800_000_000

    it("names the person, their company and whether they're the Super Admin, for an hour", () => {
        expect(REALTIME_TOKEN_SECONDS).toBe(3600)
        expect(realtimeClaims({ id: "u1", role: "EMPLOYEE", companyId: "c1" }, NOW)).toEqual({
            sub: "u1", role: "authenticated", aud: "authenticated", iat: NOW, exp: NOW + 3600, company_id: "c1", super_admin: false, sees_online: false,
        })
        expect(realtimeClaims({ id: "sa1", role: "SUPER_ADMIN", companyId: null }, NOW)).toMatchObject({ sub: "sa1", company_id: null, super_admin: true })
    })

    // Part 6b: the rule on Supabase's side can't read the app's permissions.
    it("and whether its person may see who's online, as the Employees list shows it", () => {
        expect(realtimeClaims({ id: "a1", role: "ADMIN", companyId: "c1" }, NOW, true)).toMatchObject({ company_id: "c1", sees_online: true })
        expect(realtimeClaims({ id: "u1", role: "EMPLOYEE", companyId: "c1" }, NOW, false)).toMatchObject({ sees_online: false })
    })

    it("is signed with the project's JWT secret, as Supabase checks it", () => {
        const claims = realtimeClaims({ id: "u1", role: "EMPLOYEE", companyId: "c1" }, NOW)
        const token = signRealtimeToken(claims, "s3cret")
        expect(part(token, 0)).toEqual({ alg: "HS256", typ: "JWT" })
        expect(part(token, 1)).toEqual(claims)
        const [header, payload, signature] = token.split(".")
        expect(signature).toBe(createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest("base64url"))
        expect(signRealtimeToken(claims, "another").split(".")[2]).not.toBe(signature)
    })
})

describe("a screen drawn again", () => {
    let hidden = false
    let drawer: LiveDrawer
    beforeEach(() => {
        vi.useFakeTimers()
        hidden = false
        drawer = new LiveDrawer({ hidden: () => hidden })
    })
    afterEach(() => vi.useRealTimers())

    it("a second after the signal", () => {
        const draw = vi.fn()
        drawer.on("tasks", draw)
        drawer.signal("tasks")
        vi.advanceTimersByTime(999)
        expect(draw).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(draw).toHaveBeenCalledTimes(1)
    })

    it("once for signals close together, a second after the last", () => {
        const draw = vi.fn()
        drawer.on("tasks", draw)
        for (let i = 0; i < 5; i++) {
            drawer.signal("tasks")
            vi.advanceTimersByTime(500)
        }
        expect(draw).not.toHaveBeenCalled()
        vi.advanceTimersByTime(500)
        expect(draw).toHaveBeenCalledTimes(1)
    })

    it("at least every five seconds while signals keep coming", () => {
        const draw = vi.fn()
        drawer.on("tasks", draw)
        for (let i = 0; i < 20; i++) {
            drawer.signal("tasks")
            vi.advanceTimersByTime(500)
        }
        expect(draw).toHaveBeenCalledTimes(2)
    })

    it("only for what was signalled, each of its screens once", () => {
        const tasks = [vi.fn(), vi.fn()]
        const notices = vi.fn()
        tasks.forEach(draw => drawer.on("tasks", draw))
        drawer.on("notices", notices)
        drawer.signal("tasks")
        drawer.signal("tasks")
        vi.advanceTimersByTime(1000)
        expect(tasks.map(draw => draw.mock.calls.length)).toEqual([1, 1])
        expect(notices).not.toHaveBeenCalled()
    })

    // Part 4b: the cost screens hear the company's tasks and costs both, and
    // a Super Admin with a company in view hears both as that company's task
    // changes.
    it("once for a screen hearing several kinds, when they come together", () => {
        const draw = vi.fn()
        drawer.on("tasks", draw)
        drawer.on("costs", draw)
        drawer.signal("tasks")
        drawer.signal("costs")
        vi.advanceTimersByTime(1000)
        expect(draw).toHaveBeenCalledTimes(1)
        drawer.signal("costs")
        vi.advanceTimersByTime(1000)
        expect(draw).toHaveBeenCalledTimes(2)
    })

    it("not while the tab is hidden, and at once when it's shown", () => {
        const draw = vi.fn()
        drawer.on("tasks", draw)
        hidden = true
        drawer.signal("tasks")
        vi.advanceTimersByTime(10_000)
        expect(draw).not.toHaveBeenCalled()
        hidden = false
        drawer.shown()
        expect(draw).toHaveBeenCalledTimes(1)
        // Nothing waits after: shown again, nothing is drawn twice.
        drawer.shown()
        vi.advanceTimersByTime(10_000)
        expect(draw).toHaveBeenCalledTimes(1)
    })

    it("everything once, after reconnecting, for whatever was missed", () => {
        const tasks = vi.fn()
        const notices = vi.fn()
        drawer.on("tasks", tasks)
        drawer.on("notices", notices)
        drawer.everything()
        vi.advanceTimersByTime(1000)
        expect([tasks.mock.calls.length, notices.mock.calls.length]).toEqual([1, 1])
    })

    it("no longer for a screen that's gone", () => {
        const draw = vi.fn()
        const off = drawer.on("tasks", draw)
        off()
        drawer.signal("tasks")
        vi.advanceTimersByTime(1000)
        expect(draw).not.toHaveBeenCalled()
    })

    it("goes on drawing the others when one screen fails", () => {
        const first = vi.fn(() => { throw new Error("broke") })
        const second = vi.fn()
        drawer.on("tasks", first)
        drawer.on("tasks", second)
        drawer.signal("tasks")
        vi.advanceTimersByTime(1000)
        expect(second).toHaveBeenCalledTimes(1)
    })
})

describe("the token route", () => {
    const route = read("app/api/realtime/token/route.ts")

    it("signs one for the person signed in, through the standard checks", () => {
        expect(route).toContain("export const GET = withStandardHandler(async (req, session) => {")
        expect(route).toContain("const secret = process.env.SUPABASE_JWT_SECRET")
        expect(route).toContain("token: signRealtimeToken(claims, secret),")
        expect(route).toContain("topics: liveTopics(session.user, scopedCompanyId(session.user.role, cookieStore.get(SCOPED_COMPANY_COOKIE)?.value)),")
    })

    it("says whether its person may see who's online, by the permission the Employees list asks", () => {
        expect(route).toContain('const claims = realtimeClaims(session.user, Math.floor(Date.now() / 1000), can(session.user, "employees.view"))')
        expect(read("app/api/users/route.ts")).toContain('if (!can(session.user, "employees.view")) {')
    })

    it("says it's off until the secret is in Vercel, and every screen goes on as today", () => {
        expect(route).toContain("if (!secret) return ApiResponse.success({ off: true })")
    })

    it("is a core route, in every package", async () => {
        const { moduleForApiPath } = await import("./features/routes")
        expect(moduleForApiPath("/api/realtime/token")).toBeNull()
    })
})

describe("the browser's connection", () => {
    const client = read("lib/supabase-browser.ts")
    const live = read("components/LiveUpdates.tsx")

    it("hands Supabase the app's token, which it asks for on every heartbeat, or the public key until there is one", () => {
        expect(client).toContain("client = createClient(url, key, { accessToken: async () => liveToken })")
        expect(client).toContain("export function setLiveToken(token: string | null) {")
    })

    it("is one per tab, joined again for the company in view, and left as the dashboard goes", () => {
        expect(live).toContain("const connection = new LiveConnection({ ask: askForToken, load: loadClient, drawer, wants })")
        expect(live).toContain("return () => connection.stop()")
        expect(live).toContain("}, [drawer, wants, scope])")
    })

    it("draws a hidden tab when it's shown again", () => {
        expect(live).toContain("if (document.visibilityState === 'visible') drawer.shown()")
    })

    it("is around the whole dashboard, the bell's top bar included, for the company in view", () => {
        expect(read("app/(dashboard)/layout.tsx")).toContain("<LiveUpdates scope={scopeId}>")
    })
})

describe("a tab's connection", () => {
    const HOUR = 3_600_000
    const TOPICS: LiveTopic[] = [{ kind: "tasks", topic: "tasks:c1" }, { kind: "notices", topic: "notices:u1" }]

    /** Supabase's client, as far as the connection uses it. */
    function fakeSupabase() {
        const log: string[] = []
        const channels: { topic: string; private: boolean; events: string[]; on: Record<string, () => void>; status?: (s: string) => void; removed: boolean; handle: LiveChannel }[] = []
        let token: string | null = null
        const client: LiveClient = {
            channel(topic, options) {
                log.push(`join ${topic} with ${token}`)
                const entry = { topic, private: options.config.private, events: [], on: {}, removed: false } as unknown as (typeof channels)[number]
                const handle: LiveChannel = {
                    on(_type, filter, callback) { entry.events.push(filter.event); entry.on[filter.event] = callback; return handle },
                    subscribe(callback) { entry.status = callback; return handle },
                }
                entry.handle = handle
                channels.push(entry)
                return handle
            },
            removeChannel(handle) { channels.find(c => c.handle === handle)!.removed = true },
            realtime: { async setAuth() { log.push(`auth ${token}`) } },
        }
        const setToken = (next: string | null) => { token = next }
        return { client, setToken, channels, log, token: () => token }
    }

    let drawer: LiveDrawer
    let drawn: string[]
    beforeEach(() => {
        vi.useFakeTimers()
        drawer = new LiveDrawer({ hidden: () => false })
        drawn = []
        drawer.on("tasks", () => drawn.push("tasks"))
        drawer.on("notices", () => drawn.push("notices"))
        drawer.on("account", () => drawn.push("account"))
        drawer.on("requests", () => drawn.push("requests"))
        drawer.on("advances", () => drawn.push("advances"))
        drawer.on("costs", () => drawn.push("costs"))
    })
    afterEach(() => vi.useRealTimers())

    const grant = (token: string, expiresAt = Date.now() + HOUR) => ({ token, expiresAt, topics: TOPICS })

    it("joins each channel its person may hear as a private one, once Supabase has the token", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        expect(supabase.log).toEqual(["auth t1", "join tasks:c1 with t1", "join notices:u1 with t1"])
        // What changed, the person's own account (part 3), requests (part 2),
        // cash advances (part 4a) and costs (part 4b), on each.
        expect(supabase.channels.map(c => [c.topic, c.private, c.events])).toEqual([
            ["tasks:c1", true, ["changed", "account", "requests", "advances", "costs"]],
            ["notices:u1", true, ["changed", "account", "requests", "advances", "costs"]],
        ])
    })

    it("draws what a signal is for, a second later", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        supabase.channels[0].on.changed!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["tasks"])
    })

    // A change saved while the page was on its way, before its channel was
    // joined, was heard by nobody: found by the browser flow, Hana deleting a
    // task as Youssef's list was still connecting.
    it("draws once on joining a channel, for what changed while the page was on its way, and again on joining it again", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        await vi.advanceTimersByTimeAsync(5000)
        expect(drawn).toEqual([])
        supabase.channels[1].status!("SUBSCRIBED")
        await vi.advanceTimersByTimeAsync(1000)
        // And whether the account can go on, for a suspension missed the same
        // way (part 3), the requests, for one asked for or decided (part 2),
        // the cash advances, for an advance given or confirmed (part 4a), and
        // the costs, for a charge collected (part 4b).
        const joined = ["notices", "account", "requests", "advances", "costs"]
        expect(drawn).toEqual(joined)
        supabase.channels[1].status!("CHANNEL_ERROR")
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(joined)
        supabase.channels[1].status!("SUBSCRIBED")
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual([...joined, ...joined])
    })

    // Part 3: suspended, closed, deleted, or the company banned. On the
    // person's own channel, or their company's for a ban, as the database
    // sends it (the live_account_* triggers).
    it("asks whether the account can go on when either channel says it can't, a second later", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        supabase.channels[1].on.account!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["account"])
        supabase.channels[0].on.account!()
        supabase.channels[1].on.account!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["account", "account"])
    })

    // Part 2: a request asked for, decided or withdrawn. On the company's
    // channel, and on each Super Admin's own, as the database sends it (the
    // live_requests_* triggers).
    it("draws the Requests page and its count when either channel says requests changed, a second later", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        supabase.channels[0].on.requests!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["requests"])
        supabase.channels[0].on.requests!()
        supabase.channels[1].on.requests!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["requests", "requests"])
    })

    // Part 4a: an advance given, returned, confirmed or spent on a cost. On
    // the company's channel, and on each Super Admin's own, as the database
    // sends it (the live_advances_* triggers).
    it("draws the cash advance screens when either channel says cash advances changed, a second later", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        supabase.channels[0].on.advances!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["advances"])
        supabase.channels[0].on.advances!()
        supabase.channels[1].on.advances!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["advances", "advances"])
    })

    // Part 4b: a charge changing without its task, on the company's channel
    // and each Super Admin's own; and for a Super Admin, any change to
    // costs (the live_costs_* triggers).
    it("draws the cost screens when either channel says costs changed, a second later", async () => {
        const supabase = fakeSupabase()
        await new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer }).start()
        supabase.channels[0].on.costs!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["costs"])
        supabase.channels[0].on.costs!()
        supabase.channels[1].on.costs!()
        await vi.advanceTimersByTimeAsync(1000)
        expect(drawn).toEqual(["costs", "costs"])
    })

    it("loads nothing while the token route says it's off, and doesn't ask again", async () => {
        const load = vi.fn()
        const ask = vi.fn(async () => "off" as const)
        await new LiveConnection({ ask, load, drawer }).start()
        expect(load).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(ask).toHaveBeenCalledTimes(1)
    })

    // Asked while offline, or as the server failed, the first token never
    // came, and nothing asked again until the page was loaded again (Codex,
    // on PR 244).
    it("asks again a minute later when the first token doesn't come, and joins once it does", async () => {
        const supabase = fakeSupabase()
        const answers = [null, null, grant("t1")]
        const ask = vi.fn(async () => answers.shift() ?? null)
        await new LiveConnection({ ask, load: async () => supabase, drawer }).start()
        expect(supabase.channels).toEqual([])
        await vi.advanceTimersByTimeAsync(RETRY_MS - 1)
        expect(ask).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(ask).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(RETRY_MS)
        expect(ask).toHaveBeenCalledTimes(3)
        expect(supabase.channels.map(c => c.topic)).toEqual(["tasks:c1", "notices:u1"])
    })

    it("tries again a minute later when Supabase's client doesn't load", async () => {
        const supabase = fakeSupabase()
        const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(supabase)
        await new LiveConnection({ ask: async () => grant("t1"), load, drawer }).start()
        expect(supabase.channels).toEqual([])
        await vi.advanceTimersByTimeAsync(RETRY_MS)
        expect(load).toHaveBeenCalledTimes(2)
        expect(supabase.channels.map(c => c.topic)).toEqual(["tasks:c1", "notices:u1"])
    })

    it("asks no more once it's stopped while waiting to ask again", async () => {
        const ask = vi.fn(async () => null)
        const connection = new LiveConnection({ ask, load: vi.fn(), drawer })
        await connection.start()
        connection.stop()
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(ask).toHaveBeenCalledTimes(1)
    })

    it("asks for the next token five minutes before the one held ends, and a minute later again if that fails", async () => {
        const supabase = fakeSupabase()
        const answers = [grant("t1"), null, grant("t2")]
        const ask = vi.fn(async () => answers.shift() ?? null)
        await new LiveConnection({ ask, load: async () => supabase, drawer }).start()
        await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS - 1)
        expect(ask).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(ask).toHaveBeenCalledTimes(2)
        expect(supabase.token()).toBe("t1")
        await vi.advanceTimersByTimeAsync(RETRY_MS)
        expect(ask).toHaveBeenCalledTimes(3)
        expect(supabase.token()).toBe("t2")
        expect(supabase.log.at(-1)).toBe("auth t2")
    })

    it("stops renewing once the token route says it's off", async () => {
        const supabase = fakeSupabase()
        const answers: ("off" | ReturnType<typeof grant>)[] = [grant("t1"), "off"]
        const ask = vi.fn(async () => answers.shift() ?? null)
        await new LiveConnection({ ask, load: async () => supabase, drawer }).start()
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(ask).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(ask).toHaveBeenCalledTimes(2)
    })

    it("leaves its channels, and forgets its token, as it stops", async () => {
        const supabase = fakeSupabase()
        const connection = new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer })
        await connection.start()
        connection.stop()
        expect(supabase.channels.map(c => c.removed)).toEqual([true, true])
        expect(supabase.token()).toBeNull()
        // Nothing renews after.
        const before = supabase.log.length
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(supabase.log.length).toBe(before)
    })

    // Part 6b: a channel for who's online, joined only while a screen wants it.
    describe("and the channels screens want", () => {
        const wanted = (supabase: ReturnType<typeof fakeSupabase>, topic: string) => supabase.channels.filter(c => c.topic === topic)
        const start = async (wants: LiveWants, supabase = fakeSupabase()) => {
            const connection = new LiveConnection({ ask: async () => grant("t1"), load: async () => supabase, drawer, wants })
            await connection.start()
            return { connection, supabase }
        }
        beforeEach(() => { drawer.on("online", () => drawn.push("online")) })

        it("joins those wanted before it started, as private ones, after its own, hearing only that someone came or went", async () => {
            const wants = new LiveWants()
            wants.want("online:c1")
            const { supabase } = await start(wants)
            expect(supabase.log).toEqual(["auth t1", "join tasks:c1 with t1", "join notices:u1 with t1", "join online:c1 with t1"])
            expect(wanted(supabase, "online:c1").map(c => [c.private, c.events])).toEqual([[true, ["changed"]]])
        })

        it("joins one wanted once it's started, and leaves it once no screen wants it", async () => {
            const wants = new LiveWants()
            const { supabase } = await start(wants)
            const release = wants.want("online:c2")
            expect(wanted(supabase, "online:c2")).toHaveLength(1)
            release()
            await vi.advanceTimersByTimeAsync(LEAVE_AFTER_MS)
            expect(wanted(supabase, "online:c2")[0].removed).toBe(true)
        })

        it("draws the screens that show who's online when someone comes or goes, a second later, and once on joining", async () => {
            const wants = new LiveWants()
            wants.want("online:c1")
            const { supabase } = await start(wants)
            const channel = wanted(supabase, "online:c1")[0]
            channel.status!("SUBSCRIBED")
            await vi.advanceTimersByTimeAsync(1000)
            expect(drawn).toEqual(["online"])
            channel.on.changed!()
            await vi.advanceTimersByTimeAsync(1000)
            expect(drawn).toEqual(["online", "online"])
        })

        it("leaves them, and listens for no more, as it stops", async () => {
            const wants = new LiveWants()
            wants.want("online:c1")
            const { connection, supabase } = await start(wants)
            connection.stop()
            expect(wanted(supabase, "online:c1")[0].removed).toBe(true)
            wants.want("online:c3")
            expect(wanted(supabase, "online:c3")).toEqual([])
        })

        it("joins none before its token came", async () => {
            const wants = new LiveWants()
            let answer!: (given: ReturnType<typeof grant>) => void
            const supabase = fakeSupabase()
            const connection = new LiveConnection({ ask: () => new Promise(resolve => { answer = resolve }), load: async () => supabase, drawer, wants })
            const started = connection.start()
            wants.want("online:c1")
            expect(supabase.channels).toEqual([])
            answer(grant("t1"))
            await started
            expect(supabase.log).toEqual(["auth t1", "join tasks:c1 with t1", "join notices:u1 with t1", "join online:c1 with t1"])
        })
    })

    it("joins nothing when it's stopped before its token came", async () => {
        const supabase = fakeSupabase()
        let answer!: (g: ReturnType<typeof grant>) => void
        const connection = new LiveConnection({ ask: () => new Promise(r => { answer = r }), load: async () => supabase, drawer })
        const started = connection.start()
        connection.stop()
        answer(grant("t1"))
        await started
        expect(supabase.channels).toEqual([])
    })
})

describe("the screens that are drawn again", () => {
    it("the task list", () => {
        expect(read("app/(dashboard)/dashboard/tasks/TasksClient.tsx")).toContain("useLive('tasks', () => router.refresh())")
    })

    it("a task's page, keeping what's being edited or reviewed (DESIGN.md §8)", () => {
        const page = read("app/(dashboard)/dashboard/tasks/[id]/client.tsx")
        expect(page).toContain("useLive('tasks', () => router.refresh())")
        expect(page).toContain("if (!isEditing) setEditForm(editFormFrom(initialTask))")
        expect(page).toContain("if (!isReviewModalOpen) setReviewDifficulty(initialTask.difficulty)")
    })

    // Kept while the dialog was open, its old assignees and files were sent
    // with a title change, undoing a transfer or dropping a file added
    // meanwhile (Codex, on PR 244).
    it("a task's page saves its details with who it's assigned to now, and leaves its files alone", () => {
        const page = read("app/(dashboard)/dashboard/tasks/[id]/client.tsx")
        const form = page.slice(page.indexOf("const editFormFrom"), page.indexOf("})", page.indexOf("const editFormFrom")))
        expect(form).not.toContain("assigneeIds")
        expect(form).not.toContain("attachments")
        const save = page.slice(page.indexOf("const handleSaveDetails"), page.indexOf("const handlePaymentStatusChange"))
        expect(save).toContain("assigneeIds: task.assignees?.map((a: any) => a.id) ?? []")
        expect(save).not.toContain("attachments")
        expect(page).toContain("setEditForm(editFormFrom(task))")
    })

    it("the bell", () => {
        expect(read("components/NotificationBell.tsx")).toContain("useLive('notices', () => { void mutate() })")
    })

    // Part 2: the page keeps its tab, filters, search and dialogs, as a
    // refresh does; the count is asked for again, as on every page.
    it("the Requests page, and the count on Requests in the side bar, inside the dashboard's connection", () => {
        expect(read("app/(dashboard)/dashboard/requests/RequestsClient.tsx")).toContain("useLive('requests', () => router.refresh())")
        expect(read("components/DashboardShell.tsx")).toContain("useLive('requests', () => { if (waitingKey) void recheckWaiting() })")
        const layout = read("app/(dashboard)/layout.tsx")
        expect(layout.indexOf("<DashboardShell")).toBeGreaterThan(layout.indexOf("<LiveUpdates"))
        expect(layout.indexOf("<DashboardShell")).toBeLessThan(layout.indexOf("</LiveUpdates>"))
    })

    // Part 4a: each through its own route, keeping what's typed, the
    // search, the filter and the page.
    it("the cash advance screens: the Cash advances tab, a person's, Add cost's line about it, and an open Give advance window", () => {
        expect(read("components/cash-advances/CashAdvancesList.tsx")).toContain("useLive('advances', () => { void mutate() })")
        expect(read("components/cash-advances/CashAdvanceHistory.tsx")).toContain("useLive('advances', () => { void mutate() })")
        expect(read("components/cash-advances/AdvanceBalanceHint.tsx")).toContain("useLive('advances', () => { void mutate() })")
        const dialog = read("components/cash-advances/CashAdvanceDialog.tsx")
        expect(dialog).toContain("useLive('advances', () => { void refreshAbout() })")
        // An advance given is weighed against the balance as the server says it now.
        expect(dialog).toContain("const balance = kind === 'GIVEN' ? about?.data?.balance ?? person?.balance ?? 0")
        // A part picked, then gone elsewhere, stays picked, holding nothing (found by Codex on PR 252).
        expect(dialog).toContain("const parts = partsToPick(held, from, chosen)")
        expect(dialog).toContain("const picked = parts.find(part => heldPartKey(part) === from)")
        expect(dialog).toContain("onChange={e => { setFrom(e.target.value); setChosen(parts.find(part => heldPartKey(part) === e.target.value) ?? null) }}")
        expect(dialog).toContain("...parts.map(part => ({ value: heldPartKey(part)")
    })

    // Part 4b: with the company's tasks, which a cost added, removed or paid
    // changes, and the costs, which a charge changes without its task. Each
    // through its own route, keeping the search, filters and page; what
    // someone else changed is tinted, and the person's own actions aren't.
    it("the cost screens: the Employee costs tab, the Charged to clients tab and a client's charges", () => {
        const live = read("components/LiveUpdates.tsx")
        expect(live).toContain("export function useLive(kinds: LiveKind | readonly LiveKind[], onChange: () => void) {")
        expect(read("components/useArrivals.ts")).toContain("export function useArrivalsIn<T>(kinds: LiveKind | readonly LiveKind[], scope: string, rows: readonly T[], rowKey: (row: T) => string) {")

        const employee = read("app/(dashboard)/dashboard/costs/CostsClient.tsx")
        expect(employee).toContain("useLive(['tasks', 'costs'], () => router.refresh())")
        // By what each row shows: another person's share of the same task paid doesn't tint it.
        expect(employee).toContain("const arrivals = useArrivals(['tasks', 'costs'], sortedEntries.map(shownOf), row => row.key)")
        const shown = employee.slice(employee.indexOf("const shownOf"), employee.indexOf("const arrivals"))
        expect(shown).not.toContain("memberPaymentStatus")
        expect(shown).not.toContain("updatedAt")
        expect(employee).toContain("rowKey={rowKey}")
        expect(employee).toContain("arrived={arrivals.arrived}")
        // Mark all as paid is the person's own, from its start, and its draw once it's saved.
        const pay = employee.slice(employee.indexOf("const handleMarkAllAsPaid"), employee.indexOf("const wording"))
        expect(pay).toContain("const answered = arrivals.own()")
        expect(pay).toContain("arrivals.saved()")
        expect(pay.indexOf("arrivals.saved()")).toBeGreaterThan(pay.indexOf("else if (res.ok)"))
        expect(pay).toContain("answered()")

        const charges = read("components/charges/ChargesList.tsx")
        expect(charges).toContain("useLive(['tasks', 'costs'], () => { void mutate() })")
        expect(charges).toContain("const arrivals = useArrivalsIn(['tasks', 'costs'], listUrl, charges, c => c.id)")
        expect(charges).toContain("arrived={arrivals.arrived}")
        // Not charged, Charge again, Mark collected and Mark uncollected; the fee window's Save too.
        expect(charges).toContain("const action = useBusyAction(arrivals.own)")
        for (const key of ["charge", "collect", "uncollect"]) expect(charges).toContain(`action.run('${key}',`)
        expect(charges.match(/arrivals\.saved\(\)/g)?.length).toBe(4)
        expect(charges).toContain("<ActionStarts.Provider value={arrivals.own}>")
        expect(charges).toContain("onSaved={() => { arrivals.saved(); void mutate() }}")
        const fee = read("components/charges/ChargeFeeDialog.tsx")
        expect(fee).toContain("const action = useBusyAction()")
        expect(fee).toContain("void action.run('save',")
    })

    // Part 6b: only the badge changes, untinted (DESIGN.md §8), and the
    // search, filters and page stay. Each list hears the companies it shows,
    // and is drawn again, too, as its first person online would run out.
    it("the Employees list and All users, while they show who's online", () => {
        const employees = read("app/(dashboard)/dashboard/employees/page.tsx")
        // Only for whoever may see the list: the channel lets nobody else in.
        expect(employees).toContain("useLiveOnline(viewer && can('employees.view') ? onlineTopics(viewer, selectedCompanyId, employees.map(e => e.company?.id)) : [], () => { void mutate() }, result?.data?.onlineRunsOutInMs)")
        expect(employees).not.toContain("useArrivals")
        // The company picked, or each on the page; nobody who has left is online.
        const allUsers = read("app/(dashboard)/dashboard/all-users/page.tsx")
        expect(allUsers).toContain("useLiveOnline(viewer && isSuperAdmin && !left ? onlineTopics(viewer, companyId || null, (listed?.data ?? []).map(p => p.company?.id)) : [], () => { void mutate() }, listed?.onlineRunsOutInMs)")
        expect(allUsers).not.toContain("useArrivals")
        const live = read("components/LiveUpdates.tsx")
        expect(live).toContain("export function useLiveOnline(topics: string[], onChange: () => void, runsOutInMs: number | null | undefined) {")
        expect(live).toContain("const timer = setTimeout(() => live.drawer.signal('online'), runsOutInMs)")
    })

    // Part 3: the heartbeat asks at once, and signs the page out as it does
    // at its beat: suspended, closed, deleted, or the company banned.
    it("the heartbeat, when the account can't go on, inside the dashboard's connection", () => {
        expect(read("components/UserHeartbeat.tsx")).toContain("useLive('account', () => { void checkStatusRef.current?.() })")
        const layout = read("app/(dashboard)/layout.tsx")
        expect(layout.indexOf("<UserHeartbeat />")).toBeGreaterThan(layout.indexOf("<LiveUpdates"))
        expect(layout.indexOf("<UserHeartbeat />")).toBeLessThan(layout.indexOf("</LiveUpdates>"))
    })
})
