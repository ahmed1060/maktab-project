/**
 * What the phone keeps in the site's storage about itself, which clearing
 * that storage must leave: which review the face templates waiting on this
 * phone were sent with (lib/mobile/face.ts). Lost, the templates went,
 * though their photo might be approved a moment later, leaving the phone
 * with nothing to match against (review on #27). No imports: the error
 * screen reads it.
 */
export const PHONE_KEYS = ["nizmo-face-sent-review"] as const

/** Clears the site's storage, the phone's own keys apart. */
export function clearStorageKeepingPhone(storage: Pick<Storage, "getItem" | "setItem" | "clear">) {
    const kept = PHONE_KEYS.map(key => [key, storage.getItem(key)] as const)
    storage.clear()
    for (const [key, value] of kept) if (value !== null) storage.setItem(key, value)
}
