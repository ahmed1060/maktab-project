# Clients, locations and costs: plan

This file holds the whole plan for clients (today's vendors), task
locations, costs, cash advances (عهدة) and saved lists. It is updated with
every decision and enhancement; the change log at the end records each
update.

Each part is marked:

- **Decided**: the product owner agreed to it.
- **Proposed**: suggested, waiting for the product owner's answer.
- **Open**: a question that needs answering before that part is built.

Nothing here is built yet.

> **A note on names.** Today's **Vendors** are renamed **Clients**, and
> today's **Clients** section becomes **Records** (§0). From here on, this
> plan uses the new names: "client" means what the app calls a vendor
> today. Where it refers to today's code, it gives the current names
> (`Vendor`, `vendorId`).

---

## 0. Renaming, and records moving onto clients

### 0.1 Vendors become Clients, on screen and in code (Decided)

Everything says **Client** (Arabic **العملاء**): the side bar, pages,
forms, filters, the Excel template, permissions, notifications, the audit
log, and the code itself.

In code that means:

- models and services;
- pages (`/dashboard/vendors` becomes `/dashboard/clients`);
- API routes;
- permission names (`vendors.*` becomes `clients.*`);
- module names, translation keys and tests.

Production has no data in these parts, so now is the right time.

### 0.2 Today's Clients section becomes Records, and moves onto clients (Decided)

- Today's Clients section keeps, for each business, **sections** of
  **notes**. A note can have an attached file, an expiry date and a
  reminder. These are now called **Records** (Arabic **السجلات**, and
  **سجلات العملاء** in the side bar).
- They're the same businesses as the clients, so records **move onto each
  client's page** and the same business is no longer kept in two places.
- **Timing** (Decided): now, as part of step 0.
  Production has no clients, sections or notes in this section, so its own
  list of businesses can simply be removed instead of renamed and merged
  later.
- **A Records item in the side bar** (Decided). It lists
  every record across clients, with search and an "expiring soon" filter.
  Suggested: yes.
- **Permissions:** today's `clients.*` (see, contribute, rename, delete)
  become `records.*`, covering sections and notes on a client's page.
- **The daily expiry reminder** (`/api/notes/check-expiry`) moves with the
  records.

### 0.3 Shipping the rename without breaking production (Decided)

**Why this needs care.** Every build, previews included, runs
`prisma migrate deploy` on the one shared database (`package.json`'s build
script). A PR's database changes therefore reach production as soon as the
PR is pushed. Production keeps running the old code against them until the
PR is merged and deployed, and review can take hours.

Two things make a single big rename unsafe:

- **The names swap.** "Clients" has to become "Records" before "Vendors"
  can become "Clients".
- **Every task page reads the vendor table.** Renaming that table while the
  old code is still live breaks all task pages until the merge.

**So step 0 is split into small PRs:**

| PR | What it does | Effect on production while it waits for review |
|---|---|---|
| 0a | Records move onto clients (§0.2): sections attach to the vendor table; today's empty clients table goes; `clients.*` permissions become `records.*`; the Records page and the reminder job move; the Super Admin dashboard's client count (`getSuperAdminOverviewStats`), which counts that table, counts the vendor table instead | Only today's Clients section stops working, and it's empty |
| 0b | Vendors become Clients in code (§0.1). The code still accepts the old `vendors.*` permission names, and the database names stay as they are for now | None |
| 0c | The stored permission names are rewritten from `vendors.*` to `clients.*`, and support for the old names is removed | None, because 0b already accepts both |
| 0d | The database's own names are renamed too, during a short planned maintenance window (Decided: see below) | None. The app is closed for about 15 minutes, at a time the product owner chooses |

The app ignores permission names it doesn't know instead of failing
(`lib/permissions/matrix.ts`), so the short overlaps above can't break
sign-in.

**PR 0d, the maintenance window:**

- It renames the `Vendor` table and the `vendorId` columns to their new
  names, and removes the old-name mapping from the code.
- It's kept small so its review is quick.
- When its checks pass:
  1. turn maintenance mode on;
  2. push the PR's last commit, which carries the migration;
  3. merge as soon as its checks pass again;
  4. turn maintenance mode off once production has deployed.

  That's about 15 minutes with the app closed.

### 0.4 What production holds today

- 0 vendors, 0 clients, 0 sections and 0 notes;
- 0 audit entries for either, and no company has changed their labels or
  icons;
- **36 role permission rows** use the `vendors.*` and `clients.*` names.
  These are rewritten by 0a and 0c.

Packages store bundle names, not module names, so renaming the modules
needs no data change.

---

## 1. Why: what the code does today

- **A task gets a client only if one is picked when the task is created.**
  The edit window has only a typed location, so a task's client can't be
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

---

## 2. Locations system

### 2.1 Kinds of location (Decided)

- **HQ**: each client has exactly one, marked as its head quarters.
- **Client locations**: branches and sites belonging to one client.
- **Shared locations**: places not tied to any client, usable by tasks for
  any client.

### 2.2 Names (Decided)

- The person adding a location types only its own name, such as "Maadi
  branch".
- A client's location is shown as **"Client - Location"**, for example
  "Al Noor - Maadi branch". A shared location is shown by its name alone.
- The client's name isn't stored inside the location's name; it's joined
  when shown. That way renaming a client updates all its locations.

### 2.3 On tasks (Decided)

- **The client is optional; the location is required.**
- **There's no typed location any more.** The location is always picked
  from the list.
- Picking a client selects its HQ as the location straight away. Another of
  that client's locations, or a shared one, can be picked instead.
- **Other clients' locations aren't offered.** The location list shows the
  task client's locations (HQ first), then shared locations. A task with no
  client shows shared locations only.

### 2.4 Adding a location from the task form (Decided)

- **"+ New location"** in the location picker. You enter a name and a map
  pin: search for the place, tap the map, or use this device's current
  location (the same map as the attendance check-in places).
- The new location is attached to the task's selected client automatically.
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

- **A Locations page**, like the Clients page:
  - lists every location, filtered by client or shared, with search;
  - add, edit, archive, and set HQ.
- **Each client's page** lists that client's locations.

### 2.7 Bulk upload (Decided)

- The Excel template already has a sheet behind the client dropdown
  (`lib/services/template-generator.service.ts`).
- Add a **Locations** sheet behind a new **Location** column, listing names
  such as "Al Noor - Maadi branch".
- **Each name in the list is unique.** A shared location could be called
  "Al Noor - Maadi branch" too, and a name can contain the " - ". So where
  two would read the same, each gets a number: "Al Noor - Maadi branch (2)".
- **The sheet keeps each name's location in a hidden column,** and the
  upload finds the location from that, never by matching the text. A name
  it can't find exactly once is flagged on the review screen, never
  guessed.
- The review screen flags a location that doesn't belong to the row's client
  and isn't shared, as it flags unknown clients today.

### 2.8 Existing clients (Decided)

- Each client's current single location becomes its HQ automatically.
- If that location has no coordinates, it's marked **"Needs a pin"** on the
  Locations page.
- Because pins are required, a location marked "Needs a pin" can't be picked
  on a task until someone places its pin.

### 2.9 Permissions (Decided)

| Permission | Default |
|---|---|
| See locations (the Locations page and the task form's pickers) | Anyone who can create tasks |
| Add locations | Anyone who can create tasks |
| Manage locations (edit pin and radius, archive, set HQ) | Admin |

- **Add locations and Manage locations include See locations,** so a role
  given either can see what it adds or manages.
- **A task shows its own location** to anyone who can see the task, without
  See locations.

### 2.10 Kept separate

The attendance check-in places (Company Settings → work locations) are a
separate system. On screen they're renamed **Check-in places** (أماكن
الحضور), and task locations stay **Locations** (`UI_PLAN.md` §3.3).

---

## 3. Client link and filters (Decided)

1. **The client and location pickers** (§2.3) on creating a task, editing a
   task, and the bulk import review. A change is checked to be in the same
   company and recorded in the task's history.
2. **A client filter on the Tasks and Costs pages**:
   - lists the company's clients, plus **"No client"**;
   - kept in the address, so a filtered link can be shared;
   - shown only to people allowed to see clients;
   - English and Arabic labels.
3. **A location filter on the Tasks page**, next to the client filter.
4. **"Mark all as paid" applies the client and location filters too**, with a
   test that it pays only the filtered costs.
5. **Totals for the current filters on the Costs page.** They count across all
   pages, and with an employee filter they show that employee's share.
6. **"View tasks" on each client**, opening Tasks filtered to that client.

---

## 4. Payment safety (Decided)

1. **"Mark all as paid" pays exactly what was confirmed.** The window says
   "Pay 7 costs, 3,450 EGP"; the server pays those 7 and nothing else. If
   anything changed in the meantime, it refuses and asks you to look again.
2. **A task with paid costs can't be deleted.**
3. **Archive clients.** A client linked to any task, or holding any
   records (§0.2), is archived instead of deleted. It's hidden from
   dropdowns, kept in filters and history, and can be restored. Records
   would otherwise go with the client, because sections are deleted with
   whatever they belong to, and deleting a client would get round the
   separate permission for deleting records.
4. **Fix the bug so cost descriptions are saved** (§1), in this step.
5. **Costs get their own table** (Decided).
   - Today each cost is an entry inside the task's JSON comments, with no id
     of its own. Removing one finds it by its timestamp.
   - Client charges (§6) and cash advances (§7) both need to point at one
     particular cost, for example to undo a charge or an advance payment
     when the cost is removed.
   - So costs move into their own table here, where the description fix
     already changes how they're saved. Production has no costs yet, so
     there's nothing to move.

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
   | Add list names | Everyone |
   | Manage lists (rename, merge, archive) | Admin |

8. **Where the field appears:**
   - task titles: creating a task, editing a task, and the bulk import
     review (Excel titles are matched to the list by name);
   - cost names: the Add cost form.
9. **Filters and totals:** by cost name on the Costs page, and by title on
   the Tasks page.

---

## 6. Client charges

### 6.1 The money (Decided)

- The company works as a middleman for the task's client.
- An employee may pay another shop on that client's behalf.
- The company then collects the money from the client.

One cost can create two separate things to track, settled at different
times:

1. **The employee is paid back.** This is the existing employee cost,
   unchanged.
2. **The client owes the company.** This is the new client charge.

The company never buys on credit, so nothing is tracked as owed to shops.

### 6.2 The Add cost form: no extra work for the employee (Decided)

- **The employee enters only the cost's details:** the amount, the cost
  name (from the list), and a receipt photo. There are no ticks to decide.
- **Every cost is paid back to the employee**, as today.
- **Every cost on a task with a client is charged to that client**
  automatically.
- **Exceptions are handled on the Costs page.** On the Charged to Clients
  tab, a **"Not charged to client"** tick removes a cost from the client. It
  can be used until the charge is collected, and unticking it charges the
  cost again. It's covered by the **Manage charges** permission (§6.6).

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

- **Costs page tabs: Employee costs | Charged to Clients.**
  - Charged to Clients filters by client, date, status and search.
  - It shows three totals: **Paid out**, **Service fees** and **Total due**.
  - A charge's status is **Due** or **Collected** (غير محصّل / محصّل).
- **Each client's page:**
  - **Due** and **Collected** totals;
  - each charge: what was bought, on which task, with the receipt;
  - **Mark collected** for exactly the charges shown, for example "Collect 7
    charges, 3,450 EGP from Al Noor".

### 6.5 Rules (Decided)

- **A client charge always comes from a task cost.** There are no standalone
  bills.
- **Collecting doesn't change the task's status.**
- **Collected charges are locked.** To fix one, mark it uncollected first;
  the audit log records both steps.
- **Charges always go to the task's client.** If the client is changed:
  - charges not yet collected move with it;
  - if any were collected, the change is refused until they're marked
    uncollected.
- A cost whose charge was collected can't be removed.
- A task or client with charges can't be deleted; the client is archived
  instead.
- Audit log entries, and English and Arabic labels, throughout.

### 6.6 Permissions (Decided)

| Permission | Admin | Team Leader | Employee |
|---|---|---|---|
| See charges | Company | Their team's tasks | No |
| Manage charges (set the service fee, and the "Not charged to client" tick) | Company | No | No |
| Mark charges collected | Company | No | No |

- **Mark charges collected** moves money, so it asks for two-factor
  sign-in, as paying costs does.
- Admins in existing companies get these automatically through a migration.
- The names follow `UI_PLAN.md` §3.1, principle 6: See, Add, Manage, plus a
  verb for anything that moves money.

### 6.7 Paid to (Decided: left out for now)

- **Paid to isn't the same as the cost name:**
  - the **cost name** is what the money was for, such as "Spare parts";
  - **Paid to** is who received it, such as "Delta Spare Parts".
- Paid to would add a field the employee has to fill in. The receipt photo
  already shows the shop, and the goal is as little work for the employee as
  possible.
- **Suggested: leave it out now**, and add it later (§9) if you want totals
  per shop.

---

## 7. Cash advances (عهدة)

### 7.1 What it is (Decided)

- Money the company gives an employee up front, to pay task costs from.
- **If they spend less,** they keep the rest and carry on paying from it.
- **If they spend more,** the extra is owed to them by the company.
- **Optional per company.** A company that doesn't use it works exactly as
  today.

### 7.2 How costs use it (Decided)

Each employee has **one running balance**: what they were given, less what
they spent and what they returned. A cost they add is paid from that
balance first, automatically:

| Balance before | Cost added | Paid from the advance | Balance after | Owed to the employee |
|---|---|---|---|---|
| 1,000 | 300 | 300 | 700 | 0 |
| 200 | 500 | 200 | 0 | 300 |
| 0 | 500 | 0 | 0 | 500 (as today) |

- **No extra work for the employee.** The Add cost form only shows their
  balance ("Your advance: 700 EGP"); there's nothing to choose.
- **Charging the client doesn't change.** The client is charged the full
  cost wherever the money came from (§6).
- **Each person on a task spends from their own advance.**

### 7.3 Giving, returning and leaving (Decided)

- **Give an advance:**
  - the amount, the date, a note, and optionally a photo of the signed
    hand-over;
  - it adds to the employee's balance;
  - topping up is simply another advance.
- **The employee confirms receipt** in the app ("I received 1,000 EGP"),
  so there's no later dispute over whether the money was handed over. The
  balance can be spent straight away; until confirmed, the advance shows as
  awaiting confirmation.
- **Record a return.** When the employee hands back unspent cash, an Admin
  records it and the balance goes down.
- **Owed money at hand-over.** When giving an advance to someone the company
  owes, the screen says so ("Ahmed is owed 300 EGP") and offers to pay it in
  the same hand-over.
- **Leaving the company.** Any balance still held becomes a debt
  (source: cash advance) in the existing debts feature, recovered through
  payroll or the final settlement as other debts are.

### 7.4 The ledger and rules (Decided)

- **Every movement is an entry:**
  - **Given**;
  - **Spent**, linked to the cost and its task;
  - **Returned**;
  - **Correction**.

  The balance is always the sum of the entries, never a stored number that
  could drift.
- **Entries are never edited.** A mistake is fixed with a correction entry,
  and the audit log records it.
- **The balance never goes below zero.** Anything spent beyond it is owed to
  the employee.
- **Spent entries are made when the cost is added,** so the balance shown is
  always current.
- **Removing a cost** (allowed only while the task is In progress) puts its
  advance part back on the balance.
- **"Mark all as paid" pays only the part owed to the employee,** never the
  part already paid from the advance.
- **An advance can be given only to an active employee** of the company.
- **The feature can't be switched off,** by the Admin or the Super Admin,
  while any employee still holds advance money.
- Amounts are kept to 2 decimal places, and English and Arabic labels are
  used throughout.

### 7.5 Where it shows (Decided)

- **Costs page, a Cash advances tab:**
  - each employee's balance;
  - Give advance, Record return, and each employee's history;
  - the total held by employees.
- **On each cost**, in the Employee costs tab and on the task: **From
  advance** and **To pay back**.
- **The employee's own page:** My cash advance, in the side bar's Me group
  (`UI_PLAN.md` §2.1), with the balance and its history (given, spent on
  which task, returned).

### 7.6 Turning it on (Decided)

- **The Super Admin allows cash advances for a company.** A company that
  hasn't been allowed them doesn't see the feature at all.
- **Once allowed, the company's Admin can switch them off and on again** in
  Company Settings.
- **Neither of them can switch it off** while any employee still holds
  advance money. The balances must be spent or returned first.

### 7.7 Permissions (Decided)

| Permission | Admin | Team Leader | Employee |
|---|---|---|---|
| See cash advances | Company | Their team | Their own only |
| Give and settle cash advances (give, record returns, corrections) | Company | No | No |

- **Giving and settling moves money,** so it asks for two-factor sign-in,
  as paying costs does.
- **The name says everything it allows,** because the role editor shows
  only permission names: giving an advance, and settling it with returns
  and corrections. In Arabic: صرف العُهد وتسويتها.
- Every employee always sees their own balance.
- **Team Leaders don't give advances by default.** Because it's a
  permission, it can be given to any role.

---

## 8. Build order (Decided)

| Step | What it covers |
|---|---|
| 0 | Renaming and records moving onto clients, as PRs 0a–0d (§0) |
| 1 | Locations system: the database, every client's HQ, per-location radius, the Locations page, locations on each client's page, permissions (§2) |
| 2 | Tasks use locations: the client and location pickers on create, edit and bulk review; "+ New location"; the Excel Locations sheet; typed locations removed; the check uses the location's pin and radius (§2.3–2.7, §3.1) |
| 3 | Filters and totals: client and location filters, "No client", totals, "View tasks", "Mark all as paid" applying the filters (§3) |
| 4 | Payment safety and the cost description fix (§4) |
| 5 | Saved lists (§5) |
| 6 | Client charges (§6) |
| 7 | Cash advances (§7) |

- Each step is its own PR (or several, for step 0), opened against `main`
  and merged only on the product owner's word.
- **Order with `UI_PLAN.md`** (Decided; full detail in `UI_PLAN.md` §5):
  1. **Before step 0:**
     - settle the names and the side bar groups. Done on 2026-10-15
       (`UI_PLAN.md` §2, §3);
     - build the shared page building blocks in one PR. No old page is
       converted in it;
     - move the 3 pages this plan doesn't otherwise touch (the dashboard
       home, whose client count changes in 0a, Employees and Day Off
       Requests) onto the building blocks, in one
       small PR. Merged in #78 on 2026-10-15. It also adds
       building blocks these steps will use: the row menu, the selection
       bar, the dialog, the text area and the radio choice;
     - add the brand colour setting, in one small PR (`UI_PLAN.md` §4.6).
       Merged in #80 on 2026-10-16.
     - make the older pages, the side bar and the sign-in page follow
       the brand colour, in one small PR after it (`UI_PLAN.md` §4.6).
       Built on 2026-10-16, waiting to be merged.
  2. **Steps 0–7 above.**
     - The new side bar groups land with step 0.
     - Every screen these steps create or rework uses the building blocks:
       Clients, Locations, Records, the Costs tabs, Cash advances, and the
       task form's pickers.
  3. **Then the rest of `UI_PLAN.md`:** the remaining old pages, one by one,
     and the one Requests page.
- **When the UI work starts,** it's done page by page in small PRs merged
  into `main`, on a fresh branch from `main`. It uses `DESIGN.md` and the
  design tools in `UI_PLAN.md` §7, with UI/UX Pro Max copied across from
  `ui-refactor`.

---

## 9. Later (future enhancements)

- **An exportable client statement:** what the client was charged and what
  was collected for a date range, with receipts. It can be sent to the
  client or checked against their records.
- **"Paid by the company."** A tick on the Costs page for a cost the company
  paid directly (office cash or card), so the employee isn't paid back. Until
  then, every cost is paid back to the employee who added it.
- **Paid to,** if it's dropped now (§6.7): who received the money, from a
  saved list, for totals per shop.
- **An advance for a particular task or client,** in addition to the general
  running balance (§7).

---

## 10. Open questions

None right now. The last one, names across the whole system, was settled
on 2026-10-15 in `UI_PLAN.md` §2–§3:

- the statuses are **Due / Collected** (غير محصّل / محصّل);
- task locations stay **Locations**, and the attendance "work locations"
  become **Check-in places**;
- the permission names follow See, Add, Manage, plus a verb for anything
  that moves money;
- عهدة is **Cash advance** in English.

## 11. Turned down

- **"Paid to" picked from shared locations.** Paid to stays separate from
  locations.
- **Tracking money owed to shops.** The company doesn't buy on credit.
- **Task types.** Task titles are titles only.
- **Adding list names automatically.** Only "+ Add" adds them.
- **Renaming on screen only.** The code is renamed too.
- **Ticks on the employee's Add cost form.** Every cost is paid back and
  charged; exceptions are handled on the Costs page.

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
    - Vendors become Clients on screen;
    - "+ New location", existing vendors' HQ, the location filter, list
      management, every permission default, the build order, and doing this
      before the UI refactor;
    - a vendor charge always comes from a task cost;
    - the service fee is zero or more.
  - **Added:**
    - names suggested for today's Clients section;
    - "pay me back" on by default;
    - Paid to under discussion.
- **2026-10-12:** Further answers.
  - **Decided:**
    - today's Clients section is named **Records**, and records move onto
      each client's page;
    - the rename covers the code as well as the screens;
    - the cost description fix ships in step 4;
    - no ticks on the employee's Add cost form: every cost is paid back and
      charged to the task's client, with a "Not charged to client" tick on
      the Costs page for exceptions;
    - "Paid by the company" moved to future enhancements.
  - **Added:**
    - how the rename ships without breaking production (PRs 0a–0d, §0.3);
    - what production holds today (§0.4);
    - Paid to explained against the cost name, with dropping it suggested
      (§6.7).
  - The plan now uses the new names throughout.
- **2026-10-12:** Cash advances (عهدة) added (§7).
  - **Decided:** money given to an employee up front to pay task costs
    from; an unspent rest is kept and spent later; spending more is owed
    to the employee; optional per company.
  - **Proposed:**
    - one running balance per employee, paid from automatically;
    - the employee confirming receipt;
    - returns and owed money settled at hand-over;
    - a leftover balance becoming a debt when the employee leaves;
    - the ledger and its rules, where it shows, the switch, and the
      permissions;
    - costs moved into their own table in step 4 (§4.5);
    - cash advances as step 7.
  - **Open:** questions 7–11 in §10. Later sections are renumbered (build
    order §8, later §9, open questions §10, turned down §11).
- **2026-10-12:** Cash advance answers.
  - **Decided:**
    - the Super Admin allows cash advances for a company, and its Admin can
      then switch them off and on (§7.6);
    - neither can switch them off while employees hold advance money;
    - the details in §7.2–7.5;
    - Team Leaders don't give advances by default (§7.7);
    - costs move into their own table in step 4 (§4.5);
    - cash advances are step 7.
  - **Added to the open questions:** shipping the rename as PRs 0a–0d
    (question 7 in §10).
- **2026-10-15:** Further answers.
  - **Decided:**
    - records move onto clients now, in step 0;
    - Records gets its own side bar item;
    - the rename ships as PRs 0a–0d;
    - the database's own names are renamed too, in PR 0d, during a planned
      maintenance window of about 15 minutes;
    - the "Not charged to client" tick is covered by Manage charges;
    - Paid to is left out for now.
  - **Moved:** the remaining names go into a discussion of naming and
    organisation for the whole system (§10).
- **2026-10-15:** The order with `UI_PLAN.md` is decided (§8):
  - before step 0, the names and side bar groups are settled and the
    shared page building blocks are built;
  - steps 0–7 follow, with the side bar groups in step 0 and every new
    screen on the building blocks;
  - then the rest of the UI plan.
- **2026-10-15:** The design tools are decided, in `UI_PLAN.md` §7. The
  note on how the UI work starts (§8) now points there, instead of to the
  single design skill.
- **2026-10-15:** The names are settled in `UI_PLAN.md` §2–§3, so the last
  open question here (§10) is closed. This file now uses them:
  - **Statuses (§6.4):** Due / Collected (غير محصّل / محصّل). "Total to
    collect" becomes Total due, and the client page's "Owes us" becomes
    Due.
  - **Check-in places (§2.10):** the on-screen name for the attendance work
    locations, apart from task Locations.
  - **Records (§0.2):** سجلات العملاء in the side bar.
  - **Permission names:**
    - charges (§6.6): See charges, Manage charges, Mark charges collected;
    - cash advances (§7.7): See cash advances, Give and settle cash advances;
    - saved lists (§5): Add list names, Manage lists.

    §6.2 had still called who may use the "Not charged to client" tick
    open. It now points to Manage charges, as already decided.
  - **My cash advance (§7.5):** in the side bar's Me group.
  - **Order (§8):** the 3 pages this plan doesn't touch move onto the
    building blocks before step 0.
- **2026-10-15:** The look is chosen (style A, `UI_PLAN.md` §7.2), and the
  brand colour is a setting (`UI_PLAN.md` §4.6). §8 adds the brand colour PR
  before step 0, so every screen these steps build already follows a
  company's colour.
- **2026-10-15:** The 3 pages are built on the building blocks, waiting to
  be merged (§8). The steps here can use the building blocks that PR added:
  the row menu, the selection bar, the dialog, the text area and the radio
  choice.
- **2026-10-15:** From Codex's review of #73 and #75:
  - a client holding records is archived, not deleted (§4);
  - See locations is in the permissions, for anyone who can create tasks,
    and Add and Manage include it (§2.9);
  - the bulk upload's location names are unique, and each carries its
    location in a hidden column (§2.7);
  - the Super Admin dashboard's client count moves in step 0a (§0.3);
  - the role editor says what Give cash advances also allows (§7.7).
- **2026-10-15:** The product owner renamed the cash advance permission
  **Give and settle cash advances** (صرف العُهد وتسويتها), so its name says
  that it also records returns and corrections (§7.7). The line under it in
  the role editor is no longer needed.
- **2026-10-16:** Before step 0: the 3 pages' PR was merged in #78, and
  the brand colour setting is built, waiting to be merged (§8).
- **2026-10-16:** The brand colour PR (#80) has Codex's review findings
  fixed, still waiting to be merged (§8, `UI_PLAN.md` change log).
- **2026-10-16:** The brand colour PR (#80) costs a page no database
  reads of its own, still waiting to be merged (§8, `UI_PLAN.md` change
  log).
- **2026-10-16:** At the product owner's choice, the older pages, the side
  bar and the sign-in page follow the brand colour now, in a small PR
  after the setting's, before step 0 (§8, `UI_PLAN.md` §4.6).
- **2026-10-16:** The brand colour setting was merged in #80. The older
  pages' PR is open, waiting to be merged (§8).
