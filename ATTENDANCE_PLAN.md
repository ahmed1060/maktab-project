# Attendance & Time Tracking — Implementation Plan

Status: **built through Phase 3b** (§20). The Foundation is #2, #3 and #5;
Phase 0 (engine, settings, import) is #9–#15; Phase 1 (payroll) is #16; Phase 2
(terminals and the Local Sync Agent) is #17–#19; Phase 3 (the check-in app) is
#20–#26; Phase 3b (face verification) is #27, with later fixes and speed work in
the PRs after it, and is paused for now (§20). Phase 4 (terminals through the agent or straight to Nizmo,
ZKTeco and Hikvision alike, round 9) is planned in #269; its part 2, who
may set terminals up, is built in #277, with the built-in Admin's grant
for the companies already there in #278; part 3, terminal brands, is
built in two PRs, the Super Admin's list in #279 and the brand on each
terminal in #280; part 4, one terminal whichever way it connects, is
built in #290; part 5, Hikvision straight to Nizmo, is split in five PRs,
the first, the address a terminal sends to, built in #291, the second,
Add a terminal with its address shown once, in #292, the third, what
a scan keeps of its event, in #293, the fourth, first contacts kept for
the Super Admin, in #294, and the fifth, the straight-to-Nizmo switch on
the company's Attendance tab, in #295: part 5 is built, switched off for
every company; part 6, ZKTeco straight to Nizmo, is split in four PRs,
the first, the addresses a terminal calls, built in #296, the second,
Add a terminal for ZKTeco straight to Nizmo with the office's address,
in #297, the third, Change connection, in #298, and the fourth, first
contacts kept for a ZKTeco terminal, in #299: part 6 is built, switched
off for every company; part 7, the agent reads Hikvision, is split in
four PRs, the first, the agent's Hikvision client, in #300, the
second, Nizmo taking a terminal's protocol from the agent, with
Hikvision through the office agent ready on the screens and held back
until the agent reads it, in #301, and the third, the agent reading a
Hikvision terminal named in `agent.json`, released as 0.3.0, in #302.
Phase 5 (a day's scans read first and last, and missions, round 10) is
planned in #270 and #271; its part 2, first and last, is built in #273,
and part 3 in three PRs: Departure to confirm in #274, settling an
incomplete day in #275, and payroll waiting for both in #276; part 4,
missions, is split in four PRs, the first, a mission's day, built in
#281, the second, asking and deciding, in #283, the third, Decide
missions for the companies already there, in #284, and the fourth,
cancelling an approved mission, in #285; part 5, the mission allowance,
is split in four PRs, the first, the allowance's settings in the policy,
built in #286, the second, each mission day priced, in #287, the third,
the allowance paid with salary, in #288, and the last, the allowance
across a closed month, in #289. A template
for the file import
(§13.9) is built in #272.
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

### Round 9 — terminals that connect straight to Nizmo

All thirteen are the owner's: 1, 2 and 9 to 12 on 12 November 2026, 3 to
8, proposed with the plan (#269), on 13 November 2026, when it merged, and
13 on 14 November 2026 (#271).

| # | Topic | Decision |
|---|---|---|
| 1 | How a terminal connects | **Two options, chosen for each terminal: through the office agent, or straight to Nizmo over HTTPS** (§17.1). For terminals that push over HTTPS, this replaces round 1's "direct device push is last". |
| 2 | Protocols | **ZKTeco's and Hikvision's, both ways** (§17.2–§17.4), whatever brand is printed on the terminal (§17.9). |
| 3 | plain HTTP | **Never over the internet.** A terminal that pushes only plain HTTP connects through the agent (§17.1; Phase 4, part 8). |
| 4 | a Hikvision terminal's credential | **A secret in the address it sends to**, shown once, kept hashed, replaced on demand (§17.2). |
| 5 | a ZKTeco terminal's credential | **Its serial number, accepted only from the office's fixed internet address.** An office without one connects its ZKTeco terminals through the agent (§17.3). |
| 6 | one terminal, one count | **A terminal is one record whichever way it connects, and uses one way at a time; a scan is counted once across both** (§17.6). |
| 7 | switched off to start | **Turned on for each company by the Super Admin**, after a week's trial with a real terminal for each protocol (§17.8). |
| 8 | order | **Hikvision straight to Nizmo, then ZKTeco, then the agent reading Hikvision**, unless the terminal on hand for the trial is a ZKTeco, which then goes first (§20, Phase 4). |
| 9 | Brands | **A list kept from the screen, not written into the code**, with Convoy on it from the start beside ZKTeco and Hikvision. A brand is what is printed on a terminal; each speaks one of the protocols Nizmo knows. A brand speaking a known protocol is added from the screen; one speaking another needs that protocol built first (§17.9). |
| 10 | Who keeps the list | **The Super Admin only, one list for every company**, on a Terminal brands page under Templates. A company's Admin picks from it and can't add, change or retire a brand (§17.9). |
| 11 | Who sets terminals up | **A permission of its own, "Set up fingerprint terminals"**, since it decides whose scans count as attendance. Someone who can open the Attendance settings tab but doesn't hold it never sees the Fingerprint terminals section (§17.10). |
| 12 | The company's Admin | **The Super Admin decides, company by company, with a switch only they can change, off to start.** Off: only the Super Admin sets the company's terminals up. On: those holding the permission do, the built-in Admin among them. The permission is high-risk: its changes ask for the step-up code (§17.10). |
| 13 | Built before a terminal can try them | **Parts 4 to 7 are built now, switched off, though no terminal on hand can try them:** the first customer's Convoy can't push and isn't a Hikvision. Each way is tried, and fixed where the real terminal differs from the manuals, when a terminal that uses it is on hand; until then the switch stays off for every company (decision 7; §20, Phase 4). |

### Round 10 — reading a day's scans, and missions

Decisions 1 to 12 are the owner's (12 and 13 November 2026), planned in #270.
Decisions 13 to 21 come from a review of that plan, in #271, and are the
owner's (13 November 2026). Decisions 22 to 27 come from a second review, in
#271 too, and are the owner's (14 November 2026).

| # | Topic | Decision |
|---|---|---|
| 1 | Reading a day's scans | **First and last, the only way.** A day's first scan is the arrival and its last the departure; the scans between are left out, so breaks aren't measured (§6.9). |
| 2 | Missions (مأمورية) | **A request of their own on the Requests page, by days or by hours** (§6.10). |
| 3 | A mission by hours | **Replaced by decision 15** (13 November 2026). It covered any lateness and early leave that day, and needed an arrival and a departure. |
| 4 | Who decides a mission | **The employee asks, for themselves; someone holding "Decide missions" approves.** Never their own (§6.10). |
| 5 | Overtime on a mission | **A mission never adds overtime.** Overtime from the day's own scans is approved as on any day (§6.4, §6.10). |
| 6 | Mission allowance (بدل مأمورية) | **Paid with salary. Each company's policy says what one day is worth, the employee's own day's pay or an amount typed in, and what each kind of mission pays: none, ¼, ½, 1 or 2 days** (§6.10). |
| 7 | In pairs | **Removed, for every company:** one extra scan left the day incomplete, which isn't practical. The attendance recorded so far is test data, so nothing real moves (§6.9). |
| 8 | Scans close together | **Count as one, within a window the policy sets: 5 minutes to start, anything from 1 to 60** (§6.9). |
| 9 | Rest days inside a mission | **A mission by days pays its allowance for every day in it, rest days and holidays included.** For attendance they stay rest days and holidays, and add no overtime (§6.10). |
| 10 | When a mission is asked | **Before or after the day.** A day in a month whose payroll is already approved is handled by decision 16 (§6.10, §12). |
| 11 | On to start | **Missions are on in every policy, new or already saved, until its Admin turns them off** (§6.10). |
| 12 | The allowance to start | **None for both kinds of mission until the Admin sets it**, so turning missions on pays nothing nobody chose (§6.10). |
| 13 | Departure to confirm | **Early leave of more than the policy's threshold, 2 hours to start, isn't charged as it stands: the day waits as Departure to confirm** until HR accepts the early leave or adds the missing scan. Early leave of the threshold or less is charged by the policy as always (§6.9). |
| 14 | Payroll waits | **A month's payroll can't be approved while any day in it is a Departure to confirm or incomplete.** A window lists them, each with a link to settle it (§6.9, §12.1). |
| 15 | Two kinds of mission by hours | **Until the end of the day: one scan is enough, read as the arrival; lateness is charged, early leave isn't. From the start of the day: one scan is enough, read as the departure; early leave is charged, lateness isn't.** The employee picks one. Replaces decision 3 (§6.10). |
| 16 | A mission across a closed month | **Accepted.** Its days in a month whose payroll is approved become discrepancies, settled on the next payslip (§6.10, §12.3). |
| 17 | Reminders on a mission day | **The no-check-in reminder skips a mission by days and a mission from the start of the day; the absent and incomplete notices skip mission days**, as they skip leave (§6.10, §13.4). |
| 18 | A mission's task | **Optional: one of the employee's open tasks, shown to whoever decides the mission**, to make it easier to review. Nothing else links them: check-ins aren't judged by the task's place, and the task's page doesn't change (§6.10). |
| 19 | The allowance and tasks | **Never added to a task's costs or charged to a client** (§6.10, §19). |
| 20 | Deciding a mission | **Beside the request: the day's scans, and the task named or "No task".** No monthly limit (§6.10). |
| 21 | Nizmo's address | **`nizmo.vercel.app` until the second customer, then the owner's own domain.** The old address keeps working beside it, so the first customer's agent needn't change (§18). |
| 22 | Settling an incomplete day | **Besides adding the scan, HR can mark the day absent or accept it as it is, charged nothing, each with a reason,** so payroll never waits on a scan someone has to make up (§6.9, §13.1). |
| 23 | Departure to confirm, and what counts first | **Approved permission hours count first:** early leave they cover never makes the day wait. **A mission until the end of the day never waits,** since its early leave isn't charged. **A mission from the start of the day waits like any day** when its one scan, read as the departure, leaves more than the threshold (§6.9). |
| 24 | Requests still to decide at payroll | **The payroll window also lists the month's requests not yet decided, as a warning:** missions, permission hours, missing scans, and overtime, which approval rejects. Approving anyway is allowed (§6.9, §12.1). |
| 25 | Withdrawing and cancelling a mission | **The employee withdraws a mission while it waits. Once approved, someone holding "Decide missions" can cancel it, with a reason, until that month's payroll is approved;** after, its days there become discrepancies, as in decision 16 (§6.10). |
| 26 | The Exceptions screen | **Incomplete means one scan left after the window, and Departure to confirm gets a tab of its own** (§13.1). |
| 27 | Summer time on terminals | **The terminal's own setting, not Nizmo's.** Whoever installs it sets its clock, summer time included; Nizmo reads the times as the terminal sends them (§19). |

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
   on port 80, which Vercel redirects and the device will not follow. Newer
   models of both brands push over HTTPS, and those may connect straight to
   Nizmo instead (round 9, §17.1).
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

### 6.9 Reading a day's scans (round 10; first and last built in #273, Departure to confirm in #274, settling an incomplete day in #275, payroll waiting for both in #276)

**First and last, the only way** (round 10, decision 1). The day's first
scan is the arrival and its last the departure; the scans between are left
out. A break isn't measured, and scanning twice on arriving changes
nothing. Lateness runs from the shift's start to the first scan, early
leave from the last scan to the shift's end, the time worked from the first
scan to the last, and overtime is the time past the shift's end up to the
last scan. Built in #273, with the window below.

**In pairs is removed** (decision 7). Built in Phase 0 (§11), it took the
first scan with the second and the third with the fourth, so one extra
scan left an odd count and the day incomplete: not practical where people
scan twice to be sure. Every company reads First and last, with no choice
in the policy. The attendance recorded so far is test data, so nothing real
moves.

**Scans close together count as one** (decision 8). Two scans on arriving
and none on leaving would otherwise read as a day from 08:55 to 08:57. A
scan within the policy's window of the one kept before it is dropped from
the reading, though it is still kept and shown on the Punches tab: 5
minutes to start, anything from 1 to 60. A single scan left after that is
an incomplete day, as now: a missing departure is never guessed. Built in
#273: the window is "Scans this close count as one" in the policy's dialog,
and its panel says it. A version saved before it reads as 5 minutes, so
nothing is migrated.

**Departure to confirm** (decision 13). A forgotten last scan would
otherwise read as leaving early: 08:55, 12:00 and 12:40 with nothing at
17:00 is a departure at 12:40. So early leave of more than the policy's
threshold, 2 hours to start, isn't charged as it stands. The day waits as
*Departure to confirm*, and the employee is told the next day, as for an
incomplete day (§13.4). Someone with `attendance.correct` settles it on the
Exceptions screen (§13.1): accepting the early leave, which the policy then
charges, or adding the missing scan, from the employee's report or by hand.
Early leave of the threshold or less is charged by the policy as always.

Built in #274. The threshold is the policy's "Early leave longer than this
waits to be confirmed", in minutes, 120 to start and anything from 1 to
720, and its panel says it; a version saved before it reads as 120, so
nothing is migrated. The day's status is `TO_CONFIRM`, an added value
(§11). While it waits, nothing of the day is charged, its lateness
included, as for an incomplete day. Settling it is a decision on its early
leave, as on the Late / early tab: **Accept**, which the policy then
charges, or **Excuse**, with a reason, which isn't charged; each is
audited, and undoing it from Decided puts the day back to wait. Adding the
departure scan, by hand or by approving the employee's missing-punch
report, measures the day again. The employee's own day says it waits, and
offers reporting the missing scan or asking for permission hours for the
early leave. Payroll waits for it from #276 (below). A month already
approved keeps its days as paid; a recompute there
records a day that would now wait as a discrepancy (§12.3).

**What counts first** (decision 23). Approved permission hours that day
are taken off the early leave before it's measured against the threshold,
so leaving three hours early on three approved hours never waits. On a
mission until the end of the day the day never waits, since its early
leave isn't charged. On a mission from the start of the day, its one scan
is read as the departure, so a forgotten scan out reads as leaving early:
it waits like any other day once that is more than the threshold.

**Settling an incomplete day** (decision 22). Besides adding the missing
scan, or linking the employee's missing-punch request, HR can **mark the
day absent**, which the policy charges as an absence, or **accept it as
it is**, charged nothing. Each needs a reason and is audited, so that
payroll never waits on a scan someone has to make up.

Built in #275. The Punch missing tab on the Exceptions screen offers
**Mark absent** and **Accept as it is** beside Add a punch, each asking a
reason that is kept with the day and audited. Each is a decision on the
day itself, the subject `INCOMPLETE` (§11), and not on its absence: an
absence decided while a day had no scan says nothing about a scan that
arrives later. Marked absent, the day is an absence, charged by the
policy as one, with its one scan shown; it can't be marked on a rest day
or a holiday, where nobody was expected. Accepted as it is, nothing of
the day is charged, its lateness included: on a working day it counts as
present, and on a rest day or a holiday as worked, with no overtime.
Either way the day is no longer incomplete, so it leaves the tab for
Decided, and **Undo** there makes it incomplete again. The person's own
day says which it was, and a recent one marked absent is told to them as
any absence is (§13.4). A scan added afterwards measures the day from its
scans, and the decision stays under Decided, counting for nothing, until
it is undone. Payroll waits for incomplete days from #276 (below).

**Payroll waits for both** (decision 14). While any day in the month is a
Departure to confirm or incomplete, the payroll run can't be approved: its
Approve opens a window listing them, each with its employee, date, scans
and a link to settle it (§12.1). An incomplete day would otherwise be
charged nothing. The same window also lists, as a warning, the month's
requests not yet decided (decision 24): missions, permission hours, missing
scans, and overtime, which approval rejects. They don't stop the approval;
one decided after it follows §12.3, as any change to a closed month does.

Built in #276. Once attendance reaches a month's payroll (§12), approving
it is refused while any day of the month, for someone on the register, is
a Departure to confirm or incomplete; before then attendance charges
nobody, so nothing waits. Payroll's Approve opens the window in place of
the confirmation (`DESIGN.md` §5.5, Dialog): each day waiting, with its
employee, date, what it waits on and its scans, opening the Exceptions
screen on that day and kind, and Close. It lists 50 at most, then says
how many more wait of each kind, each line opening the Exceptions screen
on that kind for the month (review on #276). Once they're settled, Approve
asks as before. Under a
heading of its own, as a warning, the same window counts the month's
requests not yet decided for people on the register: permission hours,
missing punches, and overtime, which approval rejects, each kind opening
the Requests page on it; missions joined them in #283. The server checks
again inside approval's transaction, after the month's last recompute and
before undecided overtime is rejected, so a day whose stored row was out
of date is caught too; refused then, the recompute is kept, nothing else
is written, and the window shows the day. Anyone on the register being
approved who wasn't on the one read before, such as someone put back on
the payroll meanwhile, is checked once that register is built; a day of
theirs waiting undoes the whole approval and is refused the same way
(review on #276). Undone, the recompute that found it goes too, so the
register read again can't show it: the refusal carries the days waiting,
how many of each kind and the first 50, and the window shows those
(review on #276).

**The terminal's in/out key is still not read.** It is often left on the
wrong state, and the order of the scans is surer.

### 6.10 Missions — مأمورية (round 10; a mission's day built in #281, asking and deciding in #283, the companies already there in #284, cancelling in #285)

An employee sent to work away from their desk (a client, another branch,
another city) asks for a mission on the Requests page, so the day isn't
charged as late, early or absent.

| Kind | Asked for | What it does to the day |
|---|---|---|
| **By days** | A first and a last date | Each working day in it is a mission day: never absent, late or early, with no scans needed and no day off used. Scans that arrive on it are kept and shown, and change nothing. |
| **By hours, until the end of the day** | One date | Early leave isn't charged; lateness is. One scan is enough, read as the arrival: the employee may go from the mission straight home (decision 15). |
| **By hours, from the start of the day** | One date | Lateness isn't charged; early leave is. One scan is enough, read as the departure: the employee may go to the mission straight from home (decision 15). |

- **Not from the allowance.** A mission is work, so it never draws on
  permission hours (§6.6). Permission hours already approved for that day
  stay drawn unless they are withdrawn.
- **Overtime** (decision 5). A mission day adds none. On a mission by hours,
  overtime from the day's own scans past the shift's end is counted and
  approved as on any day (§6.4).
- **Who asks and who decides** (decision 4). The employee asks, for
  themselves, as for permission hours. Someone holding
  `attendance.approve_missions`, "Decide missions", at team or company
  scope, approves or rejects it; never their own. The built-in Admin holds
  it.
- **When** (decision 10). Before or after the day. A mission can't
  overlap a day off or another mission. A day of a mission by hours with
  no scan at all stays absent.
- **Across a closed month** (decision 16). A mission is accepted even when
  part of it falls in a month whose payroll is approved. Its days in the
  open month count as usual; those in the closed month become discrepancies
  (§12.3), which HR settles on the next payslip: the deductions refunded
  and the allowance paid.
- **Withdrawing and cancelling** (decision 25). The employee withdraws a
  mission while it waits. Once approved, someone holding "Decide missions"
  can cancel it, with a reason, until the month's payroll is approved; the
  employee is told, and the days count again as they would without it.
  After the month's payroll is approved, cancelling turns its days there
  into discrepancies, the other way round from decision 16: the deductions
  charged and the allowance taken back on the next payslip.
- **Reminders and notices** (decision 17). The no-check-in reminder
  (§13.4) skips a mission by days and a mission from the start of the day,
  when no arrival is due; the absent and incomplete notices skip mission
  days. Both already skip leave.
- **On to start** (decision 11). Missions are on in every policy, new or
  already saved, and its Admin can turn them off. Their allowance starts
  at none for both kinds (decision 12), so nothing is paid until
  the Admin sets it.

**The mission allowance (بدل مأمورية)** is paid with salary (decision 6).
The policy's Missions section sets:

- **What one day is worth:** the employee's own day's pay, at the daily
  rate deductions use on that date (§6.3), or an amount typed in, the same
  for everyone, in the company's currency.
- **What each kind pays:** a mission by days for every day in it, rest
  days and holidays included (decision 9), and a mission by hours once. Each is none, ¼, ½, 1 or 2 days.

For example, with one day worth 200 EGP, missions by days at 1 and missions
by hours at ½, a three-day mission pays 600 EGP and a mission by hours pays
100. A three-day mission from Thursday to Saturday pays for all three
days, though Friday and Saturday stay rest days for attendance and add no
overtime (decision 9).

The allowance reaches the payslip as its own line, "Mission allowance",
written at approval like the other attendance entries (§12.2).

**A mission's task** (decision 18). Asking for a mission, the employee may
name one of their open tasks; a trip to a bank or a government office has
none. It is there for whoever decides the mission, shown beside the
request, and for nothing else: check-ins aren't judged by the task's place,
and the task's page doesn't change. A deleted task leaves its title on the
mission as text.

**Never a task's cost** (decision 19). The allowance is salary. It is never
added to a task's costs or charged to a client (§19).

**Deciding a mission** (decision 20). Beside the request, the approver
sees the day's scans so far, and the task named or "No task". There is no
monthly limit.

**Built in #281: a mission's day.** The first of part 4's four PRs
(§20). Nothing asked for a mission then; #283 does.

- **`MissionRequest`** holds each mission: by days, or by hours with the
  part of the day it covers; its first and last date, one date for a
  mission by hours; the optional task, its title kept as text; the
  reason; and who decided or cancelled it, when and why. Its status is
  its own, `MissionStatus`: waiting, approved, rejected, withdrawn or
  cancelled. The database refuses a mission by hours without its part of
  the day or across two dates, and a last date before the first.
- **The engine reads approved missions**, whatever the policy says about
  asking for them: the policy's switch, in the next PR, stops new ones
  being asked, never one already approved.
- **By days.** Each working day in it is `MISSION`, an added day status:
  never absent, late or early, charged nothing, adding no overtime. Its
  scans are kept, counted and shown, first and last, and change nothing.
  Rest days and holidays inside it stay rest days and holidays, scans or
  not, adding no overtime (decision 9); an unpaid holiday stays unpaid,
  as for everyone else.
- **Until the end of the day.** One scan is the arrival, its lateness
  charged as on any day, and the day is present, not incomplete. Two or
  more are read first and last as on any day, but the early leave isn't
  counted, so the day never waits as a Departure to confirm
  (decision 23). Overtime past the shift's end counts as on any day.
- **From the start of the day.** One scan is the departure: no lateness,
  early leave from it to the shift's end, after approved permission
  hours, waiting as a Departure to confirm past the threshold
  (decision 23), and overtime past the shift's end. Two or more are read
  first and last, without the lateness.
- **What stays.** A working day of a mission by hours with no scan is
  absent. Time worked is only measured between two scans, so one scan
  read as the arrival or the departure measures none. Leave and
  suspension come first: a day on leave stays leave, a suspended day
  suspended. A day with one scan settled on the Exceptions screen
  (§6.9, PR 275) keeps the decision, but it counts for nothing on a
  mission by hours, where one scan is enough.
- **Reminders and notices** (decision 17). The no-check-in reminder skips
  a working day of a mission by days or from the start of the day,
  approved or waiting, as it skips a late arrival asked for; a check-in
  on one approved isn't called late. A mission day, of any kind, sends
  no day notice: neither absent, incomplete, nor a departure to confirm
  (§13.4).
- **On screen.** The Days list shows a mission by days as **Mission**,
  marked good, and a day of a mission by hours says which kind beside
  its status. The day's breakdown keeps which kind of mission it had. A
  day of a mission by days is on none of the Exceptions screen's tabs;
  one of a mission by hours is there as the lateness or early leave its
  kind charges.

**Built in #283: asking and deciding.** Part 4's second PR (§20).

- **Decide missions** (`attendance.approve_missions`), at team or company
  scope, implying `attendance.view_team`, never on one's own. A new
  company's built-in Admin holds it company-wide; the companies already
  there get it from the next PR's migration, once this release's role
  editor knows it (as #278 did). It isn't high-risk, as deciding permission
  hours and overtime isn't. Given in #284, to the built-in Admin alone, as
  for Set up fingerprint terminals: a company's own roles are given it in
  the role editor. An Admin role holding it already, a new company's, is
  left as it is; the others' holders reload their grants once.
- **The policy's Missions switch** (decision 11), on in every version: one
  saved before it reads as on, so nothing is migrated. The policy dialog
  has a Missions section with the switch alone for now (part 5 adds the
  allowance under it), and the policy card says whether they're on. A
  mission is refused while any of its dates falls under a version with
  missions off. Turning them off withdraws nothing: a mission already
  asked is decided as before, and one approved counts.
- **Asking**, on the Requests page's New request, for whoever has
  attendance of their own, as for permission hours, and offered while
  today's policy has missions on. The form asks:
  - which kind: by days, or by hours;
  - by days, its first and last dates; by hours, its date and the part of
    the day, until its end or from its start;
  - the task, optional: one of their open tasks (theirs, Pending or In
    progress), where the company has Tasks; "No task" to start;
  - and why, which it needs, up to 500 characters.
- **What asking refuses**, besides missions off:
  - dates more than a year before today or after it, and a mission by
    days longer than 90 days (a guard: recomputing reaches back a year,
    §11);
  - any of its dates in another mission, or in a day off, waiting or
    approved. Asking for a day off over a mission waiting or approved is
    refused the same way. One person's missions and days off, asked at
    once, wait on each other, so two can't both pass;
  - a task that isn't one of their open tasks.
- **A closed month is no refusal** (decision 16). Asking and deciding take
  the months' locks, as permission hours do, but go ahead in a month
  whose payroll is approved. Once approved, the mission's days are worked
  out again from its first date, and those in a closed month become
  discrepancies (§12.3) for HR to settle on the next payslip. Its own
  months are worked out by name, however far back they now are: a change's
  cascade reaches a year back at most, which a mission asked near that
  edge can pass while it waits (found by Codex on #283).
- **Withdrawing**: the employee, while it waits; it's then Withdrawn.
  Cancelling an approved one is part 4's last PR, #285.
- **Deciding**, under To review, for whoever holds Decide missions at the
  asker (the Super Admin for every company): approve, or reject with a
  reason if there is one. Beside it (decision 20): its kind, dates and
  part of the day; the task, or "No task"; the reason; and the scans so
  far, each of its days up to today that has any, with that day's scans as
  the clock read them, or that there are none yet. They're read for the
  missions on the page shown, every scan of each (found by Codex on #283).
- **Told of the decision**: the employee hears it was approved or not,
  with the reason if there is one. The notice opens the Requests page on
  it.
- **Payroll's window** counts the missions waiting with a day in the
  month, for people on the register, among the month's requests not yet
  decided, opening To review on missions.
- **Live**: the Requests page and the count on Requests in the side bar
  draw themselves again when a mission is asked, decided or withdrawn
  (a migration adds the table to #250's triggers).
- **Audit**: asking, approving, rejecting and withdrawing, each in the log.

**Built in #285: cancelling an approved mission.** Part 4's last PR
(§20, decision 25). No migration: #281's table already keeps who
cancelled a mission, when and why.

- **Who**: whoever holds Decide missions at the asker (the Super Admin
  for every company), as for deciding it, and never one's own.
- **What**: an approved mission alone, with a reason, which it needs, up
  to 500 characters. One waiting is withdrawn or rejected instead; one
  cancelled, rejected or withdrawn already is refused.
- **Where**: To review's Done, where the approved ones are. Its row's
  More actions has Cancel mission, which asks whose mission and which
  dates, says what follows, and takes the reason.
- **What follows**: the mission is Cancelled, and its days are worked out
  again from its first, as after approving it, so they count as they
  would without it. Its days in a month whose payroll is approved aren't
  rewritten: they become discrepancies the other way round from decision
  16, the deductions charged on the next payslip. A discrepancy still
  open from approving it closes instead, the day being back to what was
  paid.
- **Its dates are free again**: another mission or a day off can be
  asked for them.
- **Told of it**: the employee hears it was cancelled, with the reason.
  The notice opens the Requests page on it.
- **On the page**: it's Cancelled, in the problem badge's colours, as a
  phone revoked is, since it isn't the asker's doing; under Mine and To
  review's Done, with when it was cancelled and why.
- **Live and audit**: the page draws itself again, as for a decision;
  cancelling is in the log.

**Built in #286: the allowance's settings.** The first of part 5's four
PRs (§20, decisions 6 and 12). Nothing is priced or paid yet: the next PR
prices each mission day.

- **In the policy**, under Missions, beside the switch: what a mission by
  days pays for each of its days, and what a mission by hours pays, each
  nothing, ¼ day, ½ day, 1 day or 2 days; and what one day is worth, the
  employee's own day's pay or an amount typed in, asked once either kind
  pays something.
- **To start**, both kinds pay nothing (decision 12), in every policy, new
  or already saved, and in the templates: a version saved before it reads
  as nothing, so nothing is migrated.
- **The amount** is in the company's currency, the same for everyone, from
  0.01 to 100,000. It's needed when one day is worth an amount and either
  kind pays something, said under its field.
- **Each version has its own**, as with every rule: a change counts from
  its version's date, and each mission day will be priced by the version in
  force on it.
- **While missions can't be asked for**, the settings stay: a mission
  approved before still counts, and will pay.
- **On the policy's card**, the Missions lines say what each kind pays and
  what one day is worth.
- **Audit**: saved with the policy, as its other rules are.

**Built in #287: each mission day priced.** The second of part 5's four
PRs (§20). Priced and shown, not yet paid: the next PR writes it to the
payslip.

- **Which days**: the allowance follows the approved mission, not the
  day's scans. A mission by days pays for every date in it, rest days and
  holidays included (decision 9); a mission by hours pays once, on its
  date. Not a date the employee is on leave or suspended, which come
  before a mission as they do when a day is read. A mission that didn't
  happen is cancelled (decision 25), which takes its allowance back.
- **How much**: the days its kind pays, times what one day is worth, both
  by the policy in force on that date. One day is the amount typed in, or
  the employee's own day's pay: their monthly salary in force that date
  over the month's days, as a deduction is priced (§6.3). Each day is
  rounded to the piastre on its own. With no salary on a date, one day
  worth the employee's own pays nothing that day.
- **Kept on the day**, `AttendanceDay.missionAllowanceMinor`, beside its
  deduction and overtime, and worked out again whenever the day is: a
  mission approved or cancelled, the policy changed, a salary changed.
  The migration only adds the column, and a day with no allowance keeps
  the hash it had, so no day is written again for the column alone.
- **Shown** on Attendance's Days list and on the employee's own days, on
  the day and in the month's totals, to whoever may see that person's
  pay, as a deduction is. Anyone else is sent no allowance, there or on
  Exceptions: where one day is worth the employee's own pay, it would
  give their salary away.
- **Not yet paid**: the next PR writes it at approval as its own entry,
  on the payslip's Mission allowance line. Until it does, approving a
  month's payroll freezes its days with no allowance, since no payslip
  carried one: what a frozen day holds is what was paid, so nothing reads
  as paid that wasn't. A month whose payroll is approved keeps its days
  as paid; the allowance across it is the PR after.

**Built in #288: paid with salary.** The third of part 5's four PRs
(§20).

- **On the payslip**: from the month a company's attendance reaches its
  payroll (§12), each person's allowance for the month is an earning on
  their payslip, "Mission allowance", after Overtime. It is the sum of
  their days' allowances as priced in #287, never worked out again at a
  month-end rate.
- **Written at approval** as its own attendance entry, category
  `MISSION_ALLOWANCE`, reconciled like the others (§12.2): approving
  again never pays it twice, and one that no longer applies is removed.
  The migration only adds the category.
- **Frozen as paid**: a month's days are frozen with the allowance their
  payslips carried, where #287 froze them with none. What a frozen day
  holds is what was paid, so a day whose allowance no payslip carried is
  frozen with none: every day of a month approved before attendance
  reaches payroll, and the days of someone left out of the run (review
  on #288).
- **Before attendance reaches payroll**, the dry run says what the
  allowance would add, with what attendance would deduct, and pays
  nobody: a company pays the allowance by using attendance in payroll.
  Once such a month is approved, its days say nothing of an allowance.
- **Someone left out of the run** is paid no allowance, as nothing else
  of their month is paid.
- **Not in it**: a mission approved or cancelled after the month's
  payroll is approved. Its allowance across the closed month is the PR
  after.

**Built in #289: across a closed month.** The last of part 5's four PRs
(§20, decisions 16 and 25).

- **A difference carries the allowance** (§12.3): where a day of a month
  whose payroll is approved would now pay a different allowance than its
  payslip carried, the day is listed under Attendance changed after
  payroll, and what is owed counts the allowance with the deduction and
  the overtime. A mission approved after the month was paid is owed its
  allowance. A paid mission cancelled owes it back, for its rest days
  and holidays too, where nothing else of the day changes.
- **Paid stays as paid**: the month's days, entries and payslips are not
  rewritten. Whoever prepares payroll settles the difference with an
  adjustment in the current month and marks it resolved, as any other.
- **Measured from what was paid, or last settled**: a day that comes back
  to it closes its difference, and one that changes again after being
  settled opens a new one from there.
- **Only for those the run paid**: someone left out of the run, or with
  no payslip in it, was paid no allowance by it, and theirs is not
  compared: being left out is not a change. And only for a month whose
  payslips carried attendance, as with every difference.
- **A month approved between #287 and #288** was frozen with no
  allowance, so what its missions pay shows as owed the next time the
  month is worked out.
- **On the row**, under the day's change of status: "Mission allowance:
  200.00 more than paid", or less than paid, where the allowance is part
  of the difference.
- **The migration only adds two columns** to a difference: what the
  allowance was paid at, and what it is now. They are empty on a
  difference recorded before them, whose paid allowance is read from the
  day.

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
  scanReading, missions                                       Json   // round 10, planned: the window and the threshold (§6.9), missions (§6.10)
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

model MissionRequest          // مأمورية, round 10, the table built in #281 (§6.10)
  userId, kind DAYS | HOURS, startDate, endDate   // one date for HOURS
  hoursPart FROM_START | TO_END?                  // HOURS only (decision 15)
  taskId?, taskTitle?                             // optional (decision 18); the title kept as text
  reason, status, reviewedById?, reviewedAt?, rejectionReason?
                              // status MissionStatus: PENDING | APPROVED | REJECTED | WITHDRAWN | CANCELLED
  cancelledById?, cancelledAt?, cancelReason?     // an approved mission cancelled (decision 25)
  updatedAt
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

// Round 9 adds to AttendanceDevice (§17.1–§17.6), defaults keeping what exists:
//   protocol         ZKTECO | HIKVISION      default ZKTECO: what Nizmo and the agent speak to it
//   brandId          String?                 the brand printed on it (§17.9); unset until picked
//   connection       AGENT | DIRECT          default AGENT
//   pushSecretHash   String? @unique         Hikvision straight to Nizmo (§17.2)
//   allowedAddresses String[]                ZKTeco straight to Nizmo, required there (§17.3)
//   pushCursor       String?                 ZKTeco's ATTLOGStamp (§17.3)
//   lastAddress      String?                 where its last request came from
//   refusedCount, lastRefusedAt?, lastRefusal?   §17.5
//   addedById        String?                 who added it by hand
// lastSeenAt, already there, is its last contact of any kind, scans or not.
// On Company: terminalsDirectAllowed Boolean, the Super Admin's switch (§17.8).
// On Company: terminalsSetupByCompany Boolean, default false: the Super Admin's
//   switch letting the company set its own terminals up (§17.10).
// model TerminalBrand: the Super Admin's list of brands (§17.9)
//   id, name (unique, case aside), protocol ZKTECO | HIKVISION,
//   notesEn?, notesAr? (where its settings are in its menu),
//   createdById, createdAt, updatedAt, retiredAt?
// model TerminalFirstContact: deviceId, receivedAt, method, path (the
//   route's pattern, never the secret), headers Json (the ones Nizmo knows),
//   otherHeaders String[] (every other header, by name alone), body (names,
//   card numbers, pictures and templates taken out), kind (its events'
//   types), outcome String[] (what Nizmo made of it); the first 50 for each
//   terminal straight to Nizmo, 5 of a kind, deleted after 7 days by the
//   nightly job (§17.8).
// On AttendanceDevice: firstContactAt DateTime?, when the first request
//   was taken from it: first contacts are kept for 7 days from then.
// On AttendancePunch: a partial unique index over (companyId, sourceKey)
//   where source is AGENT or DEVICE_PUSH, so a scan is counted once whichever
//   way it came (§17.6).

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
  reviewedAt?, reviewReason?  // a flagged check-in decided, and why it was rejected: the Requests page's Done order and outcome (UI_PLAN.md §2.3, #135)

model AttendanceDay
  companyId, userId, date
  scheduleVersionId?, overrideId?, policyId   // the exact, immutable inputs
  deductionMinor, overtimeMinor              // money, at that day's rate (§6.3)
  missionAllowanceMinor                      // the mission allowance for the day (§6.10, #287)
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
- **Where they're decided:** under To review on the one Requests page,
  waiting and decided, with Approve, Reject and Revoke (`UI_PLAN.md` §2.3,
  part 4b, #134); the Attendance page points there, and a new phone's
  notice opens it there (part 4d, #136). A person's own phone stays on the
  Attendance page.
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
  this makes them traceable. The time is the one the photos opened at, on the
  viewer's own clock and in the page's digits (`DESIGN.md` §5.5, Face photos;
  PR 216).
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
check, the reviewer also sees the one captured frame (§13.8). They're decided
on the one Requests page, under To review, with the map of where the phone
was and the face photos (`UI_PLAN.md` §2.3, part 4c, #135); the Attendance
page points there (part 4d, #136).

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
margin either side for early arrivals and overruns. **Scans close together**
count as one: a scan within the policy's window of the one kept before it is
left out (§6.9, 5 minutes to start). **First and last** (round 10, built in
#273): the day's first scan is the arrival and its last the departure, for
every company. A single scan left is `INCOMPLETE`; a missing punch is never
guessed. Before #273, scans were paired in sequence, first with second and
third with fourth, after a fixed 60-second debounce, so an odd count left
the day incomplete.

**Excusing** — approved permission hours are subtracted from late and
early-leave minutes before pricing, and recorded as `excusedMinutes`. An approved mission by hours (round 10, built in #281, §6.10)
leaves the day's early leave or its lateness uncounted, as its kind says,
and a mission by days makes each working day in it a mission day,
`MISSION`. A day whose
early leave passes the policy's threshold waits as `TO_CONFIRM` (§6.9,
built in #274), and is charged nothing until it is settled. An incomplete
day is settled by a decision on the day (§6.9, built in #275): the added
subject `INCOMPLETE` of `AttendanceDayDecision`, marked absent when
`ACCEPTED`, accepted as it is, charged nothing, when `EXCUSED`.

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
- **Before it** (round 10, built in #276, §6.9): once attendance reaches the
  month's payroll, approval is refused while any day in the month, for
  someone on the register, is `INCOMPLETE` or `TO_CONFIRM`, and the screen
  lists them. It also lists the month's requests not yet decided, as a
  warning that doesn't stop the approval (decision 24).
- **Inside approval's transaction, in order:** take the lock → resolve pending
  overtime in the month as rejected → run the final recompute of the month's
  attendance → write the attendance payroll entries (§12.2) → compute and save the
  payslips → stamp every `AttendanceDay` with `lockedByPayrollRunId` → set the run
  `APPROVED`. One commit; either all of it happened or none of it did.
  From #276, once attendance reaches the month's payroll, the days are
  checked again right after the first recompute and before pending
  overtime is rejected: a day still waiting refuses the approval, the
  recompute kept and nothing else written. Anyone on the register being
  approved who wasn't checked then is checked once it's built, and a day
  of theirs waiting undoes it all.
- **After it:** anything that takes the lock and finds the month locked records a
  discrepancy instead of writing (below).

This changes the existing approve flow — computing inside the transaction rather
than before it — and needs its own tests for the race, not only for the result.

### 12.2 Attendance entries are reconciled, never appended

Attendance is recomputed many times before approval; the existing adjustment path
increments `SalaryRecord` and appends a row on every call, which would duplicate
deductions. So attendance does **not** write adjustments as it goes. Instead:

- Each entry has a **stable identity**: `(userId, year, month, source = ATTENDANCE,
  category)`, where category is lateness, early leave, absence or overtime, and with
  round 10 the mission allowance (§6.10) — enforced by a unique index.
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
| Incomplete | Odd punch count. Under First and last (built in #273): one scan left after the window (§6.9) | Add punch, link a missing-punch request; mark absent or accept as it is, each with a reason (decision 22, built in #275) |
| Departure to confirm (built in #274) | Early leave of more than the policy's threshold (§6.9) | Add the departure scan; accept the early leave, or excuse it with a reason, as on Late / early. The employee's missing-punch report adds the scan once approved (decisions 13, 26) |
| Overtime | Unapproved overtime | Approve, approve partially, reject |
| Requests | Pending permission-hour, missing-punch, device and face-enrolment requests | Approve, reject |
| Unmatched | Terminal punches with no mapped employee | Map (backfills) |
| Flagged | Check-ins that failed integrity, IP, or face checks | Accept, reject |

Every action is audited.

The Exceptions, Days and Punches tabs, and the Super Admin's integrity
view (§13.7), draw themselves again as check-ins come in, for whoever may
see other people's attendance, at most every 30 seconds while they keep
coming (`REALTIME_PLAN.md` part 4c, #265).

### 13.2 Device health on System Health

Terminals and agents join the `JobHeartbeat` cards: last seen, last sync, clock
drift, queue depth, agent version; stale during working hours turns red. The same
data, filtered to one company, appears on that company's Devices tab.

### 13.3 The employee's own attendance

Each day: status, punches, late minutes, excused minutes, deduction, overtime,
and the rule that produced the deduction in the same words the payslip will use.
The month so far: permission hours remaining, lates against the free allowance,
deductions to date. Request permission hours or report a missing punch from the
day itself, and, with round 10, ask for a mission (§6.10).

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
- Sent when: a day becomes `INCOMPLETE` or `ABSENT`, or with round 10
  `TO_CONFIRM` (built in #274), though not on a mission day (§6.10, built in #281); a check-in is flagged; a
  request is approved or rejected; **no check-in has arrived N minutes after the
  shift starts** (reminder, adopted in round 4 — N configurable in the policy,
  suggest 15), though not on a mission by days or from the start of the
  day (§6.10, built in #281).

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

### 13.9 A template for the file import (built in #272)

The owner, 14 November 2026. The Import tab takes the file a terminal
exports, but a company without one has nothing to start a file from.

- **Download template**, a quiet button on the Import tab under Choose a
  file (`DESIGN.md` §5.5, Files), gives an Excel file (.xlsx) in the
  language the page is in. The plan said Download a template; the build
  took the label the task upload's template already has, so the same thing
  is called the same everywhere.
- **Its first sheet, Punches, holds only the headings,** in row 1:
  Employee number, Date and Time (رقم الموظف، التاريخ، الوقت). The import
  reads the first sheet that has anything on it, and knows these headings
  in either language.
- **No In / out column.** Nizmo doesn't read the in/out key (§6.9). A file
  that has one still imports as it does now.
- **Its second sheet, How to fill it,** says what each column takes, with
  example rows:
  - the employee number set on Attendance, Employee numbers;
  - the date, day first (25/11/2026), or an Excel date;
  - the time, 08:55, 17:05 or 5:05 PM.
- **The examples stay off the first sheet,** so a template sent back
  unchanged imports nothing, never made-up punches.
- **All three columns are text cells,** so what is typed is what the
  import reads: an employee number starting with 0 keeps it, and Excel
  never turns 03/11/2026 into 11 March by the computer's own date order,
  or a time into a fraction of a day. The import then reads the date in
  the order the Import tab is set to, day first unless changed. The plan
  had the Date column showing day, month, year; the build made it text
  for the same reason as the employee number.
- **Both sheets read right to left in Arabic.**
- **The same people as the import can download it.** The file holds no
  company data. The server builds it on request with the library the import
  already reads files with, from the import's own headings. A test reads
  each language's template back through the import and finds its three
  columns.

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
| **Attendance — Terminals** | Fingerprint terminals, through the Local Sync Agent or straight to Nizmo (§17). |
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

### 17.1 Two ways a terminal connects (round 9)

Each terminal is set to one of two connections. The company's Admin picks it
when the terminal is added, and can change it later:

| Connection | How its scans reach Nizmo | Suits |
|---|---|---|
| **Through the office agent** | The Local Sync Agent, on a PC on the office network, reads the terminal and sends its scans over HTTPS (above). Built for ZKTeco; Hikvision is added in §17.4. | Any terminal, older ones included. Needs a PC that stays on. |
| **Straight to Nizmo** | The terminal sends each scan to Nizmo's address itself, over HTTPS, through the office's internet connection. No PC. | Newer models that push over HTTPS: ZKTeco's cloud server setting with HTTPS on (§17.3), Hikvision's HTTP listening with HTTPS (§17.2). |

Whichever way a terminal connects:

- **HTTPS only over the internet.** A terminal that pushes only plain HTTP
  connects through the agent (§20, Phase 4, part 8), never straight. Vercel
  redirects plain HTTP, and terminals don't follow redirects, so this is also
  simply what works.
- **Nizmo never reaches into the office.** A terminal straight to Nizmo
  connects out, as the agent does: no port is opened on the office's router,
  and Nizmo never polls a terminal over the internet (§19).
- **Company from the credential, never the body** (§2): the agent's token, a
  Hikvision terminal's secret address (§17.2), or a ZKTeco terminal's serial
  number from the office's address (§17.3).
- **Scans only** (§17.5). No fingerprint templates, faces, pictures or user
  lists are asked for or kept.
- **The same scan, the same punch.** Mapping employee numbers, the terminal's
  entrance or exit mode, the engine, health alerts and payroll treat a scan
  the same whichever way it came.

### 17.2 Straight to Nizmo: Hikvision

A Hikvision access or attendance terminal sends its events to an "HTTP
listening" server set on the terminal, in its web page or with
`PUT /ISAPI/Event/notification/httpHosts`: host, port, HTTP or HTTPS, and a
URL path, all chosen by whoever sets it up. `POST …/httpHosts/<id>/test`
checks the setting from the terminal's side.

- **Its credential is a secret in the address it sends to.** When an Admin
  adds a Hikvision terminal straight to Nizmo, Nizmo makes a random secret
  (32 bytes) and shows, once, what to set on the terminal: Nizmo's host, port
  443, HTTPS, and the path `/api/terminals/hikvision/<secret>`. Only the
  secret's sha256 is kept, as for the agent's token. **Issue a new address**
  replaces it: the old one stops working at once, and the terminal is set to
  the new one. Over HTTPS the path is encrypted on its way; it does appear in
  Vercel's request logs, which only the project's owners can read, the same
  people who hold the database.
- **What counts as a scan:** an `AccessControllerEvent` with major type 5
  (an event), a minor type for an identity check that passed (fingerprint,
  face, card, or more than one), and an employee number
  (`employeeNoString`). Failed attempts, door events, alarms and heartbeats
  are answered and dropped. Which minor types each model sends is checked on
  a real terminal (§17.8, §18).
- **Bodies come in three shapes:** a multipart form with the event's JSON in
  one part (usually `event_log`) and pictures in others; JSON alone; or the
  older XML `EventNotificationAlert`. Pictures are dropped unread (§17.5).
- **Answered with an empty 200.** A terminal sends an event again until it
  hears 200, so everything is answered once stored or knowingly refused
  (§17.5).
- **Health:** every request, scans or not, is a contact: the terminal's last
  contact and the address it came from.

**Built in #291: the address a terminal sends to**,
`POST /api/terminals/hikvision/<secret>`. Nothing gives a terminal a secret
yet (Add a terminal does, §20, part 5), and the company's switch is off
(§17.8), so it answers nobody until those are built.

- **Whose request it is:** the secret is 32 random bytes, in the address;
  only its sha256 is kept. One that isn't a secret's shape is answered 404
  without a look at the database. One that is, and is nobody's, is 404 and
  counted against the address it came from: past 30 in 15 minutes, 429. A
  guess costs one indexed read either way, and 2^256 secrets can't be
  searched; the count is for a scanner or a terminal set to an old address
  hammering away.
- **Held, not dropped,** while Nizmo can't take a scan: 503 during
  maintenance, as for the agent; 403 while the company is suspended, its
  package has no Terminals add-on, or its straight-to-Nizmo switch is off;
  429 past 600 requests a minute from one terminal. A terminal sends an
  event again until it hears 200, so these are sent again later. An
  unexpected failure is a 500, recorded with the address's secret taken
  out, and sent again too.
- **Everything else is answered with an empty 200** (§17.5), and the
  request is the terminal's contact: when, and from which address.
- **A scan** is an `AccessControllerEvent` of major type 5 with an employee
  number and a minor type for an identity check that passed. The list is
  Hikvision's own, from its SDK's header: card (0x01), card and password
  (0x02), fingerprint (0x26), card and fingerprint (0x28), card, fingerprint
  and password (0x2b), fingerprint and password (0x2e), face and
  fingerprint (0x36), face and password (0x39), face and card (0x3c), face,
  password and fingerprint (0x3f), face, card and fingerprint (0x42),
  employee number and fingerprint (0x45), with password too (0x48), face
  (0x4b), employee number and face (0x4d), employee number and password
  (0x65), person and ID card (0x69). Its time is the first 19 characters of
  the event's `dateTime`, the terminal's wall clock; its offset isn't read
  (§17.5). It goes through the same steps as any terminal's own scan
  (§17.6).
- **Not a scan, and dropped:** heartbeats, alarms, door and button events,
  failed and timed-out checks, and anything with no employee number.
- **Counted on the terminal as refused, with the reason** (§17.5), so that
  nothing a real terminal sends is lost without a trace: an event with an
  employee number whose minor type is on neither list
  (`EVENT_NOT_KNOWN:<minor>`: a model that names a passed check otherwise
  shows up here in the trial, §17.8), an employee number longer than 32
  characters (`INVALID_NUMBER`), and a body that can't be read
  (`UNREADABLE`). They are answered 200: sent again, they would only come
  the same, and a terminal waits behind what isn't answered.
- **The three shapes** (above) are read: a multipart form, whose text parts
  are tried and whose pictures are never opened; JSON alone; and XML.
- **The secret stays out of what is kept:** the audit log's entry for a
  failure names the route as `/api/terminals/hikvision/[secret]`, and
  anything sent to the error tracker has the secret taken out of every
  address in it.
- **Since then:** what a scan keeps of its event (`rawPayload`) and the
  terminal's own time zone on its card came in #293 (§17.5), and first
  contacts kept in #294 (§17.8).

### 17.3 Straight to Nizmo: ZKTeco

Newer ZKTeco terminals push with ZKTeco's ADMS protocol to the cloud server
set on the terminal, under **Comm.**, **Cloud Server Setting**: server address,
port, **Enable domain name**, and on newer firmware **HTTPS**. The terminal
then calls fixed paths under `/iclock/`:

- `GET /iclock/cdata?SN=…&options=all`: its first contact, and again after
  each restart. Nizmo answers with the terminal's options, among them what to
  send (`TransFlag`: attendance records only) and where it had got to
  (`ATTLOGStamp`, kept on the terminal's record).
- `POST /iclock/cdata?SN=…&table=ATTLOG&Stamp=…`: scans, one a line,
  tab-separated: employee number, wall-clock time, status, how the person was
  identified, work code. Answered `OK: <count>`. Anything else (`OPERLOG`,
  `USERINFO`, fingerprint templates, photos) is answered `OK` and dropped
  unread.
- `GET /iclock/getrequest?SN=…`: the terminal asking for commands, every few
  seconds to a minute. Nizmo answers `OK`: there are none (§19). It is the
  terminal's heartbeat, and says what the terminal reports of itself
  (firmware, how many users and records it holds), shown on its card.

These paths are at the root of Nizmo's address, not under `/api`. The proxy's
matcher (`proxy.ts`) leaves `/api` alone and must leave `/iclock` alone too,
or the terminal is sent to the sign-in page and never follows.

**ADMS knows a terminal by its serial number alone.** Nothing secret travels
with it that this plan can rely on: the comm key protects the terminal's own
port on the office network, and whether any firmware sends something derived
from it over ADMS is unknown (§18). The serial number is printed on the
terminal and shown in its menu, so anyone who reads it could send Nizmo scans
in that terminal's name, for any employee number, from anywhere. For
attendance, that is the threat that matters: someone checking colleagues in
from home.

So a ZKTeco terminal straight to Nizmo is **accepted only from the office's
internet address**:

- The Admin enters the office's fixed public address when adding the
  terminal: one or more, or ranges, as `WorkLocation.officeIpRanges` takes
  them (§9.4). An Admin in the office is offered the address they are
  connecting from.
- The address must be the office's own, not only fixed. Some providers,
  4G routers especially, share one public address among many customers,
  and any of them would pass. An office on a shared address connects its
  ZKTeco terminals through the agent.
- The address is read from Vercel's own header, `x-vercel-forwarded-for`,
  which a caller can't set and `getClientIp()` (`lib/api-utils.ts`) already
  prefers. A request without it is refused: the check fails closed.
- A request from any other address is refused, not answered `OK`, and
  counted on the terminal's card with the address it came from. A real
  terminal whose office address changed keeps its scans and sends them again
  once the Admin enters the new address: none is lost.
- Only serial numbers an Admin has added as straight to Nizmo are answered.
  An unknown one is refused, never brought in on its first call, unlike a
  terminal an enrolled agent reports.
- An office without a fixed address connects its ZKTeco terminals through
  the agent. If the trial (§17.8) finds firmware that proves itself with a
  secret, this is looked at again for those models.

**Built in #296: the addresses a ZKTeco terminal calls**, everything under
`/iclock/` at the root of Nizmo's address (part 6's first PR, §20). Nothing
lets a ZKTeco terminal be added straight to Nizmo yet (part 6's second PR
does), and every company's switch is off (§17.8), so they answer nobody
until then. What the build settled:

- **Left alone by the proxy:** its matcher skips `/iclock` as it skips
  `/api`, so a terminal is never sent to the sign-in page.
- **Whose request it is:** the serial number in the request (`SN`) names a
  ZKTeco terminal added straight to Nizmo and not retired, and the request
  comes from one of the addresses kept for it. The caller's address is
  read from `x-vercel-forwarded-for` alone: a request without it is
  refused, and so is a terminal with no address kept.
- **Nothing says whether a serial number is known.** An unknown one, a
  known one called from elsewhere, and a request with no serial number are
  all answered 403 with nothing in it. Each is counted against the address
  it came from: past 30 in 15 minutes, 429.
- **A call from elsewhere is noted on the terminal**, as refused, with the
  address it came from (`ADDRESS_NOT_ALLOWED:<address>`): at most once an
  hour for a terminal, so a terminal that polls every few seconds from an
  office whose address changed doesn't count thousands. Its card then
  says which address to add (the card is part 6's second PR).
- **Held, not dropped,** as for Hikvision (§17.2): 503 during
  maintenance; 403 while the company is suspended, its package has no
  Terminals add-on, or its switch is off; 429 past 600 requests a minute
  from one terminal; 500 when something fails that shouldn't. A terminal
  counts anything but 200 as a failure and tries again.
- **Its first call, `GET /iclock/cdata?SN=…&options=all`,** is answered
  with its options, a line each, as ZKTeco's own document has them (HTTP
  PUSH SDK 2.0.1, §17.11):
  - `GET OPTION FROM: <serial number>`;
  - `Stamp`, and `ATTLOGStamp`, later firmware's name for it: where it
    had got to in its attendance log, 0 for one never heard from, so it
    sends its whole memory (§17.6);
  - `OpStamp`, and `OPERLOGStamp`: where it had got to in its log of
    changes to people, kept so it doesn't offer them again;
  - `ErrorDelay=60`, `Delay=30`, `TransTimes=00:00;14:05`,
    `TransInterval=1` and `Realtime=1`: try again a minute after a
    failure, ask for commands every 30 seconds, and send a scan as it
    happens;
  - `TransFlag=1000000000`: attendance records and nothing else (§17.5).
    The document's own example is `1111000000`, which also sends changes
    to people and photos;
  - `Encrypt=0`, as the document asks;
  - `TimeZone`, the company's offset from UTC now in whole hours
    (`TimeZone=2`), and none for a zone off the hour. The 2.0.1 document
    has no such option; later firmware reads one, and what a terminal
    does with it is the trial's to answer (§18, 5). One that sets its
    clock from the server's time and this option shows the company's
    wall clock, which is how its scans are read (§17.5); one that ignores
    it is as it was. Left out, such a terminal might take the server's
    time as it is, which is UTC. No command is sent (§19).
- **Scans** are a `POST` to `/iclock/cdata` with `table=ATTLOG`, or, from
  firmware as old as the 2.0.1 document, with a `Stamp` and no table. A
  line each: employee number, `YYYY-MM-DD HH:MM:SS`, status, how the
  person was identified, and on later firmware a work code and more,
  separated by tabs. Each goes through the same steps as any terminal's
  own scan (§17.6), keeps its time as sent, its status, how the person
  was identified and its work code (`rawPayload`, §17.5), and is answered
  `OK: <lines>`. The request's `Stamp` is then kept as where the terminal
  had got to.
- **Each log's stamp is moved on by its own upload alone.** The two
  stamps are kept together on the terminal, so an upload writes its own
  log's and leaves the other's as the terminal's record holds it at that
  moment, with the record held while it is written. Were each to write
  both from what it read when it arrived, an attendance upload and a
  people's-log upload at once would undo one another's, and the terminal
  would be told to send again what was already answered (review on
  #296).
- **Counted on the terminal as refused, with the reason** (§17.5): a line
  that can't be read (`UNREADABLE`), an employee number longer than 32
  characters (`INVALID_NUMBER`), and what any terminal's own scan is
  refused for (§17.6). They are answered `OK` all the same.
- **Dropped unread, and answered `OK`:** the log of changes to people
  (`table=OPERLOG`, or an `OpStamp`), which carries names, with its stamp
  kept so it isn't sent again; and any other table or path under
  `/iclock/`, among them `devicecmd`, a command's result, though Nizmo
  sends none.
- **`GET /iclock/getrequest`** is always answered `OK`: there are no
  commands (§19). It is the terminal's heartbeat, and what it says of
  itself in `INFO` is kept on it: its firmware, how many people it holds
  and how many records. Its address on the office network, which `INFO`
  also carries, isn't.
- **Each request is the terminal's contact:** when, and from which
  address.
- **Not in this PR:** Add a terminal for ZKTeco straight to Nizmo with
  the office's address, and its card; Change connection; and first
  contacts kept for a ZKTeco terminal (§17.8). They are part 6's other
  three PRs (§20).

### 17.4 Through the agent: Hikvision

The agent learns Hikvision's ISAPI beside the ZKTeco protocol it speaks:

- A terminal in `agent.json` gets `"protocol": "hikvision"`, a user name and a
  password: a user made on the terminal for the agent, with only the rights
  reading events needs, where the model allows, rather than its admin.
- It reads scans with `POST /ISAPI/AccessControl/AcsEvent?format=json` (major
  type 5, from its cursor, a page at a time), the terminal's identity from
  `/ISAPI/System/deviceInfo` (serial number, model, firmware), and its clock
  from `/ISAPI/System/time`. It signs in with HTTP digest authentication,
  which never sends the password itself.
- Over HTTPS where the terminal offers it, its self-signed certificate pinned
  on the first contact; otherwise over HTTP on the office network, as the
  ZKTeco protocol already is. Plaintext never leaves the building.
- `probe` works as it does for ZKTeco. Clearing a terminal's memory stays
  ZKTeco's until a Hikvision model needs it.
- The agent's queue, cursor and delivery don't change. Nizmo receives
  `AGENT` punches, and knows the terminal's protocol from what the agent
  reports, and its brand from its record (§17.9).

**Built in #300: the agent's Hikvision client** (part 7's first PR,
§20), which nothing in the agent uses yet: `agent.json` names no
Hikvision terminal until part 7's third PR. What the build settled:

- **Signing in:** HTTP digest authentication (RFC 7616), MD5 or SHA-256,
  whichever the terminal asks for, with `qop=auth`. The password itself
  never travels. The terminal's challenge is answered again for each
  request, counted on; one it calls stale, or refuses, is asked for anew
  once, and a second refusal is the wrong user or password.
- **Over HTTPS** where the terminal is set to it. Its certificate is its
  own, signed by nobody, so it isn't checked against a list: its
  fingerprint (SHA-256) is pinned instead. On the first contact the
  client says which it saw, for the agent to keep; after that a terminal
  showing another is refused, since another machine could be answering
  at its address. Otherwise over HTTP, on the office network only, as
  the ZKTeco protocol is.
- **Its identity:** `/ISAPI/System/deviceInfo`, read as XML: its serial
  number, model, firmware, and the name set on it.
- **Its clock:** `/ISAPI/System/time`: its wall time and its offset from
  UTC, which the search below is asked in.
- **Its passed checks:** `POST /ISAPI/AccessControl/AcsEvent?format=json`,
  major type 5, 30 a page, each page asked for by its position until the
  terminal says there are no more. Only passed checks are kept: the same
  minor types Nizmo counts as one when a terminal sends straight to it
  (§17.2), held in step by a test. Each keeps its employee number and
  its wall time; one with no employee number, such as a card issued to
  nobody, is no one's scan and is skipped. The number is read as text,
  or as a number where the text is empty, as Nizmo reads one sent
  straight to it (found by Codex on #300).
- **Where it had got to** is the last event read: its serial number,
  which is the terminal's own order, and its time. The search asks from
  a day before that time, so a clock set back by hours still shows, and
  keeps the events past that serial number. If every event it finds is
  numbered below it, or the one numbered as it isn't the event it was
  (a new log already numbered that far), the terminal's log was cleared
  or restarted: those from the cursor's time on are kept, and Nizmo
  stores each scan once.
- **The first read** asks from a day before its first day too, and keeps
  the scans from that day on by the terminal's wall clock. So a terminal
  whose clock doesn't say its offset from UTC loses none of that day's
  first hours.
- **A long history,** such as a first read from months back or a
  terminal the agent hasn't reached for weeks, is read over several
  rounds: a read takes at most 1,000 pages (30,000 events), and the next
  goes on from where it stopped. One that can't get past where it had
  got to, more events in a day than a read takes, is an error rather
  than a read that never moves. The last three were found by Codex on
  #300.
- **A terminal that doesn't answer** is given up on: each request has
  one deadline, ten seconds unless set, over opening the connection, the
  handshake over HTTPS and the reply. Past it the connection is closed,
  not left open.
- **A terminal that answers otherwise than asked**, with another status
  or a body that isn't what was asked for, is an error saying what, as
  for ZKTeco. Nothing half-read is returned.

**Built in #301: Nizmo takes a terminal's protocol from the agent, and
Hikvision through the agent is ready on the screens, held back until
the agent reads it** (part 7's second PR, §20). What the build settled:

- **The heartbeat says each terminal's protocol,** `ZKTECO` or
  `HIKVISION`, beside its serial number. An agent before part 7's third
  PR says none, and reads ZKTeco's protocol only, so a terminal it reports
  is ZKTeco's.
- **A terminal reported for the first time** gets that protocol and no
  brand, as before (§17.9).
- **A terminal already the agent's** takes the protocol the agent
  reached it with, where that's another than the one recorded: the agent
  reading it shows what it speaks, and the record was wrong. Its brand,
  which speaks the protocol recorded, is cleared, for an Admin to pick
  one speaking the new one. The audit log has the protocol before and
  after, and the brand cleared. One the agent didn't reach this time keeps its
  protocol, since a failed read says nothing of what it speaks; one set
  straight to Nizmo is left alone, as before (#290).
- **Picking a brand holds the terminal's row** (Codex on #301), so a
  heartbeat changing its protocol at that moment is waited for, and a
  brand that no longer speaks it is refused.
- **Held back until the agent reads it** (Codex on #301). The agent
  released today can't read a Hikvision terminal, so offering its way
  now would let a working terminal be moved to an agent that can't read
  it, its address revoked. Hikvision's way through the agent stays not
  built (`CONNECTIONS_BUILT`): Add a terminal lists it, not to be
  picked, Change connection isn't offered for it, the server refuses
  both, and the setup guide says the model can't be read yet, as
  before. Everything below is written and tested, and the third PR,
  with the agent's release, builds the way and so shows it.
- **Add a terminal** will offer a Hikvision terminal both ways: through
  the office agent, and straight to Nizmo where the company may use it
  (§17.8).
- **Change connection** will move a Hikvision terminal between the two,
  as it does a ZKTeco one (#298). Moved to the agent, the dialog says to
  add it to the agent's `agent.json` with the user made on it for the
  agent, and to turn its HTTP Listening off, where ZKTeco's says Cloud
  Server Setting. Moved straight to Nizmo, its new address is shown
  once, as when it's added.
- **The setup guide** will have Hikvision's steps through the agent: at the
  office, a user made on the terminal for the agent, its address with
  HTTPS on, its clock, its HTTP Listening left off, and the PC; then the
  agent, as for ZKTeco, with `agent.json` and `probe` for Hikvision;
  matching numbers to people; and what to do when something goes wrong.
  Where the company may connect it straight to Nizmo, the guide says so
  above the steps, as it does for ZKTeco.
- **What the third PR builds to,** which the guide's steps say:
  - A Hikvision terminal in `agent.json` is `"protocol": "hikvision"`,
    its `"host"`, the `"user"` made on it for the agent and that user's
    `"password"`, as text, and a `"name"` if wanted. It's read over
    HTTPS on port 443, unless it says `"https": false`, which reads it
    over HTTP on port 80, on the office network only; `"port"` sets
    another.
  - `nizmo-agent.exe probe hikvision TERMINAL-ADDRESS AGENT-USER` reads
    one, asking for the password without showing it, and sends nothing.
    A password typed on the command line would stay in its history.
  - The agent's errors for a Hikvision terminal start `HIK_`, as
    ZKTeco's start `ZK_`. The client's codes are renamed in this PR,
    `HIK_AUTH_FAILED` among them, so the guide names what the agent
    will say.

**Built in #302: the agent reads Hikvision** (part 7's third PR, §20).
Its screens stay as they are: Hikvision's way through the agent is
built in the fourth PR, once the package that reads it exists. What
the build settled:

- **`agent.json`** names a Hikvision terminal with `"protocol":
  "hikvision"`, its `"host"`, the `"user"` made on it for the agent and
  that user's `"password"`, in quotes, and a `"name"` if wanted. It's
  read over HTTPS on port 443, or over HTTP on port 80 where it says
  `"https": false`; `"port"` sets another. A terminal that names no
  protocol is ZKTeco's, as every `agent.json` before it is. What's
  missing or the wrong kind is refused when the agent starts, saying
  which terminal and what to set, as for ZKTeco.
- **Each round reads it** with the client built in #300: who it is, its
  clock, and its passed checks from where the agent had got to, kept
  in the agent's state file beside its pinned certificate. They join
  the queue as a ZKTeco terminal's do, and are delivered the same way.
  `sendFrom`, a terminal set straight to Nizmo, another terminal put at
  its address, and one that doesn't answer are handled as for ZKTeco.
- **The heartbeat says each terminal's protocol**, `ZKTECO` or
  `HIKVISION` (#301), with a Hikvision terminal's serial number, model,
  firmware and clock. It says nothing of how full its memory is, and
  the agent never clears it (§17.4).
- **Its certificate** is pinned the first time a round reads it over
  HTTPS, and the log says so with its fingerprint. A terminal showing
  another later is refused (`HIK_CERTIFICATE_CHANGED`), as another
  machine could be answering at its address. If it is the same
  terminal, whose certificate was renewed, as after a reset or a
  firmware update, `nizmo-agent.exe trust TERMINAL-ADDRESS`, with the
  service stopped, reads it, shows its serial number and its new
  fingerprint, and pins that one instead. Over HTTP there's none to pin.
- **`probe hikvision TERMINAL-ADDRESS AGENT-USER`** asks for the user's
  password without showing it as it's typed, then shows the terminal's
  serial number, model, firmware, clock and, over HTTPS, its
  certificate's fingerprint, and sends nothing. `--http` reads one
  whose HTTPS is off; a port can follow the user.
- **The release:** the agent is 0.3.0. Its package is built by the
  Attendance agent workflow, run by hand once this is merged, as
  before (§17).
- **The fourth PR** builds Hikvision's way through the agent, so Add a
  terminal, Change connection and the setup guide offer it (#301), and
  adds to the guide that the agent reads Hikvision from 0.3.0, how to
  check the version installed, and what to do on
  `HIK_CERTIFICATE_CHANGED`.

### 17.5 What a terminal sends, and what Nizmo keeps

- **Kept**, for each scan: the terminal, the employee number and the
  wall-clock time; and, as `rawPayload` (§8.6), its line, or its event's JSON
  without its pictures or the person's name.
- **Never kept:** pictures (a Hikvision face terminal attaches its capture to
  each event, and it is a face photo, §10), fingerprint or face templates,
  user lists and names. A ZKTeco terminal is told to send attendance records
  only (`TransFlag`). A Hikvision terminal's pictures can be turned off on it,
  and the setup card says how. Whatever else arrives is dropped unread.
- **The terminal's wall clock, as for the agent.** A scan's time is the
  terminal's wall clock, read in the company's time zone, so it reads the same
  whichever way it came and has the same `sourceKey` (§17.6). A Hikvision
  event's own offset is kept in `rawPayload` as evidence. If it disagrees with
  the company's time zone, the terminal's card says so, as it does for clock
  drift.
- **Everything is answered**, once the request is known to be the
  terminal's (§17.2, §17.3). A terminal that pushes sends again whatever
  isn't answered, and waits behind it, so nothing is left for it to send
  again. A scan stored, already there, or refused for good (its month's
  payroll approved, the terminal retired, its time more than 60 minutes ahead
  of Nizmo's clock) is answered. Each refusal is counted on the terminal's
  card, with the latest reason. Unlike the agent, a terminal can't hold a scan
  dated ahead and offer it again later; a terminal whose clock runs ahead is
  shown as such, and the scans it sent meanwhile are added by hand if needed.
- **Limits.** Vercel refuses a body over 4.5 MB; a Hikvision event with its
  pictures is well under that, and the setup card says to turn them off
  anyway. Requests are rate limited (`RateLimit`): by terminal once it is
  known, and by address while it isn't, so a wrong secret or serial number
  can't be tried at speed. A terminal sending its whole memory after a switch
  sends it in batches, which the limit allows for.

**Built in #293: what a scan keeps of its event**, for a Hikvision
terminal straight to Nizmo (part 5's third PR, §20). What the build
settled:

- **A scan keeps the fields of its event that Nizmo knows**, as
  `rawPayload` on its punch: when and what kind of event it was, the
  terminal's own name and its address on the office network, the event's
  number in the terminal's log, the employee number, how the person was
  identified, which reader and door, and the attendance status picked on
  the terminal (in, out, a break). Each is a short text, a number or a
  yes or no.
- **Kept by name, not left out by name.** Only the fields listed are
  kept, so one this plan didn't foresee can't carry a name, a card number
  or a picture in: the person's name, the card's number, pictures,
  whether they wore a mask, and anything nested are never kept. This is
  stricter than "the event without its pictures or the person's name"
  above, on purpose: what a punch keeps, it keeps for good. What a real
  terminal sends beyond these is seen in its first contacts (§17.8), kept
  for 7 days.
- **Only a new punch keeps it.** A scan already there, from the agent or
  sent before, stays as it is.
- **The terminal's own offset from UTC** is read from each scan's
  `dateTime` and kept on the terminal (`utcOffsetMinutes`), with the
  event's `dateTime` whole in `rawPayload`. A scan's time is still the
  terminal's wall clock (above): the offset changes nothing about when a
  scan counts.
- **Its card says when that isn't the company's time zone**, beside
  Clock off: "Time zone UTC+08:00, not the company's". It is compared
  with the company's zone as it is now, so a terminal that doesn't follow
  the company's summer time shows it while it differs. It is something to
  check on the terminal, since its wall clock is what counts.
- **The migration only adds:** `rawPayload` on a punch, empty for every
  punch there is, and `utcOffsetMinutes` on a terminal, empty until it
  sends a scan.

### 17.6 One terminal, whichever way its scans come

- A terminal is one `AttendanceDevice`, known by its serial number, whichever
  connection it uses. Changing its connection keeps its history, its mode
  and the employee numbers mapped to people.
- It uses one connection at a time. The agent skips a terminal set straight
  to Nizmo (the heartbeat's answer tells it), and a push from a terminal set
  to the agent is refused.
- **A scan is counted once across both.** Punches are unique by
  `(companyId, source, sourceKey)`, and the two ways have different sources
  (`AGENT`, `DEVICE_PUSH`) with the same `sourceKey`. A ZKTeco terminal moved
  from the agent to Nizmo sends its whole memory on its first contact, so
  each scan the agent already delivered would arrive again under the other
  source and count twice. A partial unique index over
  `(companyId, sourceKey)`, for those two sources, stops it. Production holds
  no terminal punches yet (checked 12 November 2026: 23 punches, all from the
  app), so the index can't fail there.
- Scans from before the company started with terminals are skipped, as the
  agent's `sendFrom` skips them.

**Built in #290**, with no screen and no route for a terminal yet (parts 5
and 6 add those, §20):

- **The connection is on the terminal**: `AttendanceDevice.connection`,
  through the agent or straight to Nizmo, through the agent for every
  terminal there is. With it, the columns a terminal straight to Nizmo
  needs (§8.6): its secret's hash, the addresses it may call from, where
  it had got to, the address of its last request, what was refused, and
  who added it. And the Super Admin's switch on the company,
  `terminalsDirectAllowed`, off (§17.8). The migration only adds.
- **A scan is stored once across both ways**: the index over
  `(companyId, sourceKey)` for the two sources. Production held no
  terminal punch when it was added (15 November 2026: 23 punches, all
  from the app, and no terminal).
- **One way in for both**: the agent's punches and a terminal's own go
  through the same steps, in the same order: the employee numbers, the
  month's lock, a punch already there under either source, the direction
  from the terminal's mode, and the days worked out again. The Punches
  list names the terminal a scan came from, whichever way it came.
- **A scan already there is already there**, whatever has happened to its
  month since. Only a new one in a month whose payroll is approved is
  refused. Before, an agent sending a stored scan of a paid month again
  was told the month was locked. For a terminal sending its whole memory
  after a switch, that would have counted every scan Nizmo holds as
  refused on its card.
- **One connection at a time**: a terminal's own scans are refused while
  it is set to the agent, while the company's switch is off, or once it
  is retired. The agent's for a terminal set straight to Nizmo are still
  taken, each stored once: what the agent read before it heard of the
  change isn't lost.
- **The agent leaves such a terminal's log alone**: the heartbeat answers
  `DIRECT` for it and takes none of what the agent says of it. The agent
  sends what it already holds, then reads no more of the terminal's log
  and never clears it. It still asks the terminal which one it is and
  names it in each heartbeat: so it hears when the terminal is set back to
  the agent, and reads on from where it stopped; and another terminal put
  at the same address is read. An agent from before this goes on reading
  it: each scan is still stored once, and it never clears a terminal that
  isn't `ACTIVE`.
- **A terminal's own scans**: one from before the company's first
  terminal's month is skipped, as the agent's `sendFrom` skips it. One
  refused is counted on the terminal with its reason (§17.5): its month's
  payroll approved, the terminal retired, a time no calendar has, or one
  more than 60 minutes ahead. Unlike the agent's, none waits to be sent
  again.

### 17.7 Setting a terminal up

On **Fingerprint terminals**, in the Attendance tab of the company's options
(the Company Options page, §5, titled "Company settings" on screen), behind
its own permission and the company's switch (§17.10) and the **Attendance —
Terminals** add-on (§16):

- **Add a terminal** asks for its name, brand (from the Super Admin's list,
  §17.9), serial number, mode (entrance, exit or either, above), and how it
  connects: **Through the office agent** or **Straight to Nizmo**. The brand
  decides the protocol, and so which steps the setup card shows; its own notes
  come above them.
  - Through the agent: it shows under the agent once the agent reports it, as
    today.
  - Straight to Nizmo, Hikvision: what to set on the terminal, the secret
    path shown once with Copy, and how to turn its pictures off.
  - Straight to Nizmo, ZKTeco: what to set on the terminal (server address,
    port 443, Enable domain name on, HTTPS on), and the office's internet
    address, required.
- A terminal straight to Nizmo shows **Waiting for its first contact** until
  it calls, then its status, last contact, the address it calls from, and
  what was refused.
- A terminal's menu gains **Change connection** and, for Hikvision straight to
  Nizmo, **Issue a new address**. Retiring is as today.
- The Super Admin's terminals list on System health (#177) shows each
  terminal's connection.
- The screens' design comes first in `DESIGN.md`, in its own commit, with the
  part that builds them; their words come in both languages.

**Built in #282: the setup guide**, as the product owner asked on
14 November 2026, ahead of Add a terminal. A round "i" beside the
Fingerprint terminals title opens **How to set up a fingerprint
terminal** (`DESIGN.md` §5.2, §5.5, Dialog). Its **Terminal model**
picker offers the brands not retired (§17.9), and the steps follow the
model's protocol:

- **ZKTeco's, through the agent:** at the office, the PC software's
  settings, the terminal's address and clock, and the PC; installing the
  agent, its `agent.json` and `probe`; connecting it, with Add an agent,
  `enrol`, the service, and the terminal's brand; matching terminal
  numbers to people; and what to do when something goes wrong. The
  model's notes, the Super Admin's, show in the step that finds its
  address.
- **Hikvision's:** not read yet, until parts 5 and 7 (§20).
- **Getting the agent:** the Super Admin is told where it's built, the
  Attendance agent workflow's latest run on GitHub; anyone else, to ask
  the Super Admin for it.

The Convoy trial's week, and what passes it, stay on the trial's own
page, outside Nizmo. For the guide, the brands the terminals list offers
(`GET /api/attendance/devices`) carry their notes.

**Built in #292: Add a terminal, and its address shown once** (part 5's
second PR, §20). What the build settled:

- **Add a terminal** is beside Add an agent on the section's card. It
  asks for the terminal's name, its brand, from those not retired, its
  serial number, how it reads scans, and how it connects.
- **How it connects follows the brand's protocol and what is built.** A
  ZKTeco terminal connects through the office agent; straight to Nizmo
  waits for part 6. A Hikvision terminal connects straight to Nizmo; the
  agent reads it from part 7. The way that isn't built yet is listed,
  greyed, with why beside the choice (`DESIGN.md` §5.3). Straight to
  Nizmo is listed only where the Super Admin has turned it on for the
  company (§17.8): until part 5's last PR nobody has, so a Hikvision
  terminal can't be added yet, and the dialog says so. The server
  refuses the same.
- **Through the agent**, the terminal is added waiting: once an agent of
  the company reports a terminal with that serial number, it is this
  one, with the name, brand and mode it was given. Nothing is issued, so
  no step-up code is asked for.
- **Straight to Nizmo**, adding it issues its address, so it asks for
  the step-up code (§17.10). What to set on the terminal is then shown
  once (`DESIGN.md` §5.5, Dialog), each setting under the name
  Hikvision's HTTP listening gives it:
  - the destination, Nizmo's own address as the page was opened on: a
    setting, not written into the code (§18, 6), as the agent's guide
    has it (#282);
  - the URL, with the secret in it, port 443 and HTTPS, with Copy beside
    the destination and the URL;
  - where that setting is on the terminal's web page, and how to stop
    the terminal sending pictures, which Nizmo never opens (§17.5);
  - above them, the brand's notes, the Super Admin's (§17.9).

  The menu's names are from Hikvision's manual for its DS-K1T670 series
  (V4.17, December 2025) and differ by model; the trial checks them
  (§17.8).
- **Issue a new address**, in the menu of a Hikvision terminal straight
  to Nizmo, asks first, then for the step-up code: the address it has
  stops working at once, and the new one is shown once, the same way. It
  works whether the company's switch is on or off: it only replaces a
  secret.
- **A serial number is one terminal's.** One the company already has is
  refused, saying to restore it if it was retired; one in use at another
  company is refused as it is when restoring. As with an agent's report,
  whoever names a serial number nobody uses has it, one company at a
  time (above); one named in error is retired, by its company or the
  Super Admin, and is then free again.
- **Only a terminal added by hand waits.** One an agent brought in was
  heard of when it was, so with no contact kept it reads as it did.
- **Waiting for its first contact:** a terminal added by hand shows so
  until it is heard from, reported by an agent or calling Nizmo itself.
  No alert is raised about it meanwhile.
- **The card of a terminal straight to Nizmo** says so among its facts,
  with its last contact, the address it calls from, and how many of its
  scans were refused, with the latest reason in words.
- **Working, for a terminal straight to Nizmo, is heard from in the last
  24 hours,** not the agent's 15 minutes. A terminal calls when someone
  scans, and whether it sends heartbeats between scans is the trial's to
  answer (§18, 4). Past that it reads Not heard from in working hours,
  and Quiet outside them. No alert is raised for one yet: that, and the
  threshold, follow the trial's answer.
- **The setup guide** (#282), for a Hikvision model where straight to
  Nizmo is on, points to Add a terminal in place of saying Nizmo can't
  read the model yet.
- **Not in this PR:** Change connection, since no protocol has both ways
  yet. It comes with part 6, the first that gives a protocol both (§20).
  The Super Admin's terminals list showing each terminal's connection
  came with first contacts, in #294 (§17.8).

**Built in #297: Add a terminal for ZKTeco straight to Nizmo** (part 6's
second PR, §20). What the build settled:

- **A ZKTeco terminal connects either way now:** through the office
  agent, or straight to Nizmo where the Super Admin has turned that on
  for the company (§17.8). The switch is off for every company, so
  nobody can add one yet; the first added this way is the first the
  addresses built in #296 answer (§17.3).
- **The office's internet address is asked for, and required,** when a
  ZKTeco terminal is added straight to Nizmo: one address or range per
  line, as a check-in location's office IPs (§9.4), up to 20. Nizmo lets
  the terminal in from these alone (§17.3). The server refuses one with
  none, an entry that isn't an address or a range, and an address for
  any other terminal: a Hikvision terminal has its secret address
  instead, and one through the agent is read at the office.
- **Adding it asks for the step-up code** (§17.10), as a Hikvision
  terminal's does: from the office's address, scans are let in for any
  employee number. Nothing is issued and nothing is secret.
- **What to set on the terminal** is shown once it's added, and its
  menu shows it again at any time, as What to set on it, since nothing
  in it is secret (`DESIGN.md` §5.5, Dialog). Each setting is under the
  name ZKTeco's Cloud Server Setting gives it: Server address, this
  Nizmo's own as the page was opened on (§18, 6), with Copy; Server port,
  443; Enable domain name, on; HTTPS, on. The brand's notes, the Super
  Admin's (§17.9), are above them. The names differ by model and
  firmware; the trial checks them (§17.8).
- **Its row** says the office's address, each one left to right and
  never translated, beside where it last called from.
- **A call from elsewhere,** noted on the terminal (#296), is said in
  words on its row as the latest refused: the address it came from, which
  isn't the office's.
- **Change office address,** in the menu of a ZKTeco terminal straight
  to Nizmo that isn't retired, takes the same field, filled with the
  addresses kept, and asks for the step-up code. The audit log has the
  addresses before and after. It works whether the company's switch is
  on or off: it only narrows or moves where the terminal is let in from.
- **The setup guide** (#282), for a ZKTeco model where straight to Nizmo
  is on, says above its steps that the model can be added straight to
  Nizmo too, with Add a terminal.
- **Not in this PR:** Change connection (part 6's third, §20), and first
  contacts kept for a ZKTeco terminal (its fourth): until then its menu
  has no Read first contacts.

**Built in #298: Change connection** (part 6's third PR, §20). What the
build settled:

- **Change connection** is in the menu of a terminal that isn't retired,
  where its protocol has another way built that the company may use
  (`DESIGN.md` §5.5, Dialog). A ZKTeco terminal moves between the office
  agent and straight to Nizmo, straight to Nizmo only where the Super
  Admin has turned that on (§17.8). A Hikvision terminal has no other
  way until the agent reads it (part 7).
- **Moving straight to Nizmo** asks for the office's internet address,
  as adding it does, then the step-up code (§17.10), and what to set on
  the terminal is shown after. At its next heartbeat the agent hears the
  terminal is set straight to Nizmo, sends what it has already read, and
  reads no more (§17.6). Where the terminal had got to starts again, so
  once set it sends its whole memory, and each scan the agent already
  delivered is stored once (§17.6).
- **Moving to the agent** asks first, with no step-up code: nothing is
  let in. Nizmo stops taking the terminal's own calls at once, and the
  agent reads on from where it stopped once it reports the terminal. The
  dialog says to turn the terminal's Cloud Server Setting off, so it
  stops calling.
- **What stays, and what starts again.** Its scans, name, brand, mode,
  the employee numbers mapped to people, and when it was first seen
  stay (§17.6). What belonged to the way it connected starts again:
  straight to Nizmo, the office's addresses or its secret address, where
  it had got to, where it last called from, and what was refused;
  through the agent, whether the agent reached it, and its clock's drift,
  which the agent measures again. Moved straight to Nizmo, it waits for
  its first contact until it calls, as one just added that way.
- **The audit log** has the connection before and after, and the
  office's addresses when it moves straight to Nizmo.
- **No silence alert for a terminal straight to Nizmo** (above): one
  moved from the agent keeps the agent that last reported it, and the
  agent's silence check now leaves it out.
- **The server refuses** a retired terminal, a move to the way it
  already connects, straight to Nizmo where the switch is off, a way not
  built for its protocol, and an office's address that's missing, isn't
  one, or isn't asked for.
- **From the review:** an agent's heartbeat that read the terminal as
  its own just before a move straight to Nizmo committed writes nothing
  over the move. What an agent says of a terminal is taken only while the
  terminal is still the agent's and not retired; otherwise the heartbeat
  reads it again, and hears it's set straight to Nizmo (§17.6).
- **Not in this PR:** first contacts kept for a ZKTeco terminal (part
  6's fourth, §20).

### 17.8 Proving it on real terminals

None of this can be tried without the terminals, and the build has none. So:

- **Switched off to start.** The Super Admin turns terminals straight to
  Nizmo on for a company (`terminalsDirectAllowed`, §8.6); off, the choice
  isn't offered and the routes refuse everything. As face verification was,
  it ships built and off.
- **First contacts kept, to compare with this plan.** The first 50 requests
  from each terminal straight to Nizmo are kept for 7 days, for the Super
  Admin: headers without the secret path, and bodies with pictures,
  templates and names taken out. That is how the real formats are checked
  against §17.2 and §17.3.
- **The trial:** one terminal for each protocol, at a company that agrees, on
  the production address, for a week. It answers the questions in §18, and
  the switch stays off for everyone else until it passes.

**Built in #295: the switch**, the Super Admin's, on the company's
Attendance tab (part 5's fifth and last PR, §20). What the build settled:

- **Where:** a card of its own, Terminals straight to Nizmo, under Who
  sets up fingerprint terminals and above Fingerprint terminals, shown
  to the Super Admin alone for a company holding the Terminals add-on.
  It is a field of the Attendance tab only the Super Admin sets, as the
  other switch is (§17.10). Its column came with part 4 (#290), off for
  every company: this PR has no migration.
- **Off:** a terminal can't be added straight to Nizmo, and one already
  set that way is held: its requests are answered 403, so it keeps its
  scans and sends them again (§17.2). Nothing is deleted, its address
  stays its own, and the agent doesn't read it meanwhile (§17.6).
- **On:** whoever sets the company's terminals up can add one straight
  to Nizmo (§17.7), its requests are taken, and its first contacts are
  kept (above).
- **Its row** has On or Off and one button, Turn on or Turn off, the
  short words the other settings' switches have: a row's end holds no
  wider a button on a phone. The question's button says in full what it
  does: Allow straight to Nizmo, or Stop straight to Nizmo.
- **Allowing asks first,** since what a terminal sends counts towards
  pay.
- **Stopping asks only when it would hold a terminal:** it says how many
  send straight to Nizmo now, and that each keeps its scans and sends
  them again. With none, it stops nothing and doesn't ask. Its button
  isn't in the danger colour: nothing is deleted and allowing again
  undoes it (`DESIGN.md` §5.5, Dialog).
- **How many** is read from the list Fingerprint terminals shows, so a
  terminal added or retired on the same page is counted at once; and
  once the switch is saved that list is asked for again, so Add a
  terminal offers Straight to Nizmo without the page loaded again. Turn
  off can't be pressed until that list is read: before then nothing
  says whether a terminal would be held. A list that couldn't be read
  isn't a list with no terminals: the card says so, with Try again, and
  Turn off waits (review on #295).
- **Written to the audit log** each time it turns, by name, with who
  turned it.
- **It stays off** for every company until the trial with a real
  terminal passes (above). No alert is raised for a silent terminal
  straight to Nizmo yet: that follows the trial too (§17.7).
- **The card above it** (§17.10, #277) got the same short button here.
  On a phone in English its longer one, Set them up for the company,
  lay over the row's words. Its question's button still says in full
  what turning it on does.
- **The Super Admin's page** reads a company from the companies list's
  route, not the settings route: both return the switch, or the card
  read Off once the page was loaded again.
- **A first contact is dated with the terminal's row held** (a fix to
  #294, found by its own test failing about one run in six). Requests
  that come at once are now dated in the order they are let in, so none
  kept is dated before the terminal's first. Before, each was dated as
  it arrived, and one let in later could be dated a moment earlier.

**Built in #294: first contacts kept**, for a Hikvision terminal straight
to Nizmo (part 5's fourth PR, §20). What the build settled:

- **What is kept:** a request Nizmo takes from the terminal, answered
  200, in the terminal's first 7 days: up to 50 in all, and up to 5 of a
  kind. A kind is the request's event types, such as a heartbeat or a
  passed check by face, or a body that couldn't be read, or an empty one.
  Without the 5, a terminal that sends a heartbeat every few seconds
  would fill the 50 before anyone scanned. Both limits hold when
  requests come at once: what is kept is counted again as each is kept,
  one at a time for a terminal.
- **A request held isn't kept.** One answered 403, 429 or 500 is sent
  again until it is taken, so keeping it would fill the 50 with copies.
- **Each is kept for 7 days**, then deleted by the nightly job that
  prunes the logs. After the terminal's first 7 days nothing more is
  kept, and nothing is looked up for it.
- **With each:** when it came, its method, the route by its pattern
  (never the address, which is the secret), its headers, its body, its
  kind, and what Nizmo made of it: a scan stored, already there or from
  before the company's terminals started, what was refused and why,
  nothing to keep, unreadable, or empty.
- **Headers:** the ones a terminal sends that say how it speaks (content
  type and length, user agent, what it accepts, connection, host) are
  kept with their values. `Authorization` keeps its scheme alone, and a
  cookie only that it was there. Every other header is kept by name
  alone: the hosting adds its own, and some of those are credentials.
- **Bodies:** JSON and XML are kept with every name but the terminal's
  own, card numbers, pictures and their addresses, templates and any
  long text taken out, each replaced by a note of what was there. A
  form's pictures are never opened: the part's name, type and size are
  kept. Text that is neither JSON nor XML is kept to its first 600
  characters, with what looks like a name or a card number taken out.
  The secret is replaced wherever it appears, and a body is cut at 8,000
  characters. A body, or a part of a form, longer than Nizmo reads an
  event from (256 KB) isn't opened: only its length is kept. Employee
  numbers stay, as on the punch.
  - What a field's name says it holds, everything under it holds: a
    picture's address inside its picture goes with it, in XML as in
    JSON, and so does what is under a name or a card. An XML element's
    attributes go by the same rules as its elements.
  - A form's field goes by its own name too: one called `name` is
    somebody's name, whatever it holds.
  - A picture's address, or its file's name, is taken out whatever its
    field is called.
  - A text that holds fields of its own, such as an event sent as text
    or an address with a query, is read by the same rules, with its
    escapes undone first.
  - Text that can't be read as JSON or XML, such as an event cut short,
    is read field by field all the same: a value goes by its field's
    name and by what its field is under, whether it is text or a number.
    There a number of 6 digits or more is taken out wherever it is: a
    field's name can't always be relied on, and such a number can't be
    told from a card's.
  - (The first three from the first review on #294, the last from the
    second.)
- **Only the Super Admin reads them**, from the terminal's menu on
  Fingerprint terminals: **First contacts** (`DESIGN.md` §5.5, Dialog),
  in the order they came, each a row that opens onto what it sent. A
  company's own people are refused by the server. While it's open the
  list is read again every 10 seconds, so a request appears as the
  terminal sends it during a trial.
- **Keeping never holds a terminal.** If keeping fails, or counting
  what is kept does before the request is taken, the request is taken
  and answered all the same, and the failure is recorded without the
  secret.
- **System health:** the Super Admin's terminals list (#177) now lists a
  company whose only terminals are straight to Nizmo, and says how many
  of a company's terminals connect that way (§17.7).
- **Not in this PR:** looking again once the 7 days are over. If the
  trial needs it, a Super Admin action reopens it.
- **The migration only adds:** the `TerminalFirstContact` table, and
  `firstContactAt` on a terminal, empty until its first request is taken.

**Built in #299: first contacts kept for a ZKTeco terminal** straight to
Nizmo (part 6's fourth and last PR, §20), as a Hikvision terminal's are
(#294): a request Nizmo takes in the terminal's first 7 days, up to 50
in all and 5 of a kind, each kept for 7 days, for the Super Admin alone.
A request held, and one from elsewhere, isn't kept. What the build
settled:

- **A kind is what the request is:** its options (`options`), its scans
  (`ATTLOG`), changes to the people it holds (`OPERLOG`), its heartbeat
  (`getrequest`), or anything else by its method, path and table, such as
  `POST cdata table=ATTPHOTO`. It is known before the body is read, so
  once 5 heartbeats are kept the next is counted, not kept.
- **Its request line:** the path under `/iclock/` as it came, and its
  query a parameter at a time, in the order sent. Those the protocol
  names keep their values: the serial number, `options`, `table`, the
  stamps, `pushver`, `language`, `INFO` and a few more. Any other keeps
  its name alone, with how long its value was: a later firmware's could
  carry something drawn from the comm key (§18).
- **`INFO`** keeps the firmware and the counts. The terminal's address on
  the office network is taken out, as it isn't kept on the terminal
  either (§17.3).
- **Headers** go by Hikvision's rules. The office's own internet address,
  in the hosting's header, is kept by name alone.
- **Only scans are opened.** Each line is kept as it came, its tabs and
  spaces too, up to 8,000 characters. A line read as a scan keeps its
  employee number, as the punch does, its date and time, and short
  numbers; anything else on it is replaced by a note of what was there.
  A line that can't be read as a scan goes by the rules for text that is
  neither JSON nor XML (#294), where a number of 6 digits or more is
  taken out.
- **Nothing else is opened:** changes to the people a terminal holds
  carry their names, and its other tables carry pictures and
  fingerprints. A note says so in place of the body; its length is in
  its headers.
- **What Nizmo made of it:** answered with its options; a scan stored,
  already there, from before the company's terminals started, or refused
  and why; nothing to keep, for a heartbeat or an upload with no lines;
  or not opened.
- **First contacts is in the menu** of every terminal straight to Nizmo,
  whichever its protocol, for the Super Admin alone. For a ZKTeco
  terminal, its line above the list says only scans are opened and its
  address on the office network is taken out.
- **Keeping never holds a terminal,** as for Hikvision: if keeping fails,
  or counting what is kept does, or working out what to keep of it does,
  the request is taken and answered all the same, and the failure is
  recorded.
- **No migration:** the table came with #294.
- **From the review:** a line that can't be read as a scan goes by the
  rules for unreadable text whatever its shape. One that happened to be
  JSON or XML was read as JSON or XML, where a long number under a field
  whose name says nothing, such as a card's under another name, was
  kept. Now it is taken out there too.

### 17.9 Terminal brands, a list kept from the screen (round 9)

A terminal's **brand** is what is printed on it. Its **protocol** is the
language Nizmo and the agent speak to it. They aren't the same thing: many
brands sell terminals another maker builds, and those speak the maker's
protocol. The first customer's Convoy speaks ZKTeco's, as its own screens
show (§20).

- **Protocols are code.** Nizmo knows two: ZKTeco's, which the agent reads
  over the office network (above) and a terminal pushes to Nizmo (§17.3); and
  Hikvision's ISAPI (§17.2, §17.4). Another protocol is added by building it,
  with its own plan and PRs.
- **Brands are data.** Only the Super Admin keeps the list, one for every
  company, on a **Terminal brands** page under Templates (`UI_PLAN.md`
  §2.2; round 9, decision 10): each brand's name, the protocol its
  terminals speak, and optional notes in English and Arabic, such as where
  its settings are in its menu. It starts with ZKTeco, Hikvision and Convoy
  (ZKTeco's protocol, from its screens, 14 November 2026).
- **Adding a brand** takes its name and picks its protocol from the ones
  Nizmo knows. A brand that speaks another can't be added: the page says so,
  rather than offering a brand that will never connect.
- **Changing a brand:** its name and notes at any time; its protocol only
  while no terminal uses it, since changing it under a working terminal
  would cut it off. Once a terminal has used it, a brand is retired, never
  deleted, and isn't offered for new terminals.
- **A brand whose models speak different protocols** is added once for each,
  named so the two can be told apart.
- **On a terminal**, `protocol` is what it speaks and `brandId` what is
  printed on it (§8.6). A terminal an agent reports gets the protocol the
  agent read it with and no brand, until an Admin picks one from the brands
  speaking that protocol. A terminal added by hand takes its brand's
  protocol.
- **A company's Admin** sees the brand on each terminal's card and picks it in
  Add a terminal (§17.7), but can't add, change or retire one. A brand that
  isn't listed is asked of the Super Admin.
- Adding, changing and retiring a brand are written to the audit log, as role
  and policy templates are.

**Built in #279** (part 3's first PR). What the build settled:

- **The list** is the Terminal brands page under Templates, the Super
  Admin's alone. Each brand is a row: its name, the protocol it speaks,
  how many terminals use it, and its notes in the page's language.
- **Names are unique, capitals aside,** so "zkteco" can't sit beside
  "ZKTeco".
- **A brand no terminal has used is deleted, asking first;** one a
  terminal has used is retired instead (`DESIGN.md` §5.5, Row menu), and
  Put back offers it again. A retired brand's terminals keep it.
- **Its protocol can't change while any terminal uses it,** retired or
  not: the field is locked, and its hint says why.
- **Only the two protocols Nizmo speaks are offered.** The dialog says a
  brand whose terminals speak another can't be added yet.
- **Every terminal gets a protocol,** ZKTeco's for those already there,
  since the agent reads only that one, and no brand. Showing the brand on a
  terminal's card and picking it there is part 3's second PR.

**Built in #280** (part 3's second PR). What the build settled:

- **A terminal's card shows its brand** among its facts, or "Brand not
  picked yet" for one an agent brought in.
- **An Admin picks it in the terminal's Edit dialog,** from the brands that
  speak the terminal's protocol and aren't retired. Its hint says the list
  is the Super Admin's, and that a brand that isn't there is asked of
  them. Once picked, a brand can be changed but not taken off.
- **A retired brand stays where a terminal has it,** chosen in its picker
  with "(retired)" after its name, so saving the name or mode leaves it as
  it is (`DESIGN.md` §5.5, Row menu). Once another is saved, it isn't
  offered again.
- **The server checks the brand:** it must be there, speak the terminal's
  protocol, and not be retired unless it's the terminal's own. It holds
  the brand's row while it saves, so the Super Admin can't change its
  protocol or delete it meanwhile.
- **The audit log** has the brand's change, by name, with the terminal's
  other changes.

### 17.10 Who may set terminals up (round 9)

Setting terminals up decides whose scans count as attendance: an agent's code
or a terminal's address lets punches in for any employee number, and so into
pay. So it stops being part of the Attendance settings tab's own access
(`lib/attendance/terminals-access.ts` asks the tab's question today):

- **A permission of its own,** `attendance.manage_terminals`, "Set up
  fingerprint terminals", at company scope: seeing and changing everything
  under Fingerprint terminals (agents and their codes; terminals, their brand,
  mode and connection; a Hikvision terminal's address; a ZKTeco terminal's
  office address; clearing a terminal's memory; retiring). Without it the
  section isn't shown at all, and its routes answer as if it weren't there
  (404), whatever else the person may do on the Attendance tab.
- **High-risk** (`ROLES_PLAN.md` §6.15), since it adds to attendance and so to
  pay: issuing an agent's code, issuing a terminal's address, changing a
  terminal's connection or the office address, and retiring a terminal ask
  for the step-up code. Seeing the section doesn't.
- **The built-in Admin role holds it**, and another role only if the Super
  Admin, who alone builds roles (`ROLES_PLAN.md` round 5), grants it.
- **The company's switch, the Super Admin's alone:** "The company sets up its
  own fingerprint terminals" (`Company.terminalsSetupByCompany`, §8.6), off to
  start. It sits on the same Attendance tab of the company's options, beside
  the Fingerprint terminals section, as a field only the Super Admin may
  change, as the cash advances switch is (`lib/company-settings-tabs.ts`,
  `superAdminOnly`). The company's own people never see it.
  - **Off:** nobody in the company sees the section, its Admin included; the
    Super Admin sets the company's terminals up, from its settings.
  - **On:** those holding the permission do.
  - The built-in Admin role is locked for every company (`ROLES_PLAN.md` §4.3,
    rule 7), so the switch is how the Super Admin decides, company by
    company, whether its Admin may.
  - Turning it off stops nothing already set up: scans keep coming, and only
    the screens and changes are the Super Admin's again. Turning it on or off
    is written to the audit log.
- **Alerts** about a silent agent or terminal in working hours go to those
  holding the permission while the switch is on, and to the Super Admin
  otherwise, in place of everyone holding `settings.view` today.
- **Companies already there:** production has no terminals, and two agents
  created but never connected (checked 12 November 2026). With the switch off
  to start, those two are the Super Admin's to finish or remove; nobody loses
  a working setup.

**Built in #277.** What the build settled:

- **Reached on the Attendance tab.** The section is on that tab, so a
  company's people reach it where the Super Admin shows them the tab
  (§5.2), and the permission implies `settings.view`, without which no tab
  opens. Its routes no longer ask whether the tab may be saved: they ask
  that the company holds attendance and the Terminals add-on, that the
  person may see the Attendance tab, and, for anyone but the Super Admin,
  the company's switch and the permission. Anything else answers 404.
- **Seeing it is changing it.** There's no read-only view of the section:
  whoever may see it may do everything in it.
- **The high-risk acts there are today:** adding an agent, which issues
  its code, issuing a new code, and retiring a terminal. Issuing a
  terminal's address, and changing its connection or the office address,
  ask the same once parts 5 and 6 add them.
- **The switch** is a card above the section, shown to the Super Admin
  alone for a company holding the Terminals add-on. Turning it on asks
  first, since it lets the company's people add what counts towards pay;
  turning it off doesn't, since it stops nothing already set up.
- **Alerts** go to those holding the permission where the switch is on and
  the Attendance tab is shown to the company, and to the Super Admin
  otherwise, or when nobody at work there holds it.
- **The companies already there** get the built-in Admin's grant from a
  later PR's migration, once this release is live (part 2's second PR, as
  for cash advances, `CLIENTS_PLAN.md` §7.8), so no role editor that
  doesn't know the permission drops it meanwhile. A new company's Admin
  role holds it from this release. With every company's switch off until
  the Super Admin turns it on, nobody's access changes meanwhile. Given in
  #278, to the built-in Admin alone, as for cash advances: a company's own
  roles are given it in the role editor. An Admin role holding it already,
  a new company's, is left as it is; the others' holders reload their
  grants once. It opens nothing until the company's switch is on.

### 17.11 Sources

Checked on 12 November 2026. Vendor documents vary by model and firmware,
and some of these are integrators' notes, so the trial (§17.8) has the last
word.

- Hikvision, [Receive alarm/event in listening mode](https://tpp.hikvision.com/Wiki/ISAPI/Access%20Control%20on%20Person/GUID-0E00BD39-BDB4-4079-A8EE-307A95871C1A.html)
  and [How to get real-time events in HTTP listening mode](https://www.hikvisioneurope.com/eu/portal/portal/Technology%20Partner%20Program/03-How%20to/How%20to%20get%20real-time%20event%20in%20listening%20mode.pdf).
- Hikvision, [Open capabilities](https://tpp.hikvision.com/tpp/OpenCapabilities):
  callback addresses over HTTP or HTTPS.
- Integrators' notes on Hikvision events: the [ISAPI reference](https://github.com/uchkunr/hikvision-best-practices),
  [access control events](https://shipkit.davrapps.dev/en/blog/hikvision-isapi-access-control-events)
  (body shapes, `event_log`), and [a terminal sending again until answered](https://ipcamtalk.com/threads/c-listening-for-hikvision-events.31659/).
- ZKTeco, [SpeedFace-V3L user manual, Cloud Server Setting](https://www.manualslib.com/manual/2802468/Zkteco-Speedface-V3l.html?page=57):
  domain name mode and HTTPS.
- ADMS's paths and handshake, from open implementations:
  [zkteco-adms (Go)](https://pkg.go.dev/github.com/s0x90/zkteco-adms) and
  [the PUSH protocol, described](https://www.linkedin.com/pulse/zkteco-adms-protocol-link-your-zk-device-server-herbin-tsobeng-qg0ze).
- ZKTeco, [HTTP PUSH SDK 2.0.1](http://f02.s.alicdn.com/kf/HTB1PANmFVXXXXaCXVXX.PRXFXXXk.pdf)
  (read on 16 November 2026, for #296): the options a server answers a
  terminal's first call with, the lines of an attendance upload and its
  `Stamp`, `getrequest` and its `INFO`, and `devicecmd`.

---

## 18. Open questions

The first was deferred to implementation; the rest are round 9's, answered by
the trial on real terminals (§17.8) unless they say otherwise.

1. **Face SDK choice** (§9.5) — still open. Phase 3b was built (#27) on a
   face check for testing only, whose recognition weights are licensed for
   non-commercial research (`mobile/FACE_CHECK.md`), so it is never used
   with real employees. A commercial on-device SDK replaces it before any
   real employee uses face checks, chosen against the rule that face
   templates never leave the phone (`mobile/README.md`, "Choosing the
   SDK"). Verify the vendor's on-device mode sends nothing to their
   servers. Paused by the owner with face checks themselves (14 November
   2026), until Nizmo has more customers (§20, Phase 3b).
2. **Does a ZKTeco terminal send anything secret over ADMS** (its comm key, a
   registration code)? If a model does, the office address rule (§17.3) can be
   relaxed for it.
3. **Do the terminals accept Nizmo's HTTPS?** Vercel needs TLS 1.2 or later and
   the server's name in the handshake (SNI), and its certificate chains to a
   current public root. A terminal whose firmware can't connects through the
   agent.
4. **Which Hikvision event types** a model sends for a fingerprint, a face and a
   card that passed (§17.2), and whether it sends heartbeats between scans. If it
   doesn't, its health is the working-hours silence alert alone.
5. **Does a ZKTeco terminal set its clock from Nizmo** by itself, from the
   answer's date or an option in it, with no command sent (§19)? If it does,
   clock drift mostly goes away for terminals straight to Nizmo. Nizmo
   answers its first call with the company's offset from UTC as
   `TimeZone` (#296, §17.3): the trial says whether a terminal reads it,
   in what form for a zone off the hour, and what it does when summer
   time changes the offset after that call.
6. **The address terminals are pointed at** (before the first terminal is
   installed at a customer, not in the trial). A terminal is set by hand, so
   moving Nizmo to its own domain later means visiting every terminal. The
   address in the setup card is a setting, not written into the code.
   Decided in round 10 (decision 21): `nizmo.vercel.app` until the second
   customer, then the owner's own domain. `nizmo.vercel.app` keeps working
   beside it, so the first customer's agent needn't change.
7. **Signing the agent** (the owner's purchase, not the trial). The Attendance
   agent workflow signs with a `.pfx` file from GitHub secrets, but since June
   2023 a code signing key must live on a hardware token or a certificate
   authority's cloud HSM, so no new certificate comes as a `.pfx`. Microsoft's
   own signing service takes organizations in the US, Canada, the EU and the
   UK only. So a certificate bought now is an OV certificate from a CA that
   signs from its cloud (SSL.com's eSigner, for one), and the workflow's
   signing step changes to that CA's tool, its credentials in GitHub secrets.
   Signing names the publisher in place of "Unknown publisher", but Windows
   SmartScreen warns about a new file until it has built a reputation, signed
   or not, so until then whoever installs the agent chooses Run anyway, as
   they do unsigned.

---

## 19. Non-goals

- Door access control.
- Real-time streaming attendance.
- Storing fingerprint templates from terminals.
- Storing or transmitting face templates. (One approved reference photo per
  face-enrolled employee is stored, §9.5; ordinary check-ins send none.)
- Polling a tenant's device over the internet.
- A terminal pushing plain HTTP over the internet (§17.1).
- Sending a terminal commands over the internet: adding users, clearing its
  memory, setting its clock, opening a door. A terminal straight to Nizmo is
  only listened to (§17.3).
- Keeping the pictures a terminal attaches to its events (§17.5).
- Shift planning and rota building.
- Adding the mission allowance to a task's costs, or charging it to a client
  (round 10, decision 19).
- Summer time on a terminal. The terminal keeps its own clock, summer time
  included, set by whoever installs it; Nizmo reads the times as the
  terminal sends them (round 10, decision 27).
- Check-in from a browser. Check-in is native-app only; the web product stays as
  it is for everything else.

---

## 20. Phasing

Each phase is independently shippable. Every phase up to and including 3b is
built; Phases 4 and 5 are built part by part, as their headings below say.

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

**Paused** by the owner (14 November 2026) until Nizmo has more customers.
It stays switched off meanwhile, on the face check meant for testing only;
choosing a commercial SDK (§18, question 1) waits with it.

### Phase 4 — Terminals through the agent or straight to Nizmo — parts 2 and 3 built in #277 to #280 and #282, part 4 in #290, part 5 in #291 to #295, part 6 in #296 to #299, part 7 from #300

Planned in #269, for ZKTeco and Hikvision alike (§17.1–§17.11). It replaces
the earlier Phase 4, a listener for pushes on the agent and nothing else,
which becomes part 8 below. Each part is its own PR:

1. **The plan** (#269).
2. **Who may set terminals up** (§17.10): the permission, high-risk, held by
   the built-in Admin; the company's setup switch, the Super Admin's, off to
   start;
   the Fingerprint terminals section and its routes behind both; alerts to
   those holding it. The roles tests and `ROLES_PLAN.md` §6.15's list gain
   it. Built in #277; the built-in Admin's grant for the companies already
   there in #278.
3. **Terminal brands** (§17.9): the migration (`TerminalBrand`, starting with
   ZKTeco, Hikvision and Convoy; a terminal's `protocol` and `brandId`), the
   Super Admin's Terminal brands page under Templates, with `DESIGN.md`
   first, and the brand on each terminal's card, picked by an Admin. Useful
   at once with the agent, and needs none of the rest. Built in two PRs:
   the migration and the Super Admin's page in #279, then the brand on each
   terminal's card in #280. Then, as the product owner asked, the setup
   guide behind an "i" on Fingerprint terminals, its steps by the model
   picked (§17.7), in #282.
4. **One terminal whichever way** (§17.6): the migration (connection, the
   columns for terminals straight to Nizmo, the index across both sources,
   the straight-to-Nizmo switch, §17.8), the ingest taking a terminal as well
   as an agent,
   and the agent told to skip a terminal set straight to Nizmo. No screen
   changes. Built in #290.
5. **Hikvision straight to Nizmo** (§17.2): `DESIGN.md` first; Add a terminal
   with its connection, the secret address shown once, Issue a new address;
   the receiving route; first contacts kept (§17.8); the straight-to-Nizmo
   switch on the company's Attendance tab. In five PRs, each safe with the
   switch off:
   1. The address a terminal sends to, which answers nobody yet (§17.2).
      Built in #291.
   2. Add a terminal, with its connection and the secret address shown
      once, Issue a new address, and the terminal's card for one straight
      to Nizmo (§17.7). `DESIGN.md` first. Straight to Nizmo is offered
      only where the switch is on. Built in #292. Change connection moves
      to part 6: until then no protocol has both ways to change between.
   3. What a scan keeps of its event (`rawPayload`, §17.5), and the
      terminal's own time zone on its card. Built in #293. It was one PR
      with first contacts, and is its own to keep each small.
   4. First contacts kept, for the Super Admin (§17.8), with each
      terminal's connection on the Super Admin's terminals list (§17.7).
      Built in #294.
   5. The straight-to-Nizmo switch on the company's Attendance tab
      (§17.8), last, when everything it turns on is there. Built in #295.
6. **ZKTeco straight to Nizmo** (§17.3): the `/iclock` routes, outside the
   proxy; the options answer, scans, and `getrequest` as its heartbeat; the
   office address check; ZKTeco's protocol in Add a terminal; and Change
   connection (§17.7), which a ZKTeco terminal is the first to have both
   ways for. In four PRs, each safe with the switch off:
   1. The addresses a terminal calls, which answer nobody yet: the
      routes, whose request it is by serial number and office address,
      the options answer, scans stored, and `getrequest` as its
      heartbeat (§17.3). Built in #296.
   2. Add a terminal for ZKTeco straight to Nizmo, with the office's
      internet address, what to set on the terminal, its card, and the
      office's address changed later (§17.7). Built in #297.
   3. Change connection (§17.7). Built in #298.
   4. First contacts kept for a ZKTeco terminal (§17.8): what is kept of
      what it sends, with names never opened. Built in #299.
7. **The agent reads Hikvision** (§17.4): ISAPI beside the ZKTeco protocol,
   `probe`, `agent.json`; a new agent release. In four PRs, each safe
   with nothing set up to use it:
   1. The agent's Hikvision client, which nothing uses yet: HTTP digest
      authentication, the terminal's identity, its clock, and its passed
      checks a page at a time from where it had got to, over HTTPS with
      the terminal's certificate pinned on its first contact, or HTTP on
      the office network. Tried against a simulated terminal, as the
      ZKTeco client is (§17.4).
   2. Nizmo takes a terminal's protocol from the agent's heartbeat, and
      Hikvision through the office agent is made ready in Add a
      terminal, Change connection and the setup guide (§17.7), held
      back until the agent reads it. An agent before it sends no
      protocol, and its terminals are ZKTeco's as before. Built in #301.
   3. `agent.json` names a Hikvision terminal, with the user made on it
      for the agent and its password; the agent's rounds read it and
      report its protocol; `probe` reads one; `trust` pins a renewed
      certificate; a new agent release, 0.3.0 (§17.4). No screen
      changes. Built in #302.
   4. Hikvision's way through the agent is built, so the screens offer
      it, once the 0.3.0 package is built; the setup guide says which
      agent version reads Hikvision, and what to do when a terminal's
      certificate changes.
8. **Only when a customer needs it: the agent listens on the office network**,
   for terminals that push only plain HTTP. The terminal pushes to the agent's
   address on the office network, and the agent sends on over HTTPS, as for
   scans it reads. Plaintext never leaves the building.

Hikvision goes first because its secret address is the safer first step;
parts 5 and 6 share the screen, so whichever comes second adds its protocol
to it. Parts 4 to 7 are built now, switched off, though no terminal on hand
can try them (round 9, decision 13). The trial (§17.8) of each way follows
when a terminal that uses it is on hand, and the switch stays off for every
company until it passes. Part 7 changes nothing in how the agent reads
ZKTeco's terminals, so a new agent with it still reads the Convoy as
before.

**The first customer's terminal comes before all of it.** It is a Convoy, an
Egyptian brand that sells other makers' terminals under its own name. Its
screens, photographed by the owner on 14 November 2026, settle what it is:

- **A ZKTeco terminal under Convoy's name.** It calls itself a CB 3000, on
  ZKTeco's platform ZLM60_TFT with ZKTeco's fingerprint algorithm VX10.0,
  and the office reads it today with ZKTeco's PC software, Attendance
  Management.
- **On the office network, as the agent reads it.** A fixed address there,
  ZKTeco's port 4370 and comm key 0: the agent's defaults, so
  `nizmo-agent.exe probe <its address>` is all it takes to read it.
- **No push to anyone.** Its Comm menu holds Ethernet and PC Connection
  only, with no Cloud Server Setting, and it has no gateway set. It can't
  send scans to Nizmo itself, so ZKTeco straight to Nizmo (part 6) can't be
  tried on it.

So it connects through the agent, built in Phase 2 and never yet tried on a
real terminal: that trial comes first (`nizmo-agent.exe probe`, then a week
of scans), ahead of the parts above but parts 2 and 3. Part 2 comes before
the terminal is set up, so that only those meant to see the setup do; part
3 puts Convoy on its card. Two things to settle with the office before the
trial week:

- **One reader at a time.** Attendance Management and the agent both read
  the terminal on port 4370, and a ZKTeco terminal often takes one
  connection at a time, so while the PC software is connected the agent's
  read waits for its next round.
- **Records cleared after reading.** If Attendance Management is set to
  delete the terminal's records once it has downloaded them, scans it
  reads first never reach the agent. That option is off for the trial.

Until the agent runs, the office's scans can come in through the import
(Phase 0), from the file Attendance Management exports, or the template
(§13.9). The trial checks that the import reads that file's columns.

It is also the first trial terminal (§17.8; the owner, 13 November 2026).
With no push, it stays on the agent and tries the agent alone. Parts 4 to 7
are built all the same, switched off, and tried when a terminal that pushes,
or a Hikvision, is on hand (round 9, decision 13).

### Phase 5 — Reading scans first and last, and missions — parts 2 and 3 built in #273 to #276, part 4 in #281, #283, #284 and #285, part 5 in #286 to #289

Planned in #270 and #271 (round 10, §6.9, §6.10). Each part is its own PR:

1. **The plan** (#270), and the decisions from its review (#271).
2. **First and last** (§6.9), built in #273: the engine reads every day
   first and last, and In pairs is removed; the policy's window, 5 minutes
   to start, on the policy panel; the simulator. No migration: a saved
   policy without the window reads as 5 minutes.
3. **Departures to confirm** (§6.9), in three PRs:
   1. **The waiting day**, built in #274: the policy's threshold, 2 hours
      to start, measured after approved permission hours; the day waiting
      as `TO_CONFIRM`, charged nothing; its notice; and its tab and
      settling on the Exceptions screen (decisions 13, 23, 26).
   2. **Settling an incomplete day**, built in #275: marking it absent or
      accepting it as it is, each with a reason, as a decision on the day
      (decision 22).
   3. **Payroll waits for both**, built in #276, with the window that lists them and warns
      of the month's requests not yet decided (decisions 14, 24).
4. **Missions, asked and decided** (§6.10), in four PRs. No money yet:
   1. **A mission's day**, built in #281: `MissionRequest`, with the two
      kinds of mission by hours and the optional task; the engine reading
      approved missions, a mission by days as the day status `MISSION`, a
      mission from the start of the day waiting as a Departure to confirm
      like any day; the mission day on the employee's own attendance, and
      the reminder and notices skipping it (decisions 9, 15, 17, 23).
   2. **Asking and deciding**, built in #283: the permission "Decide
      missions", given to a new company's built-in Admin; the policy's
      Missions switch, on to start (decision 11); missions on the
      Requests page, under Mine and To review and in the kind filter,
      with the optional task, and what the approver sees beside each;
      withdrawing one while it waits; a mission across a closed month
      accepted, its days there becoming discrepancies; and the
      notification of a decision (decisions 4, 10, 16, 18, 20, 25).
   3. **The companies already there**, built in #284: they get "Decide
      missions" for their built-in Admin, from a migration, once the
      release before it has the role editor's new line (as #278 did).
   4. **Cancelling an approved mission**, built in #285, with a reason, until the month's
      payroll is approved, and after it its days there as discrepancies
      the other way round; and the notification of a cancellation
      (decision 25).
5. **The mission allowance** (§6.10), in four PRs:
   1. **The allowance's settings**, built in #286: the policy's Missions
      section, what each kind pays and what one day is worth, nothing to
      start (decisions 6, 12). Nothing priced yet.
   2. **Each mission day priced**, built in #287: at its date, by the
      policy in force on it and, where one day is worth the employee's own
      day's pay, the salary in force on it (§6.3); kept and shown on the
      day. The allowance follows the approved mission, not the day's
      scans: by days, every date in it, rest days and holidays included
      (decision 9); by hours, its one date. A mission that didn't happen
      is cancelled (decision 25), which takes its allowance back.
   3. **Paid with salary**, built in #288: written at approval as its
      own entry (§12.2); the register's and the payslip's Mission
      allowance line. From then a month's days are frozen with the
      allowance their payslips carried; #287 froze them with none.
   4. **Across a closed month**, built in #289: a discrepancy carries
      the allowance, paid or taken back on the next payslip (decisions
      16, 25), for those the run paid. A month approved between #287 and
      #288 was frozen with none, so what its missions pay shows here as
      owed.

Part 2 needs none of the rest, and helps the first customer at once: a
second scan on arriving no longer leaves a day incomplete.

### The import's template — built in #272

Planned in #271 (§13.9). Its own small PR, needing nothing from Phase 4
or 5, and built before them.

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
