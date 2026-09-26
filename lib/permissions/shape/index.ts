/**
 * Response shapers: every response that can carry a protected field goes
 * through one, with the viewer. Routes never pick fields by role themselves.
 * The fields and the permissions that reveal them are in ./fields.ts.
 */
export { PROTECTED_FIELDS } from "./fields"
export { shapeUser } from "./user"
export { shapeTask } from "./task"
