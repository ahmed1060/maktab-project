import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { clientMatches, clientMissing, clientName, clientsInOrder, missingCount, ownerName } from "@/lib/client-list"

/**
 * Clients' names on the Clients page (LATER_CHANGES_PLAN.md §3.1, step 6b,
 * PR 407; DESIGN.md §5.3): each in the page's language, searched in either,
 * an Arabic page's in Arabic order, and the ones still missing a language
 * counted and listed for whoever may edit clients. Read from the list the
 * page already has, as its search is.
 */

const client = (id: string, name: string, nameAr: string | null, ownerName = "Mahmoud Ali", ownerNameAr: string | null = "محمود علي") =>
    ({ id, name, nameAr, ownerName, ownerNameAr })
const nour = client("k1", "El Nour Trading", "النور للتجارة")
const delta = client("k2", "Delta Supplies", null, "Sara Adel", null)
const amal = client("k3", "شركة الأمل", "شركة الأمل", "Hany Said", "هاني سعيد")
const zahra = client("k4", "Zahra Foods", "الزهراء للأغذية", "Omar Nabil", null)

describe("a client's names, in the page's language", () => {
    it("are its Arabic on an Arabic page and its English on an English one", () => {
        expect(clientName(nour, "ar")).toBe("النور للتجارة")
        expect(clientName(nour, "en")).toBe("El Nour Trading")
        expect(ownerName(nour, "ar")).toBe("محمود علي")
        expect(ownerName(nour, "en")).toBe("Mahmoud Ali")
    })

    it("are the one it has while it has only one", () => {
        expect(clientName(delta, "ar")).toBe("Delta Supplies")
        expect(ownerName(delta, "ar")).toBe("Sara Adel")
        expect(clientName(amal, "en")).toBe("شركة الأمل")
    })
})

describe("a client searched", () => {
    it("is found by its name or its owner's, in either language, whatever its case", () => {
        expect(clientMatches(nour, "nour")).toBe(true)
        expect(clientMatches(nour, "النور")).toBe(true)
        expect(clientMatches(nour, "mahmoud")).toBe(true)
        expect(clientMatches(nour, "محمود")).toBe(true)
        expect(clientMatches(nour, "delta")).toBe(false)
        expect(clientMatches(delta, "النور")).toBe(false)
    })
})

describe("the clients in order", () => {
    it("on an Arabic page: the ones with an Arabic name first, in Arabic order, then the rest as they came", () => {
        expect(clientsInOrder([delta, zahra, nour, amal], "ar").map(c => c.id)).toEqual(["k4", "k1", "k3", "k2"])
        expect(clientsInOrder([nour, delta, client("k5", "Atlas", null, "A", null)], "ar").map(c => c.id)).toEqual(["k1", "k2", "k5"])
        // Sorted, whatever order they came in.
        expect(clientsInOrder([amal, nour, zahra], "ar").map(c => c.id)).toEqual(["k4", "k1", "k3"])
    })

    it("on an English page, as they came", () => {
        expect(clientsInOrder([delta, zahra, nour, amal], "en").map(c => c.id)).toEqual(["k2", "k4", "k1", "k3"])
    })
})

describe("the names still missing a language", () => {
    it("are a client's or its owner's with no Arabic, or whose English holds Arabic letters", () => {
        expect(clientMissing(nour)).toEqual([])
        expect(clientMissing(delta)).toEqual(["ar"])
        expect(clientMissing(amal)).toEqual(["en"])
        expect(clientMissing(zahra)).toEqual(["ar"])
        expect(clientMissing(client("k6", "شركة", "شركة", "Ola", null))).toEqual(["en", "ar"])
    })

    it("are counted by client", () => {
        expect(missingCount([nour, delta, amal, zahra])).toBe(3)
        expect(missingCount([nour])).toBe(0)
    })
})

describe("the Clients page", () => {
    const page = readFileSync("app/(dashboard)/dashboard/clients/page.tsx", "utf8")

    it("shows each name in the page's language, the owner's and who added it too", () => {
        expect(page).toContain("<bdi>{clientName(c, locale)}</bdi></Link>")
        expect(page).toContain("detail={<bdi>{ownerName(c, locale)}</bdi>}")
        expect(page).toContain("{ icon: UserIcon, text: <bdi>{ownerName(c, locale)}</bdi> }")
        expect(page).toContain("const addedBy = (c: Client) => c.createdBy ? personName(c.createdBy, locale) : t('role_super_admin')")
        expect(page).toContain("label={t('ui_more_actions_for').replace('{name}', clientName(c, locale))}")
        expect(page).toContain(".replace('{name}', () => clientName(toDelete, locale))")
        expect(page).toContain("deleteForGoodQuestion({ ...forGood, name: clientName(forGood, locale) }, t, locale)")
    })

    it("searches either language and orders an Arabic page in Arabic", () => {
        expect(page).toContain("const ordered = clientsInOrder(all, locale)")
        expect(page).toContain("(!search || clientMatches(c, search))")
    })

    it("lists the ones missing a language for whoever may edit clients, and counts the ones in use", () => {
        expect(page).toContain("const editsNames = mayEdit")
        expect(page).toContain("(names !== 'missing' || clientMissing(c).length > 0)")
        expect(page).toContain("const missingNames = editsNames && !archived ? missingCount(all) : 0")
        expect(page).toContain("{missingNames > 0 && <ListNote icon={TranslateIcon} title={countOf(t, locale, missingNames, 'one_language')}>{t('names_missing_note_body')}</ListNote>}")
        expect(page).toContain("...(names === 'missing' ? [{ key: 'missing', header: t('names_missing_column'), cell: missing }] : [])")
        expect(page).toContain("...(names === 'missing' ? [{ icon: TranslateIcon, text: missing(c) }] : [])")
        expect(page).toContain("{editsNames && (\n                    <Field label={t('names_filter_label')} hideLabel>")
    })

    it("counts the Names select among the filters, resets it, and starts its list on its first page", () => {
        expect(page).toContain("activeCount={(archived ? 1 : 0) + (names ? 1 : 0)}")
        expect(page).toContain("setQuery(''); setArchived(false); setNames('')")
        expect(page).toContain("useAdjustOnChange([search, names], () => setPage(1))")
    })

    it("asks for who added each client in both languages", () => {
        const route = readFileSync("app/api/clients/route.ts", "utf8")
        expect(route).toContain("createdBy: { select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } }")
    })
})
