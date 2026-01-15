'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

/**
 * Server Action to persist language preference in cookies and 
 * force a revalidation of all server-side components.
 */
export async function setLanguageAction(locale: string) {
    const cookieStore = cookies();

    // Set cookie on the server side
    cookieStore.set('NEXT_LOCALE', locale, {
        path: '/',
        maxAge: 31536000, // 1 year
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
    });

    // Force Next.js to purge the cache and re-render the layout and all its sub-pages
    // This is the key to ensuring Server Components update immediately without lag.
    revalidatePath('/', 'layout');
}
