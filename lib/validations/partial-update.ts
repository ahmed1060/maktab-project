import { z } from "zod"

/**
 * An update schema derived from a create schema, without inheriting its
 * defaults.
 *
 * `createSchema.partial()` looks like it says "every field is optional", and
 * for whether a field may be *omitted* it does. What it does not do is stop a
 * field's own `.default()` from running: an omitted key still parses to the
 * create-time default, so the parsed object comes back holding values the
 * caller never sent.
 *
 * That is not a theoretical tidiness problem. updateUserSchema was built this
 * way, and the service cannot distinguish "the caller left this alone" from
 * "the caller chose the default" — so the Employees list's suspend toggle,
 * which sends `{ id, status }` and nothing else, silently rewrote three
 * unrelated fields on that person: role to EMPLOYEE, gender to MALE, and
 * salary to 0. The salary one also wrote a SalaryChange row, putting a zero
 * into the effective-dated history that every payslip is computed from.
 *
 * So: strip the `.default()` wrapper and keep everything underneath it,
 * including optionality and nullability. An omitted key then parses to genuine
 * `undefined`, which is what every `if (field !== undefined)` in the services
 * was already written to expect.
 *
 * Only defaults are removed. Validation is untouched: a field that is sent is
 * checked exactly as it was on create.
 */

/** Peel off `.default()` layers, leaving the schema underneath intact. */
function withoutDefault(field: z.ZodTypeAny): z.ZodTypeAny {
    let inner: any = field
    while (inner?.def?.type === "default") inner = inner.def.innerType
    return inner as z.ZodTypeAny
}

export function partialWithoutDefaults<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }> {
    const source = schema.shape as unknown as Record<string, z.ZodTypeAny>
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const key of Object.keys(source)) {
        shape[key] = withoutDefault(source[key]).optional()
    }
    return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>
}
