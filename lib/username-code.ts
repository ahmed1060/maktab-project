import type { TranslationKey } from "@/lib/translations"

/**
 * A company's username code: the letters before the number in a username
 * Nizmo makes up for its people (ds0, ds1…). Each company has its own, and
 * no other company's usernames follow it. Pure, so the Create company dialog
 * can check one as it's typed; lib/username.ts does what needs the database.
 */

/** 2 to 8 English letters, lower case. Companies already there may keep a single letter they were using. */
export const CODE_PATTERN = /^[a-z]{2,8}$/

/** Maps Arabic letters to English ones, for initials and codes. */
const arabicToEnglishMap: { [key: string]: string } = {
    'أ': 'A', 'ا': 'A', 'إ': 'I', 'آ': 'A',
    'ب': 'B',
    'ت': 'T',
    'ث': 'Th',
    'ج': 'J',
    'ح': 'H',
    'خ': 'Kh',
    'د': 'D',
    'ذ': 'Dh',
    'ر': 'R',
    'ز': 'Z',
    'س': 'S',
    'ش': 'Sh',
    'ص': 'S',
    'ض': 'D',
    'ط': 'T',
    'ظ': 'Z',
    'ع': 'A',
    'غ': 'Gh',
    'ف': 'F',
    'ق': 'Q',
    'ك': 'K',
    'ل': 'L',
    'م': 'M',
    'ن': 'N',
    'ه': 'H',
    'و': 'W',
    'ي': 'Y', 'ى': 'Y',
    'ة': 'T',
    'ؤ': 'O',
    'ئ': 'E',
    'ء': 'A'
};

/** One letter in English, or nothing for a digit, a mark or anything else. */
function letterOf(char: string): string {
    if (arabicToEnglishMap[char]) return arabicToEnglishMap[char].toLowerCase()
    return /^[a-zA-Z]$/.test(char) ? char.toLowerCase() : ''
}

/**
 * A name's initials in English: the first letter of each word, an Arabic one
 * spelled the way the map spells it.
 */
export function getInitials(name: string): string {
    return name.trim().split(/\s+/).map(word => letterOf(word[0] ?? '')).join('');
}

/** A code as it's stored: lower case, no spaces around it. */
export function normaliseCode(code: string): string {
    return code.trim().toLowerCase()
}

/** What's wrong with a typed code; null when it'll do. */
export function codeError(code: string): TranslationKey | null {
    return CODE_PATTERN.test(normaliseCode(code)) ? null : 'companies_code_invalid'
}

/**
 * Codes to suggest for a company's name, best first: its initials, then
 * those followed by the rest of its last word a letter at a time (Delta
 * Systems: ds, dsy, dsys…; Karavan: ka, kar…), then by each letter of the
 * alphabet. Each is a code CODE_PATTERN accepts; which are free is the
 * database's question.
 */
export function codeCandidates(name: string): string[] {
    const words = name.trim().split(/\s+/).filter(word => letterOf(word[0] ?? ''))
    const initials = (getInitials(words.join(' ')) || 'co').slice(0, 8)
    const last = words[words.length - 1] ?? ''
    const rest = Array.from(last.slice(1)).map(letterOf).join('')
    const offered = [initials]
    for (let i = 1; i <= rest.length; i++) offered.push(initials + rest.slice(0, i))
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') offered.push(initials + letter)
    return [...new Set(offered.map(code => code.slice(0, 8)))].filter(code => CODE_PATTERN.test(code))
}
