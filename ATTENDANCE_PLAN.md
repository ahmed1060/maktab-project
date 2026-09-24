# Attendance & Time Tracking — Implementation Plan

Status: **proposal, not scheduled.** Nothing here is built. This document
records what we would build, in what order, and which decisions are already
settled so that the person who picks it up is not re-arguing them.

It started as a response to an earlier draft (`zkteco_integration_guide.md`)
that described a universal hardware webhook, and has since absorbed three
rounds of product decisions. [§0](#0-decision-log) is the record of what was
decided; everything after it is the plan as it now stands.

---

## 0. Decision log

### Round 1 — architecture

- Devices push, we never pull. The Local Sync Agent is the primary hardware
  path; direct device push (ADMS/`/iclock`) is last.
- The attendance *domain* is built before any hardware integration.
- An attendance day freezes when its payroll run is approved (§11).

### Round 2 — product

| # | Question | Decision |
|---|---|---|
| 1 | Mobile check-in | Yes, from one registered device only. |
| 2 | Exception-first admin screen | Yes (§12.1). |
| 3 | Ramadan / seasonal hours | Yes, as dated overrides (§7.1). |
| 4 | Device health | Yes, on System Health (§12.2). |
| 5 | Lateness | Deducts pay, by per-company rules in a tabbed Company Options page (§5, §6). |
| 6 | Overtime | Per company, alongside lateness (§6.4). |
| 7 | Who corrects attendance | Admin plus a non-admin grant (§13). |
| 8 | Working week | Sunday–Thursday default, overridable (§6.2). |
| 10 | Packaging | Paid add-on (§15). |

### Round 3 — refinements

| # | Topic | Decision |
|---|---|---|
| 1 | Where can a user check in from? | **Log in from any device; check in only from the one registered device.** No "phone vs laptop" detection — the binding is the rule (§9.2). |
| 2 | Changing device | After an approved change, **only the new device** can check in; the old one is revoked in the same step (§9.3). |
| 3 | Fake GPS and buddy punching | **Neither is acceptable.** This makes a native app required for mobile check-in and adds identity verification at check-in. Approach proposed in §9.4–9.5; **needs a decision** (§18.1). |
| 4 | Effective-dated rules | Agreed (§6.1). |
| 5 | Roles | Agreed on permissions over a hardcoded role — **and generalised: roles are created in the UI, each with any set of permissions across the system.** A prerequisite project (§4). |
| 6 | Working week | Agreed. |
| 7 | Raw punch retention | Agreed: current year + one, then prune punches of locked days (§14). |
| 8 | Add-on dependency | **Attendance requires HR** (§15). |
| 9 | Who edits rules | **Super Admin toggle per company exposes a Settings entry in the company Admin's sidebar, showing only the tabs the Super Admin allows** (§5.2). |
| 10 | Device registration | **Requires admin approval** (§9.3). |
| 11 | Permission hours (إذن) | **Adopted** (§6.6). |
| 12 | Overtime approval | **Adopted** (§6.4). |
| 13 | Rule simulator | **Adopted** (§6.7). |
| 14 | Employees see their own days | **Adopted** (§12.3). |
| 15 | Same-day alerts | **Adopted, in-app notification only, no email** (§12.4). |
| 16 | Policy templates | **Adopted: choose a template or build a custom policy; custom policies are not saved as templates** (§6.8). |
| 17 | Holiday calendar | **Adopted: one central calendar, each company adds or removes days** (§7.2). |

---

## 1. Where this system actually stands

**What exists.** `Company` is the tenant boundary and carries its own
`timezone`. `User` has a hardcoded role — `SUPER_ADMIN`, `ADMIN`,
`TEAM_LEADER`, `EMPLOYEE` — checked by string comparison in roughly fifty files.
Payroll is finished: `PayrollRun` (DRAFT → APPROVED → PAID), `Payslip`,
`PayslipLine`, `SalaryChange` (effective-dated), `SalaryAdjustment` (in days,
with `source`/`sourceId`), `FinalSettlement`, `Debt`. Leave is finished:
`DayOffRequest` with approval. There is a cron runner with a fail-closed secret,
a health table (`JobHeartbeat`) on `/dashboard/health`, an audit log, a rate
limiter, a package-based feature gate (`lib/features/`), a trusted-device
mechanism for MFA (`TrustedDevice`), file storage behind `/api/upload`, and task
location verification against one system-wide radius.

The company settings page (`/dashboard/companies/[id]/settings`) is Super Admin
only and is a single page of stacked cards.

**What does not exist.** Any notion of when someone was supposed to be at work —
no schedule, working week, holiday calendar, work location or timesheet — and
no way to define a role other than the four in the enum.

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
| Attendance freezes when its payroll run is APPROVED | §11. |
| Check-in only from the one registered, approved device | Round 3, decisions 1, 2, 10. |
| Mobile check-in runs in a native app, not the browser | Required by round 3, decision 3 — the browser cannot detect a faked location (§9.1). |
| Deductions land as `SalaryAdjustment` rows, source `ATTENDANCE` | Already in days, already explains itself on a payslip. |
| Access is checked by permission, never by role name | Round 3, decision 5 (§4). |
| Attendance requires HR | Round 3, decision 8. |
| Hardware biometric templates never leave the terminal | We receive IDs and timestamps only. Mobile identity checks are a separate decision (§9.5). |

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
- **Roles are data.** A `Role` is a name plus a set of permissions, created and
  edited in the UI.
- **The four existing roles become built-in roles** with exactly today's
  permissions, so the migration changes no one's access. Built-ins cannot be
  deleted, and the built-in Admin cannot lose the permission to manage roles —
  otherwise one careless edit locks a company out of its own settings.
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

- Nobody can grant a permission they do not hold themselves.
- Nobody can edit their own role, or assign themselves a different one.
- Nobody can act on their own record where the permission is an approval — a
  person with `attendance.correct` cannot correct their own attendance; a person
  with `dayoff.approve` cannot approve their own leave.
- Every role change and assignment is audited.
- The check lives on the server in `withStandardHandler`, next to the existing
  feature gate. Hiding a button is a courtesy, not a control.

### 4.4 Open design questions for the roles project

- Roles per company (each company builds its own), global (Super Admin defines,
  companies pick), or both — built-in globals that a company can copy and adjust.
  Recommendation: both, with the same copy-not-link rule as policy templates
  (§6.8).
- Can a user hold more than one role? Recommendation: one role per user to start;
  multiple roles make "why can this person do this?" much harder to answer.

This deserves its own plan document. Everything below assumes it exists and
refers to permissions by name.

---

## 5. Company Options page

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

### 6.3 Lateness and early leave

Structured rule types: grace period; **deduction bands** (e.g. 16–30 min → ¼ day,
31–60 → ½ day, over 60 → 1 day) **or** per-minute at the daily rate; a monthly
free allowance; escalation for repeats; a monthly cap. Early leave has the same
shape.

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
  it (§11).

---

## 8. Data model (sketch)

Names and shapes for discussion, not final. All company-scoped.

### 8.1 Roles (§4)

```
model Role
  id, companyId?              // null = global built-in or Super Admin template
  name, isBuiltIn
  grants  RoleGrant[]

model RoleGrant
  roleId, permission          // a key from the code catalogue
  scope                       // OWN | TEAM | COMPANY

// User.role (enum) is replaced by User.roleId, migrated so each user lands on
// the built-in role matching their current enum value.
```

### 8.2 Settings exposure (§5.2)

```
// On Company:
  adminSettingsEnabled  Boolean  @default(false)
  adminSettingsTabs     String[] @default([])   // tab keys the Admin may see
```

### 8.3 Calendar and policy

```
model WorkSchedule, ScheduleDay, ScheduleOverride, ScheduleOverrideDay,
      UserSchedule            // as in §7.1; UserSchedule effective-dated

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

model OvertimeApproval
  userId, date, approvedMinutes?, status, requestedById?, reviewedById?

model MissingPunchRequest
  userId, date, claimedInAt?, claimedOutAt?, reason, status, …
```

### 8.5 Locations and registered devices

```
model WorkLocation
  companyId, name, lat, lng, radiusMeters
  officeIpRanges  String[]    // optional, §9.4
  wifiBssids      String[]    // optional, §9.4

model UserWorkLocation        // who may check in where
  userId, locationId

model CheckInDevice           // the one device a user may check in from
  id, userId
  publicKey                   // hardware-backed key, §9.2
  platform, model, appVersion
  status                      // PENDING | ACTIVE | REVOKED
  requestedAt, approvedAt?, approvedById?, revokedAt?, revokedById?
  // Partial unique: at most one ACTIVE and one PENDING per user.
```

### 8.6 Hardware, raw and derived

```
model AttendanceDevice, DeviceCredential, UserDeviceMapping   // terminals, §16

model AttendancePunch
  companyId, userId?, source  // IMPORT | MOBILE | AGENT | DEVICE_PUSH | MANUAL
  deviceId?, checkInDeviceId?, hardwareUserId?
  punchAtLocal, punchAt, resolvedWithTimeZone
  lat?, lng?, accuracyMeters?, locationId?
  integrity  Json?            // attestation verdict, mock flag, network match
  identityCheck  Json?        // §9.5 outcome, if any
  status                      // ACCEPTED | PENDING_DEVICE | FLAGGED | REJECTED
  rawPayload Json?, receivedAt

model AttendanceDay
  companyId, userId, date
  scheduleDayId?, overrideId?, policyId
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

Round 3, decision 3 makes fake GPS unacceptable. A web page cannot meet that: the
browser reports whatever location the operating system gives it, and on Android
a mock-location app makes that anything. There is no web API to detect it.

A native app can. So **mobile check-in lives in a native app**. The rest of the
product stays on the web, and the user logs in anywhere as today (decision 1).

Recommended build: **Capacitor wrapping the existing Next.js UI**, with native
plugins only for the check-in screen — location, device integrity, key storage,
biometric prompt, push. One codebase for the UI, native code only where the
platform demands it. Two things to know going in:

- **App store review.** Apple rejects apps that are only a website in a frame
  (guideline 4.2). The native check-in, biometrics and push are what make this
  more than a wrapper, and they should be visible in the first submission.
- **A second release process.** App updates go through store review, so anything
  on the check-in path should be driven by server responses rather than baked
  into the app, to avoid waiting days to change a message or a threshold.

### 9.2 One device

A key pair is generated **inside the phone's secure hardware** (Android
Keystore / iOS Secure Enclave) at registration. The private key cannot be
exported — not by the user, not by a backup, not by us. We store the public key.
Every check-in signs a fresh one-time challenge from the server, so a captured
request cannot be replayed.

The user may be logged in on a laptop, a tablet and two phones at once. Only the
one device holding the registered key can check in. That is the whole rule;
there is no "is this a phone?" guess.

### 9.3 Registering and changing a device (decisions 2 and 10)

- **First registration:** the app requests registration → `CheckInDevice` in
  `PENDING` → someone with `attendance.approve_devices` approves → `ACTIVE`.
- **Changing device:** the new device requests registration → approval
  **revokes the old device and activates the new one in one transaction**. There
  is never a moment with two active devices, and the old one stops working the
  instant the new one starts.
- **Rejection** leaves the old device active.
- **Lost phone:** an admin can revoke directly; the user registers a new one.

**Proposed: check-in from a pending device is held, not lost.** An employee whose
device is awaiting approval on their first morning still taps Check in. The
punch is recorded as `PENDING_DEVICE`, and counts only if the device is
approved; if rejected, it is discarded. Otherwise a slow approval costs an
employee a day of attendance they did nothing to lose, and admins will approve
without looking to avoid that.

### 9.4 Location that can be trusted

Layered — each layer catches what the previous one misses:

1. **Mock-location detection.** Android flags a location as coming from a mock
   provider; iOS 15+ reports whether it was simulated by software. Flagged → the
   check-in is refused.
2. **Device integrity attestation.** Play Integrity (Android) and App Attest
   (iOS) let our server verify that the request came from *our* app, unmodified,
   on a genuine, non-rooted device. This is what stops a rooted phone from hiding
   the mock flag in step 1. Failed attestation → refused.
3. **Geofence** against the employee's `WorkLocation`, with a maximum accuracy
   radius — a fix accurate only to 500 m is not evidence of being in a 70 m
   circle.
4. **Network match (optional per location).** If the office has a fixed public
   IP, or known Wi-Fi access points, a check-in on that network is strong
   independent evidence. Both are cheap to check and very hard to fake together
   with GPS. Configured per `WorkLocation`; if configured, required.

**The honest limit.** No phone-based approach is absolute. A determined attacker
with a rooted phone and tools built to defeat attestation can sometimes get
through. What these layers achieve is raising the cost from "install a free app"
to "specialist effort", and making every failed attempt visible. For a site
where even that is unacceptable, the answer is a fixed fingerprint terminal
(§16), which has no GPS to fake.

### 9.5 Buddy punching — confirming *who* is checking in

Device binding proves *which phone*. Round 3 requires proving *which person*.
Three options, not mutually exclusive — **this needs a decision (§18.1).**

**A. Phone biometric unlock at check-in.** The app requires the phone's own
fingerprint or face unlock to use the check-in key (the key is created as
biometric-bound, so the secure hardware itself refuses to sign without it).
Cheap, no biometric data reaches us. **Weakness:** a phone accepts several
enrolled fingerprints, and its owner can enrol a colleague's. It proves "someone
the owner allowed", not "the owner".

**B. Selfie at check-in, reviewed by people.** The app takes a front-camera photo
at check-in (camera only, no gallery). Stored with the punch; admins spot-check,
and the exception screen samples a few a day. No automated matching, so no
biometric template exists — but the photos are personal data and need consent,
a retention period, and restricted access. A strong deterrent: sending a
colleague with your phone now leaves a photo of the colleague.

**C. Automated face verification with liveness.** Each selfie is matched against
the employee's reference photo, with a liveness check so a photo of a photo
fails. Strongest option. Costs: a vendor per check-in, a reference photo per
employee, false rejections that need a fallback, and it **is** biometric
processing — which Egypt's Personal Data Protection Law (151/2020) treats as
sensitive data, requiring explicit consent and stricter handling. It would
reverse the round 1 rule that we never hold biometrics, and that reversal should
be a deliberate decision with legal input, not a side effect.

**Recommendation:** A always, plus B — and C only if a customer requires it and
is willing to carry the consent process. And separately: for staff who work at a
fixed site, a fingerprint terminal solves buddy punching and fake GPS together,
better than any phone approach. The strongest version of this product uses
terminals for fixed-site staff and the app for field staff (§18.2).

---

## 10. The derivation engine

**Grouping** by shift instance (override first, then base schedule), with a
margin either side for early arrivals and overruns. **Debounce** repeats within
60 seconds. **Pair** in/out by sequence — never earliest/latest. An odd count is
`INCOMPLETE`; a missing punch is never guessed.

**Excusing** — approved permission hours are subtracted from late and
early-leave minutes before pricing, and recorded as `excusedMinutes` so both
facts stay visible.

**Pricing** — measured facts and priced outcomes are stored separately. Monthly
rules (allowance, escalation, cap, permission balance) depend on the order of
days, so pricing runs over the employee's month.

**Recomputation** is pure and idempotent: on ingest, on any change to schedule,
override, holiday, policy, mapping or approval, and nightly as a reconciliation
comparing `inputsHash`. A locked day is never rewritten. Punches in
`PENDING_DEVICE` or `FLAGGED` state are excluded until resolved.

**Unmatched terminal punches** are stored with no user and resolved when mapped.

---

## 11. The payroll boundary

Once the `PayrollRun` covering a date is `APPROVED`, every `AttendanceDay` in it
is locked and immutable, no policy version may take effect inside it, and any
still-pending overtime approval in it is treated as rejected.

Before approval, the month's outcome is written as `SalaryAdjustment` rows with
`source = ATTENDANCE` — one per employee per category, so the payslip reads as a
few lines, not twenty-two. Anything arriving after the lock becomes a
discrepancy for an admin to turn into an adjustment in the current period.

---

## 12. Screens

### 12.1 Daily exceptions

Only what needs a decision, with counts per tab:

| Tab | Shows | Actions |
|---|---|---|
| Late / early | Minutes, excused minutes, resulting deduction | Excuse with reason, accept |
| Absent | Expected, no punches, no leave | Mark leave, mark present with reason, accept |
| Incomplete | Odd punch count | Add punch, link a missing-punch request |
| Overtime | Unapproved overtime | Approve, approve partially, reject |
| Requests | Pending permission-hour, missing-punch and device requests | Approve, reject |
| Unmatched | Terminal punches with no mapped employee | Map (backfills) |
| Flagged | Check-ins that failed integrity, network or identity checks | Accept, reject |

Each tab is filtered by the viewer's permission scope — a team leader sees their
team. Every action is audited.

### 12.2 Device health on System Health

Terminals and agents join the `JobHeartbeat` cards: last seen, last sync, clock
drift, queue depth, agent version, stale during working hours turns red. The same
data filtered to one company appears on that company's Devices tab. Mobile
check-in devices are not listed here — they are per-person, and belong on the
employee's profile and in the device-request queue.

### 12.3 The employee's own attendance (round 3, decision 14)

Each day: status, punches, late minutes, excused minutes, deduction, overtime,
and **the rule that produced the deduction, in the same words the payslip will
use**. Plus the month so far: permission hours remaining, lateness count against
the free allowance, deduction total to date. Buttons to request permission hours
or report a missing punch from the day itself.

### 12.4 Same-day alerts (round 3, decision 15)

In-app notifications only, through the existing `Notification` model — no email.
Sent when a day becomes `INCOMPLETE` or `ABSENT`, when a check-in is flagged, and
when a request is approved or rejected.

In-app notifications are only seen when the app is opened. Since mobile check-in
now requires a native app, **push notifications** to that app cost almost
nothing extra and are not email. Proposed as an enhancement (§17.1).

---

## 13. Who corrects attendance

Anyone whose role holds `attendance.correct`, at their scope. Built-in Admin has
it at company scope. A company can create an "HR Officer" role with it — and that
person keeps everything an employee has, because the role is a set of
permissions, not a replacement for being an employee. Nobody can correct their
own attendance.

---

## 14. Retention

`AttendanceDay` is kept as long as payslips are — it is what a payslip's
deductions are explained by. Raw `AttendancePunch` rows are kept for the current
year plus one, then punches belonging to locked days are pruned by the existing
`/api/cron/prune` job. Check-in selfies (if option B or C in §9.5 is adopted)
need their own, shorter, period — they are personal data with no use once the
day is locked. The exact periods should be confirmed against labour
record-keeping requirements before they are set.

---

## 15. Packaging

A paid add-on that **requires HR**:

- `Bundle` gains `'ATTENDANCE'`; `Package` gains `hasAttendance`.
- The package form refuses `hasAttendance` without `hasHR`, and removing HR from
  a package removes attendance with it, with a warning.
- The gate checks both, so a company with a stale inconsistent package still
  cannot reach attendance without HR.
- The Attendance tab declares `requires: 'ATTENDANCE'`.
- Grandfathered companies (`packageId` null) are unrestricted and would receive
  attendance free on release. Decide deliberately (§18.4).

---

## 16. Hardware terminals and the Local Sync Agent

Unchanged from round 1. A signed Windows service on an always-on PC on the
tenant's LAN pulls from fingerprint terminals over TCP, queues locally, pushes
over outbound HTTPS, advances its cursor only on success, and heartbeats.
Enrolment by a one-time code exchanged for a rotatable, hashed token. Company
from the token, never the body. Clock drift detected on every heartbeat. Device
memory cleared only near capacity.

With round 3's decision on buddy punching, terminals matter more than they did:
for fixed-site staff they are the strongest answer to both fraud problems.

---

## 17. Enhancements proposed in round 3

Not decided — each needs a yes or no.

1. **Push notifications** to the check-in app for the same-day alerts. Not email;
   reaches the employee without them opening the app. The native app makes this
   nearly free.
2. **Check-in reminders.** A push at shift start plus N minutes if no check-in
   has arrived — most "absences" in the first month are people who forgot.
3. **Permission-hours balance on the check-in screen**, so an employee arriving
   late can request the إذن in the same moment rather than later.
4. **Role templates** for the roles project — HR Officer, Branch Manager,
   Accountant — using the same copy-not-link rule as policy templates.
5. **"Who can do this?" view** for the roles project: pick a permission, see
   every person holding it and through which role. The first question anyone
   asks after a surprising approval.
6. **Integrity dashboard for the Super Admin**: failed attestations, mock
   locations and flagged check-ins across companies. A company with a sudden spike
   is either under attack or has a broken app release, and we want to know either
   way.

---

## 18. Open questions

1. **Buddy punching approach (§9.5):** A + B as recommended, or C? If C, it needs
   legal review under Law 151/2020 and reverses the no-biometrics rule.
2. **Are the check-in app's users mainly field staff or office staff?** If office
   staff, fingerprint terminals should move ahead of the mobile app in the
   phasing — they solve both fraud problems more cheaply.
3. **Roles project scope (§4.4):** per company, global, or both; one role per user
   or several.
4. **Grandfathered companies** — do they receive attendance free on release?
5. **Multiple terminals per site with roles** (entry vs exit), or all readers
   equivalent?
6. **Which UI exposes the work week first** — per company, per schedule, or both
   at once?

---

## 19. Phasing

Each phase is independently shippable.

### Foundation — before attendance

- **Roles and permissions** (§4). Migrates the four built-in roles with no change
  in anyone's access, then replaces role checks with permission checks module by
  module.
- **Company Options tabs** (§5.1) and **Admin settings exposure** (§5.2).

### Phase 0 — Engine, settings, import

Schedules, overrides, the holiday calendar with add/remove, work week; policy
with effective dating, templates and the simulator; permission hours; overtime
approval; the engine; XLSX/CSV import and manual entry; missing-punch requests;
the exception screen; the employee's own view; in-app alerts; the add-on bundle.

*Exit: one real tenant runs a full month on imported data and agrees the numbers
are right.*

### Phase 1 — Payroll integration

Outcomes into `SalaryAdjustment`, the lock, discrepancies after lock. Simulator
dry run for the first month before anything is deducted.

Moved ahead of mobile check-in: mobile is now a native app with store review, the
largest single item in the plan, and attendance is sellable with import or
terminals before it exists.

### Phase 2 — Terminals and the Local Sync Agent

Or Phase 3, swapped with mobile, depending on the answer to §18.2.

### Phase 3 — Native check-in app

Capacitor app; hardware-bound device key; registration and change with approval;
held punches from pending devices; mock detection, attestation, geofence, network
match; the chosen identity check (§9.5); flagged-check-in review; push
notifications if adopted.

### Phase 4 — Direct device push

Only on demand. Needs a plain-HTTP ingress outside Vercel.

---

## 20. Non-goals

- Door access control.
- Real-time streaming attendance.
- Storing fingerprint templates from terminals.
- Polling a tenant's device over the internet.
- Shift planning and rota building.
- Check-in from a browser. Mobile check-in is native only; the web product stays
  as it is for everything else.
