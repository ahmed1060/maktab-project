import type { Descriptor } from "./match"

/**
 * The prototype's face templates on the phone (ATTENDANCE_PLAN.md §10.4):
 * encrypted with a key made from two halves, a device key that never leaves
 * this app's storage (a non-extractable WebCrypto key) and the wrapping key
 * the server hands out for each use. Without the server's half they can't
 * be read, so destroying it there makes them unreadable here.
 *
 * Two places: the approved templates, matched against; and new ones from
 * an enrolment waiting for its photo's approval (lib/mobile/face.ts).
 *
 * Weaker than the real thing: the device half lives in the web view's
 * storage, not the secure hardware.
 */

export type Slot = "approved" | "pending"

/** Where the vault keeps things: IndexedDB in the app, a Map in tests. */
export interface Store {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
}

type Sealed = { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> }

const DEVICE = "device-key"
const INFO = new TextEncoder().encode("nizmo-face-prototype/v1")

function fail(code: string): never {
    throw Object.assign(new Error(code), { code })
}

export class Vault {
    constructor(private readonly store: Store, private readonly subtle: SubtleCrypto = globalThis.crypto.subtle) {}

    /** The device half: made once, never extractable. */
    private async device(): Promise<CryptoKey> {
        const existing = await this.store.get(DEVICE)
        if (existing) return existing as CryptoKey
        const key = await this.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"])
        await this.store.set(DEVICE, key)
        return key
    }

    /** The two halves together: HKDF over the server's key, salted with the device key's mark. */
    private async key(wrappingKey: string): Promise<CryptoKey> {
        const raw = Uint8Array.from(atob(wrappingKey), c => c.charCodeAt(0))
        if (raw.length !== 32) fail("FACE_KEY_INVALID")
        const salt = new Uint8Array(await this.subtle.sign("HMAC", await this.device(), INFO))
        const material = await this.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"])
        return this.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: INFO }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
    }

    async save(slot: Slot, wrappingKey: string, descriptors: readonly Descriptor[]): Promise<void> {
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
        const plain = new TextEncoder().encode(JSON.stringify({ v: 1, descriptors }))
        const data = new Uint8Array(await this.subtle.encrypt({ name: "AES-GCM", iv }, await this.key(wrappingKey), plain))
        await this.store.set(slot, { iv, data } satisfies Sealed)
    }

    /** The slot's descriptors, or null when empty. A key that doesn't open them: TEMPLATES_UNREADABLE. */
    async load(slot: Slot, wrappingKey: string): Promise<Descriptor[] | null> {
        const sealed = (await this.store.get(slot)) as Sealed | undefined
        if (!sealed) return null
        try {
            const plain = await this.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, await this.key(wrappingKey), sealed.data)
            return (JSON.parse(new TextDecoder().decode(plain)) as { descriptors: Descriptor[] }).descriptors
        } catch {
            return fail("TEMPLATES_UNREADABLE")
        }
    }

    async has(slot: Slot): Promise<boolean> {
        return !!(await this.store.get(slot))
    }

    /** The waiting templates become the approved ones. */
    async promote(): Promise<void> {
        const pending = await this.store.get("pending")
        if (!pending) return
        await this.store.set("approved", pending)
        await this.store.delete("pending")
    }

    async discardPending(): Promise<void> {
        await this.store.delete("pending")
    }

    /** Every template. The device half stays: it unlocks nothing alone. */
    async deleteAll(): Promise<void> {
        await this.store.delete("approved")
        await this.store.delete("pending")
    }
}

/** A Store in IndexedDB, which keeps a CryptoKey as it is: still non-extractable. */
export function indexedDbStore(name = "nizmo-face"): Store {
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, 1)
        req.onupgradeneeded = () => req.result.createObjectStore("kv")
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
    // Resolved once the transaction commits, not when the request succeeds: a
    // write can still abort after that (review on #28).
    const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
        const db = await open()
        try {
            return await new Promise<T>((resolve, reject) => {
                const tx = db.transaction("kv", mode)
                const req = op(tx.objectStore("kv"))
                tx.oncomplete = () => resolve(req.result as T)
                tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"))
                tx.onerror = () => reject(tx.error ?? req.error)
            })
        } finally {
            db.close()
        }
    }
    return {
        get: key => run("readonly", s => s.get(key)),
        set: async (key, value) => { await run("readwrite", s => s.put(value, key)) },
        delete: async key => { await run("readwrite", s => s.delete(key)) },
    }
}
