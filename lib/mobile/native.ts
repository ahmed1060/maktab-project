/**
 * The phone, as the check-in screen sees it (ATTENDANCE_PLAN.md §9.1).
 *
 * The Nizmo app is Capacitor around this website. Inside it, Capacitor puts
 * a bridge on window, and the app's own plugin, NizmoCheckIn (mobile/), does
 * what a web page can't: a key held in the phone's secure hardware, a
 * location fix that says whether it was simulated, and, later, proof the
 * request came from our app. In an ordinary browser there is no bridge, and
 * the screen says to use the app.
 */

export type Platform = "ANDROID" | "IOS"

export type Fix = { latitude: number; longitude: number; accuracyMeters: number; mocked: boolean }

/** What the screen needs from the phone. */
export interface CheckInDevice {
    platform: Platform
    /** pushReady: false when this build can't take pushes at all (Android without Firebase), so none is asked for. */
    info(): Promise<{ model: string | null; appVersion: string | null; pushReady: boolean }>
    /** The public half of this phone's key, SubjectPublicKeyInfo DER in base64, or null when it has none yet. */
    publicKey(): Promise<string | null>
    /** Makes a new key in the secure hardware, replacing any before it, and gives its public half. */
    createKey(): Promise<string>
    /** Signs the text with the key; a DER ECDSA signature in base64. */
    sign(text: string): Promise<string>
    /** A fresh location fix; refuses when the person declines location. */
    location(): Promise<Fix>
    /** A token proving the request came from our app, bound to this number; null until the verifiers exist. */
    attestation(nonce: string): Promise<string | null>
}

/** The plugin's methods as the native code exposes them (mobile/README.md). */
type NativePlugin = {
    getInfo(): Promise<{ platform: string; model?: string | null; appVersion?: string | null; pushReady?: boolean }>
    getPublicKey(): Promise<{ publicKey?: string | null }>
    createKey(): Promise<{ publicKey: string }>
    sign(options: { text: string }): Promise<{ signature: string }>
    getLocation(): Promise<{ latitude: number; longitude: number; accuracy: number; mocked: boolean }>
    requestAttestation(options: { nonce: string }): Promise<{ token?: string | null }>
}

type CapacitorGlobal = {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
    Plugins?: Record<string, unknown>
}

function capacitor(): CapacitorGlobal | null {
    if (typeof window === "undefined") return null
    return ((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor) ?? null
}

/** Whether this page is running inside the Nizmo app with its check-in plugin. */
export function inNativeApp(): boolean {
    const cap = capacitor()
    return !!cap?.isNativePlatform?.() && !!cap.Plugins?.NizmoCheckIn
}

/** The phone, inside the app; null in a browser. */
export function checkInDevice(): CheckInDevice | null {
    if (!inNativeApp()) return null
    const cap = capacitor()!
    const plugin = cap.Plugins!.NizmoCheckIn as NativePlugin
    const platform: Platform = cap.getPlatform?.() === "ios" ? "IOS" : "ANDROID"
    return {
        platform,
        info: async () => {
            const i = await plugin.getInfo()
            return { model: i.model?.slice(0, 80) || null, appVersion: i.appVersion?.slice(0, 40) || null, pushReady: i.pushReady !== false }
        },
        publicKey: async () => (await plugin.getPublicKey()).publicKey ?? null,
        createKey: async () => (await plugin.createKey()).publicKey,
        sign: async text => (await plugin.sign({ text })).signature,
        location: async () => {
            const l = await plugin.getLocation()
            return { latitude: l.latitude, longitude: l.longitude, accuracyMeters: l.accuracy, mocked: !!l.mocked }
        },
        attestation: async nonce => {
            try {
                return (await plugin.requestAttestation({ nonce })).token ?? null
            } catch {
                // Not proving it is not a failure here: the server flags or refuses, and says why.
                return null
            }
        },
    }
}
