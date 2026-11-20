import { describe, it, expect } from "vitest"
import { escapeHtml, htmlOfParts, partsOf, textOfNodes, textOfParts, type NodeLike } from "./field-text"

/**
 * A text with fields put in by buttons (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md
 * §7.1, §12 step 10b; PR 347): the text kept with its fields in braces, and
 * the box that shows each field as a chip by its name. Its parts, the box's
 * first content, and reading the box back into the text kept.
 */

const FIELDS = ["person", "client", "asOf"]
const LABELS: Record<string, string> = { person: "Person's name", client: "Client's name", asOf: "Date of the figures" }

describe("a text's parts", () => {
    it("its words, and its own fields in their places", () => {
        expect(partsOf("Hello {person} of {client}.", FIELDS)).toEqual([
            { text: "Hello " }, { field: "person" }, { text: " of " }, { field: "client" }, { text: "." },
        ])
    })

    it("a field at its start or end, or two side by side, with no empty words between", () => {
        expect(partsOf("{person}{client}", FIELDS)).toEqual([{ field: "person" }, { field: "client" }])
    })

    it("braces that aren't one of its fields stay words", () => {
        expect(partsOf("{number} and {} for {person}", FIELDS)).toEqual([{ text: "{number} and {} for " }, { field: "person" }])
    })

    it("new lines stay in its words", () => {
        expect(partsOf("Hello,\n{person}\n", FIELDS)).toEqual([{ text: "Hello,\n" }, { field: "person" }, { text: "\n" }])
    })

    it("put back together, the text as it was", () => {
        for (const text of ["Hello {person} of {client}.", "{person}{client}", "{number} and {} for {person}", "a\n\nb", ""]) {
            expect(textOfParts(partsOf(text, FIELDS))).toBe(text)
        }
    })
})

describe("the box's first content", () => {
    it("words as they are, each field a chip by its name that can't be typed in, and the end kept for the cursor", () => {
        expect(htmlOfParts(partsOf("Hi {person},\nbye", FIELDS), f => LABELS[f])).toBe(
            'Hi <span class="ui-fieldtext-chip" contenteditable="false" data-field="person">Person&#39;s name</span>,\nbye<br data-end="">',
        )
    })

    it("written so nothing in the words is read as markup", () => {
        expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;")
        expect(htmlOfParts([{ text: "<img src=x onerror=alert(1)>" }], f => f)).toBe('&lt;img src=x onerror=alert(1)&gt;<br data-end="">')
    })
})

/** A made-up box, as the browser holds it. */
const text = (value: string): NodeLike => ({ nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] })
const el = (name: string, children: NodeLike[] = [], attrs: Record<string, string> = {}): NodeLike =>
    ({ nodeType: 1, nodeName: name, nodeValue: null, childNodes: children, getAttribute: (a: string) => attrs[a] ?? null })
const chip = (field: string, label: string) => el("SPAN", [text(label)], { "data-field": field })

describe("reading the box back", () => {
    it("its words, and each chip as its field", () => {
        expect(textOfNodes([text("Hello "), chip("person", "Person's name"), text(".")])).toBe("Hello {person}.")
    })

    it("a chip as its field, whatever its name says", () => {
        expect(textOfNodes([chip("client", "اسم العميل")])).toBe("{client}")
    })

    it("a line break as a new line, and the one kept at the end for the cursor as nothing", () => {
        expect(textOfNodes([text("a"), el("BR"), text("b"), el("BR", [], { "data-end": "" })])).toBe("a\nb")
    })

    it("a line the browser wrapped in a block of its own as a line", () => {
        expect(textOfNodes([text("a"), el("DIV", [text("b")]), el("DIV", [el("BR")])])).toBe("a\nb\n")
    })

    it("a block's own trailing line break as the line's end, not another", () => {
        expect(textOfNodes([el("DIV", [text("a"), el("BR")]), el("DIV", [text("b")])])).toBe("a\nb")
    })

    it("a space the browser keeps as a non-breaking one, as a space", () => {
        expect(textOfNodes([text("a\u00a0\u00a0b")])).toBe("a  b")
    })

    it("what else the browser wraps words in, as its words", () => {
        expect(textOfNodes([el("SPAN", [text("plain")]), el("B", [text(" bold")])])).toBe("plain bold")
    })

    it("an empty box as an empty text", () => {
        expect(textOfNodes([])).toBe("")
        expect(textOfNodes([el("BR", [], { "data-end": "" })])).toBe("")
    })
})
