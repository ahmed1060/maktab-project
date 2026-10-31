# Attendance & Time Tracking — Implementation Plan

Status: **built through Phase 3b** (§20). The Foundation is #2, #3 and #5;
Phase 0 (engine, settings, import) is #9–#15; Phase 1 (payroll) is #16; Phase 2
(terminals and the Local Sync Agent) is #17–#19; Phase 3 (the check-in app) is
#20–#26; Phase 3b (face verification) is #27, with later fixes and speed work in
the PRs after it. Phase 4 (direct device push through the agent) is not built.
This document is the design those PRs follow: what was decided, and why, so
that whoever changes it is not re-arguing settled points. Where the build
settled something left open here, its PR says so, and the code and
`prisma/schema.prisma` are the record of what exists.

It started as a response to an earlier draft (`zkteco_integration_guide.md`)
that described a universal hardware webhook, and absorbed four rounds of
product decisions. [§0](#0-decision-log) is the record of what was decided;
everything after it is the plan as it now stands.

**Before starting implementation, work through
[§21 — Before we start](#21-before-we-start).** The codebase will have moved on
by then, and this plan names real models and files that may have changed.

---

## 0. Decision log

### Round 1 — architecture

- Devices push, we never pull. The Local Sync Agent is the primary hardware
  path; direct device push (ADMS/`/iclock`) is last.
- The attendance *domain* is built before any hardware integration.
- An attendance day freezes when its payroll run is approved (§12).

### Round 2 — product

| # | Question | Decision |
|---|---|---|
| 1 | Mobile check-in | Yes, from one registered device only. |
| 2 | Exception-first admin screen | Yes (§13.1). |
| 3 | Ramadan / seasonal hours | Yes, as dated overrides (§7.1). |
| 4 | Device health | Yes, on System Health (§13.2). |
| 5 | Lateness | Deducts pay, by per-company rules in a tabbed Company Options page (§5, §6). |
| 6 | Overtime | Per company, alongside lateness (§6.4). |
| 7 | Who corrects attendance | Admin plus a non-admin grant (§14). |
| 8 | Working week | Sunday–Thursday default, overridable (§6.2). |
| 10 | Packaging | Paid add-on (§16). |

### Round 3 — refinements

| # | Topic | Decision |
|---|---|---|
| 1 | Where can a user check in from? | **Log in from any device; check in only from the one registered device.** No "phone vs laptop" detection — the binding is the rule (§9.2). |
| 2 | Changing device | After an approved change, **only the new device** can check in; the old one is revoked in the same step (§9.3). |
| 3 | Fake GPS and buddy punching | **Neither is acceptable.** This makes a native app required for mobile check-in and adds identity verification at check-in. Resolved in round 4 (§9.4–9.5). |
| 4 | Effective-dated rules | Agreed (§6.1). |
| 5 | Roles | Agreed on permissions over a hardcoded role — **and generalised: roles are created in the UI, each with any set of permissions across the system.** A prerequisite project (§4). |
| 6 | Working week | Agreed. |
| 7 | Raw punch retention | Agreed: current year + one, then prune punches of locked days (§15). |
| 8 | Add-on dependency | **Attendance requires HR** (§16). |
| 9 | Who edits rules | **Super Admin toggle per company exposes a Settings entry in the company Admin's sidebar, showing only the tabs the Super Admin allows** (§5.2). |
| 10 | Device registration | **Requires admin approval** (§9.3). |
| 11 | Permission hours (إذن) | **Adopted** (§6.6). |
| 12 | Overtime approval | **Adopted** (§6.4). |
| 13 | Rule simulator | **Adopted** (§6.7). |
| 14 | Employees see their own days | **Adopted** (§13.3). |
| 15 | Same-day alerts | **Adopted, in-app notification only, no email** (§13.4). |
| 16 | Policy templates | **Adopted: choose a template or build a custom policy; custom policies are not saved as templates** (§6.8). |
| 17 | Holiday calendar | **Adopted: one central calendar, each company adds or removes days** (§7.2). |

### Round 4 — final

| # | Topic | Decision |
|---|---|---|
| 1 | Timing | **Plan only. Implementation starts after the website is complete and stable.** |
| 2 | Check-in device | Confirmed: **log in and work from any device; check in only from one verified phone** (§9.2). |
| 3 | Office IP | **Adopted as an optional extra check**, configured per work location (§9.4). |
| 4 | Buddy punching | **Option C — automatic face matching with liveness — chosen, as an optional feature.** Enrolled from a few photos on the phone, verified on the phone, **nothing biometric stored on or sent to the server** (§9.5). Legal position in §10. |
| 5 | Roles | Agreed (§4). Built-in role templates from the Super Admin plus company-created roles (§4.4). |
| 6 | Settings tab for company Admin | Agreed (§5.2). |
| 7 | Held punches from pending devices | Agreed (§9.3). |
| 8 | Policy templates, holidays | Agreed (§6.8, §7.2). |
| 9 | Round 3 enhancements | **All adopted**: push notifications, no-check-in reminder, permission hours from the check-in screen, role templates, "who can do this?" view, Super Admin integrity view (§13, §4). |
| 10 | Field or office staff | **Both.** Terminals for fixed sites and the app for field staff are both in scope (§20). |
| 11 | Grandfathered companies | **Receive attendance on release**, like every other module (§16). |

### Round 5 — face enrolment, legal switch, roles

| # | Topic | Decision |
|---|---|---|
| 1 | Verifying a face setup | **After each setup the employee takes one verification photo. It is stored on their profile, visible to the Super Admin, Admin and HR, and sent to them as a critical (red) notification.** Replaces the in-person approval (§9.5). |
| 2 | Legal risk | **Build the feature, mobile app only, behind a system-wide switch that only the protected Super Admin can turn on** (§10.4). |
| 3 | Roles | **Roles and role templates are managed by the Super Admin only**, per company, according to that company's contract and policy. **One role per user** (§4). |
| 4 | "Terminals" | Clarified: the physical fingerprint devices mounted at a site's entrance (§17). |

### Round 6 — photo lifetime, packaging, who decides

| # | Topic | Decision |
|---|---|---|
| 1 | Verification photo lifetime | ~~Deleted as soon as it is approved~~ — **superseded by round 8**: kept after approval as the reference photo. Still deleted on rejection (§9.5). |
| 2 | Where the photo is shown | **Not on the profile.** It lives only in the face-verification approval queue, separate from the profile (§9.5). |
| 3 | Pause / Pause and purge | Adopted (§10.4). |
| 4 | Role assignment | **The company Admin may assign** roles the Super Admin created for that company; only the Super Admin creates them (§4). |
| 5 | Packaging | **Two separate add-ons on top of HR — Terminals and Mobile App — sold one or both per contract** (§16). |
| 6 | Photo on flagged check-ins | Adopted (§13.8). |
| 7 | Legal decision | **The protected Super Admin decides** whether and when to turn face verification on, after their own consultation. The feature is built ready and left off (§10). |
| 8 | Entry/exit terminals, work-week screen | Explained; proposed defaults recorded in §17 and §6.2. |

### Round 7 — closing the open items

| # | Topic | Decision |
|---|---|---|
| 1 | Photo on flagged check-ins | Confirmed (§13.8). |
| 2 | Entrance/exit terminals | **All terminals equal by default; optionally marked entrance-only or exit-only** (§17). |
| 3 | Work week | **Company setting at the top, optional override per schedule** (§6.2). |
| 4 | Import-only customers | **No import-only option.** Excel import is a feature of both add-ons (§16). |
| 5 | Re-verification | **Adopted: on request by Admin/HR at any time, plus an optional automatic interval per company** (§9.5). |

### Round 8 — the approved photo stays

| # | Topic | Decision |
|---|---|---|
| 1 | Approved verification photo | **Kept after approval** (reverses round 6, decision 1), as the employee's *reference photo*. **Shown only when reviewing a flagged face check-in or a re-verification**, under the protections in §9.5. **Replaced by each approved re-verification.** |

---

## 1. Where this system actually stands

**What exists.** `Company` is the tenant boundary and carries its own
`timezone`. Roles are data (§4, built): each person holds one of their
company's roles, and every check asks a permission of it through `can()`
(`lib/permissions/`); a test fails on a new check by role name.
Payroll is finished: `PayrollRun` (DRAFT → APPROVED → PAID), `Payslip`,
`PayslipLine`, `SalaryChange` (effective-dated), `SalaryAdjustment` (in days,
with `source`/`sourceId`), `FinalSettlement`, `Debt`. Leave is finished:
`DayOffRequest` with approval. There is a cron runner with a fail-closed secret,
a health table (`JobHeartbeat`) on `/dashboard/health`, an audit log, a rate
limiter, a package-based feature gate (`lib/features/`), a trusted-device
mechanism for MFA (`TrustedDevice`), file storage behind `/api/upload`, and task
location verification against one system-wide radius.

The company settings page (`/dashboard/companies/[id]/settings`) is tabbed,
from a registry (`lib/company-settings-tabs.ts`), and the Super Admin can show
a company chosen tabs at `/dashboard/settings` (§5, built).

**What does not exist.** Any notion of when someone was supposed to be at work —
no schedule, working week, holiday calendar, work location or timesheet.

*Checked against the code on 27 September 2026, after #3 and #5 (§21 step 1):
the models and files named here and in §21 exist and mean what this says.
`SalaryAdjustment.amount` is in days; its `source` is a string (`MANUAL`,
`TASK_PENALTY`, `DAY_OFF`, `SETTLEMENT`), so `ATTENDANCE` needs no migration.*

---

## 2. What changed from the original draft

1. **Domain before pipe.** Phase 0 is the engine, fed by spreadsheet import.
2. **The Local Sync Agent is the product, not the fallback.** ZKTeco ADMS is a
   vendor-specific plaintext protocol that many units speak only over plain HTTP
   on port 80, which Vercel redirects and the device will not follow.
3. **The payload never carries `tenant_id` or our employee ID.** Company comes
   from the device credential; the device's own user ID is mapped here.
4. **No `ProcessedStatus` boolean.** The derived day is rebuildable.

---

## 3. Settled design decisions

| Decision | Why |
|---|---|
| Raw punches are append-only | They are evidence; corrections live in the derived layer. |
| At-least-once delivery, deduped by index | Makes naïve retry safe for every source. |
| Every policy is effective-dated | The only way "changeable any time" and "payroll can be trusted" coexist (§6.1). |
| Attendance freezes when its payroll run is APPROVED | §12. |
| Check-in only from the one registered, approved device | Round 3, decisions 1, 2, 10. |
| Mobile check-in runs in a native app, not the browser | Required by round 3, decision 3 — the browser cannot detect a faked location (§9.1). |
| Deductions land as `SalaryAdjustment` rows, source `ATTENDANCE` | Already in days, already explains itself on a payslip. |
| Access is checked by permission, never by role name | Round 3, decision 5 (§4). |
| Attendance requires HR | Round 3, decision 8. |
| No biometric templates ever reach our servers | Terminals keep fingerprint templates; the app keeps face templates on the phone. We receive IDs, timestamps and match results — plus one approved reference photo per face-enrolled employee, shown only in reviews (§9.5, §10). |

---

## 4. Prerequisite: roles and permissions

Round 3, decision 5: roles are created in the UI, and each role can be given any
permission in the system. This is the right generalisation — and it is a project
in its own right that should land **before** attendance, because attendance
would otherwise add a dozen more hardcoded role checks that then have to be
migrated.

### 4.1 Shape

- **Permissions are defined in code.** A permission only means something if code
  checks it, so the catalogue is a typed list in the codebase, grouped by
  module: `attendance.view_team`, `attendance.correct`, `attendance.edit_rules`,
  `attendance.approve_devices`, `attendance.approve_overtime`,
  `payroll.approve`, `dayoff.approve`, `settings.view` … Adding a feature means
  adding its permissions to the list. Same pattern as `MODULE_BUNDLE`: one table,
  every caller asking the same question of it.
- **Roles are data**, created and edited in the UI — **by the Super Admin only**
  (round 5). A `Role` is a name plus a set of permissions, belonging to one
  company, built to match that company's contract and HR policy.
- **The four existing roles become built-in roles** with exactly today's
  permissions, so the migration changes no one's access. Built-ins cannot be
  deleted.
- **No company user can manage roles.** There is no `roles.manage` permission in
  the company catalogue at all. That removes most privilege-escalation risk by
  construction: nobody inside a company can create a role more powerful than the
  one they hold.
- **Super Admin stays outside this system.** It is not a company role, it is us.
  Keeping it hardcoded is what guarantees a company cannot build a role that
  reaches across tenants.

### 4.2 Scope is separate from permission

"Can approve day off" is not the whole question — *whose* day off matters. A
team leader approves their team's; an admin approves anyone's. So each grant
carries a scope: **own**, **team**, or **company**. The existing team-leader
logic already is this, expressed as special cases; the migration makes it
explicit.

### 4.3 Rules that prevent privilege escalation

- Role creation and editing are Super Admin only (§4.1), so a company user can
  never widen their own access.
- The company Admin may **assign** roles (round 6) — but only roles the Super
  Admin created for that company, and never to themselves.
- Nobody can act on their own record where the permission is an approval — a
  person with `attendance.correct` cannot correct their own attendance; a person
  with `dayoff.approve` cannot approve their own leave.
- Every role change and assignment is audited.
- The check lives on the server in `withStandardHandler`, next to the existing
  feature gate. Hiding a button is a courtesy, not a control.

### 4.4 Where roles come from

Decided in round 5:

- **Role templates** — HR Officer, Branch Manager, Accountant — are created and
  maintained by the Super Admin.
- **Company roles** are created by the Super Admin for a specific company, from a
  template or from scratch, according to that company's contract and policy. A
  company role is a **copy** of its template: editing the template later changes
  no company. One company's roles are invisible to every other.
- **The company Admin assigns roles to their own people** (round 6) — for a new
  hire, say — choosing from the roles the Super Admin built for that company.
  They cannot create or edit a role.
- **One role per user.** Someone who needs HR Officer *and* Branch Manager
  permissions gets one role built for exactly that. "Why can this person do
  this?" always has a one-line answer: their role.
- The **"who can do this?" view** (§13.5) is a Super Admin screen: pick a
  company and a permission, see every person who holds it.

The full design is in [`ROLES_PLAN.md`](ROLES_PLAN.md). Everything below assumes it
exists and refers to permissions by name.

---

## 5. Company Options page

**Built in #5.** The tabs are General, Branding, Payroll, Roles, Modules and
Admin access; Attendance is added as one registry entry when Phase 0 needs it.
Settled while building it: a company may be shown General, Branding and
Payroll; in Payroll the debt recovery percent stays the Super Admin's (shown,
not editable, refused by the server), a one-line change in the registry.

### 5.1 Structure

A refactor of the existing settings page into tabs, shippable before attendance:

```
┌──────────────────────────────────────────────────────────────┐
│ General │ Branding │ Payroll │ Attendance │ …                │
├──────────────────────────────────────────────────────────────┤
│ Attendance: Work week · Schedules · Seasonal hours ·          │
│   Holidays · Lateness · Overtime · Absence · Permission hours │
│   · Locations · Devices                                      │
└──────────────────────────────────────────────────────────────┘
```

- **Tabs are a registry**: `{ key, labelKey, component, requires?: Bundle,
  adminEligible: boolean }`. Adding a category is one entry.
- **Active tab in the URL** (`?tab=attendance`).
- **Each tab fetches and saves its own data**, with an unsaved-changes guard.
- **Existing cards move without behaviour change.**

### 5.2 Letting a company's Admin see settings (round 3, decision 9)

A Super Admin toggle on each company — *"Company admin can manage settings"* —
adds a **Settings** entry to that company's sidebar. Under the toggle, a
checkbox per tab chooses which tabs the Admin sees.

Rules:

- **Some tabs can never be exposed.** Each tab declares `adminEligible`. Package
  and billing, module names and icons (already documented in the schema as
  Super Admin policy), and anything that crosses tenants are not eligible, so no
  checkbox appears for them. The Attendance tab is eligible; Payroll probably
  partially — payroll day and payslip visibility yes, debt recovery percent is a
  question for the Super Admin.
- **One set of tab components, two entry points.** The Super Admin reaches them
  from the company list; the Admin reaches them at `/dashboard/settings`. Same
  components, filtered by what is allowed.
- **Enforced on the server.** Each settings API checks the company toggle, that
  tab's checkbox, and the caller's `settings.view` / `settings.edit` permission.
  A hidden tab whose API still answers is not hidden.
- **Changes the Admin makes are audited with their name**, so a Super Admin can
  see who changed the lateness rule.

The toggle decides whether the company can see settings at all; the permission
decides which of its people can.

---

## 6. Attendance policy

### 6.1 Effective dating

A policy is a series of versions. Editing creates a new version; saving asks
**"from when?"** — defaulting to the next payroll period, with "from today" and a
custom date. Each `AttendanceDay` records the version it was measured against. A
version cannot take effect inside a period whose payroll is APPROVED.

### 6.2 Work week

Sunday–Thursday working by default. Overridable per company and per schedule.

Decided (round 7): the **company's work week** is one setting at the top of
the Attendance tab (Sunday–Thursday preselected). Each **schedule** — "Office",
"Warehouse" — inherits it and has an optional *different work week* field for the
exceptions, such as a six-day warehouse. Both are built in Phase 0.

### 6.3 Lateness and early leave

Structured rule types: grace period; **deduction bands** (e.g. 16–30 min → ¼ day,
31–60 → ½ day, over 60 → 1 day) **or** per-minute at the daily rate; a monthly
free allowance; escalation for repeats; a monthly cap. Early leave has the same
shape.

**Pricing is done in money, per day, at that day's rate.** Two limits of the
existing adjustment path make this necessary: `SalaryAdjustment.amount` is a count
of days to two decimals — one minute of an eight-hour day is about 0.0021 days and
rounds away — and payroll values a day count at a single monthly rate
(`valueDayQuantity` in `lib/payroll.ts`), so a deduction from before a mid-month
salary change would be priced at the later salary. So each `AttendanceDay` stores
its deduction and overtime **as an amount in minor units**, computed from the
salary in force *on that date* (`SalaryChange` is already effective-dated). How it
reaches the payslip is in §12.

### 6.4 Overtime

Enabled or disabled; multiplier by day type (working day, rest day, holiday);
minimum threshold; compensation as pay or banked time (banking later, field
from the start).

**Approval (round 3, decision 12).** When the policy requires it, overtime is
recorded and shown but priced at zero until someone with
`attendance.approve_overtime` approves it. Two routes, both supported:

- **Pre-approval** — a manager approves overtime for a date and an employee
  before it happens; matching overtime is priced automatically.
- **After the fact** — unapproved overtime appears on the exception screen for
  approval or rejection.

Unapproved overtime still in that state when the payroll run is approved is
treated as rejected for that period, so a forgotten queue cannot leave pay
undecided.

### 6.5 Absence

Deduction per unexcused day as a multiplier (1, 1.5, 2). A day covered by an
approved `DayOffRequest` is leave, never absence.

### 6.6 Permission hours — إذن (round 3, decision 11)

Policy fields:

- **Monthly allowance** in hours (e.g. 4).
- **Minimum and maximum per request** (e.g. 30 min to 2 h).
- **Maximum requests per month**, optional.
- **When it can be requested** — in advance only, or also within N hours after
  the fact.
- **Carry-over** — unused hours lapse at month end (default) or carry once.
- **Types** — late arrival, early leave, mid-day absence.

Flow: employee requests → someone with `attendance.approve_permissions` (scope
team or company) approves → the covered minutes are excused from lateness or
early-leave calculation, and the hours are drawn from the month's allowance.
A request that would exceed the allowance is refused with the remaining balance
shown, rather than approved and then silently partially applied.

The employee sees their remaining allowance on their own attendance page.

### 6.7 Rule simulator (round 3, decision 13)

When an admin edits any rule, before saving: *"Under this rule, last month
would have been…"* — per employee, old deduction vs new, and the total
difference. Pure computation over last month's already-measured days using the
draft policy; nothing is written. The same mechanism provides the first-month
dry run before attendance ever touches payroll.

### 6.8 Policy templates (round 3, decision 16)

When a company first sets up attendance, or at any later point, the admin can
**choose a template** ("Standard Egyptian office", "Six-day factory") **or build
a custom policy** from scratch.

- Applying a template **copies** its values into the company's policy. The
  company's policy is not linked to it — editing the template later does not
  change any company, which would otherwise re-price other companies' payroll
  without their knowledge.
- A company's custom policy is **never** added to the template list.
- Templates are maintained by the Super Admin only.
- Applying a template creates a new policy version and goes through the same
  "from when?" question as any other edit.

---

## 7. Calendar

### 7.1 Schedules and seasonal overrides

Base schedules per weekday, with shifts crossing midnight expressed as
`endMinutes > 1440`. Ramadan and seasonal hours are **dated overrides** on a
schedule, never edits to it: the base is never touched, the override ends by
itself, and next year's Ramadan is a copy with new dates. Override dates stay
editable until their first day has been measured, because Ramadan dates are
confirmed late.

### 7.2 Holidays (round 3, decision 17)

- **One central calendar** of Egyptian public holidays, maintained by the Super
  Admin.
- **Each company inherits it** and can **add** its own days (company anniversary,
  a local holiday) and **remove** inherited ones it does not observe.
- A removal is stored as an exclusion against the central day, not as a
  deletion, so when the Super Admin moves a holiday's date — Egyptian holidays
  are sometimes moved by decree — companies that did not opt out get the moved
  date automatically, and companies that opted out stay opted out.
- A central change that lands inside a locked payroll period does not re-price
  it (§12).

---

## 8. Data model (sketch)

Names and shapes for discussion, not final. All company-scoped.

### 8.1 Roles (§4)

**Defined in [`ROLES_PLAN.md` §5](ROLES_PLAN.md#5-data-model), not here.** In short:
every `Role` belongs to one company and has a base role; `User.role` (the enum) is
**kept** as a derived base role, because team structure and subscription
behaviour depend on it; permissions come from `RoleGrant`. An earlier sketch in
this section replaced the enum and allowed company-less roles — that was
superseded by the roles plan and must not be followed.

### 8.2 Settings exposure (§5.2)

```
// On Company:
  adminSettingsEnabled  Boolean  @default(false)
  adminSettingsTabs     String[] @default([])   // tab keys the Admin may see
```

### 8.3 Calendar and policy

```
model WorkSchedule            // the named schedule: "Office", "Warehouse"
  id, companyId, name, isDefault

model ScheduleVersion         // the hours themselves, effective-dated
  id, scheduleId, effectiveFrom, createdById
  graceInMinutes, graceOutMinutes, breakMinutes, roundingMinutes?, workWeek?
  days  ScheduleDay[]         // one per weekday, belonging to this version
  @@unique([scheduleId, effectiveFrom])
  // Immutable once any AttendanceDay references it. Editing "Office" creates
  // a new version with an effectiveFrom, asked "from when?" like the policy
  // (§6.1) — so earlier days keep being measured against the hours that
  // actually applied, even while the month is still a draft.

model ScheduleOverride, ScheduleOverrideDay   // dated by nature, §7.1
model UserSchedule            // effective-dated assignment of a schedule

model PublicHoliday           // the central calendar
  id, country, date, name
model CompanyHoliday          // a company's own additions
  companyId, date, name, isPaid
model CompanyHolidayExclusion // a central day this company does not observe
  companyId, publicHolidayId

model PolicyTemplate          // Super Admin maintained
  id, name, description, body Json

model AttendancePolicy        // one row per version, per company
  companyId, effectiveFrom, createdById
  appliedTemplateId?          // informational only — never a live link
  workWeek Int[]
  lateness, earlyLeave, overtime, absence, permissionHours   Json
  @@unique([companyId, effectiveFrom])
```

### 8.4 Requests

```
model PermissionRequest       // إذن
  userId, date, type, startAt, endAt, minutes
  reason, status, reviewedById?, reviewedAt?, rejectionReason?
  updatedAt                   // asked, decided or withdrawn: the Requests page's Done order (UI_PLAN.md §2.3, #130)

model OvertimeApproval
  userId, date, approvedMinutes?, status, requestedById?, reviewedById?

model MissingPunchRequest
  userId, date, claimedInAt?, claimedOutAt?, reason, status, …
  updatedAt                   // reported, decided or withdrawn: the Requests page's Done order (UI_PLAN.md §2.3, #131)
```

### 8.5 Locations and registered devices

```
model WorkLocation
  companyId, name, lat, lng, radiusMeters
  officeIpRanges  String[]    // optional; empty = no IP check (§9.4)

model UserWorkLocation        // who may check in where
  userId, locationId

model CheckInDevice           // the one device a user may check in from
  id, userId
  publicKey                   // hardware-backed key, §9.2
  platform, model, appVersion
  status                      // PENDING | ACTIVE | REVOKED
  requestedAt, approvedAt?, approvedById?, revokedAt?, revokedById?
  faceEnrolledAt?, faceModelVersion?   // a fact that enrolment happened —
                                        // the templates themselves stay on the phone
  faceReferencePhotoPath?               // the APPROVED photo; encrypted, private (§9.5)
  facePendingPhotoPath?                 // awaiting a decision; becomes the
                                        // reference on approval, deleted on rejection
  faceEnrolmentStatus?                  // PENDING | APPROVED | REJECTED
  faceEnrolmentReviewedById?, faceEnrolmentReviewedAt?   // §9.5
  reverifyRequestedAt?, reverifyRequestedById?          // §9.5 re-verification
  // Partial unique: at most one ACTIVE and one PENDING per user.

// On SystemSettings: faceVerificationEnabled Boolean — protected Super Admin only.
// On AttendancePolicy: faceVerificationAvailable Boolean (company switch).
// On AttendancePolicy: faceReverifyMonths Int? (null = no automatic re-verification).
// On User: faceVerificationRequired Boolean (per employee, §9.5).

model BiometricConsent        // the legal record; not biometric data itself
  id, userId
  consentTextVersion
  acceptedAt, withdrawnAt?
  // Current consent = latest row with withdrawnAt null and the current
  // text version. A new text version requires a new acceptance.

// On Company: faceVerificationLegalConfirmedAt?, …ById? — the company has
// confirmed it holds whatever licence the consultation says it needs (§10.4).
```

### 8.6 Hardware, raw and derived

```
model AttendanceDevice, DeviceCredential, UserDeviceMapping   // terminals, §17

model AttendancePunch
  companyId, userId?, source  // IMPORT | MOBILE | AGENT | DEVICE_PUSH | MANUAL
  deviceId?, checkInDeviceId?, hardwareUserId?
  sourceKey                   // durable idempotency key, stable across retries:
                              //  AGENT / DEVICE_PUSH: "<deviceId>:<hardwareUserId>:<punchAtLocal>"
                              //    — the terminal's own record identity
                              //  MOBILE: a UUID the app generates once per check-in
                              //    and resends unchanged on every retry
                              //  IMPORT: "<file sha256>:<row number>"
                              //  MANUAL: the punch's own id
  @@unique([companyId, source, sourceKey])
  // A retried delivery hits this constraint and is reported "duplicate" — it is
  // never appended. The 60-second debounce in §11 is a separate thing: it
  // collapses two *real* scans, and is not a retry key.
  punchAtLocal, punchAt, resolvedWithTimeZone
  direction?                  // IN | OUT | null — decided AT INGESTION from the
                              // terminal's mode at that moment (§17) and never
                              // re-derived, so changing a terminal's mode later
                              // cannot reinterpret historical scans
  lat?, lng?, accuracyMeters?, locationId?
  integrity  Json?            // attestation verdict, mock flag, network match
  identityCheck  Json?        // face result only: verified, scores, model version
  status                      // ACCEPTED | PENDING_DEVICE | FLAGGED | REJECTED
  rawPayload Json?, receivedAt

model AttendanceDay
  companyId, userId, date
  scheduleVersionId?, overrideId?, policyId   // the exact, immutable inputs
  deductionMinor, overtimeMinor              // money, at that day's rate (§6.3)
  firstInAt?, lastOutAt?
  workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes
  excusedMinutes              // covered by approved permission hours
  status, deductionDays, overtimeAmount
  isManuallyAdjusted, derivedAt, inputsHash, lockedByPayrollRunId?
  @@unique([companyId, userId, date])
```

---

## 9. Mobile check-in

### 9.1 Why it must be a native app

Fake GPS is not acceptable (round 3). A web page cannot meet that: the browser
reports whatever location the operating system gives it, and on Android a
mock-location app makes that anything, with no web API to detect it. Face
matching on the phone (§9.5) also needs the camera, secure storage and on-device
machine learning at a level only a native app gets.

So **check-in lives in a native mobile app**. Everything else stays on the web,
and the user logs in and works from any device as today.

Recommended build: **Capacitor wrapping the existing Next.js UI**, with native
plugins for the check-in screen only — location, device integrity, hardware key
storage, camera and face matching, push notifications. Two things to know going
in:

- **App store review.** Apple rejects apps that are only a website in a frame
  (guideline 4.2). The native check-in, face matching and push are what make it
  more than a wrapper, and they should be visible in the first submission.
- **A second release process.** App updates go through store review, so
  thresholds, messages and rules on the check-in path come from the server, not
  from the app build.

### 9.2 One verified phone

Round 4, decision 2: **log in and work from any device; check in only from one
verified phone.**

A key pair is generated **inside the phone's secure hardware** (Android Keystore
/ iOS Secure Enclave) at registration. The private key cannot be exported — not
by the user, not by a backup, not by us. We store the public key. Every check-in
signs a fresh one-time challenge from the server, so a captured request cannot
be replayed.

The user may be logged in on a laptop, a tablet and a second phone at once. Only
the one approved phone holding the registered key can check in. That is the
whole rule.

### 9.3 Registering and changing the phone

- **First registration:** the app requests registration → `PENDING` → someone
  with `attendance.approve_devices` approves → `ACTIVE`.
- **Changing phone:** the new phone requests registration. **The moment of that
  request is the cutover**: from then on the old phone is *suspended* and cannot
  check in, and only the new phone's punches are recorded (held, below).
  Approval revokes the old phone and activates the new one in one transaction.
  So two phones' punches can never cover the same period — there is exactly one
  stream before the cutover and one after.
- **Rejection** discards the new phone's held punches, reactivates the old phone,
  and tells the employee to check in with it. The days affected surface on the
  exceptions screen as incomplete, for the usual missing-punch flow.
- **Lost phone:** an admin revokes directly; the user registers a new one.
- **Held punches:** check-ins from a phone awaiting approval are recorded as
  `PENDING_DEVICE` and count only once it is approved, so a slow approval does not
  cost the employee a day.
- **Face enrolment is per phone** (§9.5). A new phone means enrolling again,
  because the face data never left the old one. Until the new phone's photo is
  approved, its check-ins are flagged for review ("no approved face on this
  phone"), so changing phone never turns the face check off.

### 9.4 Location that can be trusted

Layered — each layer catches what the previous one misses:

1. **Mock-location detection.** Android flags a location from a mock provider;
   iOS 15+ reports whether it was simulated by software. Flagged → refused.
2. **Device integrity attestation.** Play Integrity (Android) and App Attest
   (iOS) let the server verify the request came from our real, unmodified app on
   a genuine, non-rooted phone. This is what stops a rooted phone hiding the flag
   in step 1, and — just as important — what makes the on-device face result in
   §9.5 trustworthy at all. Failed → refused.
3. **Geofence** against the employee's `WorkLocation`, with a maximum accuracy
   radius — a fix accurate to 500 m is not evidence of being in a 70 m circle.
4. **Office IP — optional (round 4, decision 3).** If a `WorkLocation` has one or
   more fixed public IPs configured, a check-in must also arrive from one of them.
   Configured per location, off by default. Useful for offices; meaningless for
   field staff, which is why it is per location and not per company.

**The honest limit.** No phone approach is absolute. A determined attacker with a
rooted phone and tools built to defeat attestation can sometimes get through.
These layers raise the cost from "install a free app" to specialist effort, and
make every failed attempt visible on the Flagged tab and in the Super Admin's
integrity view.

### 9.5 Face matching with liveness — on the phone only

Round 4, decision 4: option C, **optional**, with **nothing biometric stored on
or sent to the server**.

#### Turning it on

- **System level:** a switch in System Settings that **only the protected Super
  Admin** can change (round 5; §10.4). Off by default. While off, the feature does
  not exist for any company.
- **Company level:** the attendance policy has a switch, *face verification
  available*. Off by default, and only available while the system switch is on.
- **Employee level:** with the company switch on, face verification is enabled per
  employee. Not everyone at a company needs it — an office with a fingerprint
  terminal may use it only for field staff.
- **Consent first:** before enrolment the app shows a clear explanation of what is
  captured, that the matching data stays on the phone, that **one verification
  photo is stored on the server and who can see it**, and how to withdraw — and records the
  employee's explicit acceptance (who, when, which text version) on the server.
  The consent record is not biometric data; the face data is. See §10 for why
  this step is legally required, not a courtesy.

#### Enrolment

1. The employee takes **3–5 photos** in the app, guided — straight on, slight
   turns, with a liveness check on each so a photo of a photo is refused.
2. A face-recognition model **bundled in the app** turns each photo into a
   numeric *face template* (an embedding — a list of numbers describing the face).
   Nothing is "trained": the model is pre-trained and ships with the app; enrolment
   only records what this person's face looks like to it.
3. The templates are encrypted with a key held in the phone's secure hardware
   and stored on the phone. **The photos themselves are deleted** as soon as the
   templates exist.
4. The phone tells the server only: *enrolled, on this device, at this time,
   with model version X*.

5. **Verification photo (round 5).** Immediately after setup, the app asks the
   employee to verify it: one live capture, with liveness, which must match the
   templates just created. **This one photo is uploaded** and stored as a
   private review asset — **never on the profile** (round 6) — becoming the
   employee's *face reference photo* once approved.
6. Face verification for this employee stays **inactive until approved**.

**Why the photo, and why approval.** Since the templates never leave the phone,
the server cannot tell whose face was enrolled. An employee could enrol a
colleague's face on day one, and the colleague would check in for them forever.
The verification photo closes that: a person who knows the employee looks at it
and confirms it is them. This replaces the in-person approval proposed in
round 4 — it needs no office visit, which matters for field staff.

Note that the employee's existing profile `avatar` cannot serve this purpose: it
is chosen by the employee and approved by no one.

**Who sees it and who is told.**

- The photo is **not part of the employee's profile** (round 6). It appears only in
  the **face-verification approval queue**, to the **Super Admin**, the company
  **Admin**, and anyone whose role holds `attendance.approve_face` (typically
  **HR**). Nobody else — not team leaders, not colleagues, not the profile page.
- On upload, those people receive a **critical notification** — shown in red,
  pinned at the top of the notification list until someone acts on it (§13.4).
- Any one of them can **approve** (face verification becomes active) or
  **reject** (the employee must set up again). Both are audited.
- Every *view* of a face reference photo is audited too. It is the most sensitive
  thing we store, and "who looked at it" should always be answerable.

**What this changes about "nothing on the server".** The face *templates* —
the biometric data used for matching — still never leave the phone. **One photo
per face-enrolled employee does, and is kept** (round 8). The consent text must
say so plainly: that the photo is stored, why, who can see it, and when.

**Lifetime.**

- **Pending** — uploaded, awaiting a decision.
- **Approved → becomes the reference photo.** Exactly one per employee.
- **Rejected → deleted.** If there was an earlier reference photo, it stays.
- **Replaced** by the next approved re-verification or re-enrolment; the old one
  is deleted, not archived.
- **Deleted** when the employee withdraws consent, is archived, or when face
  verification is purged (§10.4).

**When it can be seen — only two cases.** The reference photo is not on the
profile, not in any list, and has no page of its own. It is shown only:

1. **Reviewing a flagged face check-in** — beside the frame that failed (§13.8).
2. **Reviewing a re-verification** — beside the new photo, so the reviewer compares
   old with new rather than working from memory.

**How that is enforced.**

- **No "show me this person's photo" endpoint exists.** The only endpoints that
  return it take the ID of an *open* flagged check-in or an *open*
  re-verification, and refuse once that item is resolved. There is no way to
  browse reference photos, because nothing addresses them by employee.
- **Permission and company checked on every request** — `attendance.approve_face`
  in that employee's company, or the Super Admin.
- **Encrypted at rest** with an application key of its own, separate from every
  other secret — the same pattern the codebase already uses for MFA secrets —
  so a leaked storage bucket alone reveals nothing.
- **Served by streaming through the checked endpoint**, never a public or
  long-lived URL, with `no-store` so it is not cached in the browser.
- **Viewer watermark.** Displayed with the viewer's name and the time overlaid, so
  a screenshot identifies who took it. Screenshots cannot be prevented on the web;
  this makes them traceable.
- **Every view audited** — who, when, for which review.

This combines with phone approval (§9.3): a new phone means a new enrolment, a new
verification photo and a new approval.

#### Re-verification (round 7)

The reference photo shows who was approved *at enrolment*. Re-verification checks
that the face enrolled on the phone still belongs to that person, and refreshes the
reference:

- **On request.** Anyone with `attendance.approve_face` can press **Re-verify** on
  an employee at any time — typically when something looks wrong. The employee's
  next check-in opens the verification capture first.
- **On a schedule — optional.** A company policy setting, *re-verify every N
  months*, off by default (6 months suggested when on).
- **Same path as enrolment.** One live capture that must match the phone's
  templates → uploaded → critical notification → the reviewer sees **new photo
  beside the current reference photo** → approve (new photo **replaces** the
  reference) or reject (new photo deleted, reference kept).
- **Check-ins keep working while it is pending,** so a slow reviewer never costs
  the employee attendance. A **rejection** deactivates face verification for that
  employee until they enrol again, and is audited.
- A request that is not completed within a set time (suggest 3 working days)
  appears on the exceptions screen, so it cannot quietly be ignored.

#### Check-in

1. Employee taps Check in → the app opens the front camera.
2. **Liveness check** — the app confirms a live person is in front of the camera
   and not a photo, a screen or a mask (passive detection, or a short prompt such
   as a blink or a head turn).
3. The app computes a template from the live frame and compares it with the
   enrolled ones. Match above threshold → verified.
4. The frame is discarded immediately.
5. The signed check-in carries the **result only**: verified yes/no, match score,
   liveness score, model version. Signed by the hardware key and covered by the
   attestation, so a modified app cannot simply claim "verified".

#### When it fails

Faces change — lighting, glasses, a beard, an injury. A strict "refuse" would
lock people out of attendance. So: up to N attempts (suggest 3), then the
check-in is **recorded as `FLAGGED`** with the reason, not refused. It appears on
the Flagged tab for a person to decide. Repeated failures prompt a re-enrolment,
with a new verification photo and approval.

#### What keeping matching on the phone costs — accepted trade-offs

- **Little evidence in a dispute.** No photo is taken at ordinary check-ins —
  only the score is recorded. Accepted as the price of privacy; flagged check-ins
  are the exception (§13.8).
- **Trust rests on the app's integrity.** The server believes a "verified" result
  only because attestation (§9.4) proves it came from the genuine app on a
  genuine phone. Face matching must never be offered on a phone that fails
  attestation.
- **Re-enrolment on every phone change**, and after reinstalling the app.
- **Model quality varies across devices.** Low-end phones are slower and less
  accurate. The threshold and the model come from the server config per
  platform, so they can be tuned without an app release.

#### Build or buy

On-device face matching with **reliable liveness** is the hard part. Recognition
models are widely available; liveness that resists a video replayed on another
screen is not, and a weak liveness check makes the whole feature decorative.
Recommendation: use a commercial SDK that does both on-device, and check before
choosing that its on-device mode sends nothing to the vendor's servers — several
do by default for "quality" purposes, which would silently break the
nothing-leaves-the-phone promise.

---

### 9.6 Refused vs flagged check-ins

Every check-in attempt ends in one of three outcomes:

| Outcome | Meaning | Counts as attendance? | Examples |
|---|---|---|---|
| **Accepted** | Every check passed. | Yes, immediately. | The normal case. |
| **Refused** | Clear evidence of cheating or a wrong setup. Nothing for a person to judge. | No. Logged, and visible in the Super Admin integrity view. The employee sees why. | Mock location detected; app or phone failed attestation; not the employee's registered phone. |
| **Flagged** | Something did not check out, but it could be innocent. A person decides. | Only if a reviewer accepts it. | Face check failed 3 times (bad light, new glasses); location fix too imprecise; outside the geofence by a small margin; office IP configured but the phone was on mobile data. |

A **flagged check-in** is therefore *"the system is not sure — a human, please
look"*. It is saved with the reason, appears on the **Flagged** tab of the daily
exceptions screen (§13.1) for Admin/HR, and the employee is told it is awaiting
review. If accepted, it counts as a normal check-in; if rejected, it does not, and
the day is treated as if there were no check-in. Where the reason was the face
check, the reviewer also sees the one captured frame (§13.8).

The line between refused and flagged is deliberate: refusing innocent failures
locks honest people out, and flagging clear fraud wastes reviewers' time.

---

## 10. Legal: biometric data in Egypt

> **Not legal advice.** A technical summary of public sources. The decision to
> turn face verification on belongs to the **protected Super Admin**, after their
> own consultation (round 6). The feature is built ready and ships switched off;
> this section is the briefing for that decision.

### 10.1 The law

- **Personal Data Protection Law No. 151 of 2020** is Egypt's data protection
  law. Its **Executive Regulations were issued by Prime Ministerial Decree No. 816
  on 1 November 2025**, which brought the law fully into operation, with a
  one-year grace period: **compliance is expected from 1 November 2026.**
- **Biometric data is "sensitive personal data"** under Article 1, alongside
  health, genetic, financial, religious, political and criminal-record data.

### 10.2 What sensitive data requires

As reported in the public sources below:

- **A licence from the Personal Data Protection Center (PDPC)** to collect, store,
  process or transfer sensitive data. There is no route to processing biometric
  data without it.
- **Explicit, written consent** from each person, on top of the licence.
- **A Data Protection Officer** registered with and approved by the PDPC, for
  every controller and processor.
- **Breach notification to the PDPC within 72 hours**, and to affected people
  within three working days after that.
- **Rights for the person** — to know, to withdraw consent, to correct, to
  restrict, and to be told of a breach.
- **Penalties** reported at up to EGP 5,000,000 in fines, with imprisonment
  possible for sensitive-data violations; failures in licensing, security or
  breach reporting are reported at EGP 300,000–3,000,000.

### 10.3 What on-device processing does and does not change

Keeping the face data on the phone is the strongest privacy design available, and
it should make a regulator's and an employee's view of the feature far more
favourable. **But it does not obviously take the feature outside the law.** Our
app still captures faces and computes biometric templates; that is processing,
wherever it happens. Whether on-device processing that never reaches our servers
still requires the PDPC sensitive-data licence — and whether the licence falls on
us, on the employing company, or both — is the first thing to establish.

Questions for the protected Super Admin's consultation:

1. Does on-device-only processing of face templates require the sensitive-data
   licence, and for whom — the software provider, the employer, or both?
2. Who is the *controller* (likely the employing company, which decides to use
   it) and who is the *processor* (likely us)? That decides who holds which
   licence and who signs the consent.
3. Can consent be "freely given" by an employee to their employer? Does keeping
   the feature optional per employee, with a non-biometric alternative, satisfy
   that?
4. What must the written consent contain, and does in-app acceptance with a
   stored record count as written?
5. Is a face photo stored on the server for **human** review (the verification
   photo, §9.5) itself biometric data under the law, given it belongs to a
   biometric system — or ordinary personal data like an ID photo in an HR file?
6. Does the non-sensitive part of attendance — punches, locations, IPs — need its
   own licence tier?

### 10.4 Consequences for the design

Built into the design regardless of the answers:

- **Optional per employee, with a non-biometric alternative** (the phone check-in
  without face, or a terminal). Consent that cannot be refused is weak consent.
- **Withdrawal is one tap in the app**, deletes the templates on the phone
  immediately, and the server records the withdrawal. The employee falls back to
  the alternative; nothing about their employment record changes.
- **Consent is versioned.** If the explanation text changes, employees re-accept.
- **Deletion on offboarding:** archiving an employee revokes their phone, and the
  app deletes the templates the next time it runs.
- **A system-wide switch that only the protected Super Admin can turn on**
  (round 5). The code can be built and shipped; the law governs *processing*, and
  no processing happens while the switch is off. It stays off until the protected
  Super Admin decides to enable it. It reuses the existing `SuperAdmin.isProtected` flag, which
  the database itself already enforces with a trigger.
- **Two ways to turn it off.** *Pause* stops the feature everywhere and keeps
  enrolments, for a temporary stop. *Pause and purge* is for when the answer is
  no; it asks for confirmation and MFA.

  **Purge must not claim more than it can do.** A server cannot delete data on a
  phone that is off, lost, or never opens the app again. So the templates are
  protected by **crypto-shredding**: on the phone they are encrypted with a key
  made from two parts — one held in the phone's secure hardware, one per-device
  *wrapping key* held on our server and fetched at each check-in. Neither part is
  biometric data. Purge **destroys every server-held wrapping key**, which makes
  every template on every phone permanently unreadable at that instant, whether
  or not the phone is ever seen again. It then deletes every stored reference
  photo, pending photo and flagged frame, and asks each app to delete its
  (now unreadable) ciphertext. The purge record states both facts separately:
  *"keys destroyed — all templates unusable"* (immediate and complete) and
  *"deletion acknowledged by N of M devices"* (tracked as phones check in,
  and counted on the purge record itself, so a phone or person deleted later
  doesn't lower N). The same mechanism applies to one employee on consent withdrawal or
  archiving.
- **The feature is gated on the company's legal readiness** — a company cannot
  switch face verification on until it has confirmed (and we have recorded) that
  it holds whatever licence the consultation says it needs.

### 10.5 Beyond this feature — flagged, not in scope

Two things the research surfaced that concern more than attendance:

- **Fingerprint terminals are biometric processing too.** Our round-1 rule — we
  never receive templates from terminals — keeps *us* out of it, but the employer
  operating a fingerprint terminal is processing biometric data. Customers using
  terminals should be told this.
- **Financial data is also sensitive data under Article 1**, and the existing
  product already processes salaries, payslips and debts. With compliance expected
  from **1 November 2026**, the current website's own position under the law is
  worth a lawyer's review regardless of attendance.

### 10.6 Sources

- [Baker McKenzie — Egypt: Important Data Protection Update (Jan 2026)](https://www.bakermckenzie.com/en/insight/publications/2026/01/egypt-important-data-protection-update)
- [CMS — Egypt's PDPL: Executive regulations issued, one-year compliance countdown begins](https://cms.law/en/int/legal-updates/egypt-s-pdpl-executive-regulations-issued-one-year-compliance-countdown-begins)
- [Kennedys — Egypt's Personal Data Protection Law: the compliance countdown has begun (2026)](https://www.kennedyslaw.com/en/thought-leadership/article/2026/egypt-s-personal-data-protection-law-the-compliance-countdown-has-begun/)
- [Clyde & Co — Egypt regulatory update on data privacy (Jan 2026)](https://www.clydeco.com/en/insights/2026/01/egypt-regulatory-update-on-data-privacy)
- [Consortio — Sensitive personal data in Egypt: PDPL licence & consent for biometric attendance](https://consortiolawfirm.com/pdpl-sensitive-data-biometric-attendance-egypt/)
- [Andersen — Translation of Law No. 151 of 2020](https://eg.andersen.com/translation-law-151-2020/)
- [MCIT — Law No. 151 of 2020 (official document)](https://mcit.gov.eg/Upcont/Documents/Reports%20and%20Documents_1232021000_Law_No_151_2020_Personal_Data_Protection.pdf)

---

## 11. The derivation engine

**Grouping** by shift instance (override first, then base schedule), with a
margin either side for early arrivals and overruns. **Debounce** repeats within
60 seconds. **Pair** in/out by sequence — never earliest/latest. An odd count is
`INCOMPLETE`; a missing punch is never guessed.

**Excusing** — approved permission hours are subtracted from late and
early-leave minutes before pricing, and recorded as `excusedMinutes`.

**Pricing** — measured facts and priced outcomes are stored separately. Monthly
rules (allowance, escalation, cap, permission balance) depend on the order of
days, so pricing runs over the employee's month.

**Recomputation** is pure and idempotent: on ingest, on any change to schedule,
override, holiday, policy, mapping or approval, and nightly as a reconciliation
comparing `inputsHash`. A locked day is never rewritten. Punches in
`PENDING_DEVICE` or `FLAGGED` state are excluded until resolved.

**Unmatched terminal punches** are stored with no user and resolved when mapped.

---

## 12. The payroll boundary

### 12.1 Locking is one transaction with approval

Today `PayrollRunService.approve` saves the draft (`saveDraft`) and *then* opens
the transaction that sets the run to `APPROVED`. If attendance simply "locks when
the run is approved", a punch or a nightly recompute landing between those two
steps would change attendance after the payslip figures were computed — approved
payslips that disagree with the final attendance.

So approval and locking are serialized:

- **One lock per company-month.** Approval, punch ingestion, recomputation and any
  request approval that touches a date take the same Postgres advisory lock for
  that company and month (`pg_advisory_xact_lock`) before writing. They cannot
  interleave.
- **Inside approval's transaction, in order:** take the lock → resolve pending
  overtime in the month as rejected → run the final recompute of the month's
  attendance → write the attendance payroll entries (§12.2) → compute and save the
  payslips → stamp every `AttendanceDay` with `lockedByPayrollRunId` → set the run
  `APPROVED`. One commit; either all of it happened or none of it did.
- **After it:** anything that takes the lock and finds the month locked records a
  discrepancy instead of writing (below).

This changes the existing approve flow — computing inside the transaction rather
than before it — and needs its own tests for the race, not only for the result.

### 12.2 Attendance entries are reconciled, never appended

Attendance is recomputed many times before approval; the existing adjustment path
increments `SalaryRecord` and appends a row on every call, which would duplicate
deductions. So attendance does **not** write adjustments as it goes. Instead:

- Each entry has a **stable identity**: `(userId, year, month, source = ATTENDANCE,
  category)`, where category is lateness, early leave, absence or overtime —
  enforced by a unique index.
- Entries are written **only inside the approval transaction** (§12.1), from the
  final recompute, as **money in minor units** (the sum of each day's priced
  amount, §6.3) — not as a day count revalued at a month-end rate.
- Writing is **reconcile, not add**: if an entry with that identity exists and
  differs, it is replaced atomically within the same transaction; if it matches,
  nothing is written. Rerunning approval preparation can therefore never
  double-count.
- The payslip shows them as their own lines, which needs a money-denominated
  attendance line kind alongside the existing day-based adjustment — a small
  extension to `PayslipLine`, planned with Phase 1.
- Before approval, the attendance screens show the **computed** figures live; they
  are simply not yet payroll entries.

### 12.3 After the lock

Anything arriving for a locked month becomes a discrepancy for an admin to turn
into an adjustment in the current period.

A system that silently edits a paid payslip is worse than one with no attendance
at all.

---

## 13. Screens and notifications

### 13.1 Daily exceptions

Only what needs a decision, with counts per tab, filtered by the viewer's
permission scope:

| Tab | Shows | Actions |
|---|---|---|
| Late / early | Minutes, excused minutes, resulting deduction | Excuse with reason, accept |
| Absent | Expected, no punches, no leave | Mark leave, mark present with reason, accept |
| Incomplete | Odd punch count | Add punch, link a missing-punch request |
| Overtime | Unapproved overtime | Approve, approve partially, reject |
| Requests | Pending permission-hour, missing-punch, device and face-enrolment requests | Approve, reject |
| Unmatched | Terminal punches with no mapped employee | Map (backfills) |
| Flagged | Check-ins that failed integrity, IP, or face checks | Accept, reject |

Every action is audited.

### 13.2 Device health on System Health

Terminals and agents join the `JobHeartbeat` cards: last seen, last sync, clock
drift, queue depth, agent version; stale during working hours turns red. The same
data, filtered to one company, appears on that company's Devices tab.

### 13.3 The employee's own attendance

Each day: status, punches, late minutes, excused minutes, deduction, overtime,
and the rule that produced the deduction in the same words the payslip will use.
The month so far: permission hours remaining, lates against the free allowance,
deductions to date. Request permission hours or report a missing punch from the
day itself.

### 13.4 Notifications — in-app and push, never email

- **In-app** through the existing `Notification` model.
- **Push** to the check-in app — adopted in round 4. Not email; reaches the
  employee without them opening anything.
- **Priority.** `Notification` gains a `priority`: `NORMAL`, `HIGH`, `CRITICAL`.
  `CRITICAL` is red and stays pinned at the top until acted on. It is reserved for
  things that **need a decision from a person** — a face reference photo awaiting
  approval, a terminal offline during working hours, an integrity spike. If
  ordinary events are critical too, people learn to ignore red, and the one that
  matters is missed.
- Sent when: a day becomes `INCOMPLETE` or `ABSENT`; a check-in is flagged; a
  request is approved or rejected; **no check-in has arrived N minutes after the
  shift starts** (reminder, adopted in round 4 — N configurable in the policy,
  suggest 15).

### 13.5 "Who can do this?" (roles)

A Super Admin screen: pick a company and a permission; see every person holding
it, at which scope, through which role. The first question anyone asks after a
surprising approval.

### 13.6 Check-in screen extras

When a check-in is late, the confirmation offers **"Request permission hours
(إذن)"** right there, with the remaining monthly balance shown — adopted in
round 4. One tap from the moment it matters, rather than remembered later.

### 13.7 Super Admin integrity view

Across all companies: failed attestations, mock-location detections, office-IP
mismatches, face-check failures and flagged check-ins, over time. A company with a
sudden spike is either under attack or has a broken app release — we want to
know either way. Adopted in round 4.


### 13.8 Photo on flagged check-ins — adopted (round 6)

When a check-in is flagged because the face check failed three times, the app
uploads the last captured frame with it. The reviewer sees that frame **beside the
employee's reference photo** (§9.5) and decides whether it is the same person.
Ordinary successful check-ins send no photo. The frame is deleted the moment the
flag is accepted or rejected; while it exists it has the same protections as the
reference photo — encrypted, reachable only through the open flag, watermarked,
every view audited. Covered by the same consent text as the verification photo.

---

## 14. Who corrects attendance

Anyone whose role holds `attendance.correct`, at their scope. The built-in Admin
has it at company scope. The Super Admin can create an "HR Officer" role with it for a company, and
that person keeps everything an employee has. Nobody can correct their own
attendance.

---

## 15. Retention

`AttendanceDay` is kept as long as payslips are. Raw `AttendancePunch` rows are
kept for the current year plus one, then punches belonging to locked days are
pruned by the existing `/api/cron/prune` job. Face templates never reach the
server. The one face reference photo per employee is kept while face verification is
active for them, replaced on each approved re-verification or re-enrolment, and
deleted on consent withdrawal, archiving or purge (§9.5). Flagged-check-in frames
are deleted when the flag is resolved. Face-consent records are kept for as long as the consent is relevant
plus whatever the consultation advises (§10). Exact periods confirmed against labour
record-keeping requirements before they are set.

---

## 16. Packaging

Round 6: **two separate add-ons on top of HR, sold one or both according to the
contract.**

| Add-on | Gives the company |
|---|---|
| **Attendance — Terminals** | Fingerprint terminals through the Local Sync Agent (§17). |
| **Attendance — Mobile App** | The native check-in app (§9), including face verification when the system switch is on. |

**The attendance core comes with either.** Schedules, policies, permission hours,
overtime approval, the engine, the exceptions screen, the employee's own view,
Excel import, manual entry and payroll integration are needed whichever way punches
arrive. There is **no import-only option** (round 7): import is a feature of both
add-ons, not a product on its own. A company holding either add-on gets all of them; one holding both gets
one core, with punches from both sources feeding the same days.

Implementation:

- `Bundle` gains `'ATTENDANCE_TERMINALS'` and `'ATTENDANCE_MOBILE'`; `Package`
  gains `hasAttendanceTerminals` and `hasAttendanceMobile`.
- **Both require HR.** The package form refuses either without `hasHR`; removing
  HR removes both, with a warning.
- **The core module is unlocked by either add-on.** Today `MODULE_BUNDLE` maps each
  module to exactly one bundle; the core attendance module needs "any of these
  bundles". A small, deliberate extension to `lib/features/bundles.ts`, with a
  test that a company holding only one add-on reaches the core.
- Terminal-only screens (devices, the agent, mappings) require
  `ATTENDANCE_TERMINALS`; app-only screens (phones, work locations, face) require
  `ATTENDANCE_MOBILE`. The Attendance settings tab shows only the sub-sections the
  company bought.
- Removing one add-on from a contract keeps all attendance history; it stops new
  punches from that source.
- **Grandfathered companies (`packageId` null) receive both** on release (round 4).

## 17. Hardware terminals and the Local Sync Agent

*Terminal* in this plan means a **physical fingerprint attendance device** —
the ZKTeco or Hikvision unit mounted at a site's entrance, which employees scan
their finger on when arriving and leaving. It is what the original draft was
about. Terminals suit staff who arrive at a fixed place every day; the app suits
staff who do not.

A signed Windows service on an always-on PC on the tenant's LAN pulls from
fingerprint terminals over TCP, queues locally, pushes over outbound HTTPS,
advances its cursor only on success, and heartbeats. Enrolment by a one-time code
exchanged for a rotatable, hashed token. Company from the token, never the body.
Clock drift detected on every heartbeat. Device memory cleared only near
capacity. We never receive fingerprint templates — only IDs and timestamps
(and see §10.5 on the employer's own obligations).

Since the product serves both office and field staff (round 4), terminals are the
answer for fixed sites and the app for field staff; a company may use both, and
the engine treats their punches identically.

**Entry and exit terminals — decided (round 7).** Some sites mount two devices, one
at the entrance and one at the exit. The question is whether a scan on the
"entrance" device should always mean *arriving* and a scan on the "exit" device
always mean *leaving*. **By default every terminal is equal** and the
engine works out arriving/leaving from the order of scans (first scan of the shift
= arrived, next = left, and so on). A terminal can optionally be marked
*entrance only* or *exit only* in its settings, for sites that want it.
The mode is applied **when each punch arrives** and stored on the punch as its
direction (§8.6). Changing a terminal's mode later affects only new scans; it
never reinterprets past ones, even in a month still being recomputed.

---

## 18. Open questions

One left, deliberately deferred to implementation:

1. **Face SDK choice** (§9.5) — chosen when Phase 3b starts, against the rule that
   face templates never leave the phone. Verify the vendor's on-device mode sends
   nothing to their servers.

---

## 19. Non-goals

- Door access control.
- Real-time streaming attendance.
- Storing fingerprint templates from terminals.
- Storing or transmitting face templates. (One approved reference photo per
  face-enrolled employee is stored, §9.5; ordinary check-ins send none.)
- Polling a tenant's device over the internet.
- Shift planning and rota building.
- Check-in from a browser. Check-in is native-app only; the web product stays as
  it is for everything else.

---

## 20. Phasing

Each phase is independently shippable. Every phase up to and including 3b is
built; Phase 4 is not.

### Foundation — built

- **Roles and permissions** (§4), including role templates and the "who can do
  this?" view. Migrates the four built-in roles with no change in anyone's access.
  Built in #2 and #3.
- **Company Options tabs** (§5.1) and **Admin settings exposure** (§5.2). Built
  in #5.

Both are useful to the website on their own and are the natural first step.

### Phase 0 — Engine, settings, import — built (#9–#15)

Schedules, overrides, holidays with add/remove, work week; policy with effective
dating, templates and the simulator; permission hours; overtime approval; the
engine; XLSX/CSV import and manual entry; missing-punch requests; the exception
screen; the employee's own view; in-app notifications; the add-on bundle.

*Exit: one real tenant runs a full month on imported data and agrees the numbers
are right.*

### Phase 1 — Payroll integration — built (#16)

Outcomes into `SalaryAdjustment`, the lock, discrepancies after lock. Simulator
dry run for the first month before anything is deducted.

### Phase 2 — Terminals and the Local Sync Agent — built (#17–#19)

For office and fixed-site staff. Device registry, enrolment, ingest, heartbeat,
device health.

### Phase 3 — Native check-in app — built (#20–#26)

For field staff. Capacitor app; hardware-bound key; phone registration and change
with approval; held punches; mock detection, attestation, geofence, optional
office IP; push notifications and the no-check-in reminder; permission hours from
the check-in screen; flagged review; Super Admin integrity view.

### Phase 3b — Face verification — built (#27)

Separate from Phase 3 on purpose, so it cannot hold the rest of the app back. Built
complete and shipped **switched off**; the protected Super Admin enables it when
they decide to (§10). Consent flow, enrolment with verification photo and approval, on-device
matching with liveness, fallback to flagged.

### Phase 4 — Direct device push, through the agent — not built

Only on demand. Terminals that push (ZKTeco ADMS) often speak **plain HTTP only**,
so a public ingress would expose device credentials, employee IDs and punch times
on the internet and let an intercepted credential forge punches. **A public
plain-HTTP endpoint is therefore not supported, anywhere.**

Instead, the Local Sync Agent (§17) gains an **ADMS listener on the LAN**: the
terminal pushes to the agent's local address over the office network, and the
agent forwards over authenticated HTTPS exactly as it does for pulled punches.
Plaintext never leaves the building. A site that cannot run an agent uses pull
mode or Excel import, not direct push.

---

## 21. Before we start

This plan was written against the codebase as of September 2026 and will be
picked up later. Before the first line of implementation:

1. **Re-read §1 against the code.** Confirm the models and files it names still
   exist and still mean what it says — `PayrollRun`, `SalaryAdjustment` and its
   `source` values, `DayOffRequest`, `JobHeartbeat`, `lib/features/bundles.ts`,
   `lib/features/routes.ts`, `lib/modules.ts`, `lib/time.ts`, the company
   settings page. Update this document where they changed.
   *Done 27 September 2026 (§1). Redo it if Phase 0 starts much later.*
2. **Nothing legal blocks the build.** Face verification ships switched off; the
   protected Super Admin enables it after their consultation (§10).
3. **The roles project has its own plan** in [`ROLES_PLAN.md`](ROLES_PLAN.md). It
   lands first and touches the whole product. *Built (#2, #3).*
4. **Pick one pilot tenant** for the Phase 0 exit criterion before building
   Phase 0, so the month of real data is ready when the engine is.
