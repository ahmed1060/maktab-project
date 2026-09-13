import { readImageHeader, type ImageInfo } from "@/lib/image-header"

/**
 * The rules a company logo has to satisfy, and the reasons for each.
 *
 * Kept apart from the endpoint that enforces them so they can be tested
 * without a request, a session or a storage bucket — the decisions here are
 * the part worth pinning, and every one of them is a pure function of bytes.
 */

/** 1 MB. The existing upload route allows 4, which is sized for a task
 *  attachment; a logo is one small image on every page load of every session.
 *  A real logo is a few tens of kilobytes. */
export const MAX_LOGO_BYTES = 1024 * 1024

/** Above this, the browser is downscaling a picture nobody needed at that
 *  size. The sidebar renders it at about 40 CSS pixels. */
export const MAX_LOGO_DIMENSION = 2000

/** Below this it is not a logo — a tracking pixel and a favicon-sized crop
 *  both land here, and both render as a smear at the size this is shown. */
export const MIN_LOGO_DIMENSION = 32

export type LogoRejection =
    | { ok: false; reason: "empty" }
    | { ok: false; reason: "too_large"; bytes: number }
    | { ok: false; reason: "unreadable" }
    | { ok: false; reason: "too_big_pixels"; info: ImageInfo }
    | { ok: false; reason: "too_small_pixels"; info: ImageInfo }

export type LogoVerdict = { ok: true; info: ImageInfo } | LogoRejection

/**
 * Whether these bytes may become a company's logo.
 *
 * Note what is *not* consulted: the file name, and the browser-supplied MIME
 * type. Both are client input. `readImageHeader` returning a format is the
 * only evidence accepted that this is a PNG, JPEG or WebP at all — which is
 * also how SVG is refused. Refusing the ".svg" extension would leave the
 * actual risk untouched, because the extension is chosen by whoever is
 * uploading; an SVG is a document that can carry a <script> tag, and this
 * bucket serves its files publicly.
 */
export function validateLogo(bytes: Buffer): LogoVerdict {
    if (bytes.length === 0) return { ok: false, reason: "empty" }
    if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: "too_large", bytes: bytes.length }

    const info = readImageHeader(bytes)
    if (!info) return { ok: false, reason: "unreadable" }

    if (info.width > MAX_LOGO_DIMENSION || info.height > MAX_LOGO_DIMENSION) {
        return { ok: false, reason: "too_big_pixels", info }
    }
    if (info.width < MIN_LOGO_DIMENSION || info.height < MIN_LOGO_DIMENSION) {
        return { ok: false, reason: "too_small_pixels", info }
    }

    return { ok: true, info }
}

/** The extension to store a validated logo under — taken from the format that
 *  was actually detected, never from the name the file arrived with, so the
 *  content-type lib/storage.ts derives from it is telling the truth. */
export function logoExtension(format: ImageInfo["format"]): string {
    return format === "jpeg" ? ".jpg" : `.${format}`
}

/** The path inside the app-assets bucket that a stored logo URL points at, or
 *  null if this URL did not come from that bucket. Used to delete the old file
 *  when a logo is replaced, the same way avatars are cleaned up. */
export function bucketPathFor(url: string | null | undefined): string | null {
    if (!url) return null
    const parts = url.split("/app-assets/")
    return parts.length > 1 && parts[1] ? parts[1] : null
}
