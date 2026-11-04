import { z } from "zod"
import { USERNAME_PATTERN } from "@/lib/username-rules"

/** A typed username (lib/username-rules.ts), spaces around it dropped. */
export const usernameSchema = z.string().trim().regex(USERNAME_PATTERN, "A username is 2 to 30 letters, digits, dots, hyphens or underscores, starting with a letter or digit")
