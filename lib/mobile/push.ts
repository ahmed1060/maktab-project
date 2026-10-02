import { deviceFingerprint, type Post } from "./check-in-flow"
import type { CheckInDevice } from "./native"

/**
 * Push notifications inside the Nizmo app (ATTENDANCE_PLAN.md §13.4), through
 * Capacitor's push plugin: ask the person once, get the token the phone's
 * push service gives, and tell the server it belongs to this phone. Tapping
 * a notice opens the page it is about.
 */

type Listener = { remove(): Promise<void> }
type Permission = { receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" }
export type PushPlugin = {
    checkPermissions(): Promise<Permission>
    requestPermissions(): Promise<Permission>
    register(): Promise<void>
    addListener(event: "registration", cb: (token: { value: string }) => void): Promise<Listener>
    addListener(event: "registrationError", cb: (error: { error: string }) => void): Promise<Listener>
    addListener(event: "pushNotificationActionPerformed", cb: (action: { notification: { data?: Record<string, unknown> } }) => void): Promise<Listener>
}

export function pushPlugin(): PushPlugin | null {
    if (typeof window === "undefined") return null
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor
    return cap?.isNativePlatform?.() ? (cap.Plugins?.PushNotifications as PushPlugin | undefined) ?? null : null
}

const REGISTRATION_TIMEOUT_MS = 20_000

/**
 * Turns pushes on for this phone, if the person allows them: asks once (the
 * phone remembers the answer), registers, and sends the token for this
 * phone's key. Nothing when the phone has no key yet: there's no phone of
 * theirs on the server to push to.
 */
export async function enablePush(device: CheckInDevice, push: PushPlugin | null, post: Post, timeoutMs = REGISTRATION_TIMEOUT_MS): Promise<"REGISTERED" | "DENIED" | "UNAVAILABLE"> {
    if (!push) return "UNAVAILABLE"
    const keyFingerprint = await deviceFingerprint(device)
    if (!keyFingerprint) return "UNAVAILABLE"
    let permission = await push.checkPermissions()
    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") permission = await push.requestPermissions()
    if (permission.receive !== "granted") return "DENIED"
    const listeners: Listener[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        let resolveToken!: (token: string) => void
        let rejectToken!: (error: Error) => void
        const token = new Promise<string>((resolve, reject) => { resolveToken = resolve; rejectToken = reject })
        // Awaited below; an error that arrives while register() is still running isn't "unhandled".
        token.catch(() => {})
        // Listening before asking (review on #25): a phone with a token already
        // answers at once, and an answer before the listener is there is lost.
        listeners.push(await push.addListener("registration", t => resolveToken(t.value)))
        listeners.push(await push.addListener("registrationError", e => rejectToken(new Error(e.error))))
        timer = setTimeout(() => rejectToken(new Error("PUSH_REGISTRATION_TIMEOUT")), timeoutMs)
        await push.register()
        await post("/api/attendance/phone/push-token", { keyFingerprint, token: await token })
        return "REGISTERED"
    } catch {
        // No push service on this build (no Firebase setup yet), or none reachable: check-in works the same.
        return "UNAVAILABLE"
    } finally {
        clearTimeout(timer)
        await Promise.all(listeners.map(l => l.remove()))
    }
}

/** Opens the page a tapped notice is about; only a path on this site. */
export async function onPushTapped(push: PushPlugin | null, go: (path: string) => void): Promise<() => void> {
    if (!push) return () => {}
    const listener = await push.addListener("pushNotificationActionPerformed", action => {
        const link = action.notification.data?.link
        if (typeof link === "string" && link.startsWith("/") && !link.startsWith("//")) go(link)
    })
    return () => { void listener.remove() }
}
