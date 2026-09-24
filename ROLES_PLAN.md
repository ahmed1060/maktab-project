# Roles & Permissions — Implementation Plan

Status: **approved plan, not scheduled.** Nothing here is built. It is the first
item of the attendance plan's Foundation phase
([`ATTENDANCE_PLAN.md` §4](ATTENDANCE_PLAN.md#4-prerequisite-roles-and-permissions)),
but it stands on its own and is useful to the website without attendance — so it
can be built whenever the Super Admin decides, including as part of making the
current website stable.

Like the attendance plan, it names real files and models. **Re-check §2 against
the code before starting**; the numbers there are a snapshot.

---

## 0. Decisions already made

Settled during the attendance brainstorm (rounds 3–6 of `ATTENDANCE_PLAN.md`):

| Decision | |
|---|---|
| Roles are created in the UI, each with any set of permissions | Round 3 |
| **Only the Super Admin** creates and edits roles and role templates | Round 5 |
| Roles are built **per company**, to match that company's contract and policy | Round 5 |
| Role **templates** (HR Officer, Branch Manager, Accountant…) exist, maintained by the Super Admin; a company role is a **copy** of a template, never a live link | Rounds 3–5 |
| **One role per user** | Round 5 |
| The **company Admin may assign** roles the Super Admin created for their company — never create or edit them | Round 6 |
| A **"who can do this?"** view for the Super Admin | Round 4 |
| The Super Admin stays outside the role system | Round 3 |

---

## 1. Goal

Today a person's access is one of four fixed roles, and what each role may do is
written into the code. The goal: the Super Admin can give a company exactly the
roles its contract describes — an HR Officer who approves leave but cannot see
salaries, an Accountant who runs payroll but cannot manage tasks, a Branch Manager
who leads a team and approves its day-off — **without a code change per company.**

And the migration must change **nobody's access on the day it ships.**

---

## 2. How roles work today

### 2.1 The enum

`User.role` is `UserRole`: `SUPER_ADMIN`, `ADMIN`, `TEAM_LEADER`, `EMPLOYEE`. It is
put into the JWT at login (`lib/auth.ts`) and read from the session everywhere.
Super Admins are a separate `SuperAdmin` model; a `User` row can also carry
`SUPER_ADMIN`, which `notification.service.ts` already notes.

### 2.2 How much code reads it

Role checks by string comparison, as of September 2026:

| Where | Files | Checks |
|---|---|---|
| `app/api` (routes) | 41 | 59 |
| `app/(dashboard)` (pages) | 15 | 33 |
| `components` | 7 | 21 |
| `lib` (services, helpers) | 15 | 44 |
| **Total** | **78** | **~157** |

Plus 5 routes using `withStandardHandler`'s `allowedRoles` option
(`lib/api-utils.ts`).

### 2.3 The role does more than grant permissions

This is the most important finding for the design. The enum is also
**structural** — other parts of the system depend on *what kind* of person
someone is, not only on what they may do:

| Behaviour | Where | Depends on |
|---|---|---|
| **Team structure** — `teamLeaderId` is only set on an `EMPLOYEE` and only points at a `TEAM_LEADER` in the same company; cycles are impossible by construction | `User` model comments, `UserService`, `lib/team-scope.ts` | Role = TEAM_LEADER / EMPLOYEE |
| **Team scoping** — a leader sees their team and themselves | `scopesToTeam(role)` in `lib/team-scope.ts` | Role = TEAM_LEADER |
| **Subscription blocking** — Admins keep access when a subscription lapses, employees do not | `isBlockedBySubscription` in `lib/billing/state.ts` | Role = ADMIN |
| **Maintenance mode** — everyone but Super Admins blocked | `lib/api-utils.ts` | Role = SUPER_ADMIN |
| **Who may create whom** — only a Super Admin creates an Admin | `UserService` | Role = ADMIN |
| **Payroll company scope** — a Super Admin may name a company, an Admin may not | `lib/payroll-scope.ts` | Role |

A design that simply replaces the enum with free-form permission sets breaks all
of these at once. §3 is built around not doing that.

---

## 3. Design

### 3.1 Two layers: base role and permissions

Every role has a **base role** — `ADMIN`, `TEAM_LEADER` or `EMPLOYEE` — plus a set
of **permission grants**.

- The **base role** answers *what kind of person is this*: are they part of the
  team structure as a leader or a member, are they exempt from subscription
  blocking, may they be the target of Admin-only rules. It stays in
  `User.role`, the enum, exactly as today. **All the structural behaviour in §2.3
  keeps reading it, unchanged.**
- The **permissions** answer *what may this person do*. They come from the role's
  grants, and every "may they do this?" check moves to them.

Examples:

| Role | Base role | Why that base |
|---|---|---|
| HR Officer | EMPLOYEE | An employee with extra rights. Still has a team leader, still checks in, still gets a payslip. |
| Branch Manager | TEAM_LEADER | Leads a team — the team structure needs them to be a leader. |
| Accountant | EMPLOYEE | Payroll rights without leading anyone. |
| Deputy Admin | ADMIN | Everything an Admin can do, minus a few permissions. |

`User.role` is **derived**: whenever a role is assigned, the user's enum is set to
that role's base role in the same transaction. Nobody edits it directly any more.

**Why this shape.** It makes the migration gradual instead of big-bang. Structural
code does not change at all. Permission checks move over module by module, each
move independently testable, while everything not yet migrated keeps working off
the enum. At no point is the product half-broken.

### 3.2 Permissions are defined in code

A permission only means something if code checks it, so the catalogue is a typed
constant in `lib/permissions/catalogue.ts`, grouped by module — the same pattern as
`MODULE_BUNDLE` in `lib/features/bundles.ts`: one table, every caller asking the
same question of it.

Each entry has a key, a label key for both languages, the **module** it belongs to
(for package gating, §3.6), and whether it supports **scope** (§3.3).

A first draft, derived from what the product does today:

| Module | Permissions |
|---|---|
| Employees | `employees.view`, `employees.create`, `employees.edit`, `employees.archive`, `employees.assign_role`, `employees.assign_team` |
| Profile requests | `profile_requests.review` |
| Requests | `requests.view`, `requests.review` |
| Tasks | `tasks.view`, `tasks.create`, `tasks.assign`, `tasks.review`, `tasks.delete` |
| Obligations | `obligations.view`, `obligations.manage` |
| Clients | `clients.view`, `clients.manage` |
| Vendors | `vendors.view`, `vendors.manage` |
| Costs | `costs.view`, `costs.manage` |
| Day off | `dayoff.view`, `dayoff.approve`, `dayoff.adjust_credit` |
| Salaries | `salary.view`, `salary.edit`, `salary_adjustments.manage` |
| Payroll | `payroll.view`, `payroll.prepare`, `payroll.approve`, `payroll.mark_paid`, `payroll.issue_payslips`, `settlements.manage`, `debts.manage` |
| Settings | `settings.view`, `settings.edit` (within the tabs the Super Admin exposed — attendance plan §5.2) |
| Audit | `audit.view` |

Attendance adds its own when it is built (`attendance.correct`,
`attendance.approve_face`, …).

Every action in the product belongs to exactly one permission. "Viewing" and
"changing" are separate wherever a real company would want to split them —
`salary.view` in particular, since who may see salaries is the question companies
care most about.

### 3.3 Scope: own, team, company

"May approve day off" is not the whole question — *whose* day off matters. Each
grant of a scopable permission carries a scope:

- **OWN** — their own records only.
- **TEAM** — their team and themselves, using the existing `teamMemberWhere` in
  `lib/team-scope.ts`. Only meaningful for a TEAM_LEADER-based role.
- **COMPANY** — anyone in their company.

The existing team-leader behaviour is exactly TEAM scope expressed as special
cases; migrating makes it explicit. The composition rule in `team-scope.ts` —
every scope added with `and`, never assignment — carries over unchanged.

### 3.4 The one check

```ts
can(actor, "dayoff.approve", { targetUserId })   // → boolean
requirePermission(actor, "dayoff.approve")        // in withStandardHandler
scopeWhere(actor, "tasks.view")                    // → Prisma where fragment
```

- **`can`** — pure: takes the actor's grants and the target, returns yes/no.
  Testable without a database, like `lib/approval.ts` and `lib/payroll-scope.ts`.
- **`withStandardHandler({ permission: "..." })`** — replaces `allowedRoles`,
  checked on the server next to the existing feature gate. A route with neither is
  a lint/test failure, so the sixty-first route cannot ship ungated.
- **`scopeWhere`** — returns the Prisma condition for list queries, so a list is
  filtered by scope in the database, not in the browser.
- **`useCan(permission)`** — the client hook for showing and hiding UI. A
  courtesy only; the server check is the control.

### 3.5 The Super Admin

Stays outside the system entirely. It is not a company role; it is us. Every check
treats a Super Admin as holding every permission at every scope in every company.
Keeping it hardcoded is what guarantees no company role can ever reach across
tenants, however it is configured.

### 3.6 Permissions and packages

A permission for a module the company has not bought is meaningless. Two rules:

- **Both checks apply.** An action needs the permission *and* the company's
  package must include the module. The feature gate in `lib/features/` stays
  exactly as it is; permissions sit alongside it, not in place of it.
- **The role editor shows unavailable permissions greyed out**, labelled with the
  missing bundle, rather than hiding them — so the Super Admin building a role for
  a contract sees what an upgrade would unlock.

If a company's package later loses a module, roles keep their grants; they simply
do nothing until the module returns. No role is silently rewritten.

---

## 4. Rules

### 4.1 Who does what

| Action | Super Admin | Company Admin | Anyone else |
|---|---|---|---|
| Create / edit / delete role templates | ✅ | ❌ | ❌ |
| Create / edit / delete a company's roles | ✅ | ❌ | ❌ |
| Assign a role to a user | ✅ | ✅ within own company, see 4.2 | ❌ unless their role holds `employees.assign_role` |
| See the "who can do this?" view | ✅ | ❌ | ❌ |

### 4.2 Guards against privilege escalation

Most escalation is impossible by construction — no company user can create or edit
a role (§4.1). The remaining rules:

1. **Nobody changes their own role.**
2. **Only the Super Admin assigns an ADMIN-based role.** Carries over today's rule
   that only a Super Admin creates an Admin (`UserService`). A company Admin can
   assign HR Officer or Branch Manager, not make another Admin.
3. **Assigning is limited to that company's roles.** An Admin never sees another
   company's roles or templates.
4. **Nobody approves their own request**, whatever their permission — leave,
   overtime, a missing punch, a salary change. Enforced in `can` for every
   approval-type permission, not in each route.
5. **The last Admin cannot be removed.** A company always keeps at least one
   active user on the built-in Admin role, or it could lock itself out of
   assigning roles at all.
6. **Every role creation, edit, deletion and assignment is audited** with before
   and after.

### 4.3 Changing a role that people hold

- **Editing** a role changes access for everyone holding it — shown before saving:
  *"This affects 14 people."*
- **Deleting** a role that anyone holds is refused until they are reassigned. A
  person must never be left without a role.
- **Changing a role's base role** is refused if it would break the team structure
  — e.g. turning a TEAM_LEADER-based role into an EMPLOYEE-based one while its
  holders still lead teams. Same rule `UserService` already applies when demoting
  a leader.

### 4.4 When changes take effect

Permissions travel in the session token. The JWT callback in `lib/auth.ts` already
re-checks the database every 60 seconds (`sessionVersion`, status, maintenance
mode). It gains two fields — `roleId` and `roleVersion` — and on that same check,
if the role's version changed, it **reloads the permissions into the token without
logging the person out**.

So a permission change reaches everyone within about a minute, at no extra
database cost. For a removal that must be instant — someone is dismissed, a role
is found to be too wide — the Super Admin can choose *"apply now"*, which uses the
existing `sessionVersion` bump and signs the affected people out.

---

## 5. Data model

```prisma
model RoleTemplate {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  baseRole    UserRole                 // ADMIN | TEAM_LEADER | EMPLOYEE
  grants      Json                     // [{ permission, scope }] — validated
                                       // against the catalogue by zod
  createdAt, updatedAt
}

model Role {
  id               String   @id @default(uuid())
  companyId        String
  name             String
  description      String?
  baseRole         UserRole
  isBuiltIn        Boolean  @default(false)   // the migrated four; not deletable
  copiedFromTemplateId String?                // informational only, never a live link
  version          Int      @default(1)       // bumped on every edit (§4.4)
  grants           RoleGrant[]
  users            User[]
  createdAt, updatedAt
  @@unique([companyId, name])
}

model RoleGrant {
  roleId      String
  permission  String      // a catalogue key; unknown keys rejected on write
  scope       PermissionScope?   // null for permissions that are not scopable
  @@id([roleId, permission])
}

enum PermissionScope { OWN TEAM COMPANY }

// On User:
  roleId   String       // required after the migration
  role     UserRole     // kept, now derived from Role.baseRole (§3.1)
```

Grants are rows rather than Json on `Role` because the "who can do this?" view is a
query *by permission* across roles, and that should be an indexed lookup. On
templates, Json is fine: nothing queries into them.

---

## 6. Screens

### 6.1 Super Admin — Role templates

A list of templates; each opens an editor: name, description, base role, and the
permission matrix (§6.3).

### 6.2 Super Admin — a company's roles

In the company's settings (a tab in the Company Options page, attendance plan
§5.1): the company's roles, how many people hold each, and **New role → from
template / from scratch**. Editing shows the affected-people count before saving.

### 6.3 The permission matrix

One row per permission, grouped by module and collapsible; a checkbox per row, and
a scope selector (Own / Team / Company) where the permission is scopable. Greyed
rows for modules outside the company's package (§3.6). A **"compare with
template"** toggle highlights where a company role has drifted from the template it
was copied from — useful when a contract is renewed.

### 6.4 Assigning a role

On the employee's page, a **Role** dropdown listing only that company's roles,
filtered by §4.2 (no ADMIN-based roles for a company Admin). Replaces today's role
selector. For a TEAM_LEADER-based role, the existing team rules apply as today.

### 6.5 "Who can do this?"

Super Admin only. Pick a company and a permission → every person holding it, at
which scope, through which role. And the reverse: pick a person → everything they
can do and why. The first question anyone asks after a surprising approval.

---

## 7. Migration

The one hard requirement: **nobody's access changes on the day it ships.**

### Step 1 — Catalogue and `can`, reading the enum

Write the permission catalogue and `can()`, but make `can()` answer from a fixed
table that maps each of today's four roles to exactly the permissions they have now.
No schema change yet. Build the parity tests (§8) against this table — they are the
safety net for everything after.

### Step 2 — Migrate checks, module by module

Replace role comparisons with `can()` / `requirePermission()` / `scopeWhere()` one
module at a time — Tasks, then Day off, then Payroll, and so on. Behaviour is
identical because `can()` still answers from the fixed table. Each module is its own
change, reviewable and revertible on its own. Also migrate **notification
recipients**: "notify the company's Admins" becomes "notify holders of
`dayoff.approve` at a scope covering this person" — otherwise an HR Officer who can
approve leave never hears that leave was requested.

Leave the structural checks in §2.3 alone; they are supposed to keep reading the
base role.

### Step 3 — Roles become data

Add `Role`, `RoleGrant`, `RoleTemplate`, `User.roleId`. A migration creates, for
every company, four built-in roles — Admin, Team Leader, Employee, and a
Super-Admin-only placeholder if any `User` row carries `SUPER_ADMIN` — with grants
equal to the fixed table, and points every user at the one matching their enum.
Switch `can()` from the fixed table to the user's grants. Parity tests must still
pass unchanged.

### Step 4 — Open the UI

Only now do the Super Admin screens (§6) appear. Before this point, the whole
project is invisible to users.

### Step 5 — Close the old door

A lint rule or test that fails on a new `role === 'ADMIN'`-style comparison outside
an allowlist of structural files (§2.3). Without it, the next feature quietly adds
the 158th check.

---

## 8. Testing

- **Parity tests** — for every permission in the catalogue and each of the four
  built-in roles, `can()` gives the same answer as the code did before migration.
  Written in Step 1, run on every step after. This is what makes "nobody's access
  changes" a checked fact rather than a hope.
- **Route coverage** — every API route declares a permission or is on an explicit
  public/core list. Same idea as the existing `lib/features/routes.test.ts`.
- **Escalation tests** — one per rule in §4.2.
- **Scope tests** — TEAM scope returns exactly `teamMemberWhere`; a later filter
  cannot widen it (the `and` rule).
- **Tenant isolation** — a role, template or grant from company A is never visible
  or assignable in company B.

---

## 9. Open questions

1. **Can a company Admin delegate role assignment?** §4.1 lets a role hold
   `employees.assign_role` — e.g. an HR Officer assigning roles to new hires. Keep
   it, or restrict assignment to Admins only?
2. **Should the built-in Admin role be editable per company?** Recommendation: no —
   it is the one role guaranteed to be able to fix the rest. A reduced admin is made
   as a separate ADMIN-based role (e.g. "Deputy Admin").
3. **Final permission list.** §3.2 is a first draft; each module's owner should
   confirm the split between view and change, especially around salaries.

---

## 10. Non-goals

- Company users creating or editing roles.
- More than one role per user.
- Per-user permission overrides outside a role. A one-off need becomes a role.
- Custom scopes beyond own / team / company (e.g. "a branch"). Revisit only if
  branches become a real structure in the product.
- Changing how Super Admins work.
