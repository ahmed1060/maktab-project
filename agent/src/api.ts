import type { QueuedPunch } from "./state"

/**
 * The website's side of the conversation (/api/agent/*, ATTENDANCE_PLAN.md
 * §17). Every answer carries a stable `code` on failure; what to do about it
 * is decided by the caller from `retryLater` and `reenrol`.
 */

export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(`${code}: ${message}`)
        this.name = "ApiError"
    }
    /** The token is no longer accepted: the agent must be enrolled again with a new code. */
    get reenrol() {
        return this.status === 401
    }
    /** Worth trying again next round: the network, the server, or a limit. */
    get retryLater() {
        return this.status === 0 || this.status === 429 || this.status >= 500
    }
}

export type Enrolled = { token: string; agentId: string; name: string; company: string; timeZone: string }

export type DeviceReport = {
    serialNumber: string; name?: string; model?: string; firmware?: string
    reachable: boolean; error?: string; clock?: string
    userCount?: number; recordCount?: number; recordCapacity?: number
}

export type HeartbeatReply = {
    serverTime: string
    timeZone: string
    devices: { serialNumber: string; state: "ACTIVE" | "RETIRED" | "CLAIMED_ELSEWHERE"; deviceId: string | null; mode: string | null }[]
    rotateToken: boolean
}

export type PunchesReply = { accepted: number; duplicates: number; refused: { index: number; reason: string; retry: boolean }[] }

export class AgentApi {
    constructor(private readonly server: string, private readonly token: () => string | null, private readonly timeoutMs = 30_000) {}

    private async post<T>(path: string, body: unknown, authenticated = true): Promise<T> {
        const headers: Record<string, string> = { "Content-Type": "application/json" }
        if (authenticated) {
            const token = this.token()
            if (!token) throw new ApiError(401, "NOT_ENROLLED", "This agent has not been enrolled yet.")
            headers.Authorization = `Bearer ${token}`
        }
        let res: Response
        try {
            res = await fetch(`${this.server}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) })
        } catch (e) {
            throw new ApiError(0, "NETWORK", (e as Error).message)
        }
        const json = await res.json().catch(() => null) as { success?: boolean; data?: T; code?: string; error?: string } | null
        if (!res.ok || !json?.success) throw new ApiError(res.status, json?.code ?? `HTTP_${res.status}`, json?.error ?? res.statusText)
        return json.data as T
    }

    enrol(code: string, about: { hostname: string; agentVersion: string }) {
        return this.post<Enrolled>("/api/agent/enrol", { code, ...about }, false)
    }

    heartbeat(beat: { agentVersion: string; hostname: string; queueDepth: number; clock: string; devices: DeviceReport[] }) {
        return this.post<HeartbeatReply>("/api/agent/heartbeat", beat)
    }

    punches(punches: QueuedPunch[]) {
        return this.post<PunchesReply>("/api/agent/punches", { punches })
    }

    rotate() {
        return this.post<{ token: string }>("/api/agent/token", {})
    }
}
