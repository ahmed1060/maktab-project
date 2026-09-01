import { describe, it, expect } from "vitest"
import { cellToPrimitive } from "./xlsx-cell"

describe("cellToPrimitive (F-20: exceljs cell.value normalization)", () => {
    it("passes plain strings and numbers through unchanged", () => {
        expect(cellToPrimitive("hello")).toBe("hello")
        expect(cellToPrimitive(42)).toBe(42)
        expect(cellToPrimitive(0)).toBe(0)
    })

    it("passes null/undefined through unchanged (empty cell)", () => {
        expect(cellToPrimitive(null)).toBeNull()
        expect(cellToPrimitive(undefined)).toBeUndefined()
    })

    it("passes a Date through unchanged (date-formatted cell)", () => {
        const d = new Date("2027-01-15T09:30:00.000Z")
        expect(cellToPrimitive(d)).toBe(d)
    })

    it("unwraps a formula cell to its computed result", () => {
        expect(cellToPrimitive({ formula: "A1+A2", result: 7 })).toBe(7)
        // A formula cell whose result is itself a date must also unwrap correctly.
        const d = new Date("2027-01-15T00:00:00.000Z")
        expect(cellToPrimitive({ formula: "A1", result: d })).toBe(d)
    })

    it("unwraps a hyperlink cell to its display text", () => {
        expect(cellToPrimitive({ text: "click here", hyperlink: "https://example.com" })).toBe("click here")
    })

    it("joins a rich-text cell's runs into plain text", () => {
        expect(cellToPrimitive({ richText: [{ text: "Hello " }, { text: "World" }] })).toBe("Hello World")
    })

    it("falls back to String() for an unrecognized object shape rather than throwing", () => {
        expect(cellToPrimitive({ someWeirdShape: true })).toBe(String({ someWeirdShape: true }))
    })
})
