/**
 * The rules (LATER_CHANGES_PLAN.md §3.1, step 2, PR 399): a word in neither
 * Nizmo's list of names nor its business words, written in the other
 * language letter by letter. Always a guess to check (DESIGN.md §5.3):
 * Arabic is written without its short vowels, so a word comes out as its
 * consonants, محمد as "Mhmd", and English doesn't say which Arabic letter it
 * means, so Hassan comes out as هسن. A rare name corrected once is learned
 * by the company (§3.1, step 3). A number is kept, in the digits of the
 * language it's written into.
 */

/** Each Arabic letter as Egyptian names are spelled in English: ج is g, ق is k. */
const LETTERS: Record<string, string> = {
    "ا": "a", "أ": "a", "إ": "e", "آ": "a", "ء": "", "ئ": "e", "ؤ": "o",
    "ب": "b", "ت": "t", "ث": "th", "ج": "g", "ح": "h", "خ": "kh", "د": "d", "ذ": "z",
    "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
    "ع": "a", "غ": "gh", "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n",
    "ه": "h", "ة": "a", "ى": "a",
}
/** The letters that are vowels, or carry one: و and ي are vowels between two others. */
const LONG = "اأإآىةويءئؤ"
const consonant = (letter: string | undefined) => letter !== undefined && !LONG.includes(letter)
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
/** Arabic's digits, ٠ to ٩, each at its value. */
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
const isDigit = (letter: string) => letter >= "0" && letter <= "9"

/** An Arabic word in English letters, its article joined as El: الشناوي is Elshnawy. */
export function arabicGuess(word: string): string {
    const article = word.length > 3 && word.startsWith("ال")
    const letters = article ? word.slice(2) : word
    let out = ""
    for (let i = 0; i < letters.length; i++) {
        const letter = letters[i]
        const prev = letters[i - 1]
        const next = letters[i + 1]
        if (letter === "و") out += i > 0 && consonant(prev) && (next === undefined || consonant(next)) ? "o" : "w"
        else if (letter === "ي") out += i > 0 && consonant(prev) && consonant(next) ? "i" : "y"
        else if (ARABIC_DIGITS.includes(letter)) out += ARABIC_DIGITS.indexOf(letter)
        else out += LETTERS[letter] ?? (isDigit(letter) ? letter : "")
    }
    return capital(article ? `el${out}` : out)
}

/** Each English letter, or pair, as an Arabic one. */
const PAIRS: Record<string, string> = { sh: "ش", kh: "خ", gh: "غ", th: "ث", ou: "و", oo: "و", ee: "ي", aa: "ا" }
const CONSONANTS: Record<string, string> = {
    b: "ب", c: "ك", d: "د", f: "ف", g: "ج", h: "ه", j: "ج", k: "ك", l: "ل", m: "م", n: "ن",
    p: "ب", q: "ق", r: "ر", s: "س", t: "ت", v: "ف", w: "و", x: "كس", y: "ي", z: "ز",
}
/** A vowel: at the start on its alef, at the end as its long letter, in the middle long or not written. */
function vowel(letter: string, first: boolean, last: boolean): string {
    if (first) return letter === "e" || letter === "i" ? "إ" : "أ"
    if (letter === "i") return "ي"
    if (letter === "o" || letter === "u") return "و"
    return last && letter === "a" ? "ا" : ""
}

/** An English word in Arabic letters, its article El or Al as ال: Elshenawy is الشنوي. */
export function englishGuess(word: string): string {
    let letters = word.toLowerCase().replace(/[^a-z0-9]/g, "")
    const article = letters.length > 4 && /^(el|al)[^aeiou]/.test(letters)
    if (article) letters = letters.slice(2)
    let out = ""
    for (let i = 0; i < letters.length; ) {
        const pair = PAIRS[letters.slice(i, i + 2)]
        if (pair) {
            out += pair
            i += 2
            continue
        }
        const letter = letters[i]
        if (isDigit(letter)) out += ARABIC_DIGITS[Number(letter)]
        else if ("aeiou".includes(letter)) out += vowel(letter, i === 0, i === letters.length - 1)
        // A doubled letter is written once.
        else if (letter !== letters[i - 1]) out += CONSONANTS[letter] ?? ""
        i++
    }
    return article ? `ال${out}` : out
}
