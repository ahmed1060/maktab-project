# Attendance & Time Tracking — Implementation Plan

Status: **proposal, not scheduled.** Nothing here is built. This document
records what we would build, in what order, and which decisions are already
settled so that the person who picks it up is not re-arguing them.

It is a response to an earlier draft (`zkteco_integration_guide.md`) that
described a universal hardware webhook. That draft was right about the
architecture and wrong about the order of work. The reasoning for the change is
in [§2](#2-what-changes-from-the-original-draft).

---

## 1. Where this system actually stands

Worth stating plainly, because the original draft assumed otherwise.

**What exists.** `Company` is the tenant boundary. `User` is the employee.
Payroll is real and finished: `PayrollRun` (DRAFT → APPROVED → PAID, unique per
company/month/year), `Payslip`, `PayslipLine`, `SalaryChange` (effective-dated),
`SalaryAdjustment`, `FinalSettlement`, `Debt`. Leave is real: `DayOffRequest`
with an approval queue and `DayOffCreditSnapshot`. There is a cron runner with a
fail-closed secret (`lib/cron-auth.ts`) and a health table (`JobHeartbeat`).
There is an audit trail (`AuditLog`), a rate limiter (`RateLimit`), a feature
gate keyed on packages (`lib/features/bundles.ts`, `lib/features/routes.ts`), and
a timezone-aware date layer (`lib/time.ts`, defaulting to `Africa/Cairo` but
already parameterised).

**What does not exist.** Any notion of *when someone was supposed to be at
work*. No attendance model, no shift, no schedule, no working-week definition,
no holiday calendar, no timesheet. Search the schema: there is nothing between
`DayOffRequest` and `Payslip`.

That gap is the whole project. A fingerprint device emits a person's ID and a
timestamp; turning that into "late by 12 minutes, owed 1.5 hours overtime,
deduct half a day" requires a schedule to measure against, and we have no
concept of one. The hardware integration is the easy half.

---

## 2. What changes from the original draft

The draft proposed: build a universal webhook → devices push to it → a cron
processes raw logs into timesheets.

Four changes.

### 2.1 Build the domain before the pipe

Ingesting punches into a table that nothing can interpret is not progress. The
first shippable thing is the attendance *engine* — shifts, schedules, a derived
day, a missing-punch workflow, the payroll link — fed by a spreadsheet import.
Every ZKTeco and Hikvision terminal on the market exports XLSX or CSV, and
`exceljs` is already a dependency. A tenant can be getting value in weeks with
zero hardware risk, and we get real punch data to validate the calculation
engine against before we commit to a sync agent.

### 2.2 The Local Sync Agent is the product, not the fallback

The draft framed direct device push as the modern path and the local agent as a
concession to old hardware. It is the other way round.

ZKTeco "ADMS push" does not send our JSON. It speaks its own protocol: a
handshake on `GET /iclock/cdata?SN=…&options=all`, then batched
tab-separated plaintext on `POST /iclock/cdata?SN=…&table=ATTLOG`, and it
expects specific plaintext replies or it retries indefinitely or silently drops
the batch. It varies by model and firmware. Many units are **HTTP-only on port
80** with no working TLS — Vercel will redirect them to HTTPS and the device
will not follow, which alone kills the "just paste the URL" story on our current
hosting. Authentication is the serial number in a query string.

So "Option A" is not *accept a webhook*, it is *implement and maintain a
protocol adapter per vendor family, on an ingress that can serve plain HTTP*.
That is a later phase, justified by a specific customer's hardware.

The local agent, by contrast, is one codebase that talks to any device over the
LAN through the vendor SDK, and reaches us over ordinary outbound HTTPS. No
inbound firewall rule, no port forward, no certificate on a 2015 embedded stack.
That is also the easiest thing to sell to a customer's IT contact.

### 2.3 The payload must not carry `tenant_id` or an HR employee ID

The draft's payload was:

```json
{ "tenant_id": "...", "employee_id": "emp-987", "punch_type": "check-in" }
```

Three problems.

- **`tenant_id` is self-asserted.** Anyone who finds the URL writes punches into
  any company. The company must be *derived server-side* from the device
  credential and never read from the body — the same rule `lib/company-scope.ts`
  already enforces everywhere else.
- **`employee_id` contradicts the draft's own section 4**, which correctly says
  device IDs rarely match ours. If the agent knew our IDs we would be shipping a
  copy of the tenant's HR directory to a PC in their office. The payload carries
  the *hardware* user ID; resolution happens here.
- **`punch_type` from the device is close to worthless.** The in/out status flag
  is routinely misconfigured on site, and employees press the wrong key. Keep it
  as a recorded hint; never let it decide anything.

### 2.4 `ProcessedStatus` as a boolean is a one-way door

Late punches arrive. Mappings get corrected. A shift gets fixed a week after the
fact. A boolean "this row has been folded into a timesheet" means none of those
can ever be reflected.

The derived attendance day should be a **pure function of (raw punches +
schedule + policy)**, rebuildable from scratch for any employee and date range.
Then "processed" is a cache we can invalidate, not a decision we can't revisit.
This matters more here than in most places because the output determines pay.

---

## 3. Design decisions (settled)

| Decision | Why |
|---|---|
| Raw punches are append-only and never edited | They are evidence. Corrections live in the derived layer, with an author and a reason. |
| Ingest endpoint only authenticates + inserts + returns 200 | A slow webhook makes agents retry, which amplifies load exactly when we are struggling. Derivation happens elsewhere. |
| At-least-once delivery assumed; dedupe by unique index | Agents re-pull overlapping windows and retry on network failure. `@@unique([deviceId, hardwareUserId, punchAt])` is what makes the whole agent design safe to write naïvely. |
| Biometric templates never leave the device | We receive IDs and timestamps. A fingerprint template in our database is a special-category-data compliance burden nobody is paying us for. |
| Attendance freezes when its payroll run is APPROVED | See [§7.4](#74-the-payroll-boundary). |
| Timezone is per company, stored on `Company` | `lib/time.ts` already takes a `timeZone` parameter; the default is Cairo. Multi-country tenants break the hardcoded assumption and the fix is cheap now, expensive later. |
| Attendance is an HR-bundle module | It sits with `DAY_OFF` and `PAYROLL` in `MODULE_BUNDLE`. A Company-Management-only buyer does not get it. |

---

## 4. Data model (sketch)

Names and shapes for discussion, not final. Every model is company-scoped
through either a direct `companyId` or its `User`.

### 4.1 Schedule layer — the part that does not exist today

```
model WorkSchedule            // a named pattern: "Office 9–5", "Factory night"
  id, companyId, name, isDefault
  timeZone?                   // null = the company's
  graceInMinutes              // lateness tolerance before it counts
  graceOutMinutes
  minOvertimeMinutes          // below this, overtime is not credited
  breakMinutes                // unpaid, deducted from worked time
  roundingMinutes?            // e.g. round to nearest 5; null = exact

model ScheduleDay             // one row per weekday per schedule
  scheduleId, weekday (0-6)
  isRestDay
  startMinutes, endMinutes    // minutes from local midnight; end may exceed
                              // 1440 to express a shift crossing midnight
  isHalfDay

model UserSchedule            // effective-dated assignment, like SalaryChange
  userId, scheduleId, effectiveFrom, effectiveTo?

model Holiday                 // company calendar; paid non-working days
  companyId, date, name, isPaid
```

The effective-dated `UserSchedule` is deliberate and copies the lesson already
written into `SalaryChange`: *when a change was entered* and *when it takes
effect* are two different facts, and a schedule change entered on the 20th that
applies from the 1st is ordinary.

`endMinutes` exceeding 1440 is how a night shift is expressed without special
cases downstream. A shift is an interval on a number line anchored to a local
date, not a pair of clock faces.

### 4.2 Device layer

```
model AttendanceDevice
  id, companyId
  name                        // "Front door", tenant-facing
  serialNumber                // as printed on the unit; unique per company
  vendor                      // ZKTECO | HIKVISION | OTHER | MANUAL
  timeZone?                   // null = company's; a device may sit elsewhere
  lastSeenAt, lastSyncAt
  clockDriftSeconds?          // measured each sync, see §8.3
  isActive

model DeviceCredential        // what an agent or device authenticates with
  id, deviceId
  tokenHash                   // never the token itself
  createdAt, lastUsedAt, revokedAt?

model UserDeviceMapping       // hardware ID → our User
  id, companyId, deviceId?    // null = applies across all this company's devices
  hardwareUserId
  userId
  @@unique([companyId, deviceId, hardwareUserId])
```

Mapping is company-wide by default because the same badge number is normally the
same person on every reader in the building; the per-device override exists for
the site that numbered its readers independently.

### 4.3 Raw layer

```
model AttendancePunch
  id, companyId, deviceId
  hardwareUserId
  userId?                     // resolved at ingest; null = unmatched, see §8.2
  punchAtLocal                // what the device said, naive, as text
  punchAt                     // resolved UTC instant
  resolvedWithTimeZone        // which zone produced punchAt
  deviceDirection?            // the device's in/out flag — a hint only
  source                      // AGENT | DEVICE_PUSH | IMPORT | MANUAL
  rawPayload      Json?       // the untouched line, for forensics
  receivedAt
  @@unique([deviceId, hardwareUserId, punchAt])
  @@index([companyId, userId, punchAt])
```

Storing the naive local string *alongside* the resolved instant is not
redundancy. A device with a wrong timezone setting, or a DST transition handled
badly, makes `punchAt` wrong — and if the original string is gone the row is
unrepairable. Keeping both means a bad batch is a re-derivation, not a loss.

### 4.4 Derived layer

```
model AttendanceDay
  id, companyId, userId
  date                        // local calendar date the shift is anchored to
  scheduleDayId?              // what we measured against; null = rest/holiday
  firstInAt?, lastOutAt?
  workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes
  status                      // PRESENT | ABSENT | REST | HOLIDAY | ON_LEAVE
                              // | INCOMPLETE | MANUAL
  isManuallyAdjusted
  derivedAt, inputsHash       // see below
  lockedByPayrollRunId?       // set when its run is APPROVED
  @@unique([companyId, userId, date])

model MissingPunchRequest     // mirrors DayOffRequest's shape and approval flow
  id, userId, date
  claimedInAt?, claimedOutAt?
  reason, status, rejectionReason?
  reviewedById?, reviewedAt?
```

`inputsHash` is a digest of everything the row was computed from (the punch IDs,
the schedule version, the policy values). A nightly reconciliation recomputes
and compares; a mismatch means an input changed after the fact and the row is
stale. That is how late punches and corrected mappings get picked up without
scanning everything, and how we can prove a figure has not silently drifted.

`status = ON_LEAVE` is where this meets `DayOffRequest`: an approved leave day is
not an absence, and the two modules must agree on that without either one
guessing.

---

## 5. Phasing

Each phase is independently shippable and independently sellable. That is the
point of the ordering.

### Phase 0 — Attendance without hardware

- Schedule layer (§4.1), with a Schedules admin screen and per-employee
  assignment.
- `AttendancePunch` + `AttendanceDay` + the derivation engine (§7).
- **XLSX/CSV import** of device exports, as a first-class feature, not a stopgap:
  column mapping UI, dry-run preview, dedupe against existing punches.
  `lib/csv.ts` and `exceljs` already exist.
- Manual punch entry and correction by an admin, fully audited.
- `MissingPunchRequest` + approval queue, modelled on the day-off flow.
- Employee-facing "my attendance" view; admin daily/monthly register.
- Export to XLSX.
- Feature gating: new `ATTENDANCE` module in `MODULE_BUNDLE` under `'HR'`, a
  `lib/modules.ts` entry with label/icon, `/api/attendance` in
  `API_MODULE_ROUTES`.

*Exit criterion: a real tenant runs a full month on imported data and agrees the
numbers are right.* Do not start Phase 1 before this.

### Phase 1 — Local Sync Agent

- Device registry + enrollment flow (§8.1).
- Ingest endpoint (§6) with per-device credentials.
- The agent itself (§8): pulls over LAN, buffers, pushes, heartbeats.
- Device health dashboard + offline alerting, reusing the `JobHeartbeat`
  presentation.
- Signed installer, versioning, and an update path.

### Phase 2 — Payroll integration

Deliberately after Phase 1, because the numbers must be trusted before they move
money. Deductions for lateness and absence, overtime as a `PayslipLine`, the
freeze rule in §7.4, and the late-punch-after-approval path through
`SalaryAdjustment`.

Arguably this could sit at the end of Phase 0 for tenants importing manually. If
a customer demands it there, the freeze rule still applies unchanged.

### Phase 3 — Direct device push (`/iclock` / ISAPI)

Only when a specific customer's hardware justifies it. Requires solving the
plain-HTTP ingress first, which is a hosting decision, not a code one: a small
always-on proxy (Fly/Railway/a VPS) terminating port 80 and forwarding
authenticated batches to us. Do not attempt this on Vercel directly.

---

## 6. Ingest contract

```
POST /api/attendance/ingest
Authorization: Bearer <device token>
Idempotency-Key: <agent batch uuid>

{
  "device_serial": "ZK8000-0042",
  "agent_version": "1.2.0",
  "punches": [
    { "hardware_user_id": "137",
      "punched_at_local": "2026-09-20T08:30:00",
      "device_direction": "IN",
      "raw": { ... } }
  ]
}
```

- Company is resolved from the token → `DeviceCredential` → `AttendanceDevice`.
  It is never present in the body.
- Response reports per-punch outcome (`accepted` / `duplicate` /
  `unmatched_user`) so the agent can stop retrying what we already have.
- Rate-limited per device through the existing `RateLimit` table.
- Batch cap (suggest 1000 punches), with the agent chunking above it.
- Returns 200 on partial success. A 5xx means *retry the whole batch* and the
  dedupe index makes that safe.

Separate endpoint for liveness:

```
POST /api/attendance/heartbeat   → { device_time, agent_version, queue_depth }
```

The `device_time` in the heartbeat is what drives clock-drift detection (§8.3).

---

## 7. The derivation engine

### 7.1 Grouping

Group by **shift instance**, not calendar date. For each employee and each local
date, take the `ScheduleDay` in force (via `UserSchedule` effective on that
date), build its interval — `[date + startMinutes, date + endMinutes]`, where
`endMinutes > 1440` naturally spills into the next morning — and pull every
punch in that window plus a configurable margin either side (suggest 4 hours, so
an early arrival or a long overrun still attaches to the right shift).

Grouping by calendar date, as the original draft did, breaks on every night
shift in the country.

### 7.2 Pairing

Order the window's punches by time. Collapse repeats inside a debounce window
(suggest 60 seconds — double-taps at the reader are constant). Then pair them
in/out/in/out by sequence.

Do **not** use "earliest = in, latest = out". It silently absorbs a lunch break
as worked time, and on a multi-door site it attributes the gate punch and the
floor-door punch to the same pair.

An odd number of punches means `status = INCOMPLETE`, which is what the
`MissingPunchRequest` flow exists to resolve. Never guess a missing punch-out;
guessing here means guessing at someone's pay.

### 7.3 Recomputation

Derivation is pure and idempotent. Triggers:

- on ingest, for the affected employee-days only;
- on schedule, mapping, holiday or policy change, for the affected range;
- on approval of a `MissingPunchRequest`;
- nightly, a reconciliation cron that recomputes recent days and compares
  `inputsHash`, reporting drift.

A locked day (§7.4) is never rewritten by any of these. It is recorded as a
pending discrepancy instead.

### 7.4 The payroll boundary

Once the `PayrollRun` covering a date is `APPROVED`, every `AttendanceDay` in
that period is stamped with `lockedByPayrollRunId` and becomes immutable.

A punch arriving afterwards — an agent that was offline for a week, a
retroactively approved missing-punch request — does not rewrite a payslip
someone has already been paid against. It surfaces as a discrepancy for an admin
to convert into a `SalaryAdjustment` in the current period. That mechanism
already exists and already knows how to explain itself on a payslip.

This is the single most important rule in the document. A system that silently
edits a paid payslip is worse than one that has no attendance at all.

---

## 8. The Local Sync Agent

Scope: a small service (Python, packaged as a signed Windows service, plus a
Linux binary) running on any always-on PC on the tenant's LAN.

Loop: connect to each configured device over TCP → pull attendance logs since
the last cursor → normalise → append to a local durable queue (SQLite) → push
batches to the ingest endpoint → advance the cursor **only on a 2xx** →
heartbeat every N minutes.

Outbound HTTPS only. No inbound port, no firewall change, no static IP.

### 8.1 Enrollment

Admin adds a device in our UI and is shown a one-time enrollment code. The agent
is installed and given the code; it exchanges it for a device token that is
stored locally in the OS credential store and only ever transmitted as a bearer
token. We store the hash. Revocation is a row update; rotation is supported from
day one, because a token that cannot be rotated is a token that will live on a
decommissioned PC forever.

### 8.2 Unmatched users

A punch whose `hardwareUserId` has no mapping is **stored, not dropped**, with
`userId` null, and raised in an "unmatched punches" queue. When the admin creates
the mapping, the backfill resolves the existing rows and re-derives the affected
days. Dropping them means the employee's first week of attendance silently never
existed.

### 8.3 Clock drift

Every heartbeat carries the device's own clock reading. We compare it to server
time, store the delta on the device, and alert above a threshold (suggest 120
seconds). NTP sync is worth attempting from the agent but is frequently blocked
on these networks, so *detection* matters more than *correction*: a device
running 40 minutes fast makes everyone look early, and without this we would
find out at payroll.

### 8.4 Device memory

As the original draft said, and worth keeping: do not clear device logs on every
pull. Clear only near capacity (~80%), so the tenant retains a hardware backup of
their own attendance data. Add: log what was cleared and when, so "the device was
wiped" is answerable.

---

## 9. Security model

- Company derived from credential, never from payload. Non-negotiable.
- Tokens stored hashed; rotation and revocation in the UI from day one.
- Per-device rate limiting via `RateLimit`; a runaway agent should be throttled,
  not able to fill the table.
- Replay protection through the dedupe index plus an `Idempotency-Key` per
  batch.
- Payload size and batch-count caps, enforced before parsing.
- Every manual attendance edit, mapping change, schedule change and token action
  written to `AuditLog`. This data determines pay; the edit history is evidence,
  and we should assume it will one day be read in a dispute.
- No biometric templates, ever. If a vendor SDK offers them, the agent must not
  request them.

---

## 10. Enhancements worth considering

Beyond the original draft.

1. **Geofenced mobile check-in as a parallel track.** We already have location
   verification for tasks and `Company.autoVerifyLocation` as a policy switch.
   For a lot of SMB tenants a phone-based check-in *is* the whole feature, at a
   fraction of the cost and with no support burden from a dusty PC in a back
   office. It also shares the entire Phase 0 engine — only the punch source
   differs, which is exactly what `AttendancePunch.source` is for. Strong
   candidate for validating demand before committing to Phase 1.

2. **Schedule templates per company, assignable in bulk.** Most tenants have two
   or three patterns, not one per employee.

3. **Exception-first admin UI.** Nobody wants to read 200 rows of "present,
   on time". The daily screen should default to lates, absences, incompletes
   and unmatched punches. The full register is an export.

4. **A dry-run mode for payroll deductions.** Before the first month where
   attendance touches pay, an admin should be able to see what the deductions
   *would have been*. The trust cost of getting month one wrong is very high.

5. **Ramadan / seasonal hours** as a dated schedule override rather than an
   edit to the base schedule, so last year's hours remain recoverable.

6. **Device health as part of the existing System Health screen**, alongside
   `JobHeartbeat`, rather than a new dashboard nobody opens.

7. **Per-company timezone** should land in Phase 0 even though nothing needs it
   yet. Retrofitting a timezone through a table full of resolved instants is
   painful; adding the column while the table is empty is free.

---

## 11. Open questions

These need a decision before Phase 0 starts. Listed without answers on purpose.

1. Does lateness deduct pay, or is it reported only? If it deducts — by the
   minute, by fixed penalty bands, or by a policy per company?
2. Is overtime paid, banked as time off, or recorded only? At what multiplier,
   and does it differ on rest days and holidays?
3. Who may correct attendance — Admin only, or also a team leader for their own
   team? (The day-off flow's answer is the natural precedent.)
4. What is the working week per company? Fri/Sat, Sat/Sun, or arbitrary?
   `ScheduleDay.isRestDay` assumes arbitrary, which is more work but is the only
   answer that survives a second country.
5. Do we support multiple devices per site with different roles (entry vs exit),
   or are all readers equivalent? The pairing logic in §7.2 assumes equivalent.
6. Retention on `AttendancePunch` — this table grows fastest of anything we have
   (a 200-person tenant produces ~100k punches a year). `/api/cron/prune`
   exists; what is the policy, and does the derived layer survive the raw layer
   being pruned? (It should: that is another reason the derived row stores its
   own totals rather than recomputing on read.)
7. Is attendance sold inside the HR bundle, or as its own paid add-on? The
   `Package` model has boolean columns per bundle; a third would be a schema
   change with pricing implications.

---

## 12. Non-goals

Stated so they do not creep in.

- Access control / door opening. We read attendance events; we do not decide who
  gets through a door.
- Real-time streaming attendance. Minutes of latency is fine for payroll; the
  complexity of live is not worth it.
- Storing or matching biometrics.
- Supporting a tenant who wants us to poll their device directly over the
  internet. Some will ask, having set up a port forward. The answer is the agent.
- Shift *planning* and rota building. This module measures attendance against a
  schedule; deciding who works when is a different product.
