import { guardModule } from "@/lib/features/guard"

// Gated at the layout like the rest of attendance: a company without an
// attendance add-on gets the locked screen. The Mobile App add-on itself is
// the API's to check (lib/attendance/mobile-access.ts), and the page says so.
export default async function CheckInLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('ATTENDANCE')
    return locked ?? <>{children}</>
}
