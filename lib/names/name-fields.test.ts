import { describe, it, expect } from "vitest"
import { fieldsInOrder, newNameErrors, sourceOf, spellingOptions, toSuggest, suggestionPath } from "@/lib/names/name-fields"
import type { Suggestion } from "@/lib/names/suggest"

/**
 * A name in English and in Arabic (DESIGN.md §5.3; LATER_CHANGES_PLAN.md
 * §3.1, step 4a, PR 402): the rules of its two fields, apart from their
 * look. components/ui/NameFields.tsx draws them.
 */

const word = (text: string, from: "company" | "list" | "business" | "rules", uses?: number, others?: Suggestion["words"][number]["others"]) =>
    ({ text, from, ...(uses !== undefined ? { uses } : {}), ...(others ? { others } : {}) })
const suggestion = (...words: ReturnType<typeof word>[]): Suggestion => ({
    text: words.map(w => w.text).join(" "),
    words,
    guesses: words.filter(w => w.from === "rules").map(w => w.text),
})

describe("the two fields", () => {
    it("put the page's language first, on the start side", () => {
        expect(fieldsInOrder("en")).toEqual(["en", "ar"])
        expect(fieldsInOrder("ar")).toEqual(["ar", "en"])
    })
})

describe("what's suggested", () => {
    it("is the other language of the one typed, for the field still empty", () => {
        expect(toSuggest({ en: "", ar: " محمد " })).toEqual({ name: "محمد", to: "en" })
        expect(toSuggest({ en: "Mohamed", ar: "" })).toEqual({ name: "Mohamed", to: "ar" })
    })

    it("is nothing while both are empty, or both typed", () => {
        expect(toSuggest({ en: "", ar: "  " })).toBeNull()
        expect(toSuggest({ en: "Mohamed", ar: "محمد" })).toBeNull()
    })

    it("is asked of the server for the name, the language, and the kind of name, for the company in view", () => {
        expect(suggestionPath({ name: "محمد علي", to: "en" }, "person")).toBe("/api/names/suggest?name=%D9%85%D8%AD%D9%85%D8%AF+%D8%B9%D9%84%D9%8A&to=en&kind=person")
        expect(suggestionPath({ name: "El Nour", to: "ar" }, "business", "c2")).toBe("/api/names/suggest?name=El+Nour&to=ar&kind=business&companyId=c2")
    })
})

describe("where a suggestion comes from, said beside it", () => {
    it("is how many names here use it, where it's all the company's: the fewest of its words'", () => {
        expect(sourceOf(suggestion(word("Mohammed", "company", 4)))).toEqual({ uses: 4 })
        expect(sourceOf(suggestion(word("Mohammed", "company", 4), word("Aly", "company", 2)))).toEqual({ uses: 2 })
    })

    it("is the usual spelling, where it's all Nizmo's list", () => {
        expect(sourceOf(suggestion(word("Mohamed", "list"), word("Ali", "list")))).toBe("usual")
        expect(sourceOf(suggestion(word("El Nour", "list"), word("Trading", "business")))).toBe("usual")
        expect(sourceOf(suggestion(word("Trading", "business")))).toBe("usual")
    })

    it("is nothing for a guess, or where the two are mixed", () => {
        expect(sourceOf(suggestion(word("Ahmed", "list"), word("Elshnawy", "rules")))).toBeNull()
        expect(sourceOf(suggestion(word("Mohammed", "company", 4), word("Ali", "list")))).toBeNull()
    })
})

describe("the spellings offered when the empty field is focused", () => {
    it("are a word's: the company's, the most used first, each with how many names use it, then the usual one", () => {
        const one = suggestion(word("Mohammed", "company", 4, [{ text: "Muhammad", from: "company", uses: 1 }, { text: "Mohamed", from: "list" }]))
        expect(spellingOptions(one)).toEqual([
            { text: "Mohammed", uses: 4 },
            { text: "Muhammad", uses: 1 },
            { text: "Mohamed", usual: true },
        ])
    })

    it("are, for a name of several words, the suggestion, then each word's others in its place", () => {
        const two = suggestion(word("Mohammed", "company", 4, [{ text: "Mohamed", from: "list" }]), word("Hassan", "list"))
        expect(spellingOptions(two)).toEqual([
            { text: "Mohammed Hassan" },
            { text: "Mohamed Hassan", usual: true },
        ])
    })

    it("are none where there's only the one", () => {
        expect(spellingOptions(suggestion(word("Mohamed", "list")))).toEqual([])
        expect(spellingOptions(suggestion(word("Mohammed", "company", 4, [])))).toEqual([])
        expect(spellingOptions(suggestion(word("Ahmed", "list"), word("Elshnawy", "rules")))).toEqual([])
    })
})

describe("a new name's mistakes", () => {
    it("are none with both languages, each in its own letters", () => {
        expect(newNameErrors({ en: "Mohamed", ar: "محمد" })).toEqual({})
    })

    it("ask for each language left empty, or for the suggestion where the other is typed", () => {
        expect(newNameErrors({ en: "", ar: "" })).toEqual({ en: "required", ar: "required" })
        expect(newNameErrors({ en: "Mohamed", ar: "  " })).toEqual({ ar: "use_suggestion" })
        expect(newNameErrors({ en: "", ar: "محمد" })).toEqual({ en: "use_suggestion" })
    })

    it("ask for each in its own letters", () => {
        expect(newNameErrors({ en: "محمد", ar: "محمد" })).toEqual({ en: "not_english" })
        expect(newNameErrors({ en: "Mohamed", ar: "Mohamed" })).toEqual({ ar: "not_arabic" })
        expect(newNameErrors({ en: "Mohamed", ar: "محمد Ali" })).toEqual({ ar: "not_arabic" })
    })
})
