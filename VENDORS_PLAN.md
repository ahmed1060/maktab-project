# Vendors, locations and costs: plan

This file holds the whole plan for vendors, task locations, costs and saved
lists. It is updated with every decision and enhancement; the change log at
the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Nothing here is built yet.

---

## 1. Why: what the code does today

- **A task gets a vendor only if one is picked when the task is created.**
  The edit window has only a typed location, so a task's vendor can't be
  added, changed or removed later (`components/TaskEditDetailsModal.tsx`;
  `TaskService.updateDetails` ignores `vendorId`).
- **Typed locations rarely have map coordinates.** After a task is created,
  an employee's reported position is checked against the task's location
  (`extractCoords(task.location)` in `lib/services/task.service.ts`). With no
  coordinates, the check is skipped.
- **One check radius for everything**: 70 m by default
  (`SystemSettings.locationVerifyRadiusMeters`), whether the place is a small
  shop or a large factory.
- **"Mark all as paid" re-runs the search on the server**
  (`app/api/tasks/payment/bulk/route.ts`), so it can pay costs added after
  the person looked at the page.
- **A paid task can be deleted, and its payment record goes with it**
  (`TaskService.delete` doesn't check payment).
- **Deleting a vendor quietly unlinks all its tasks** (`onDelete: SetNull`).
- **Bug: cost descriptions are thrown away.** The task's cost form sends a
  description with each cost, but the server saves only the amount ("Added
  cost: 150.00 EGP"), so every cost shows "No description".
- **Production has no vendors and 1 task**, so no existing data needs moving
  in production.

---

## 2. Locations system

### 2.1 Kinds of location (Decided)

- **HQ**: each vendor has exactly one, marked as its head quarters.
- **Vendor locations**: branches and sites belonging to one vendor.
- **Shared locations**: places not tied to any vendor, usable by tasks for
  any vendor.

### 2.2 Names (Decided)

- The person adding a location types only its own name, such as "Maadi
  branch".
- A vendor's location is shown as **"Vendor - Location"**, for example
  "Al Noor - Maadi branch". A shared location is shown by its name alone.
- The vendor's name isn't stored inside the location's name; it's joined
  when shown. That way renaming a vendor updates all its locations.

### 2.3 On tasks (Decided)

- **The vendor is optional; the location is required.**
- **There's no typed location any more.** The location is always picked
  from the list.
- Picking a vendor selects its HQ as the location straight away. Another of
  that vendor's locations, or a shared one, can be picked instead.
- **Other vendors' locations aren't offered.** The location list shows the
  task vendor's locations (HQ first), then shared locations. A task with no
  vendor shows shared locations only.

### 2.4 Adding a location from the task form (Proposed)

- **"+ New location"** in the location picker. You enter a name and a map
  pin: search for the place, tap the map, or use this device's current
  location (the same map as the attendance check-in places).
- The new location is attached to the task's selected vendor automatically.
  A **"Shared location"** tick makes it shared instead.
- A one-off place never blocks creating a task, and it joins the list for
  next time.

### 2.5 Map pin and check radius

- **Every location must have a map pin** (Decided). A location can't be saved
  with a name only. The pin is what the employee location check measures
  against, so every task gets the check, and the per-location radius always
  has a point to measure from.
- **A check radius per location** (Decided). Each location can have its own
  radius. When it's left empty, the default of 70 m is used. The map shows
  the radius as a circle around the pin.
- **A pin corrected later applies to open tasks.** Tasks link to the
  location, so they use the corrected pin and radius. Location checks
  already done keep their result. Old tasks with typed locations keep
  showing their text.

### 2.6 Pages (Decided)

- **A Locations page**, like the Vendors page:
  - lists every location, filtered by vendor or shared, with search;
  - add, edit, archive, and set HQ.
- **Each vendor's page** lists that vendor's locations.

### 2.7 Bulk upload (Decided)

- The Excel template already has a **Vendors** sheet behind the Vendor
  dropdown (`lib/services/template-generator.service.ts`).
- Add a **Locations** sheet behind a new **Location** column, listing names
  such as "Al Noor - Maadi branch".
- The review screen flags a location that doesn't belong to the row's vendor
  and isn't shared, as it flags unknown vendors today.

### 2.8 Existing vendors (Proposed)

- Each vendor's current single location becomes its HQ automatically.
- If that location has no coordinates, it's marked **"Needs a pin"** on the
  Locations page.
- Because pins are required, a location marked "Needs a pin" can't be picked
  on a task until someone places its pin.

### 2.9 Permissions (Proposed)

| Permission | Default |
|---|---|
| Add locations | Anyone who can create tasks |
| Manage locations (edit pin and radius, archive, set HQ) | Admin |

### 2.10 Kept separate

The attendance check-in places (Company Settings → work locations) are a
separate system. The two need clearly different names on screen (see the
naming list in §9).

---

## 3. Vendor link and filters

1. **The vendor and location pickers** (§2.3) on creating a task, editing a
   task, and the bulk import review. A change is checked to be in the same
   company and recorded in the task's history. (Decided)
2. **A vendor filter on the Tasks and Costs pages** (Decided):
   - lists the company's vendors, plus **"No vendor"**;
   - kept in the address (`?vendorId=`), so a filtered link can be shared;
   - shown only to people allowed to see vendors;
   - English and Arabic labels.
3. **A location filter on the Tasks page**, next to the vendor filter.
   (Proposed)
4. **"Mark all as paid" applies the vendor and location filters too**, with a
   test that it pays only the filtered costs. (Decided)
5. **Totals for the current filters on the Costs page.** They count across all
   pages, and with an employee filter they show that employee's share.
   (Decided)
6. **"View tasks" on each vendor**, opening Tasks filtered to that vendor.
   (Decided)

---

## 4. Payment safety (Decided)

1. **"Mark all as paid" pays exactly what was confirmed.** The window says
   "Pay 7 costs, 3,450 EGP"; the server pays those 7 and nothing else. If
   anything changed in the meantime, it refuses and asks you to look again.
2. **A task with paid costs can't be deleted.**
3. **Archive vendors.** A vendor linked to any task is archived instead of
   deleted. It's hidden from dropdowns, kept in filters and history, and can
   be restored.
4. **Fix the bug so cost descriptions are saved** (§1). Shipping it on its own
   first is open (question 3 in §9).

---

## 5. Saved lists for cost names and task titles

1. **Each company has its own lists** of cost names and task titles. (Decided)
2. **Type or pick.** As you type, matching names from the list appear. If
   what you typed isn't on the list, a line offers **"+ Add 'X' to the
   list"**. (Decided)
3. **What's saved:** the text as entered plus a link to the list entry. Old
   records never change when an entry is edited, and reports still group
   them. (Proposed)
4. **A management page under Company Settings** (Proposed):
   - rename an entry;
   - merge two entries, such as "transport" into "Transport";
   - archive an entry;
   - names can't repeat, ignoring capital letters.
5. **Permissions** (Proposed):

   | Permission | Default |
   |---|---|
   | Add names to the lists | Everyone |
   | Manage the lists (rename, merge, archive) | Admin |

6. **Where the field appears** (Decided):
   - task titles: creating a task, editing a task, and the bulk import
     review (Excel titles are matched to the list by name);
   - cost names: the Add cost form.
7. **Filters and totals:** by cost name on the Costs page, and by title on
   the Tasks page. (Proposed)
8. **"Paid to" shop names as a third list**, using the same type-or-pick
   field. (Proposed)

---

## 6. Vendor charges

### 6.1 The money (Decided)

- The company works as a middleman for the task's vendor.
- An employee may pay another shop on that vendor's behalf.
- The company then collects the money from the vendor.

One cost can create two separate things to track, settled at different
times:

1. **The employee is paid back.** This is the existing employee cost,
   unchanged.
2. **The vendor owes the company.** This is the new vendor charge.

The company never buys on credit, so nothing is tracked as owed to shops.

### 6.2 The Add cost form (Decided)

- **The cost's details:** the amount, the cost name (from the list), a
  receipt photo, and **Paid to** (the shop's name).
- **"I paid it, pay me back"** creates an employee cost, as today.
- **"Charge to [vendor]"** creates a vendor charge. It's on by default when
  the task has a vendor.
- Both choices can be on for the same cost.

### 6.3 Service fee (Decided)

- Three amounts side by side: **Paid | Service fee | Total**.
- Typing a service fee works out the total; typing a total works out the
  service fee.
- The fee can't be negative, so the total is never below what was paid.
- If the paid amount is corrected, the fee stays and the total updates.
- Amounts are kept to 2 decimal places.
- The server stores the paid amount and the fee, and always works out the
  total itself.
- The fee is locked once the charge is collected.

### 6.4 Where charges show (Decided)

- **Costs page tabs: Employee costs | Charged to Vendors.**
  - Charged to Vendors filters by vendor, date, status and search.
  - It shows three totals: **Paid out**, **Service fees** and **Total to
    collect**.
- **Each vendor's page:**
  - **Owes us** and **Collected**;
  - each charge: what was bought, where from, on which task, with the
    receipt;
  - **Mark collected** for exactly the charges shown, for example "Collect 7
    charges, 3,450 EGP from Al Noor".

### 6.5 Rules (Decided)

- **Collecting doesn't change the task's status.**
- **Collected charges are locked.** To fix one, mark it uncollected first;
  the audit log records both steps.
- **Charges always go to the task's vendor.** If the vendor is changed:
  - charges not yet collected move with it;
  - if any were collected, the change is refused until they're marked
    uncollected.
- A cost whose charge was collected can't be removed.
- A task or vendor with charges can't be deleted; the vendor is archived
  instead.
- Audit log entries, and English and Arabic labels, throughout.

### 6.6 Permissions (Decided: they are permissions. Proposed: the defaults)

| Permission | Admin | Team Leader | Employee |
|---|---|---|---|
| View vendor charges | Company | Their team's tasks | No |
| Set service fee | Company | No | No |
| Mark collected | Company | No | No |

- **Mark collected** moves money, so it asks for two-factor sign-in, as
  paying costs does.
- Admins in existing companies get all three automatically through a
  migration.
- Ticking "Charge to vendor" needs no permission.

---

## 7. Build order (Proposed)

| PR | What it covers |
|---|---|
| 1 | Locations system: the database, every vendor's HQ, per-location radius, the Locations page, locations on each vendor's page, permissions (§2) |
| 2 | Tasks use locations: the vendor and location pickers on create, edit and bulk review; "+ New location"; the Excel Locations sheet; typed locations removed; the check uses the location's pin and radius (§2.3–2.7, §3.1) |
| 3 | Filters and totals: vendor and location filters, "No vendor", totals, "View tasks", "Mark all as paid" applying the filters (§3) |
| 4 | Payment safety and the cost description fix (§4) |
| 5 | Saved lists (§5) |
| 6 | Vendor charges (§6) |

Each PR is opened against `main` and merged only on the product owner's word.

---

## 8. Later

- **An exportable vendor statement:** what the vendor was charged and what
  was collected for a date range, with receipts. It can be sent to the
  vendor or checked against their records.
- **Task types and adding list names automatically,** if questions 1 and 2
  in §9 say so.

---

## 9. Open questions

1. **Task titles: title only, or a "task type"?** A task type would also fill
   in the description and difficulty when picked. Suggested: title only for
   now.
2. **Should the lists ever add a name automatically,** for example after it's
   typed 3 times? Suggested: no, keep the "+ Add" line.
3. **The cost description bug:** fix it on its own right away, or inside the
   payment safety PR?
4. **Names** (decided later). The working names are:
   - Paid to;
   - Charged to Vendors (using each company's own label for vendors);
   - the statuses To collect and Collected;
   - Locations, which must differ from the attendance "work locations";
   - the permission names in §2.9, §5.5 and §6.6.

## 10. Proposals waiting for an answer

1. **The permission defaults** in §2.9, §5.5 and §6.6, including two-factor
   sign-in for Mark collected.
2. **"+ New location" from the task form** (§2.4).
3. **Existing vendors' locations becoming their HQ** (§2.8).
4. **The location filter on Tasks** (§3.3).
5. **List management, and filters and totals by cost name and title**
   (§5.3, §5.4, §5.7).
6. **"Paid to" as a third saved list** (§5.8).
7. **The build order** (§7).
8. **This work before the UI refactor.** When the refactor starts:
   - write its plan first;
   - do it page by page, in small PRs merged into `main`;
   - start a fresh branch from `main` and copy the design skill across,
     rather than reviving the old `ui-refactor` branch.

## 11. Assumptions to confirm

- **Anyone on the task can tick "Charge to vendor"** when adding a cost.
- **With "pay me back" off, the company paid directly.**
- **A vendor charge always comes from a task cost.** There are no standalone
  vendor bills.
- **The service fee is zero or more.** There's no discount below what was
  paid.

## 12. Turned down

- **"Paid to" picked from shared locations.** Paid to stays separate from
  locations.
- **Tracking money owed to shops.** The company doesn't buy on credit.

---

## Change log

- **2026-10-11:** File created. It covers:
  - the vendor link and filters;
  - payment safety, including enhancements 1–6 adjusted for the middleman
    model;
  - the service fee and Total linked both ways;
  - permissions for vendor charges;
  - saved lists for cost names and task titles;
  - the locations system: HQ, vendor and shared locations, no typed
    locations, and the vendor optional with the location required.

  Added in this update:
  - the check radius per location;
  - other vendors' locations not offered on a task;
  - "Paid to" not taken from shared locations.
- **2026-10-11:** A map pin is required for every location (§2.5). A
  location marked "Needs a pin" can't be picked on a task until it has one
  (§2.8). The open questions in §9 are renumbered.
