/**
 * A word without what can't be seen and can't be kept (PR 315): control
 * characters, and half of a character's pair, which the database refuses.
 */
export function seen(text: string): string {
    let out = ""
    for (let at = 0; at < text.length; at++) {
        const code = text.charCodeAt(at)
        if (code >= 0xd800 && code <= 0xdbff) {
            // A pair is one character; its first half alone is nothing.
            const next = text.charCodeAt(at + 1)
            if (next >= 0xdc00 && next <= 0xdfff) out += text[at] + text[++at]
        } else if (code >= 0xdc00 && code <= 0xdfff) continue
        // Tabs and line ends are spaces, tidied after.
        else if ((code < 0x20 && (code < 0x09 || code > 0x0d)) || code === 0x7f) continue
        else out += text[at]
    }
    return out
}
