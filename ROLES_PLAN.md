# Roles & Permissions — Implementation Plan

Status: **built.** Part A (steps 1–2) is #2, Part B (steps 3–5 and every
screen in §6) is #3. It is the first item of the attendance plan's Foundation
phase ([`ATTENDANCE_PLAN.md` §4](ATTENDANCE_PLAN.md#4-prerequisite-roles-and-permissions)).

Where the build settled something this plan left open, the PRs say so:
- Acting roles end in the session at the return date, whatever the company's
  time zone; the nightly job then moves the person back (§6.13).
- Step-up confirmation covers the 11 high-risk permissions; nobody is made to
  enrol at sign-in, only when they first use one (§6.15).
- `settings.view` and `settings.edit` open a company's own settings, the tabs
  the Super Admin shows it (attendance plan §5.2, #5); the built-in Admin role
  holds both. `audit.view` is still reserved: nothing checks it yet.

§2 is the snapshot the work started from, kept as the record of what changed.

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
| **Custom roles are a real, current need** — several client companies already ask for them. Both parts of this plan (§1.1) are justified, not speculative. | Roles review |
| **All Super Admin tools adopted**: preview as role, copy roles from another company, push a template change, in-app role change requests, role matrix export, separation-of-duties warnings (§6.6–6.11) | Roles review |
| **HR may assign roles through a request that an Admin approves**; Admins assign directly (§6.12) | Roles review |
| **The built-in Admin role is locked** — not editable per company; a reduced admin is a separate ADMIN-based role (§4.3) | Roles review |
| **Acting roles adopted** (§6.13) | Roles review |
| **Periodic access review adopted as a per-company setting, off by default**, toggled in the company's settings (§6.14) | Roles review |
| **One salary permission** — `salary.view` covers salaries everywhere: profiles, payroll, payslips, history, adjustments, settlements, debts (§3.2) | Roles review |
| **High-risk permissions adopted, with step-up MFA valid for 1 hour** (§6.15) | Roles review |
| **Part A is built now, as part of stabilising the website**, on its own branch and PR; Part B follows later (§1.1) | Roles review |
| **An Admin approving their own leave is closed in Part B, not Part A.** Found while recording day-off access: today it is allowed. Part A changes nobody's access, so the record keeps it; Part B enforces §4.2 rule 5 for leave along with every other approval | Part A |
| **Permission list draft 2 accepted** with: `tasks.penalize` as its own permission, labelled as affecting pay; deleting and archiving as separate permissions; waiving debts separate from seeing them (§3.2) | Roles review |

**Revised after a review of the first draft** against the code. The first draft
overstated the migration (§2.2), relied on a circular safety net (§8), and missed
field-level access (§3.7), new-company setup (§7, step 3), and permission
dependencies (§3.8). All corrected below.

---

## 1. Goal

Today a person's access is one of four fixed roles, and what each role may do is
written into the code. The goal: the Super Admin can give a company exactly the
roles its contract describes — an HR Officer who approves leave but cannot see
salaries, an Accountant who runs payroll but cannot manage tasks, a Branch Manager
who leads a team and approves its day-off — **without a code change per company.**

And the migration must change **nobody's access on the day it ships.**

### 1.1 Why this architecture, and in what order

Compared with the current fixed roles, this design wins on flexibility, on having
every access rule in one place, on catching mistakes (every route must declare a
permission, field leaks are tested), on testability and on auditability. The
current design wins on simplicity, on access that cannot be misconfigured, and on
zero operational load — nobody has to manage roles. Since client companies are
already asking for custom roles, the flexibility is needed now, and the costs are
worth paying — **provided the operational load on the Super Admin is kept small**
(§6.7–6.10), because only the Super Admin builds roles.

The work splits into two parts:

- **Part A — one check, no visible change** (§7 steps 1–2, plus field shaping §3.7
  and the lint rule, step 5). Every access decision goes through `can()`, which
  still answers from today's four roles. Users see nothing new. It fixes weaknesses
  that exist today — scattered checks, hidden field rules, no test of who can do
  what — so it is worth doing as part of stabilising the website.
- **Part B — roles become data** (§7 steps 3–4). Roles, templates, the editor, role
  assignment. This is what client companies are asking for.

Part A makes Part B small and safe: by the time roles become data, every check
already goes through one function that is covered by recorded tests.

---

## 2. How roles work today

### 2.1 The enum

`User.role` is `UserRole`: `SUPER_ADMIN`, `ADMIN`, `TEAM_LEADER`, `EMPLOYEE`. It is
put into the JWT at login (`lib/auth.ts`) and read from the session everywhere.
Super Admins are a separate `SuperAdmin` model; a `User` row can also carry
`SUPER_ADMIN`, which `notification.service.ts` already notes.

### 2.2 How much code reads it

Role checks by string comparison in `app/`, `lib/` and `components/`, excluding
tests, as of September 2026:

| Compares against | Checks | What happens to them |
|---|---|---|
| `SUPER_ADMIN` | 117 | **Stay.** The Super Admin is outside the role system (§3.5). Replaced by an `isSuperAdmin(actor)` helper for readability, not by permissions. Many are cosmetic (layout, labels). |
| `ADMIN` | 14 | Migrate to permissions, except structural uses (§2.3). |
| `TEAM_LEADER` | 14 | Mostly structural (team scope, team membership) — stay on the base role. The rest migrate. |
| `EMPLOYEE` | 21 | Mostly "is this person acting on themselves" — become OWN scope. |
| Role lists, e.g. `['ADMIN','SUPER_ADMIN'].includes(role)` | ~24 | Migrate — these are the classic "who may do this" checks. |

Plus 5 routes using `withStandardHandler`'s `allowedRoles` option
(`lib/api-utils.ts`).

**So the real migration is roughly 60–70 checks, not 157.** The first draft of this
plan counted every role comparison as work; three quarters of them are Super Admin
checks that do not change.

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

Two copies of one fact can drift, so this is enforced rather than hoped for:

- All writes go through one `RoleAssignmentService`; a test fails if any other code
  writes `role` on a user.
- A database trigger rejects an update where `User.role` differs from its role's
  `baseRole` — the same belt-and-braces approach the codebase already uses to
  protect founder Super Admin accounts.

**Accepted debt.** Keeping the enum is a deliberate stepping stone. Once every
permission check has migrated, the structural behaviours in §2.3 could become
capabilities (`team.lead`, `billing.exempt_from_block`) and the enum could go. That
is a later decision, not part of this project.

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
(for package gating, §3.6), and **which scopes it allows** (§3.3) — not merely
whether it is scopable. Examples: `dayoff.approve` allows TEAM and COMPANY but
never OWN (approving your own leave is always refused, §4.2, so an OWN grant would
look configured and do nothing); `dayoff.view` allows all three. On every save of
a template or company role, each grant is validated against the permission's
allowed scopes **and** the role's base role (TEAM only on TEAM_LEADER-based roles).
A grant that would silently give no usable access is rejected with the reason,
rather than stored.

The list below is **draft 2**, checked against every company-facing API route in
`app/api` (September 2026), and **accepted** by the Super Admin. Draft 1 was written from the module names and missed
about a dozen real actions — task payments, penalties, transfers and reverts,
bulk upload, password resets, performance-point resets, status changes, ending
contracts, and debt waivers.

Actions a person takes on **their own** things — submitting or acknowledging a task
assigned to them, requesting leave, editing their own profile, their own
notifications, MFA and language — are not permissions. Everyone can always do
them, as today.

| Module | Permission | What it allows | Routes today |
|---|---|---|---|
| **Employees** | `employees.view` | See employee profiles and lists | `GET /users` |
| | `employees.create` | Add an employee | `POST /users` |
| | `employees.edit` | Edit profile fields (not role, not salary) | `PUT /users` |
| | `employees.change_status` | Activate / suspend an account | `users/[id]/status` |
| | `employees.end_contract` | End a contract or reinstate — starts a settlement | `users/[id]/employment` |
| | `employees.delete` | **Soft-delete** an account — separate from archiving because it is destructive (the avatar is removed and the email released) | `DELETE /users` |
| | `employees.reset_password` | Reset someone's password | `users/[id]/reset-password` |
| | `employees.assign_team` | Put people on a team / move teams | `users/team` |
| | `employees.assign_role` | Assign a role directly (§4.2) | new |
| | `employees.request_role` | Request a role assignment for Admin approval (§6.12) | new |
| **Profile requests** | `profile_requests.review` | Approve / reject name-change requests | `profile-requests/[id]/approve\|reject` |
| **Requests** | `requests.view` | See internal requests | `GET /requests` |
| | `requests.review` | Decide requests and award performance points | `PATCH /requests/[id]` |
| | `requests.reset_points` | Reset performance points (one person or all) | `users/[id]/reset-points` |
| **Tasks** | `tasks.view` | See tasks beyond their own | `GET /tasks` |
| | `tasks.create` | Create tasks, including bulk upload from the template | `POST /tasks`, `tasks/bulk`, `templates/*` |
| | `tasks.edit` | Edit details, items and locations | `tasks/[id]/details\|items\|locations` |
| | `tasks.transfer` | Move a task to someone else | `tasks/[id]/transfer` |
| | `tasks.review` | Review submitted tasks, revert a decision | `tasks/[id]/review\|revert` |
| | `tasks.delete` | Delete a task | `tasks/[id]/delete` |
| | `tasks.pay` | Record task payments, single or bulk — **moves money** | `tasks/[id]/payment`, `tasks/payment/bulk` |
| | `tasks.penalize` | Apply a task penalty — **deducts pay**; its own permission, labelled "affects pay" in the role editor (decided) | `tasks/[id]/penalty` |
| **Obligations** | `obligations.view` | See obligations | `GET /obligations` |
| | `obligations.manage` | Create, edit, delete, revert | `obligations/*` |
| **Records** | `records.view` | See a client's sections and records (`CLIENTS_PLAN.md` §0.2) | `GET /records`, `GET /records/sections` |
| | `records.contribute` | Add a section or a record, and edit any record (built as its own right: records are a shared notebook as much as a register) | `POST /records`, `PUT /records`, `POST /records/sections` |
| | `records.edit` | Rename a section | `PUT /records/sections` |
| | `records.delete` | Delete a section or a record — **cannot be undone**, high-risk (§6.15) | `DELETE /records`, `DELETE /records/sections` |
| **Clients** | `clients.view` / `clients.manage` | See clients; create, edit and delete them (named `vendors.*` until 0b, and in the database until 0c, `CLIENTS_PLAN.md` §0.3) | `clients` |
| **Costs** | `costs.view` | See costs, including a person's cost history | `users/[id]/costs-history` |
| **Day off** | `dayoff.view` | See others' leave and balances | `admin/day-off-requests`, `users/[id]/day-off-history` |
| | `dayoff.approve` | Approve / reject / re-evaluate leave | `admin/day-off-requests/[id]*` |
| | `dayoff.adjust_credit` | Change someone's leave balance | `PUT /users` (credit fields) |
| **Salaries** | `salary.view` | See salary figures anywhere (decided: one permission) | `users/[id]/salary-history`, profile, payroll |
| | `salary.edit` | Change a salary — implies view | `PUT /users` (salary) |
| | `salary_adjustments.manage` | Bonus / deduction, reverse, roll back | `users/[id]/bonus\|deduction\|adjustments/*` |
| **Payroll** | `payroll.view` | See the monthly run, payslips, export — implies `salary.view` | `payroll/[y]/[m]` GET, `export`, `payslips/*` |
| | `payroll.prepare` | Save the draft run | `payroll/[y]/[m]` POST |
| | `payroll.approve` | Approve (freeze) the month | `payroll/[y]/[m]/approve` |
| | `payroll.issue_payslips` | Email payslips to employees | `payroll/[y]/[m]/issue` |
| | `payroll.mark_paid` | Mark the month paid | `payroll/[y]/[m]/paid` |
| | `settlements.manage` | See and resend final settlements | `settlements/*`, `users/[id]/settlements` |
| | `debts.view` | See debts | `users/[id]/debts` |
| | `debts.waive` | Forgive a debt — separate because it gives money away | `debts/[id]/waive` |
| **Settings** | `settings.view` / `settings.edit` | Within the tabs the Super Admin exposed (attendance plan §5.2) | company settings |
| **Audit** | `audit.view` | See the company's audit log | `admin/audit-logs` |

**Permanent deletion is not a permission.** Today `DELETE /users?permanent=true`
needs the verification passcode, only works on an account already soft-deleted, and
is reached from the Super Admin's All Users screen. It stays exactly that: Super
Admin only, never grantable to a company role, because it erases the record that
payslips and audit history point at.

Separation-of-duties pairs to warn about (§6.11), from this list:
`payroll.prepare` + `payroll.approve`; `salary.edit` + `payroll.approve`;
`employees.create` + `salary.edit`; `tasks.pay` + `tasks.review`;
`salary_adjustments.manage` + `payroll.approve`.

Attendance adds its own when it is built (`attendance.correct`,
`attendance.approve_face`, …).

#### Salaries — the split that needs deciding

Today, in `app/api/users/route.ts`: **Admins and Super Admins see every salary in the
company; each employee sees their own; team leaders see their team's profiles but
not salaries.** Salaries also appear inside payroll, payslips, salary history,
adjustments, settlements and debts, and each of those follows its own module check.

With custom roles, "who may see salaries" stops being one rule and becomes a
choice per role. The draft offers these levels:

| Level | Permission | Typical holder |
|---|---|---|
| Own salary only | *(everyone — not a permission)* | Every employee |
| See team's salaries | `salary.view` at TEAM scope | A Branch Manager, if the client wants it |
| See everyone's salaries | `salary.view` at COMPANY scope | HR, Accountant |
| Change salaries | `salary.edit` (implies view) | HR manager, Admin |

And the question the final list must answer: **is seeing a salary on an employee's
profile the same permission as seeing it in payroll and payslips?** If yes, one
`salary.view` covers all of them — simple, but an Accountant who runs payroll
necessarily sees every salary. If no, payroll gets its own view permission and a
company can have someone who runs payroll figures without browsing profiles —
finer, but more to configure.

**Decided: one `salary.view`.** Running payroll without seeing salaries is not
realistic, and fewer permissions means fewer misconfigured roles. Every place a
salary figure appears checks this one permission, at the scope it was granted.
The payroll permissions (`payroll.prepare`, `payroll.approve`, …) imply it (§3.8),
so a role cannot be given payroll without it.

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

### 3.7 Field-level access — permissions shape responses, not just routes

A route check answers *may you call this?* It does not answer *which fields may you
see?* The product already needs the second: `app/api/users/route.ts` returns an
employee list to several roles and strips `salary` unless `canViewSalary`. That
logic is a role check today and would silently stay one if the migration only
looked at route guards.

Rule: **every response containing a protected field goes through a serializer that
takes the actor.**

- `shapeUser(actor, user)` → removes `salary` unless the actor holds `salary.view`
  at a scope covering that user; the same for any other protected field.
- One serializer per model with protected fields, in `lib/permissions/shape/`.
  Routes never pick fields by role themselves.
- The protected fields are listed next to the catalogue, so adding a sensitive
  column means adding it to one list — and a test fails if a model's protected
  field appears in any route response for an actor without the permission.

Salaries are the obvious case; payslips, debts, settlements, day-off credit and,
later, attendance deductions are the same.

### 3.8 Permission dependencies

Some permissions are useless alone: approving payroll without seeing it, editing a
salary without viewing it. The catalogue records **implies** relationships
(`payroll.approve` implies `payroll.view`; `salary.edit` implies `salary.view`).
The role editor ticks implied permissions automatically and will not let them be
removed while the permission that needs them is granted, so a Super Admin cannot
build a role that half-works.

It also enforces **scope/base-role compatibility**: TEAM scope is offered only on
TEAM_LEADER-based roles, where a team exists to scope to.

---

## 4. Rules

### 4.1 Who does what

| Action | Super Admin | Company Admin | Anyone else |
|---|---|---|---|
| Create / edit / delete role templates | ✅ | ❌ | ❌ |
| Create / edit / delete a company's roles | ✅ | ❌ | ❌ |
| Assign a role to a user directly | ✅ | ✅ within own company, see 4.2 | ❌ |
| Request a role assignment (approved by an Admin) | — | — | ✅ if their role holds `employees.request_role` — typically HR (§6.12) |
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
4. **You can only hand out access you have.** Assigning — or requesting (§6.12) —
   a role is allowed only if every grant of that role is contained in the
   actor's own grants, at an equal or narrower scope. The built-in Admin holds
   everything in their company, so this never limits them; it stops a narrower
   role that can assign (a "Deputy Admin", or HR requesting) from provisioning
   payroll, salary or audit access it does not itself hold, and stops two such
   people from escalating each other. Checked on the server at assignment and
   again at approval of a request.
5. **Nobody approves their own request**, whatever their permission — leave,
   overtime, a missing punch, a salary change. Enforced in `can` for every
   approval-type permission, not in each route.
6. **A request cannot be approved by the person who made it**, and nobody can
   request a role for themselves (§6.12).
7. **The built-in Admin role is locked.** Its permissions cannot be edited for any
   company. It is the one role guaranteed to be able to fix all the others; a
   client wanting a narrower admin gets a separate ADMIN-based role such as
   "Deputy Admin".
8. **The last Admin cannot be removed.** A company always keeps at least one
   active user on the built-in Admin role, or it could lock itself out of
   assigning roles at all.
9. **Every role creation, edit, deletion, assignment and assignment request is
   audited** with before and after.

### 4.3 Changing a role that people hold

- **Editing** a role changes access for everyone holding it — shown before saving:
  *"This affects 14 people."*
- **Deleting** a role that anyone holds is refused until they are reassigned. A
  person must never be left without a role.
- **A role's base role cannot change once anyone holds it.** `User.role` is
  derived from the base role at assignment (§3.1); changing the base role of a
  held role would leave every holder's enum disagreeing with the role they hold,
  and team scoping, subscription exemption and the rest of §2.3 would follow the
  stale value. So the base role is editable only while a role has no holders. To
  change it for people who hold it, create a new role and reassign them — each
  reassignment goes through `RoleAssignmentService`, which re-derives `User.role`
  and applies the team checks `UserService` already applies when demoting a
  leader.

### 4.4 When changes take effect

Permissions travel in the session token. The JWT callback in `lib/auth.ts` already
re-checks the database every 60 seconds (`sessionVersion`, status, maintenance
mode). It gains two fields — `roleId` and `roleVersion` — and on that same check it
compares **both** with the database: if the user's `roleId` differs from the
token's (they were reassigned) **or** the role's `version` differs (the role was
edited), it **reloads the permissions into the token without logging the person
out**. Comparing only the version would miss a reassignment between two roles
that happen to share a version number — every role starts at version 1 — and
leave the old permissions in place.

So a permission change reaches everyone within about a minute, at no extra
database cost.

The token also notes which release of the permission catalogue its grants
were read against (`CATALOGUE_VERSION` in `lib/permissions/catalogue.ts`),
raised whenever permissions are added or renamed. A token read against an
earlier one reloads its grants on its first request, whatever the role's
version says. Preview builds migrate the production database before the
release that reads it is live, so the older release can refresh a token at
a new role version while dropping permissions it doesn't know; the catalogue
check undoes that once the new release is live (from Codex's review of #82,
when `clients.*` became `records.*`).

**Token size.** The session is a cookie, and cookies are limited to about 4 KB.
Permissions are stored in the token as short numeric codes with a scope digit, not
as full key strings, so even a role holding every permission stays well under the
limit. The catalogue assigns each permission a stable code that is never reused. For a removal that must be instant — someone is dismissed, a role
is found to be too wide — the Super Admin can choose *"apply now"*, which uses the
existing `sessionVersion` bump and signs the affected people out.

---

## 5. Data model

As built. `prisma/schema.prisma` is the record; relations are left out here.

```prisma
model RoleTemplate {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  baseRole    UserRole                 // ADMIN | TEAM_LEADER | EMPLOYEE
  grants      Json                     // [{ permission, scope }], validated
                                       // against the catalogue
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Role {
  id                   String    @id @default(uuid())
  companyId            String
  name                 String
  description          String?
  baseRole             UserRole            // CHECK: never SUPER_ADMIN
  builtIn              UserRole?           // which of the built-in three this is,
                                           // if one (CHECK: equals baseRole); not deletable
  version              Int       @default(1)   // bumped on every edit (§4.4)
  copiedFromTemplateId String?             // informational only, never a live link
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@unique([companyId, name])
  @@unique([companyId, builtIn])
}

model RoleGrant {
  roleId      String
  permission  String            // a catalogue key; unknown keys rejected on write
  scope       PermissionScope
  @@id([roleId, permission])
  @@index([permission, roleId])  // "who can do this?" looks up by permission
}

enum PermissionScope { OWN TEAM COMPANY }

model RoleRequest {                // §6.12
  id            String   @id @default(uuid())
  companyId     String
  userId        String            // who would receive the role
  roleId        String            // the role asked for
  requestedById String
  note          String?
  actingUntil   DateTime?         // asked for as an acting role (§6.13)
  status        RoleRequestStatus @default(PENDING)  // PENDING | APPROVED | REJECTED | CANCELLED
  decidedById   String?
  decisionNote  String?
  decidedAt     DateTime?
  remindedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([companyId, status])
  @@index([userId])
}

// Also built: RoleChangeRequest (§6.9), and AccessReview with its
// AccessReviewLine rows (§6.14).

// On Company:
  defaultRoleId  String?   // the role every new account starts on (§6.4)

// On User:
  roleId        String?    // CHECK ("roleId" IS NOT NULL OR "role" = 'SUPER_ADMIN'
                           //        OR "companyId" IS NULL)
  actingUntil   DateTime?  // §6.13: acting in roleId until then,
  returnRoleId  String?    // then back to this role. Both set, or neither.
  role          UserRole   // kept, now derived from Role.baseRole (§3.1)
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

For an Admin the change applies immediately. For someone who may only *request*
(§6.12), the same dropdown submits a request instead, and the page shows it as
pending.

**Every company has a default role** — normally the built-in Employee — set by the
Super Admin. A new account always starts on it, so nobody ever exists without a
role, even while a request for a different one is waiting.

### 6.5 "Who can do this?"

Super Admin only. Pick a company and a permission → every person holding it, at
which scope, through which role. And the reverse: pick a person → everything they
can do and why. The first question anyone asks after a surprising approval.


### 6.6 Preview a role — adopted

When building a role for a contract, the Super Admin can open **"Preview as this
role"**: the dashboard rendered as a holder of that role in that company would see
it — which sidebar items, which buttons, which fields. **Read-only**: every write is
refused while previewing, so it cannot be used to act as someone. It previews a
role, not a person, so no one's private data is shown beyond what the Super Admin
can already see. Audited. The fastest way to catch "HR Officer can't open the
leave queue" before a company does.

---

### 6.7 Copy roles from another company — adopted

When a new client's structure resembles an existing one's, **"Copy roles from…"**
another company brings over its whole role set in one step, as independent copies.
Faster than rebuilding from templates when you already built exactly this last
month.

### 6.8 Push a template change deliberately — adopted

Company roles are copies, so improving a template changes nobody (§0) — correct,
but with many companies it means fixing the same thing many times. **"Offer this
change to companies using this template"** lists the companies whose role was
copied from it, shows each one's difference, and lets the Super Admin apply the
change to the ones chosen. Nothing changes unless the Super Admin picks it; every
application is audited and bumps the role's version (§4.4).

### 6.9 Role change requests from the company — adopted

Only the Super Admin edits roles, so today a company asks by phone or WhatsApp and
the request lives in nobody's system. A company Admin gets **"Request a role
change"**: pick a role, describe what is needed. It lands in a Super Admin queue,
linked to that company, with a status the Admin can see. The decision stays with
the Super Admin; only the channel changes.

### 6.10 Role matrix export for the contract — adopted

Custom roles are agreed in contracts. **Export the company's roles** as an Excel
sheet (`exceljs` is already a dependency): one column per role, one row per
permission, scope in the cell. The client signs it off as a contract annex, and
when a dispute comes up — *"our HR Officer should have been able to…"* — both sides
are looking at the same document.

### 6.11 Separation-of-duties warnings — adopted

Some combinations are risky in one person's hands even when both are legitimate:
preparing **and** approving payroll, editing salaries **and** approving payroll,
creating employees **and** changing their salary. The catalogue lists these
pairs; the role editor **warns** (does not block) when a role holds both, and the
warning is recorded with the Super Admin's decision. Clients with an auditor will
ask about exactly this.

---

### 6.12 Role assignment requests (HR) — adopted

HR assigns roles to new hires in practice, but assigning a role is granting access,
so an Admin confirms it.

- A role holding `employees.request_role` — typically HR Officer — can pick a role
  for an employee. That creates a **request**, not a change.
- The employee keeps their current role (for a new hire, the company default) until
  the request is decided.
- Everyone holding `employees.assign_role` in the company — the Admins — gets a
  **high-priority** notification (not critical: a pending role is not an emergency,
  and red is reserved for things that are).
- An Admin **approves** (the role is applied through the same service as a direct
  assignment, with the same checks) or **rejects** with a reason. The requester is
  notified either way.
- **Limits.** Only roles of that company; never an ADMIN-based role (Super Admin
  only, §4.2); never for oneself; never approved by the requester; and only roles
  whose grants the requester — and the approving Admin — themselves hold (§4.2,
  rule 4).
- A request left undecided for 3 working days is surfaced again to the Admins, so a
  new hire is not left on the default role indefinitely by oversight.
- Works for existing employees too — a promotion is a request in the same way.

### 6.13 Acting roles — adopted

A Branch Manager goes on leave and someone covers for two weeks. Today that means
changing the cover's role and remembering to change it back. Proposal: a role
assignment can carry an **end date**. Until then the person holds the acting role;
on that date they return automatically to their previous role, and both changes are
audited. It keeps one role per user — the acting role *replaces* theirs for the
period rather than adding to it. Assigned through the same direct or request path.

### 6.14 Periodic access review — adopted, per-company setting

Access that was right a year ago often is not now.

**It is an option, not a default.** In the company's settings — a *Roles* section of
the Company Options page — a toggle **Periodic access review**, **off by default**,
with the interval beside it (quarterly suggested). The Super Admin sets it, as part
of what a company's contract includes; it is not one of the tabs exposed to the
company Admin, since a review the reviewed can switch off is not much of a review.
Turning it off stops future reviews and keeps the record of past ones.

When on, at each interval the company's Admins receive a short in-app review: who holds
each sensitive permission — salaries, payroll approval, role assignment — with a
**confirm** or **request change** button per line. Unanswered reviews are visible to
the Super Admin. Clients with an auditor will be asked for exactly this record.

---

### 6.15 High-risk permissions and step-up confirmation — adopted

A few permissions move money, give it away, or cannot be undone: `tasks.pay`,
`tasks.penalize`, `tasks.delete`, `records.delete`, `salary.edit`,
`salary_adjustments.manage`, `payroll.approve`, `payroll.mark_paid`,
`debts.waive`, `employees.delete`, `employees.end_contract`. The catalogue
(`lib/permissions/catalogue.ts`, `highRisk`) is the list the code checks.

- **Marked in the catalogue as high-risk**, with the reason ("moves money",
  "cannot be undone"). The role editor shows the label — the "affects pay" label
  decided for `tasks.penalize` is this, applied consistently.
- **Step-up confirmation when used, at most once an hour.** Performing one of these
  actions asks for the MFA code only if the person has not confirmed one in the
  **last hour**; within that hour, every high-risk action goes straight through.
  Reuses the existing MFA service. The details that make the hour safe:
  - **Fixed, not sliding.** The hour counts from when the code was entered, and
    using high-risk actions does not extend it. Otherwise someone working
    continuously would never be asked again, and neither would someone who took
    over their session.
  - **Per session, not per account.** Confirming on the office laptop does not
    unlock the phone. The time is kept in the signed session token, so it cannot be
    edited in the browser.
  - **Signing out ends it.** A new sign-in starts with no confirmation.
  - **"Trust this device" does not skip it.** Trusted devices (`TrustedDevice`)
    skip the MFA prompt at *sign-in*; that is a different question. Step-up still
    asks once an hour on a trusted device — otherwise the trusted laptop is exactly
    the unlocked one this protects against.
  - **The interval is a system setting** (default 60 minutes), changed by the
    Super Admin, so it can be tuned without a release. A stolen session, or someone using an
  unlocked laptop, then cannot approve payroll or waive a debt. The existing
  passcode on permanent deletion is the same idea already in the codebase.
- Everyone using a high-risk permission must have MFA enabled. Nobody is made to
  enrol at sign-in: the first time someone without it uses one, the action is
  refused with `MFA_ENROL_REQUIRED` and the screen takes them to set it up
  (decided in the build).

---

## 7. Migration

The one hard requirement: **nobody's access changes on the day it ships.**

### Step 1 — Catalogue and `can`, reading the enum

Write the permission catalogue and `can()`, but make `can()` answer from a fixed
table that maps each of today's four roles to exactly the permissions they have now.
No schema change yet.

**Before writing that table, record what the product does today** — the
characterization tests in §8. The table is written by hand from reading code; the
tests are what prove it was read correctly.

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
every company, three built-in roles — Admin, Team Leader, Employee — with grants
equal to the fixed table, and points every user at the one matching their enum.

**`User` rows carrying `SUPER_ADMIN`.** The codebase allows these, usually with no
company, and a company-scoped role cannot be given to a company-less account. They
are the Super Admin, who is outside the role system (§3.5), so they get **no
role**: `roleId` is nullable, and a database `CHECK` allows null *only* when the
row's `role` is `SUPER_ADMIN`. Every other user must have a role. `can()` already
treats a Super Admin as holding everything, so nothing needs a role for them.
Before the migration runs, list these rows; if any turn out to be ordinary users
given the wrong role, fix them first — the constraint would otherwise hide the
mistake.
Switch `can()` from the fixed table to the user's grants. The characterization tests
(§8) must still pass unchanged.

Two creation paths change in the same step, or new data arrives without roles:

- **`CompanyService.create`** seeds the built-in roles for every new company, in the
  same transaction that creates it.
- **`UserService.create`** takes a `roleId` instead of a role name, and the
  employee creation form lists that company's roles.

### Step 4 — Open the UI

Only now do the Super Admin screens (§6) appear. Before this point, the whole
project is invisible to users.

### Step 5 — Close the old door

A lint rule or test that fails on a new `role === 'ADMIN'`-style comparison outside
an allowlist of structural files (§2.3). Without it, the next feature quietly adds
another hardcoded check.

---

## 8. Testing

- **Characterization tests — the safety net.** Before any code changes, call every
  API route as each of the four roles (plus a user of another company) against a
  seeded test database, and record the outcome: allowed or refused, and for list
  routes which records and which protected fields came back. That recording is the
  truth about today's access. Every migration step re-runs it and must match
  exactly.

  The first draft proposed "parity tests" comparing `can()` with a hand-written
  table of today's permissions. That only proves the table agrees with itself —
  if the table was misread from the code, both sides are wrong together. Recording
  real route behaviour is the only test that catches a misreading.
- **Route coverage** — every API route declares a permission or is on an explicit
  public/core list. Same idea as the existing `lib/features/routes.test.ts`.
- **Escalation tests** — one per rule in §4.2.
- **Scope tests** — TEAM scope returns exactly `teamMemberWhere`; a later filter
  cannot widen it (the `and` rule).
- **Tenant isolation** — a role, template or grant from company A is never visible
  or assignable in company B.
- **Field shaping** — for each protected field, every route that returns the model
  omits it for an actor without the permission (§3.7).
- **No stray role writes** — a test fails if code outside `RoleAssignmentService`
  sets `User.role` (§3.1).

---

## 9. Open questions

None. Every question raised while planning has been decided (§0).

---

## 10. Non-goals

- Company users creating or editing roles.
- More than one role per user.
- Per-user permission overrides outside a role. A one-off need becomes a role.
- Custom scopes beyond own / team / company (e.g. "a branch"). Revisit only if
  branches become a real structure in the product.
- Changing how Super Admins work.
