import { describe, it, expect } from "vitest"
import { suggestName } from "@/lib/names/suggest"
import { GIVEN_NAMES } from "@/lib/names/given-names"
import { BUSINESS_WORDS } from "@/lib/names/business-words"
import { writtenInArabic } from "@/lib/names"
import { arabicGuess, englishGuess } from "@/lib/names/rules"

/**
 * Nizmo's list of names, and the rules (LATER_CHANGES_PLAN.md §3.1, step 2,
 * PR 399; DESIGN.md §5.3): the other language of a name, suggested word by
 * word from the list of common Egyptian and Arabic given names, then from
 * the business words for a client's or the company's name, then from the
 * rules, which are a guess to check. Never saved by itself: this only
 * suggests.
 */

const toEn = (name: string, kind: "person" | "business" = "person") => suggestName(name, { to: "en", kind })
const toAr = (name: string, kind: "person" | "business" = "person") => suggestName(name, { to: "ar", kind })

describe("a person's name, from Arabic to English", () => {
    it("is the usual Egyptian spelling from the list", () => {
        expect(toEn("محمد")).toEqual({ text: "Mohamed", words: [{ text: "Mohamed", from: "list" }], guesses: [] })
        expect(toEn("مصطفى")?.text).toBe("Mostafa")
        expect(toEn("فاطمة")?.text).toBe("Fatma")
    })

    it("is looked up word by word, as a full name is a row of given names", () => {
        expect(toEn("محمد أحمد محمود")?.text).toBe("Mohamed Ahmed Mahmoud")
        expect(toEn("  محمد   أحمد ")?.text).toBe("Mohamed Ahmed")
    })

    it("takes a name of two words as one, typed with its space or without", () => {
        expect(toEn("عبد الرحمن")).toEqual({ text: "Abdelrahman", words: [{ text: "Abdelrahman", from: "list" }], guesses: [] })
        expect(toEn("عبدالرحمن")?.text).toBe("Abdelrahman")
        expect(toEn("محمد عبد الرحمن")?.text).toBe("Mohamed Abdelrahman")
    })

    it("reads a name as people type it: without its marks, its hamza, or its dots", () => {
        expect(toEn("مُحَمَّد")?.text).toBe("Mohamed")
        expect(toEn("احمد")?.text).toBe("Ahmed")
        expect(toEn("مصطفي")?.text).toBe("Mostafa")
        expect(toEn("فاطمه")?.text).toBe("Fatma")
        expect(toEn("محمـــد")?.text).toBe("Mohamed")
    })

    it("joins the article to a name it knows, as Egyptian names are written", () => {
        expect(toEn("السيد")).toEqual({ text: "Elsayed", words: [{ text: "Elsayed", from: "list" }], guesses: [] })
    })

    it("guesses a word in neither list by the rules, and says which", () => {
        const name = toEn("أحمد الشناوي")!
        expect(name.text).toBe("Ahmed Elshnawy")
        expect(name.words).toEqual([{ text: "Ahmed", from: "list" }, { text: "Elshnawy", from: "rules" }])
        expect(name.guesses).toEqual(["Elshnawy"])
    })

    it("has nothing to suggest for an empty name, or one already in English", () => {
        expect(toEn("")).toBeNull()
        expect(toEn("   ")).toBeNull()
        expect(toEn("Mohamed")).toBeNull()
    })
})

describe("a person's name, from English to Arabic", () => {
    it("is the Arabic of any of its usual spellings, whatever its capitals", () => {
        for (const spelling of ["Mohamed", "Mohammed", "Muhammad", "Mohammad", "mohamed", "MOHAMED"]) {
            expect(toAr(spelling), spelling).toEqual({ text: "محمد", words: [{ text: "محمد", from: "list" }], guesses: [] })
        }
        expect(toAr("Mostafa Hassan")?.text).toBe("مصطفى حسن")
    })

    it("takes a name of two words as one, written either way", () => {
        expect(toAr("Abdelrahman")?.text).toBe("عبد الرحمن")
        expect(toAr("Abdel Rahman")?.text).toBe("عبد الرحمن")
        expect(toAr("Mohamed Abdel Rahman")?.text).toBe("محمد عبد الرحمن")
    })

    it("reads the article joined, spaced or hyphened", () => {
        for (const spelling of ["Elsayed", "El Sayed", "El-Sayed"]) {
            expect(toAr(spelling), spelling).toEqual({ text: "السيد", words: [{ text: "السيد", from: "list" }], guesses: [] })
        }
    })

    it("guesses a word in neither list by the rules, and says which", () => {
        const name = toAr("Ahmed Zorba")!
        expect(name.words[0]).toEqual({ text: "أحمد", from: "list" })
        expect(name.words[1].from).toBe("rules")
        expect(writtenInArabic(name.words[1].text)).toBe(true)
        expect(name.guesses).toEqual([name.words[1].text])
    })

    it("has nothing to suggest for an empty name, or one already in Arabic", () => {
        expect(toAr("")).toBeNull()
        expect(toAr("محمد")).toBeNull()
    })

    it("has nothing to suggest for a name written in both, or in neither", () => {
        expect(toAr("Karim سعيد")).toBeNull()
        expect(toEn("Karim سعيد")).toBeNull()
        expect(toAr("123")).toBeNull()
        expect(toEn("123")).toBeNull()
    })
})

describe("the rules, for a word in neither list", () => {
    it("write Arabic as its letters, و and ي as vowels between two others, and the article as El", () => {
        expect(arabicGuess("محمد")).toBe("Mhmd")
        expect(arabicGuess("زيتونة")).toBe("Zitona")
        expect(arabicGuess("الشناوي")).toBe("Elshnawy")
        expect(arabicGuess("وائل")).toBe("Wael")
        expect(arabicGuess("ثروت")).toBe("Throt")
        expect(arabicGuess("قنا")).toBe("Kna")
        expect(arabicGuess("جوهرة")).toBe("Gohra")
    })

    it("write English as its consonants, its pairs as one letter, a vowel at the start on its alef, and El as the article", () => {
        expect(englishGuess("Hassan")).toBe("هسن")
        expect(englishGuess("Zorba")).toBe("زوربا")
        expect(englishGuess("Elshenawy")).toBe("الشنوي")
        expect(englishGuess("Omar")).toBe("أمر")
        expect(englishGuess("Eid")).toBe("إيد")
        expect(englishGuess("Shady")).toBe("شدي")
        expect(englishGuess("Khoury")).toBe("خوري")
        expect(englishGuess("Sameer")).toBe("سمير")
    })
})

describe("a business's name", () => {
    it("puts each business word where English puts it", () => {
        expect(toEn("شركة النور للتجارة", "business")).toEqual({
            text: "El Nour Trading Company",
            words: [{ text: "El Nour", from: "list" }, { text: "Trading", from: "business" }, { text: "Company", from: "business" }],
            guesses: [],
        })
        expect(toEn("مكتب الفاروق للمحاسبة", "business")?.text).toBe("El Farouk Accounting Office")
        expect(toEn("النور للتجارة وشركاه", "business")?.text).toBe("El Nour Trading & Partners")
        expect(toEn("شركة النور للاستيراد والتصدير", "business")?.text).toBe("El Nour Import & Export Company")
    })

    it("puts each where Arabic puts it", () => {
        expect(toAr("El Nour Trading Company", "business")?.text).toBe("شركة النور للتجارة")
        expect(toAr("El Farouk Accounting Office", "business")?.text).toBe("مكتب الفاروق للمحاسبة")
        expect(toAr("El Nour Trading & Partners", "business")?.text).toBe("النور للتجارة وشركاه")
        expect(toAr("el nour import & export company", "business")?.text).toBe("شركة النور للاستيراد والتصدير")
    })

    it("guesses a brand's name by the rules, and says so", () => {
        const name = toEn("شركة زيتونة للتجارة", "business")!
        expect(name.words.map(word => word.from)).toEqual(["rules", "business", "business"])
        expect(name.guesses).toEqual([name.words[0].text])
    })

    it("is read for business words only for a business, not for a person", () => {
        expect(toEn("مكتب", "business")?.text).toBe("Office")
        expect(toEn("مكتب", "person")?.words).toEqual([{ text: "Mktb", from: "rules" }])
    })

    it("is a person's name where it has no business words", () => {
        expect(toEn("محمود عبد الله", "business")?.text).toBe("Mahmoud Abdallah")
    })
})

describe("Nizmo's list of names", () => {
    it("holds the common Egyptian and Arabic given names", () => {
        // 698 as written (PR 399): more can be added at any time, and a company's own spellings fill the rest (step 3).
        expect(GIVEN_NAMES.length).toBeGreaterThanOrEqual(698)
    })

    it("has each in Arabic letters, and each spelling in English ones, capitalised", () => {
        for (const [ar, ...spellings] of GIVEN_NAMES) {
            expect(writtenInArabic(ar), ar).toBe(true)
            expect(spellings.length, ar).toBeGreaterThan(0)
            for (const spelling of spellings) expect(spelling, ar).toMatch(/^[A-Z][a-z]+$/)
        }
    })

    it("has each name once, and gives each spelling to one name", () => {
        const fold = (ar: string) => ar.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s/g, "")
        const arabic = new Map<string, string>()
        const english = new Map<string, string>()
        for (const [ar, ...spellings] of GIVEN_NAMES) {
            expect(arabic.get(fold(ar)), ar).toBeUndefined()
            arabic.set(fold(ar), ar)
            for (const spelling of spellings) {
                expect(english.get(spelling.toLowerCase()), `${spelling}: ${ar}`).toBeUndefined()
                english.set(spelling.toLowerCase(), ar)
            }
        }
    })

    it("has its business words in each language, each once", () => {
        const ar = new Set<string>()
        const en = new Set<string>()
        for (const word of BUSINESS_WORDS) {
            expect(word.ar.split(" ").every(writtenInArabic), word.ar).toBe(true)
            expect(word.en, word.ar).toMatch(/^[A-Z&][A-Za-z&]*( [A-Z&][A-Za-z&]*)*$/)
            expect(ar.has(word.ar), word.ar).toBe(false)
            expect(en.has(word.en.toLowerCase()), word.en).toBe(false)
            ar.add(word.ar)
            en.add(word.en.toLowerCase())
        }
    })
})
