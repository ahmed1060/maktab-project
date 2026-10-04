// The app's icon images, derived from the site's own mark (app/icon.svg), so a
// new mark there is the app's new icon after `npm run assets` (review on #31:
// a copy of the mark kept here would have drifted from it).
//
// app/icon.svg is expected to be: a <defs>, one <rect> (the gradient tile,
// with rounded corners) and one <path> (the "N"). Anything else stops the
// script rather than drawing the wrong thing.

/** The mark's parts, for drawing: full-bleed, background alone, foreground alone, and as it is. */
export function variantsOf(svg) {
    const rects = svg.match(/<rect\b[^>]*\/>/g) ?? []
    const paths = svg.match(/<path\b[^>]*\/>/g) ?? []
    if (rects.length !== 1 || paths.length !== 1 || !/<defs>[\s\S]*<\/defs>/.test(svg)) {
        throw new Error("app/icon.svg is no longer one gradient <rect> and one <path>: update mobile/scripts/icon-variants.mjs to match it")
    }
    const [rect] = rects
    const square = rect.replace(/\s+rx="[^"]*"/, "")
    return {
        // The stores and the phones round the corners themselves.
        fullBleed: svg.replace(rect, square),
        background: svg.replace(rect, square).replace(paths[0], ""),
        foreground: svg.replace(rect, ""),
        rounded: svg,
    }
}

/**
 * Android's adaptive icon with the background full bleed: @capacitor/assets
 * insets both layers to the middle 66%, and a launcher's mask, or its
 * parallax, can show past that (review on #31). Only the foreground keeps the
 * inset, which keeps the "N" inside every mask.
 */
export function fullBleedBackground(xml) {
    const fixed = xml.replace(
        /<background>\s*<inset android:drawable="@mipmap\/ic_launcher_background"[^>]*\/>\s*<\/background>/,
        '<background android:drawable="@mipmap/ic_launcher_background"/>',
    )
    if (!fixed.includes('<background android:drawable="@mipmap/ic_launcher_background"/>')) {
        throw new Error("The adaptive icon XML isn't what @capacitor/assets writes: update mobile/scripts/icon-variants.mjs")
    }
    return fixed
}
