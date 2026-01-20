import { prisma } from "./prisma";

/**
 * Maps Arabic letters to their English equivalents for initials.
 */
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

/**
 * Converts a string's initials to English.
 * If a word starts with an Arabic letter, it uses the mapping.
 */
export function getInitials(name: string): string {
    const words = name.trim().split(/\s+/);
    return words.map(word => {
        const firstChar = word[0];
        if (arabicToEnglishMap[firstChar]) {
            return arabicToEnglishMap[firstChar];
        }
        // Fallback to English char if it's already English/Latin
        if (/^[a-zA-Z]/.test(firstChar)) {
            return firstChar.toUpperCase();
        }
        return '';
    }).join('').toLowerCase();
}

/**
 * Generates an ascending username for a user in a specific company.
 * Format: [initials][number] (e.g., mm0, mm1)
 */
export async function generateUsername(companyId: string): Promise<string> {
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true }
    });

    if (!company) return `user_${Math.random().toString(36).substring(7)}`;

    const initials = getInitials(company.name) || 'u';

    // Find all users with usernames starting with these initials followed by a number
    const users = await prisma.user.findMany({
        where: {
            username: {
                startsWith: initials,
                mode: 'insensitive'
            }
        },
        select: { username: true }
    });

    // Extract numbers from existing usernames and find the max
    const numbers = users
        .map(u => {
            const match = u.username?.slice(initials.length).match(/^\d+$/);
            return match ? parseInt(match[0], 10) : -1;
        })
        .filter(n => n >= 0);

    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 0;

    return `${initials}${nextNumber}`;
}
