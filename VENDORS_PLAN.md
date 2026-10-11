# Vendors, locations and costs: plan

This file holds the whole plan for vendors, task locations, costs and saved
lists. It is updated with every decision and enhancement; the change log at
the end records each update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.
- **Under discussion**: being talked through.

Nothing here is built yet.

> **A note on names.** Vendors are being renamed **Clients** on screen (§0).
> This plan keeps saying "vendor", because that's what the code calls them
> and because today's Clients section is a different thing.

---

## 0. Names on screen

### 0.1 Vendors become Clients (Decided)

Everywhere the screens say "Vendor", they'll say **"Client"** instead
(Arabic **"العملاء"**). That covers:

- the side bar and page titles;
- forms and filters;
- the Excel template's sheet and column;
- permission labels;
- notifications and the audit log.

"Charged to Vendors" becomes **"Charged to Clients"** on its own, because it
uses each company's own label.

### 0.2 Today's Clients section gets a new name (Open)

What it does today:

- each business has **sections**;
- each section holds **notes**;
- a note can have an attached file, an expiry date, and a reminder some days
  before it expires.

So it's a record-keeping and reminder tool. Suggested names:

| Suggestion | Arabic | Why |
|---|---|---|
| **Records** (suggested) | السجلات | Fits notes and files kept per business |
| Documents | المستندات | Puts the attached files and expiry dates first |
| Files | الملفات | Simple and familiar |

### 0.3 Screen names only (Proposed)

- **Only the words on screen change.** The code, database and permission
  keys keep their current internal names.
  - Renaming those would mean migrating stored roles, packages and every
    company's settings, which is risky and gains nothing for users.
  - Developers will see `vendors.*` for what screens call Clients, and
    `clients.*` for the renamed section. A table in the code will record the
    mapping.
- **A company's own custom label still wins.** If a company already renamed
  the section, it keeps that name.

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

### 2.4 Adding a location from the task form (Decided)

- **"+ New location"** in the location picker. You enter a name and a map
  pin: search for the place, tap the map, or use this device's current
  location (the same map as the attendance check-in places).
- The new location is attached to the task's selected vendor automatically.
  A **"Shared location"** tick makes it shared instead.
- A one-off place never blocks creating a task, and it joins the list for
  next time.

### 2.5 Map pin and check radius (Decided)

- **Every location must have a map pin.** A location can't be saved with a
  name only. The pin is what the employee location check measures against,
  so every task gets the check, and the per-location radius always has a
  point to measure from.
- **A check radius per location.** Each location can have its own radius.
  When it's left empty, the default of 70 m is used. The map shows the
  radius as a circle around the pin.
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

### 2.8 Existing vendors (Decided)

- Each vendor's current single location becomes its HQ automatically.
- If that location has no coordinates, it's marked **"Needs a pin"** on the
  Locations page.
- Because pins are required, a location marked "Needs a pin" can't be picked
  on a task until someone places its pin.

### 2.9 Permissions (Decided)

| Permission | Default |
|---|---|
| Add locations | Anyone who can create tasks |
| Manage locations (edit pin and radius, archive, set HQ) | Admin |

### 2.10 Kept separate

The attendance check-in places (Company Settings → work locations) are a
separate system. The two need clearly different names on screen (§9).

---

## 3. Vendor link and filters (Decided)

1. **The vendor and location pickers** (§2.3) on creating a task, editing a
   task, and the bulk import review. A change is checked to be in the same
   company and recorded in the task's history.
2. **A vendor filter on the Tasks and Costs pages**:
   - lists the company's vendors, plus **"No vendor"**;
   - kept in the address (`?vendorId=`), so a filtered link can be shared;
   - shown only to people allowed to see vendors;
   - English and Arabic labels.
3. **A location filter on the Tasks page**, next to the vendor filter.
4. **"Mark all as paid" applies the vendor and location filters too**, with a
   test that it pays only the filtered costs.
5. **Totals for the current filters on the Costs page.** They count across all
   pages, and with an employee filter they show that employee's share.
6. **"View tasks" on each vendor**, opening Tasks filtered to that vendor.

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
   first is open (§9, question 1).

---

## 5. Saved lists for cost names and task titles (Decided)

1. **Each company has its own lists** of cost names and task titles.
2. **Type or pick.** As you type, matching names from the list appear. If
   what you typed isn't on the list, a line offers **"+ Add 'X' to the
   list"**.
3. **Names are added only by tapping "+ Add".** They're never added
   automatically.
4. **Task titles are titles only.** Picking one doesn't fill in the
   description or difficulty; there are no "task types".
5. **What's saved:** the text as entered plus a link to the list entry. Old
   records never change when an entry is edited, and reports still group
   them.
6. **A management page under Company Settings:**
   - rename an entry;
   - merge two entries, such as "transport" into "Transport";
   - archive an entry;
   - names can't repeat, ignoring capital letters.
7. **Permissions:**

   | Permission | Default |
   |---|---|
   | Add names to the lists | Everyone |
   | Manage the lists (rename, merge, archive) | Admin |

8. **Where the field appears:**
   - task titles: creating a task, editing a task, and the bulk import
     review (Excel titles are matched to the list by name);
   - cost names: the Add cost form.
9. **Filters and totals:** by cost name on the Costs page, and by title on
   the Tasks page.

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

### 6.2 The Add cost form

- **The cost's details** (Decided): the amount, the cost name (from the
  list), and a receipt photo. **Paid to** is under discussion (§6.7).
- **"I paid it, pay me back"** (Decided) creates an employee cost, as today.
  It's on by default, so nothing changes for people who add costs the way
  they do now.
- **"Charge to [vendor]"** (Decided) creates a vendor charge. It's on by
  default when the task has a vendor.
- Both choices can be on for the same cost.
- **Who can tick "Charge to vendor"** is open (§9, A1).
- **What "pay me back" switched off means** is open (§9, A2).

### 6.3 Service fee (Decided)

- Three amounts side by side: **Paid | Service fee | Total**.
- Typing a service fee works out the total; typing a total works out the
  service fee.
- **The fee can't be negative**, so the total is never below what was paid.
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
  - each charge: what was bought, on which task, with the receipt;
  - **Mark collected** for exactly the charges shown, for example "Collect 7
    charges, 3,450 EGP from Al Noor".

### 6.5 Rules (Decided)

- **A vendor charge always comes from a task cost.** There are no standalone
  bills.
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

### 6.6 Permissions (Decided)

| Permission | Admin | Team Leader | Employee |
|---|---|---|---|
| View vendor charges | Company | Their team's tasks | No |
| Set service fee | Company | No | No |
| Mark collected | Company | No | No |

- **Mark collected** moves money, so it asks for two-factor sign-in, as
  paying costs does.
- Admins in existing companies get all three automatically through a
  migration.

### 6.7 Paid to (Under discussion)

This is the shop or person who received the money for a cost, for example
"Delta Spare Parts".

- **It isn't** a vendor (client), a location (decided in §12), or someone the
  company owes money to (it never buys on credit).
- **Options:**
  - **(a) None.** The receipt photo already shows the shop.
  - **(b) Typed text.** Quick, but spellings vary, so totals per shop
    aren't reliable.
  - **(c) A saved list** (type or pick, as in §5). Names stay consistent and
    totals per shop work.
- **Suggested:** (c), optional on each cost.

---

## 7. Build order (Decided, apart from step 0)

| Step | What it covers |
|---|---|
| 0 | **Proposed:** the name changes in §0, on their own, so they're easy to review |
| 1 | Locations system: the database, every vendor's HQ, per-location radius, the Locations page, locations on each vendor's page, permissions (§2) |
| 2 | Tasks use locations: the vendor and location pickers on create, edit and bulk review; "+ New location"; the Excel Locations sheet; typed locations removed; the check uses the location's pin and radius (§2.3–2.7, §3.1) |
| 3 | Filters and totals: vendor and location filters, "No vendor", totals, "View tasks", "Mark all as paid" applying the filters (§3) |
| 4 | Payment safety and the cost description fix (§4) |
| 5 | Saved lists (§5) |
| 6 | Vendor charges (§6) |

- Each step is its own PR, opened against `main` and merged only on the
  product owner's word.
- **This work comes before the UI refactor** (Decided). When the refactor
  starts:
  - write its plan first;
  - do it page by page, in small PRs merged into `main`;
  - start a fresh branch from `main` and copy the design skill across.

---

## 8. Later

- **An exportable vendor statement:** what the vendor was charged and what
  was collected for a date range, with receipts. It can be sent to the
  vendor or checked against their records.

---

## 9. Open questions

1. **When to fix the cost description bug.**
   - (a) As its own small PR now. It would be ready within a day, and costs
     keep their descriptions from then on.
   - (b) Inside step 4 (payment safety), several PRs from now. Any cost
     entered in production before then loses its description for good.
   - Production has no costs yet, so nothing has been lost so far.
   - Suggested: (a).
2. **A new name for today's Clients section** (§0.2). Suggested: Records.
3. **Screen names only** (§0.3), and step 0 as its own PR.
4. **Are the businesses in today's Clients section the same ones that will
   now be called Clients (today's vendors)?** If they are, the notes and
   reminders could later move onto each client's page, so the same business
   isn't kept in two places. If not, the two stay separate.
5. **A1: who can tick "Charge to vendor" when adding a cost?**
   - (a) Anyone on the task, with no permission needed. The person holding
     the receipt decides on the spot.
   - (b) Only people with a permission. Charging the client is a business
     decision, so employees record the cost and someone else decides.
   - Suggested: (a), plus anyone allowed to set the service fee can charge
     or un-charge a cost later, until it's collected. That catches mistakes
     either way.
6. **A2: what does "pay me back" switched off mean?** Suggested: the company
   paid directly. The four combinations:

   | Pay me back | Charge to vendor | Meaning |
   |---|---|---|
   | On | On | The employee paid. The company pays them back, and the vendor pays the company |
   | On | Off | The employee paid. The company pays them back and keeps the cost (for example, transport) |
   | Off | On | The company paid directly. The vendor pays the company back |
   | Off | Off | The company paid directly and keeps the cost. It's recorded for the record only |

7. **Paid to** (§6.7): option (a), (b) or (c), and whether it's optional.
8. **Names still to settle:**
   - Paid to;
   - the statuses To collect and Collected;
   - Locations, which must read differently from the attendance "work
     locations";
   - the permission names in §2.9, §5.7 and §6.6.

## 10. Turned down

- **"Paid to" picked from shared locations.** Paid to stays separate from
  locations.
- **Tracking money owed to shops.** The company doesn't buy on credit.
- **Task types.** Task titles are titles only.
- **Adding list names automatically.** Only "+ Add" adds them.

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
- **2026-10-11:** Answers to the open questions and proposals.
  - **Decided:**
    - task titles are titles only, and list names are added only by "+ Add";
    - Vendors become Clients on screen (§0.1);
    - "+ New location", existing vendors' HQ, the location filter, list
      management, every permission default, the build order, and doing this
      before the UI refactor;
    - a vendor charge always comes from a task cost;
    - the service fee is zero or more.
  - **Added:**
    - names suggested for today's Clients section (§0.2);
    - screen names only, and step 0 (§0.3, §7);
    - "pay me back" on by default (§6.2);
    - Paid to under discussion (§6.7).
  - **Open, with explanations:** questions 1–8 in §9.
