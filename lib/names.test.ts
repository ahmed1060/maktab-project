import { describe, it, expect } from "vitest"
import { arabicBeside, hasArabic, missingLanguages, nameIn, personName, writtenInArabic } from "@/lib/names"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { createClientSchema, updateClientSchema } from "@/lib/validations/client.schema"
import { createCompanySchema, updateCompanySchema } from "@/lib/validations/company.schema"

/**
 * English and Arabic names (LATER_CHANGES_PLAN.md §3, step 1, PR 398): an
 * Arabic column beside each name, the one there before keeping the English.
 * A name written in Arabic before is in the English column still, and its
 * Arabic letters say it has no English yet. lib/names-both-languages.db.test.ts
 * has the columns, the copy and the services, in Postgres.
 */

const mohamed = { en: "Mohamed", ar: "محمد" }

describe("which letters a name is written in", () => {
    it("knows Arabic letters, wherever they are in a name", () => {
        expect(hasArabic("محمد")).toBe(true)
        expect(hasArabic("Karim سعيد")).toBe(true)
        // The Arabic block's other letters, and the forms a keyboard can type.
        expect(hasArabic("ﻣﺤﻤﺪ")).toBe(true)
        expect(hasArabic("پ")).toBe(true)
        for (const supplement of [0x0750, 0x077f, 0x0870, 0x08ff, 0xfb50, 0xfdff, 0xfe70, 0xfefc]) expect(hasArabic(String.fromCharCode(supplement)), supplement.toString(16)).toBe(true)
        // Either side of them, nothing, and no byte order mark, which isn't a letter.
        expect(hasArabic(String.fromCharCode(0xfeff))).toBe(false)
        for (const other of [0x05ff, 0x0700, 0x074f, 0x0780, 0x086f, 0x0900, 0xfb4f, 0xfe00, 0xfe6f, 0xff00]) expect(hasArabic(String.fromCharCode(other)), other.toString(16)).toBe(false)
        expect(hasArabic("Mohamed")).toBe(false)
        expect(hasArabic("")).toBe(false)
        expect(hasArabic(null)).toBe(false)
        expect(hasArabic(undefined)).toBe(false)
    })

    it("takes an Arabic name only in Arabic letters, with no English ones", () => {
        expect(writtenInArabic("محمد")).toBe(true)
        expect(writtenInArabic("عبد الرحمن")).toBe(true)
        expect(writtenInArabic("شركة النور للتجارة ٢")).toBe(true)
        expect(writtenInArabic("Mohamed")).toBe(false)
        expect(writtenInArabic("Karim سعيد")).toBe(false)
        expect(writtenInArabic("123")).toBe(false)
        expect(writtenInArabic("")).toBe(false)
    })
})

describe("a name in the page's language", () => {
    it("is the Arabic on an Arabic page, and the English on an English one", () => {
        expect(nameIn("ar", mohamed)).toBe("محمد")
        expect(nameIn("en", mohamed)).toBe("Mohamed")
    })

    it("is the one it has while it has only one", () => {
        // Saved before in English: no Arabic yet.
        expect(nameIn("ar", { en: "Mohamed", ar: null })).toBe("Mohamed")
        expect(nameIn("ar", { en: "Mohamed", ar: "  " })).toBe("Mohamed")
        expect(nameIn("ar", { en: "Mohamed" })).toBe("Mohamed")
        // Saved before in Arabic: in the English column, and copied beside it.
        expect(nameIn("en", { en: "محمد", ar: "محمد" })).toBe("محمد")
        expect(nameIn("en", { en: "", ar: "محمد" })).toBe("محمد")
    })

    it("is a person's first and last names, each in the page's language", () => {
        const person = { firstName: "Mohamed", lastName: "Ahmed Elshenawy", firstNameAr: "محمد", lastNameAr: "أحمد الشناوي" }
        expect(personName(person, "en")).toBe("Mohamed Ahmed Elshenawy")
        expect(personName(person, "ar")).toBe("محمد أحمد الشناوي")
        // Each part on its own: a last name with no Arabic yet stays in English.
        expect(personName({ ...person, lastNameAr: null }, "ar")).toBe("محمد Ahmed Elshenawy")
        expect(personName({ firstName: "Mona", lastName: "" }, "en")).toBe("Mona")
    })
})

describe("the language a name is missing", () => {
    it("is none for a name in both", () => {
        expect(missingLanguages([mohamed])).toEqual([])
    })

    it("is Arabic for one saved in English alone", () => {
        expect(missingLanguages([{ en: "Mohamed", ar: null }])).toEqual(["ar"])
        expect(missingLanguages([{ en: "Mohamed" }])).toEqual(["ar"])
    })

    it("is English for one saved in Arabic alone, still in the English column", () => {
        expect(missingLanguages([{ en: "محمد", ar: "محمد" }])).toEqual(["en"])
        expect(missingLanguages([{ en: " ", ar: "محمد" }])).toEqual(["en"])
    })

    it("is each a person's names are missing, once", () => {
        expect(missingLanguages([{ en: "محمد", ar: "محمد" }, { en: "Ahmed", ar: null }])).toEqual(["en", "ar"])
        expect(missingLanguages([{ en: "Mona", ar: null }, { en: "Ali", ar: null }])).toEqual(["ar"])
    })
})

describe("the Arabic kept beside a name being saved", () => {
    it("is the one given", () => {
        expect(arabicBeside("Mohamed", "محمد")).toBe("محمد")
    })

    it("is the name itself, written in Arabic by a form that asks for one name only", () => {
        expect(arabicBeside("محمد", undefined)).toBe("محمد")
    })

    it("is left as it is for a name sent back unchanged, where it has one (Codex review on PR 398)", () => {
        expect(arabicBeside("مني", undefined, { en: "مني", ar: "منى" })).toBeUndefined()
        // Changed, or with none yet: the name itself.
        expect(arabicBeside("منى", undefined, { en: "مني", ar: "منى" })).toBe("منى")
        expect(arabicBeside("مني", undefined, { en: "مني", ar: null })).toBe("مني")
        expect(arabicBeside("مني", undefined, { en: "مني", ar: " " })).toBe("مني")
        // One given is kept, whatever was there.
        expect(arabicBeside("مني", "منى", { en: "مني", ar: "منى" })).toBe("منى")
    })

    it("is left as it is otherwise", () => {
        expect(arabicBeside("Mohamed", undefined)).toBeUndefined()
        expect(arabicBeside(undefined, undefined)).toBeUndefined()
    })
})

describe("what the server takes", () => {
    const person = { firstName: "Mona", lastName: "Ali", email: "mona@example.com", password: "a".repeat(8) }
    const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success

    it("takes a person's Arabic names, not yet asked for", () => {
        expect(accepts(createUserSchema, person)).toBe(true)
        expect(accepts(createUserSchema, { ...person, firstNameAr: "منى", lastNameAr: "علي" })).toBe(true)
        expect(accepts(updateUserSchema, { id: "u1", firstNameAr: "منى", lastNameAr: "علي" })).toBe(true)
    })

    it("takes them in Arabic letters only, up to 40 characters, as the English", () => {
        expect(accepts(createUserSchema, { ...person, firstNameAr: "Mona" })).toBe(false)
        expect(accepts(createUserSchema, { ...person, lastNameAr: "Ali علي" })).toBe(false)
        expect(accepts(createUserSchema, { ...person, firstNameAr: "" })).toBe(false)
        expect(accepts(createUserSchema, { ...person, firstNameAr: "م".repeat(40) })).toBe(true)
        expect(accepts(createUserSchema, { ...person, firstNameAr: "م".repeat(41) })).toBe(false)
        expect(accepts(updateUserSchema, { id: "u1", lastNameAr: "Ali" })).toBe(false)
        expect(accepts(updateUserSchema, { id: "u1", firstNameAr: "م".repeat(41) })).toBe(false)
    })

    it("keeps an Arabic name trimmed", () => {
        expect(createUserSchema.parse({ ...person, firstNameAr: "  منى  " }).firstNameAr).toBe("منى")
    })

    it("takes a client's Arabic name and its owner's, up to 100 characters, as the English", () => {
        const client = { name: "El Nour Trading Company", ownerName: "Mahmoud Abdallah", mobileNumber: "01001234567", hq: { name: "HQ", latitude: 30.0444, longitude: 31.2357 } }
        expect(accepts(createClientSchema, client)).toBe(true)
        expect(accepts(createClientSchema, { ...client, nameAr: "شركة النور للتجارة", ownerNameAr: "محمود عبد الله" })).toBe(true)
        expect(accepts(createClientSchema, { ...client, nameAr: "El Nour" })).toBe(false)
        expect(accepts(createClientSchema, { ...client, ownerNameAr: "Mahmoud" })).toBe(false)
        expect(accepts(updateClientSchema, { id: "k1", nameAr: "شركة النور للتجارة", ownerNameAr: "محمود عبد الله" })).toBe(true)
        expect(accepts(updateClientSchema, { id: "k1", nameAr: "El Nour" })).toBe(false)
        expect(accepts(updateClientSchema, { id: "k1", ownerNameAr: "Mahmoud" })).toBe(false)
        expect(accepts(updateClientSchema, { id: "k1", nameAr: "ن".repeat(100) })).toBe(true)
        expect(accepts(updateClientSchema, { id: "k1", nameAr: "ن".repeat(101) })).toBe(false)
        expect(accepts(updateClientSchema, { id: "k1", ownerNameAr: "ن".repeat(101) })).toBe(false)
    })

    it("takes a company's Arabic name, up to 50 characters, as the English", () => {
        expect(accepts(createCompanySchema, { name: "El Nil Accounting", nameAr: "مكتب النيل للمحاسبة" })).toBe(true)
        expect(accepts(createCompanySchema, { name: "El Nil Accounting", nameAr: "El Nil" })).toBe(false)
        expect(accepts(updateCompanySchema, { id: "c1", nameAr: "مكتب النيل للمحاسبة" })).toBe(true)
        expect(accepts(updateCompanySchema, { id: "c1", nameAr: "ن".repeat(50) })).toBe(true)
        expect(accepts(updateCompanySchema, { id: "c1", nameAr: "ن".repeat(51) })).toBe(false)
        expect(accepts(updateCompanySchema, { id: "c1", nameAr: "Nil" })).toBe(false)
    })
})
