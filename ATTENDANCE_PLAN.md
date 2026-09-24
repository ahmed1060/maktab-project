# Attendance & Time Tracking — Implementation Plan

Status: **proposal, not scheduled.** Nothing here is built. This document
records what we would build, in what order, and which decisions are already
settled so that the person who picks it up is not re-arguing them.

It started as a response to an earlier draft (`zkteco_integration_guide.md`)
that described a universal hardware webhook, and has since absorbed a second
round of product decisions. [§0](#0-decision-log) lists what was decided and
when; everything after it is the plan as it now stands.

---

## 0. Decision log

### Round 1 — architecture

- Devices push, we never pull. The Local Sync Agent is the primary hardware
  path; direct device push (ADMS/`/iclock`) is last. See §2.
- The attendance *domain* — schedules, a derived day, a missing-punch flow — is
  built before any hardware integration.
- An attendance day freezes when its payroll run is approved. See §10.

### Round 2 — product

| # | Question | Decision |
|---|---|---|
| 1 | Mobile check-in? | **Yes.** An employee may check in from **one registered phone only**, and only from a phone. See §8.2 for what that can and cannot guarantee. |
| 2 | Exception-first admin screen | **Yes.** A daily screen showing only late, absent, incomplete and unmatched. §11.1. |
| 3 | Ramadan / seasonal hours | **Yes**, as dated overrides on a schedule, never edits to it. §6.1. |
| 4 | Device health | **Yes**, on the existing System Health screen. §11.2. |
| 5 | Does lateness cut pay? | **Yes**, by rules that differ per company and can be changed at any time. Configured in a new tabbed **Company Options** page. §4, §5. |
| 6 | Is overtime paid? | **Depends on the company**; configured alongside lateness. §5. |
| 7 | Who corrects attendance? | **Admin**, plus a new grant for people who are not admins. §12. |
| 8 | Working week | **Sunday–Thursday by default** (Egypt), overridable per company. §5. |
| 9 | Raw punch retention | Still open. Explained in §17. |
| 10 | Packaging | **A paid add-on.** §14. |

---

## 1. Where this system actually stands

**What exists.** `Company` is the tenant boundary and already carries its own
`timezone` (default `Africa/Cairo`, resolved company → `SystemSettings` →
constant). `User` is the employee, with roles `SUPER_ADMIN`, `ADMIN`,
`TEAM_LEADER`, `EMPLOYEE`. Payroll is real and finished: `PayrollRun` (DRAFT →
APPROVED → PAID, unique per company/month/year), `Payslip`, `PayslipLine`,
`SalaryChange` (effective-dated), `SalaryAdjustment` (in days, with a
`source`/`sourceId` pair), `FinalSettlement`, `Debt`. Leave is real:
`DayOffRequest` with an approval queue. There is a cron runner with a
fail-closed secret (`lib/cron-auth.ts`), a health table (`JobHeartbeat`) shown on
`/dashboard/health`, an audit trail, a rate limiter, a package-based feature
gate (`lib/features/`), a trusted-device mechanism for MFA (`TrustedDevice`), and
task location verification against a system-wide radius
(`SystemSettings.locationVerifyRadiusMeters`).

The company settings page (`/dashboard/companies/[id]/settings`) exists, is
Super Admin only, and is a single page of stacked cards — Modules, Logo,
Payroll.

**What does not exist.** Any notion of *when someone was supposed to be at
work*. No attendance model, no shift, no schedule, no working week, no holiday
calendar, no work location, no timesheet. The schema goes straight from
`DayOffRequest` to `Payslip`.

That gap is the whole project. The hardware integration is the easy half.

---

## 2. What changed from the original draft

Kept brief; the argument was had in round 1.

1. **Domain before pipe.** Ingesting punches nothing can interpret is not
   progress. Phase 0 is the engine, fed by spreadsheet import.
2. **The Local Sync Agent is the product, not the fallback.** ZKTeco ADMS is a
   vendor-specific plaintext protocol that many units speak only over plain
   HTTP on port 80, which Vercel redirects and the device will not follow.
3. **The payload never carries `tenant_id` or our employee ID.** The company is
   derived from the device credential; the device's own user ID is mapped here.
   The device's in/out flag is recorded as a hint and decides nothing.
4. **No `ProcessedStatus` boolean.** The derived day is a pure function of its
   inputs and can be rebuilt.

---

## 3. Settled design decisions

| Decision | Why |
|---|---|
| Raw punches are append-only | They are evidence. Corrections live in the derived layer, with an author and a reason. |
| At-least-once delivery, deduped by unique index | Agents re-pull overlapping windows and retry. The index is what makes naïve retry safe. |
| Ingest endpoints only authenticate, insert, return | A slow ingest makes clients retry, amplifying load exactly when we are struggling. |
| **Every policy is effective-dated** | "Changeable at any time" and "payroll can be trusted" are only compatible if a change applies *from a date* and never silently rewrites a month already measured. §5.1. |
| Attendance freezes when its payroll run is APPROVED | §10. |
| Biometric templates never leave the device | We receive IDs and timestamps only. |
| Mobile check-in is bound to one registered phone | Decision 1. §8.2. |
| Deductions land as `SalaryAdjustment` rows | That model is already in days, already has `source`/`sourceId`, and already explains itself on a payslip. New source: `ATTENDANCE`. |
| Attendance is a paid add-on bundle | Decision 10. §14. |
| Correcting attendance is a grant, not a new role | §12. |

---

## 4. Company Options page

Decision 5 asked for per-company rules reached from the company's options
button, as a page with tabs across the top, each tab its own category, built so
new categories can be added later. That is the right shape, and it is worth
doing as a refactor of the existing settings page rather than a second page
beside it.

### 4.1 Structure

```
/dashboard/companies/[id]/settings?tab=attendance

┌──────────────────────────────────────────────────────────────┐
│ General │ Branding │ Payroll │ Attendance │ …                │
├──────────────────────────────────────────────────────────────┤
│  Attendance sub-sections:                                    │
│   Work week · Schedules · Seasonal hours · Lateness ·        │
│   Overtime · Absence · Permissions · Locations · Devices     │
└──────────────────────────────────────────────────────────────┘
```

- **Tabs are a registry, not hand-written JSX.** One array of
  `{ key, labelKey, component, requires?: Bundle }`, the same pattern as
  `lib/modules.ts`. Adding a category is one entry. A tab whose bundle the
  company does not hold is hidden, so a company without the add-on never sees
  an Attendance tab.
- **The active tab lives in the URL** (`?tab=`), so a link can point straight at
  a tab and the back button behaves.
- **Each tab fetches and saves its own data.** Today the page loads the whole
  company once; five tabs of rules would make that one request carry everything.
  Each tab owns its API call and its unsaved-changes state, and switching tabs
  with unsaved edits asks first.
- **Existing cards move, not change.** Modules and Logo go to Branding, Payroll
  stays Payroll, the rest goes to General. No behaviour change in the refactor.
  That refactor is worth shipping on its own, before attendance exists.

### 4.2 Who may edit what

Today the page is Super Admin only, and the codebase has a stated split: the
Super Admin owns *policy* (naming, packages), the company's own Admin owns
*day-to-day data*. Attendance rules sit awkwardly across that line — they are
policy, but they are the customer's own HR policy, not ours. See open question
§17.1.

---

## 5. Attendance policy

All of this is configured in the Attendance tab, per company, and every one of
it is effective-dated.

### 5.1 Effective dating — the rule that makes "change any time" safe

A policy is a series of versions, each with an `effectiveFrom` date. Editing a
rule never mutates the current version; it creates a new one. When saving, the
admin is asked **"from when?"** — defaulting to the start of the next payroll
period, with "from today" and a custom date as the alternatives. This is the
same this-month-or-next question `SalaryChange` already asks.

Each `AttendanceDay` records the policy version it was measured against. So:

- a rule changed on the 20th does not silently re-price the 1st–19th;
- a rule backdated into a period whose payroll is APPROVED is refused, because
  that period is frozen (§10);
- "why was I deducted half a day on the 3rd?" is always answerable with the
  rule that was actually in force on the 3rd.

Without this, a company admin tightening the lateness rule on the 28th changes
everyone's pay for the whole month, and nobody can reconstruct why.

### 5.2 Work week

Company default: **Sunday–Thursday working, Friday–Saturday rest.** Overridable
per company (common outliers: a six-day Saturday–Thursday week in factories and
retail) and per schedule, since one company can run an office on five days and
a warehouse on six.

### 5.3 Lateness

Structured rule types rather than free-form formulas — a form an HR person can
fill in and a payslip line can explain.

- **Grace period** — minutes after shift start that count as on time.
- **Deduction bands** — e.g. 16–30 min → ¼ day, 31–60 → ½ day, over 60 → 1 day.
  Bands are the common Egyptian practice and map directly onto
  `SalaryAdjustment`, which is already in days.
- **Or per-minute** — deduct the exact late minutes at the daily rate, for
  companies that prefer it. One mode or the other per policy version.
- **Monthly free allowance** — the first N lates in a month are not deducted.
- **Escalation** — repeat lateness in a month multiplies the band (e.g. from the
  4th late, double).
- **Monthly cap** — a ceiling on total lateness deduction.
- **Early leave** — the same shape, measured against shift end.

### 5.4 Overtime

- **Enabled / disabled.** Disabled means overtime is recorded and shown, never
  paid.
- **Multiplier by day type** — working day, rest day, public holiday.
- **Minimum threshold** — overtime under N minutes is not credited.
- **Requires approval** — see enhancement §16.2. When on, unapproved overtime
  is recorded but not paid.
- **Compensation** — paid, or banked as time off. Banking is a later phase; the
  field exists from the start so the data does not need migrating.

### 5.5 Absence

- Deduction per unexcused absent day, as a multiplier (1 day, or the stricter
  1.5 or 2 some companies use).
- Whether a day with no punches and an approved `DayOffRequest` counts as leave
  (it always should — this is the join point with the day-off module, and the
  two must agree without either guessing).

### 5.6 Permissions (إذن)

See enhancement §16.1 — proposed, not yet decided.

---

## 6. Data model (sketch)

Names and shapes for discussion, not final. Every model is company-scoped.

### 6.1 Schedule layer

```
model WorkSchedule            // "Office 9–5", "Warehouse 6-day", "Night shift"
  id, companyId, name, isDefault
  graceInMinutes, graceOutMinutes
  breakMinutes                // unpaid, deducted from worked time
  roundingMinutes?

model ScheduleDay             // one row per weekday per schedule
  scheduleId, weekday (0-6)
  isRestDay
  startMinutes, endMinutes    // minutes from local midnight; end may exceed
                              // 1440 to express a shift crossing midnight
  isHalfDay

model ScheduleOverride        // Ramadan, summer hours, stocktake week
  id, scheduleId, name
  startDate, endDate          // inclusive, local dates
  // Its own ScheduleOverrideDay rows, same shape as ScheduleDay.
  // Weekdays with no override row fall through to the base schedule.

model UserSchedule            // effective-dated assignment, like SalaryChange
  userId, scheduleId, effectiveFrom, effectiveTo?

model Holiday
  companyId, date, name, isPaid
```

**Why overrides, not edits (decision 3).** If Ramadan is entered by editing the
base schedule, then on the day after Eid someone has to remember to put it back,
and last year's Ramadan attendance is now measured against this year's normal
hours if it is ever recomputed. An override is a dated layer on top: the base
schedule is never touched, the override ends by itself, and next year's Ramadan
is a copy of this year's with new dates. Resolution for a given day is
*override for that date if one exists, else the base schedule*.

Ramadan dates move by about eleven days a year and are confirmed late, so the
override's dates must be editable up to the day it starts — until its first day
has been measured, after which ordinary effective-dating applies.

### 6.2 Policy layer

```
model AttendancePolicy        // one row per version, per company
  id, companyId
  effectiveFrom               // local date; see §5.1
  createdById, createdAt
  workWeek         Int[]      // working weekdays, default [0,1,2,3,4]
  lateness         Json       // mode, grace, bands | perMinute, allowance,
                              // escalation, cap — narrowed by a zod schema
  earlyLeave       Json
  overtime         Json
  absence          Json
  permissions      Json?      // §16.1, if adopted
  @@unique([companyId, effectiveFrom])
```

Json per category, validated by a zod schema on the way in and narrowed on the
way out, for the same reason `Company.moduleLabels` is Json: these shapes will
grow, gate nothing structurally, and a migration per new rule field is pure
ceremony. The effective-dating column is real because queries depend on it.

### 6.3 Locations and mobile devices

```
model WorkLocation            // a branch, a site, a warehouse
  id, companyId, name
  lat, lng, radiusMeters      // per location — see §8.2
  isActive

model UserWorkLocation        // who may check in where
  userId, locationId

model AttendanceMobileDevice  // the one phone an employee may check in from
  id, userId
  publicKey                   // the device's key; see §8.2
  label                       // "Samsung A54", from the browser at enrolment
  enrolledAt, lastUsedAt
  revokedAt?, revokedById?
  // Partial unique: one active (revokedAt IS NULL) device per user.

model DeviceChangeRequest     // "I have a new phone" — approved like DayOffRequest
  id, userId, reason, status, reviewedById?, reviewedAt?
```

### 6.4 Hardware layer

```
model AttendanceDevice        // a fingerprint terminal
  id, companyId, locationId?
  name, serialNumber, vendor, timeZone?
  lastSeenAt, lastSyncAt, clockDriftSeconds?, isActive

model DeviceCredential
  id, deviceId, tokenHash, createdAt, lastUsedAt, revokedAt?

model UserDeviceMapping       // terminal's user ID → our User
  companyId, deviceId?, hardwareUserId, userId
  @@unique([companyId, deviceId, hardwareUserId])
```

### 6.5 Raw layer

```
model AttendancePunch
  id, companyId
  userId?                     // null = unmatched (§9.2)
  source                      // IMPORT | MOBILE | AGENT | DEVICE_PUSH | MANUAL
  deviceId?                   // terminal, for AGENT / DEVICE_PUSH
  mobileDeviceId?             // phone, for MOBILE
  hardwareUserId?
  punchAtLocal                // what the source said, naive, as text
  punchAt                     // resolved UTC instant
  resolvedWithTimeZone
  lat?, lng?, accuracyMeters? // MOBILE only
  locationId?                 // which WorkLocation it matched
  deviceDirection?            // a hint only
  rawPayload      Json?
  receivedAt
  // Dedupe: unique on (source, device or mobileDevice, subject, punchAt).
```

### 6.6 Derived layer

```
model AttendanceDay
  id, companyId, userId, date
  scheduleDayId?, overrideId?, policyId   // exactly what it was measured against
  firstInAt?, lastOutAt?
  workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes
  status                      // PRESENT | ABSENT | REST | HOLIDAY | ON_LEAVE
                              // | INCOMPLETE | MANUAL
  deductionDays   Decimal     // what the policy made of it
  overtimeAmount  Decimal
  isManuallyAdjusted
  derivedAt, inputsHash
  lockedByPayrollRunId?
  @@unique([companyId, userId, date])

model MissingPunchRequest     // mirrors DayOffRequest
  id, userId, date, claimedInAt?, claimedOutAt?
  reason, status, rejectionReason?, reviewedById?, reviewedAt?
```

---

## 7. Punch sources

All sources write the same `AttendancePunch` row and feed the same engine. Only
`source` differs, which is the point: the engine is built once.

| Source | Phase | Notes |
|---|---|---|
| `IMPORT` | 0 | XLSX/CSV from a terminal's export. Column mapping, dry-run preview, dedupe. |
| `MANUAL` | 0 | Admin or attendance officer, always with a reason, always audited. |
| `MOBILE` | 1 | Decision 1. §8. |
| `AGENT` | 2 | Local Sync Agent. §13. |
| `DEVICE_PUSH` | 4 | ADMS/ISAPI, only on demand. |

---

## 8. Mobile check-in

### 8.1 Flow

Employee opens the app on their phone → taps Check in → the browser supplies a
location fix → the phone signs a fresh server challenge with its enrolled key →
the server checks: signature valid, device is the user's one active device,
fix is inside one of the user's `WorkLocation`s, accuracy is acceptable → punch
recorded with `source = MOBILE`.

Location is per `WorkLocation` with its own radius, not the system-wide task
radius. A factory yard and a city-centre office need different circles, and a
company with three branches needs three.

### 8.2 One phone, and only a phone — what is achievable

Decision 1: an employee may check in from one mobile device only, and not from
any other type of device. **This is achievable, with one important limit that
depends on whether we stay a web app.**

**Binding to one device — yes, reliably.** A browser cannot read a phone's
hardware identity (IMEI, serial) — that is deliberate on the platform's part and
cannot be worked around. What it *can* do is generate a key pair inside the
browser with WebCrypto, marked non-extractable, stored in that browser on that
phone. The private key cannot be read out or copied to another device. We store
the public key at enrolment; every check-in must be signed by it.

Consequences, all of them acceptable and some of them the point:

- A different phone, a different browser on the same phone, or the same browser
  after its site data is cleared has no key → check-in refused → the employee
  files a `DeviceChangeRequest`, an admin approves, the old key is revoked. That
  approval step *is* the control; without it "one device" means nothing.
- The same pattern as `TrustedDevice`, which already does this for MFA with a
  hashed token — except a signed challenge is stronger than a bearer token,
  because nothing that crosses the network can be replayed.
- Enrolment happens once, on first check-in, and should itself need an admin's
  approval (or at minimum a notification), so an employee cannot enrol a
  colleague's phone on day one.

**Phone only, not a laptop — a deterrent, not a guarantee.** We can check the
browser's own mobile signal (`navigator.userAgentData.mobile`, the user agent,
touch capability) at enrolment and refuse desktops. All of those are reported
by the browser and can be faked by someone who knows how. In practice the
binding above does most of the work: whatever device is enrolled is the only
one that works, and enrolment is approved by a person.

**Location — the real weakness on the web.** A browser trusts whatever location
the operating system reports, and on Android a "mock location" app will report
anything. The web platform gives us no way to detect it. What we can do on the
web: reject fixes with poor accuracy, flag fixes that are suspiciously perfect
or identical across days, and show admins the pattern. What we cannot do on the
web is prevent it.

**If this must be strong, it needs a thin native app.** A native wrapper
(Capacitor around the existing Next.js UI) gets three things the web cannot:
mock-location detection, platform attestation (Play Integrity / App Attest —
proof the request came from our real app on a real, unmodified phone), and a
key held in the phone's secure hardware. Recommendation: **ship the web version
first**, designed so the native wrapper slots in later with no server change
beyond accepting the attestation. Whether tenants need the native version is
something the web version will tell us.

### 8.3 What one-device binding does not solve

An employee can hand their phone to a colleague who is at the office. Device
binding proves *which phone*, not *whose hand*. The fix, if it is ever needed,
is WebAuthn user verification — the phone's own fingerprint or face unlock
required at check-in — layered on top of the device key. Noted as a later
enhancement, not planned.

---

## 9. The derivation engine

### 9.1 Grouping and pairing

Group by **shift instance**, not calendar date. For each employee and local
date, resolve the schedule day (override first, then base), build its interval —
`endMinutes > 1440` spills into the next morning — and take every punch in that
window plus a margin (suggest 4 hours). Collapse repeats within a debounce
window (suggest 60 seconds). Pair in/out by sequence.

Never "earliest = in, latest = out" — it absorbs lunch as worked time and breaks
on multi-door sites. An odd punch count is `INCOMPLETE`; never guess a missing
punch-out, because guessing here is guessing at someone's pay.

### 9.2 Unmatched punches

A terminal punch with no `UserDeviceMapping` is stored with `userId` null and
shown on the exception screen. Creating the mapping backfills and re-derives.
Dropping them means an employee's first week silently never happened.

### 9.3 Applying policy

Measured facts (worked, late, early, overtime minutes) and priced outcomes
(`deductionDays`, `overtimeAmount`) are computed together but stored separately.
A policy change re-prices days in its effective range without re-measuring them,
and the exception screen can show both "12 minutes late" and "¼ day deducted".

Monthly rules — the free allowance, escalation, the cap — depend on the order of
days in the month, so pricing runs over the employee's month, not one day in
isolation.

### 9.4 Recomputation

Pure and idempotent. Triggered on ingest (affected employee-days only), on any
schedule/override/mapping/holiday/policy change (affected range), on approval of
a missing-punch or day-off request, and nightly by a reconciliation cron that
compares `inputsHash` and reports drift. A locked day is never rewritten.

---

## 10. The payroll boundary

Once the `PayrollRun` covering a date is `APPROVED`, every `AttendanceDay` in
that period is stamped with `lockedByPayrollRunId` and becomes immutable, and no
policy version may take effect inside it.

Before approval, the month's attendance outcome is written as `SalaryAdjustment`
rows with `source = ATTENDANCE` — one per employee per category (lateness,
absence, overtime), not one per day, so the payslip reads as three lines rather
than twenty-two.

A punch or approval that arrives after the lock surfaces as a discrepancy for an
admin to convert into an adjustment in the current period.

The single most important rule in the document: a system that silently edits a
paid payslip is worse than one with no attendance at all.

---

## 11. Admin screens

### 11.1 Daily exceptions (decision 2)

The default attendance screen shows **only what needs a decision**, today and
any unresolved days before it:

| Tab | Shows | Actions |
|---|---|---|
| Late | Late in or early out, with minutes and the resulting deduction | Excuse (with reason), accept |
| Absent | Expected, no punches, no leave | Mark as leave, mark present with reason, accept |
| Incomplete | Odd punch count | Add missing punch, link a pending missing-punch request |
| Unmatched | Terminal punches with no mapped employee | Map to employee (backfills) |
| Suspicious | Mobile punches with poor accuracy or repeating identical fixes | Accept, reject |

Counts on each tab, so an empty screen is visibly "nothing to do" rather than
"did it load?". An exception, once acted on, leaves the screen; it does not need
to be hidden by hand. The full register — everyone, every day — is a separate
view and an XLSX export.

Every action here writes to `AuditLog` with the actor and reason.

### 11.2 Device health on System Health (decision 4)

`/dashboard/health` already shows `JobHeartbeat` rows: last run, last success,
failure streak. Terminals and agents fit the same card shape:

- **Last seen** and **last sync**, with a stale threshold (suggest 30 minutes
  during working hours) that turns the row red.
- **Clock drift** from the last heartbeat, red above a threshold (suggest 120
  seconds).
- **Queue depth** reported by the agent — punches buffered but not yet
  delivered.
- **Agent version**, so an outdated install is visible.

That screen is Super Admin only and cross-company, which suits us (support). The
same data, filtered to one company, belongs on that company's Devices tab, so
the customer's own admin sees their terminal went offline without calling us.
An alert — notification plus email — when a device goes stale during working
hours, because a PC that was switched off on Thursday must not be discovered at
payroll.

---

## 12. Who corrects attendance (decision 7)

Admin, plus someone who is not an admin — typically an HR officer.

**Proposal: a grant, not a new role.** `UserRole` is referenced in over fifty
files. A new enum value touches every one of those checks, and it also forces a
choice: is the HR officer an `EMPLOYEE` who can correct attendance, or not an
employee? They are an employee — they check in themselves, have leave, get a
payslip. A role would take that away.

A grant is a flag on the user — `canManageAttendance`, or a small permission set
if more grants follow — that adds one capability on top of whatever role they
have. It is checked in exactly the places attendance is corrected, and nowhere
else.

Two rules that apply whichever way it is built:

- **Nobody corrects their own attendance.** The officer's own exceptions go to
  an admin. Otherwise the person best placed to fix attendance records is also
  the one person with a motive to fix their own.
- **Team leaders get read-only by default** — their team's exception screen,
  no corrections — with correction for their own team as a policy switch if a
  company wants it.

---

## 13. The Local Sync Agent

Unchanged from round 1. A signed Windows service (and a Linux binary) on an
always-on PC on the tenant's LAN: pulls from terminals over TCP via the vendor
SDK → durable local queue (SQLite) → pushes batches over outbound HTTPS →
advances its cursor only on 2xx → heartbeats. Enrolment by one-time code
exchanged for a rotatable, revocable token stored hashed. Clock drift detected
on every heartbeat. Device memory cleared only near 80% capacity, and the
clearing logged.

### 13.1 Ingest contract

```
POST /api/attendance/ingest
Authorization: Bearer <device token>
Idempotency-Key: <batch uuid>

{ "device_serial": "...", "agent_version": "...",
  "punches": [ { "hardware_user_id": "137",
                 "punched_at_local": "2026-09-20T08:30:00",
                 "device_direction": "IN", "raw": { } } ] }

POST /api/attendance/heartbeat
{ "device_time": "...", "agent_version": "...", "queue_depth": 0 }
```

Company from token, never body. Per-punch outcome in the response
(`accepted` / `duplicate` / `unmatched_user`). Rate-limited per device. Batch
cap around 1000.

---

## 14. Packaging — a paid add-on (decision 10)

Today `Bundle` is `'COMPANY_MANAGEMENT' | 'HR'`, backed by `Package.hasHR` and
`Package.hasCompanyManagement`. An add-on means a third bundle:

- `Bundle` gains `'ATTENDANCE'`; `Package` gains `hasAttendance`.
- `MODULE_BUNDLE` gains `ATTENDANCE: 'ATTENDANCE'`.
- `API_MODULE_ROUTES` gains `/api/attendance`.
- `lib/modules.ts` gains the sidebar entry.
- The Attendance tab in Company Options declares `requires: 'ATTENDANCE'`.

**The dependency on HR is the real decision.** Deductions and overtime write into
payroll, which is in the HR bundle. See open question §17.2.

Existing grandfathered companies (`packageId` null) are unrestricted today and
would receive attendance for free the day it ships. That is how the gate is
designed and it is probably fine, but it should be a decision, not a surprise.

---

## 15. Phasing

Each phase is independently shippable.

### Phase 0 — Engine, settings, import

- Company Options refactor into tabs (§4.1). Ships on its own first.
- Schedules, seasonal overrides, holidays, work week.
- Attendance policy with effective dating (§5).
- `AttendancePunch`, `AttendanceDay`, the engine (§9).
- XLSX/CSV import, manual entry.
- Missing-punch requests.
- Exception screen (§11.1) and full register.
- `canManageAttendance` grant (§12).
- The add-on bundle (§14).

*Exit: one real tenant runs a full month on imported data and agrees the numbers
are right.*

### Phase 1 — Mobile check-in

Work locations, device enrolment and binding, signed check-in, device change
requests, the Suspicious tab. Moved ahead of the agent because it needs no
hardware at the customer and reuses all of Phase 0.

### Phase 2 — Payroll integration

Attendance outcomes into `SalaryAdjustment`, the freeze in §10, discrepancies
after lock. Could be pulled into Phase 0 for a tenant who asks, with the freeze
rule unchanged. **Dry-run first** (§16.3).

### Phase 3 — Local Sync Agent

Device registry, enrolment, ingest, heartbeat, device health on System Health
and on the company's Devices tab.

### Phase 4 — Direct device push, and the native wrapper

Only on demand. ADMS needs a plain-HTTP ingress outside Vercel. The native
wrapper (§8.2) needs app-store publishing and is a product decision of its own.

---

## 16. Enhancements proposed in round 2

Not decided — each needs a yes or no.

1. **Permissions (إذن) allowance.** Common Egyptian practice: an employee may
   take a set number of hours a month (often 2–4) to arrive late or leave early,
   requested in advance. A late arrival covered by an approved permission is not
   lateness. Without this, companies that already work this way will either
   excuse every such day by hand or not buy the module. Fits cleanly as a
   request type next to missing-punch, with the allowance in the policy.

2. **Overtime pre-approval.** Many companies pay overtime only when it was asked
   for. Without approval, staying late becomes a way to raise one's own pay.
   A policy switch: when on, overtime is recorded but priced at zero until a
   manager approves it.

3. **Policy simulator before saving.** When an admin edits a rule, show what last
   month's deductions *would have been* under the new rule, per employee, next
   to what they were. Catches the misplaced decimal before it reaches a payslip,
   and is the first-month dry run from round 1 generalised.

4. **Employee transparency.** The employee's own view shows each day's status,
   the deduction it earned, and the rule that produced it — in the same words
   the payslip will use. Most attendance disputes are "nobody told me"; this
   removes the premise.

5. **Same-day nudges.** When a day becomes `INCOMPLETE` or `ABSENT`, notify the
   employee that day, through the existing `Notification` model, so the
   missing-punch request is filed while they still remember — not three weeks
   later at payroll.

6. **Policy templates.** A Super Admin-maintained starting point ("Standard
   Egyptian office", "Six-day factory") that a company copies and adjusts, so
   no new tenant faces nine empty forms.

7. **Holiday calendar seeded per country**, maintained once by a Super Admin and
   inherited by every company, with per-company additions. Egyptian public
   holidays are announced late and sometimes moved, so a central copy corrected
   once beats every company correcting its own.

---

## 17. Open questions

1. **Who edits attendance rules — Super Admin, the company's Admin, or both?**
   The settings page is Super Admin only today. If rules stay there, every
   customer policy change is a support ticket to us. If the company Admin edits
   them, the Attendance tab needs to be reachable from the company's own
   dashboard, not only from the Super Admin's company list.

2. **Does the attendance add-on require HR?** Deductions and overtime go through
   payroll. Either the add-on requires HR (simplest, and the gate enforces it),
   or it can be bought alone and the payroll-touching parts are hidden — which
   makes it a reporting module for those customers.

3. **Raw punch retention (question 9).** Every check-in is a row in
   `AttendancePunch` forever unless something deletes it. A 200-person company
   makes roughly 100,000 a year, more with mobile check-ins and double-taps. The
   existing `/api/cron/prune` already deletes old audit logs and notifications
   on a schedule; the question is whether punches get the same treatment, and
   after how long.

   The derived `AttendanceDay` is small (one row per person per day) and should
   be kept as long as payslips are, because it is what a payslip's deductions
   are explained by. The raw punches are only needed to *recompute* a day — and
   once its payroll is approved and locked, it will never be recomputed. So a
   reasonable default is: keep raw punches for the current year plus one, then
   prune punches belonging to locked days. The exact period is a legal question
   (labour record-keeping and dispute limitation periods) rather than a
   technical one, and should be confirmed before it is set.

4. **Enrolment approval for mobile devices** — required, or a notification only?

5. **Multiple terminals per site with roles** (entry vs exit), or all readers
   equivalent? Pairing assumes equivalent.

6. **Per-company or per-schedule work week** — both are supported in the model;
   which does the UI expose first?

---

## 18. Non-goals

- Door access control.
- Real-time streaming attendance.
- Storing or matching biometrics.
- Polling a tenant's device over the internet.
- Shift planning and rota building.
- Hardware identity (IMEI, serial) from a browser — not available to web pages,
  by design.
