import { can, type Actor } from "../can"
import { PROTECTED_FIELDS } from "./fields"

/**
 * A Task as this viewer may see it.
 *
 * memberCosts maps each assignee to what they are paid for the task. Someone
 * who sees others' tasks sees all of it; anybody else — an employee on a
 * shared task — sees their own line and no one else's. The map is sometimes
 * stored as a JSON string, so both forms are read.
 */
export function shapeTask<T>(actor: Actor, task: T): T {
    if (!task || typeof task !== "object" || !("memberCosts" in task)) return task
    if (can(actor, PROTECTED_FIELDS.Task.memberCosts)) return task
    const raw = (task as any).memberCosts
    if (!raw) return task
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== "object") return task
    const id = actor.id ?? ""
    return { ...task, memberCosts: id in parsed ? { [id]: parsed[id] } : {} }
}
