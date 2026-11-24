import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    CLIENT_NAME_MAX, OWNER_NAME_MAX, clientMistakeText, clientNameErrors, clientRefusedField, missingNote, readyToSave,
} from "@/lib/client-form"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * A client's names in its form (LATER_CHANGES_PLAN.md §3.1, step 6a, PR 406;
 * DESIGN.md §5.3): its own name and its owner's, each in English and in
 * Arabic, the client's up to 100 characters and its owner's up to 60, the
 * owner's answer of 2026-11-24. The rules here, the dialog on the Clients
 * page drawing them.
 */

const both = { name: { en: "El Nour Trading", ar: "النور للتجارة" }, owner: { en: "Mahmoud Ali", ar: "محمود علي" } }
const t = (key: string) => (en as Record<string, string>)[key] ?? key
const tAr = (key: string) => (ar as Record<string, string>)[key] ?? key

describe("a client's names' limits", () => {
    it("are 100 characters for its own name, as before, and 60 for its owner's", () => {
        expect(CLIENT_NAME_MAX).toBe(100)
        expect(OWNER_NAME_MAX).toBe(60)
    })
})

describe("a client's names, checked before they're sent", () => {
    it("need nothing more when each is in both languages", () => {
        expect(clientNameErrors(both)).toEqual({})
    })

    it("need each language, and offer the suggestion for one left empty beside the other", () => {
        expect(clientNameErrors({ name: { en: "", ar: "" }, owner: { en: "", ar: "" } })).toEqual({
            name: "name_required_en", nameAr: "name_required_ar", ownerName: "name_required_en", ownerNameAr: "name_required_ar",
        })
        expect(clientNameErrors({ ...both, name: { en: "El Nour", ar: "  " } })).toEqual({ nameAr: "name_use_suggestion_ar" })
        expect(clientNameErrors({ ...both, owner: { en: "", ar: "محمود" } })).toEqual({ ownerName: "name_use_suggestion_en" })
    })

    it("take each up to its own limit", () => {
        expect(clientNameErrors({ ...both, name: { en: "N".repeat(100), ar: "ن".repeat(100) } })).toEqual({})
        expect(clientNameErrors({ ...both, name: { en: "N".repeat(101), ar: "ن".repeat(101) } })).toEqual({ name: "name_too_long", nameAr: "name_too_long" })
        expect(clientNameErrors({ ...both, owner: { en: "M".repeat(60), ar: "م".repeat(60) } })).toEqual({})
        expect(clientNameErrors({ ...both, owner: { en: "M".repeat(61), ar: "م".repeat(61) } })).toEqual({ ownerName: "name_too_long", ownerNameAr: "name_too_long" })
    })

    it("take each in its own letters", () => {
        expect(clientNameErrors({ ...both, name: { en: "النور", ar: "النور" } })).toEqual({ name: "name_not_english" })
        expect(clientNameErrors({ ...both, owner: { en: "Mahmoud", ar: "Mahmoud" } })).toEqual({ ownerNameAr: "name_not_arabic" })
    })
})

describe("what a mistake says under its field", () => {
    it("names which name it's of, and its limit in the reader's digits", () => {
        expect(clientMistakeText(t, "en", "nameAr", "name_use_suggestion_ar")).toBe("Enter the client name in Arabic, or use the suggestion.")
        expect(clientMistakeText(t, "en", "ownerName", "name_too_long")).toBe("Shorten the owner name to 60 characters.")
        expect(clientMistakeText(t, "en", "name", "name_too_long")).toBe("Shorten the client name to 100 characters.")
        expect(clientMistakeText(tAr, "ar", "ownerNameAr", "name_too_long")).toBe("يُرجى اختصار اسم المالك إلى ٦٠ حرفاً.")
        expect(clientMistakeText(tAr, "ar", "name", "name_required_en")).toBe("يُرجى إدخال اسم العميل بالإنجليزية.")
    })
})

describe("the note at the top of an edited client's form", () => {
    const client = { name: "El Nour Trading", nameAr: "النور للتجارة", ownerName: "Mahmoud Ali", ownerNameAr: "محمود علي" }

    it("isn't there when both names are in both languages", () => {
        expect(missingNote(client)).toBeNull()
    })

    it("names the one in one language only: the client's, its owner's, or both", () => {
        expect(missingNote({ ...client, nameAr: null })).toBe("client_name_missing_note")
        expect(missingNote({ ...client, ownerNameAr: "" })).toBe("owner_name_missing_note")
        // Saved before in Arabic only: its English column holds the Arabic.
        expect(missingNote({ ...client, ownerName: "محمود علي" })).toBe("owner_name_missing_note")
        expect(missingNote({ ...client, nameAr: null, ownerName: "محمود علي" })).toBe("client_names_missing_note")
    })

    it("says so in both languages", () => {
        for (const key of ["client_name_missing_note", "owner_name_missing_note", "client_names_missing_note"]) {
            expect(t(key), key).toMatch(/^Names are now kept in English and in Arabic\. .+ to save the changes\.$/)
            expect(tAr(key), key).toMatch(/^أصبحت الأسماء تُحفظ بالإنجليزية وبالعربية\. .+ لحفظ التغييرات\.$/)
        }
        expect(t("client_name_missing_note")).toContain("The client name is in one language only")
        expect(t("owner_name_missing_note")).toContain("The owner name is in one language only")
    })
})

describe("a refusal from the server, said under its field", () => {
    const body = (field: string, said: string) => ({ error: "Validation Error", details: { [field]: { _errors: [said] } } })

    it("says what's wrong with the name it's about", () => {
        expect(clientRefusedField(body("name", "Written in English letters"))).toEqual({ field: "name", key: "name_not_english" })
        expect(clientRefusedField(body("ownerNameAr", "Written in Arabic letters"))).toEqual({ field: "ownerNameAr", key: "name_not_arabic" })
        expect(clientRefusedField(body("nameAr", "Needed in Arabic"))).toEqual({ field: "nameAr", key: "name_required_ar" })
        expect(clientRefusedField(body("ownerName", "Needed in English"))).toEqual({ field: "ownerName", key: "name_required_en" })
        expect(clientRefusedField(body("ownerName", "Too long"))).toEqual({ field: "ownerName", key: "name_too_long" })
    })

    it("leaves anything else above the form", () => {
        expect(clientRefusedField({ error: "A client with this name already exists" })).toBeNull()
        expect(clientRefusedField(body("mobileNumber", "Mobile number is too short"))).toBeNull()
        expect(clientRefusedField(null)).toBeNull()
    })
})

describe("the form's save button", () => {
    it("is ready once each name has a language and the phone number is typed, the rest said on saving", () => {
        expect(readyToSave({ ...both, mobileNumber: "01001234567" })).toBe(true)
        expect(readyToSave({ name: { en: "", ar: "النور" }, owner: { en: "Mahmoud", ar: "" }, mobileNumber: "01001234567" })).toBe(true)
        expect(readyToSave({ ...both, name: { en: " ", ar: "" }, mobileNumber: "01001234567" })).toBe(false)
        expect(readyToSave({ ...both, owner: { en: "", ar: "" }, mobileNumber: "01001234567" })).toBe(false)
        expect(readyToSave({ ...both, mobileNumber: "  " })).toBe(false)
    })
})

describe("the dialog that adds or edits a client", () => {
    const page = readFileSync("app/(dashboard)/dashboard/clients/page.tsx", "utf8")

    it("asks each name in English and in Arabic, a business's and a person's, each up to its limit", () => {
        expect(page).toContain(`<NameFields label={t('client_name')} name="name" kind="business" max={CLIENT_NAME_MAX}`)
        expect(page).toContain(`<NameFields label={t('client_owner_name')} name="ownerName" max={OWNER_NAME_MAX}`)
        expect(page).not.toContain(`name="name" autoComplete="off" dir="auto"`)
        expect(page).not.toContain(`name="ownerName" autoComplete="off" dir="auto"`)
    })

    it("asks the Super Admin's spellings of the company the client is for", () => {
        expect(page).toContain("const spellingsOf = pickCompany ? chosenCompany || null : companyId ?? null")
        expect(page.split("companyId={spellingsOf}")).toHaveLength(3)
        expect(page).toContain("companyId={superAdmin ? editing.companyId : undefined}")
    })

    it("edits the names as they're kept, and says at the top which is in one language only", () => {
        expect(page).toContain("name: savedName(client.name, client.nameAr), owner: savedName(client.ownerName, client.ownerNameAr)")
        expect(page).toContain("{note && <FormNote>{t(note)}</FormNote>}")
        expect(page).toContain("const [note] = useState(() => (client ? missingNote(client) : null))")
    })

    it("checks them before sending, says what's wrong under each field, and sends both", () => {
        expect(page).toContain("const wrong = clientNameErrors(form)")
        expect(page).toContain("errors={{ en: said('name'), ar: said('nameAr') }}")
        expect(page).toContain("errors={{ en: said('ownerName'), ar: said('ownerNameAr') }}")
        expect(page).toContain("name: form.name.en, nameAr: form.name.ar, ownerName: form.owner.en, ownerNameAr: form.owner.ar,")
        expect(page).toContain("const refused = clientRefusedField(body)")
        expect(page).toContain("const ready = readyToSave(form) && (!pickCompany || !!chosenCompany)")
    })
})
