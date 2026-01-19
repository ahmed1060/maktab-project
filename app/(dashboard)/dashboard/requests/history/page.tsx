import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import RequestsHistoryClient from "./RequestsHistoryClient"

export default async function RequestsHistoryPage() {
    const session = await getServerSession(authOptions)
    if (!session) redirect("/login")

    const userRole = (session.user as any).role

    return <RequestsHistoryClient userRole={userRole} />
}
