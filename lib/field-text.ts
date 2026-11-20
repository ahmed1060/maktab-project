/**
 * A text with fields put in by buttons (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md
 * §7.1, §12 step 10b; PR 347): the text is kept with its fields as their
 * names in braces, "{person}" (lib/client-message-template.ts), and shown in
 * a box where each field is a chip by its name in the page's language.
 *
 * Here, apart from the browser so it can be tested: a text's parts, the box's
 * first content, and reading the box back into the text kept.
 */

export type TextPart = { text: string } | { field: string }

/** A field in a text: a name in Latin letters, in braces. Other braces are words. */
const FIELD = /\{([A-Za-z]+)\}/g

/** A text's words and, in their places, its own fields; any other braces stay words. */
export function partsOf(text: string, fields: readonly string[]): TextPart[] {
    const parts: TextPart[] = []
    const words = (value: string) => {
        if (!value) return
        const last = parts[parts.length - 1]
        if (last && 'text' in last) last.text += value
        else parts.push({ text: value })
    }
    const field = new RegExp(FIELD.source, 'g')
    let from = 0
    for (let m = field.exec(text); m; m = field.exec(text)) {
        if (!fields.includes(m[1])) continue
        words(text.slice(from, m.index))
        parts.push({ field: m[1] })
        from = m.index + m[0].length
    }
    words(text.slice(from))
    return parts
}

export function textOfParts(parts: readonly TextPart[]): string {
    return parts.map(p => ('field' in p ? `{${p.field}}` : p.text)).join('')
}

export function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export const CHIP_CLASS = 'ui-fieldtext-chip'

/**
 * What the box opens with: the words as they are, each field a chip by its
 * name that can't be typed in, and a line break kept at the end, where the
 * cursor can stand after a last new line or a last chip.
 */
export function htmlOfParts(parts: readonly TextPart[], label: (field: string) => string): string {
    return parts.map(p => ('field' in p
        ? `<span class="${CHIP_CLASS}" contenteditable="false" data-field="${escapeHtml(p.field)}">${escapeHtml(label(p.field))}</span>`
        : escapeHtml(p.text))).join('') + '<br data-end="">'
}

/** As much of a node as the box is read through: the browser's, or a made-up one in a test. */
export type NodeLike = {
    nodeType: number
    nodeName: string
    nodeValue: string | null
    childNodes: ArrayLike<NodeLike>
    getAttribute?: (name: string) => string | null
}

const BLOCKS = ['DIV', 'P', 'LI']

/**
 * The text a box holds: its words, each chip as its field, and its lines.
 * The box puts in new lines itself, but a browser may still wrap a line in
 * a block of its own, ending it with a line break, so those are read as
 * lines too. The line break kept at the end for the cursor is nothing.
 */
export function textOfNodes(nodes: ArrayLike<NodeLike>): string {
    let out = ''
    const walk = (list: ArrayLike<NodeLike>, inBlock: boolean) => {
        for (let i = 0; i < list.length; i++) {
            const node = list[i]
            if (node.nodeType === 3) { out += (node.nodeValue ?? '').replace(/\u00a0/g, ' '); continue }
            if (node.nodeType !== 1) continue
            const field = node.getAttribute?.('data-field')
            if (field) { out += `{${field}}`; continue }
            const name = node.nodeName.toUpperCase()
            if (name === 'BR') {
                const end = node.getAttribute?.('data-end') !== null && node.getAttribute?.('data-end') !== undefined
                // A block's own last line break ends its line; it isn't another.
                if (!end && !(inBlock && i === list.length - 1)) out += '\n'
                continue
            }
            if (BLOCKS.includes(name)) {
                if (out !== '' && !out.endsWith('\n')) out += '\n'
                walk(node.childNodes, true)
                continue
            }
            walk(node.childNodes, inBlock)
        }
    }
    walk(nodes, false)
    return out
}
