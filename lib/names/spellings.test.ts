import { describe, it, expect } from "vitest"
import { pairsOf, spellingsOf } from "@/lib/names/spellings"

/**
 * What the company saves teaches it (LATER_CHANGES_PLAN.md §3.1, step 3a,
 * PR 400): a name saved in both languages, word by word, each word of its
 * Arabic beside its English, read as the suggestion reads them (Nizmo's
 * list's names of several words as one, El spaced before a name as one
 * word, a business's words for what it is and does left out), and how many
 * names use each.
 */

const person = (en: string, ar?: string | null) => pairsOf({ en, ar }, "person")
const business = (en: string, ar?: string | null) => pairsOf({ en, ar }, "business")

describe("a name's words, paired", () => {
    it("pairs each word of its Arabic with its English, in order", () => {
        expect(person("Mohamed Ahmed", "محمد أحمد")).toEqual([
            { ar: "محمد", arKey: "محمد", en: "Mohamed", enKey: "mohamed" },
            { ar: "أحمد", arKey: "احمد", en: "Ahmed", enKey: "ahmed" },
        ])
    })

    it("takes a name of the list of several words as one, as it's written", () => {
        expect(person("Abdelrahman", "عبد الرحمن")).toEqual([{ ar: "عبد الرحمن", arKey: "عبدالرحمن", en: "Abdelrahman", enKey: "abdelrahman" }])
        expect(person("Abdel Rahman Ali", "عبد الرحمن علي")).toEqual([
            { ar: "عبد الرحمن", arKey: "عبدالرحمن", en: "Abdel Rahman", enKey: "abdelrahman" },
            { ar: "علي", arKey: "علي", en: "Ali", enKey: "ali" },
        ])
    })

    it("takes El spaced or hyphened before a name as one word, keeping how it's written", () => {
        expect(person("El-Sayed", "السيد")).toEqual([{ ar: "السيد", arKey: "السيد", en: "El-Sayed", enKey: "elsayed" }])
        expect(person("Ahmed El Shenawy", "أحمد الشناوي")).toEqual([
            { ar: "أحمد", arKey: "احمد", en: "Ahmed", enKey: "ahmed" },
            { ar: "الشناوي", arKey: "الشناوي", en: "El Shenawy", enKey: "elshenawy" },
        ])
    })

    it("leaves a business's words for what it is and does out, as Nizmo knows them", () => {
        expect(business("El Nour Trading Company", "شركة النور للتجارة")).toEqual([{ ar: "النور", arKey: "النور", en: "El Nour", enKey: "elnour" }])
        expect(business("Zaytouna Import & Export", "زيتونة للاستيراد والتصدير")).toEqual([{ ar: "زيتونة", arKey: "زيتونه", en: "Zaytouna", enKey: "zaytouna" }])
    })

    it("learns a name of up to three words whole where its words don't pair", () => {
        expect(person("Karmozika", "كرمو زيكا")).toEqual([{ ar: "كرمو زيكا", arKey: "كرموزيكا", en: "Karmozika", enKey: "karmozika" }])
        expect(person("Karmo Zika Tarbo Lino", "كرمو زيكا ترب")).toEqual([])
    })

    it("pairs no number, only words", () => {
        expect(business("El Nour 2", "النور ٢")).toEqual([{ ar: "النور", arKey: "النور", en: "El Nour", enKey: "elnour" }])
        expect(business("El Nour Two", "النور ٢")).toEqual([{ ar: "النور", arKey: "النور", en: "El Nour", enKey: "elnour" }])
        expect(person("Ahmed 2", "أحمد سامي")).toEqual([{ ar: "أحمد", arKey: "احمد", en: "Ahmed", enKey: "ahmed" }])
    })

    it("learns nothing from a name not saved in both languages", () => {
        expect(person("Mohamed")).toEqual([])
        expect(person("Mohamed", null)).toEqual([])
        expect(person("Mohamed", "   ")).toEqual([])
        // Written in Arabic before today, in both columns: it has no English yet.
        expect(person("محمد", "محمد")).toEqual([])
        expect(person("Mohamed", "Mohamed")).toEqual([])
        // Its Arabic isn't written in Arabic letters alone.
        expect(person("Mohamed Ali", "محمد Ali")).toEqual([])
        expect(person("Mohamed محمد", "محمد")).toEqual([])
        expect(person("123", "محمد")).toEqual([])
    })
})

describe("a company's spellings", () => {
    it("counts how many names use each, a name once however often it has it", () => {
        expect(spellingsOf([
            [{ en: "Mohamed Ahmed", ar: "محمد أحمد" }, { en: "Mohamed", ar: "محمد" }],
            [{ en: "Mohammed", ar: "محمد" }, { en: "Hassan", ar: "حسن" }],
            [{ en: "Mohamed", ar: "محمد" }, { en: "Ali" }],
        ], "person")).toEqual([
            { ar: "أحمد", arKey: "احمد", en: "Ahmed", enKey: "ahmed", uses: 1 },
            { ar: "حسن", arKey: "حسن", en: "Hassan", enKey: "hassan", uses: 1 },
            { ar: "محمد", arKey: "محمد", en: "Mohamed", enKey: "mohamed", uses: 2 },
            { ar: "محمد", arKey: "محمد", en: "Mohammed", enKey: "mohammed", uses: 1 },
        ])
    })

    it("keeps a spelling once whatever its capitals or marks, as it's written most", () => {
        expect(spellingsOf([
            [{ en: "mohamed", ar: "مُحَمَّد" }],
            [{ en: "Mohamed", ar: "محمد" }],
            [{ en: "Mohamed", ar: "محمد" }],
        ], "person")).toEqual([{ ar: "محمد", arKey: "محمد", en: "Mohamed", enKey: "mohamed", uses: 3 }])
    })

    it("keeps the first of two written as often", () => {
        expect(spellingsOf([[{ en: "MOHAMED", ar: "محمد" }], [{ en: "Mohamed", ar: "محمد" }]], "person")).toEqual([
            { ar: "محمد", arKey: "محمد", en: "MOHAMED", enKey: "mohamed", uses: 2 },
        ])
    })

    it("has none for names with nothing to learn", () => {
        expect(spellingsOf([], "person")).toEqual([])
        expect(spellingsOf([[{ en: "محمد", ar: "محمد" }]], "person")).toEqual([])
    })
})
