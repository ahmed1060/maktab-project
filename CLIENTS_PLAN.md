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

**Built in PR 0a** (merged in #82 on 2026-10-23):

- each client's page (`/dashboard/clients/[id]`, `/dashboard/vendors/[id]`
  until 0b) shows its details
  and its records, with a filter by section, and its sections, which can be
  added, renamed and deleted. A client's first record names its first
  section;
- a record has its text, up to 10 files of up to 4 MB each, and an optional
  expiry date with a reminder some days before it. A record's text that a
  list cuts short opens whole in a dialog (`DESIGN.md` §5.5);
- the Records item in the side bar, in the Menu group where the old Clients
  item was, until the side bar's new groups come (below). Its page lists
  every client's records, with search (by a record's text, its section's
  name or its client's name) and the expiry filter;
- **Decided:** the Records page's Add record opens the whole form there:
  which client (a search by name appears once a company has more than the
  first 50), that client's section or a new one, then the text, files and
  expiry. The record is added without leaving the page. This is how someone
  who may add records but not see the vendors list, as an ordinary
  employee, adds a client's first record. A client's own page keeps its Add
  record, which opens the same form for that client, with no client to
  choose;
- the permissions are `records.view`, `records.contribute`, `records.edit`
  and `records.delete`, with the same codes, meaning and holders as the old
  `clients.*`;
- the reminder job is `/api/records/check-expiry`, and a reminder links to
  the record's own address, `/dashboard/records/[id]`, which opens it on its
  client's page. That address doesn't change when vendors become clients.
- a record carries only files uploaded for records in its own company. A
  file is removed from storage once no record has it, and files a record's
  form uploaded but didn't save, because the form was closed or a save
  failed, are removed again (`DELETE /api/records/uploads`, ten to a
  request). A failed save keeps what it uploaded for the next try. A
  record is given a new file only once storage says it has it, and a
  Super Admin's own upload only by a Super Admin;
- two people adding records into the same new section at once get one
  section, and a client isn't deleted while a record is being added to it.
  A section deleted as a record is added to it takes that record's files
  with it;
- a record's expiry, its badges, the filter and the reminders are counted
  by the day where its company is, in the company's own time zone. A
  reminder goes out only for the date it was found for, so a date changed
  as the job runs gets its own reminder.
- edits and deletes read a record's files as they write, so a file added
  by an edit just before isn't left in storage; deleting a company removes
  its records' files too. A record a Super Admin added or edited says so
  (two new columns), and one by a user since deleted reads "Deleted user".
  Which Super Admin added a record is kept too, so its reminders reach them.
- an edit says which files the record had when its form opened, and is
  refused if someone changed them since: the person opens the record again.
- removing a file from storage and giving a record a file each hold the
  file, and a removed file is noted (`RemovedRecordFile`), so no record is
  given a file that's gone.
- on the Records page, Add record lists only the chosen company's clients:
  a Super Admin who picks another company while it's open sees that
  company's load, not the last one's, and a search that fails says so.
  Editing a record there loads its client's sections in the form, and says
  if they didn't load. A record moved to a section deleted at that moment
  is refused, rather than failing. A Super Admin looking at every company
  sees each record's company on a phone, and in the record when it's
  opened, as on a computer.
- deleting a section holds its client first, as deleting the company does,
  so the two can't deadlock, and its audit entry has its title as it was
  when deleted.

**Proposed** (built this way in 0a, for the product owner to confirm or
change):

- **"Expires soon"** shows from 30 days before a record's expiry date, up to
  and including the day, and "Expired" after it. The filter has both, with
  "Expired" beside the decided "Expiring soon".
- **A reminder** goes to whoever added the record, a Super Admin too, as
  it did in the old section: the chosen number of days before, and on the day. It says how
  many days are actually left. Changing the date or the reminder sends them
  again for the new date; the old section never did, so a renewed licence
  was never reminded about again.
- **A client with records can't be deleted** until its records are. Deleting
  it would otherwise delete its licences and contracts with it, unasked.

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
| 0a | Records move onto clients (§0.2): sections attach to the vendor table; today's empty clients table is no longer used; `clients.*` permissions become `records.*`; the Records page and the reminder job move; the Super Admin dashboard's client count (`getSuperAdminOverviewStats`), which counts that table, counts the vendor table instead | Only today's Clients section stops working, and it's empty |
| 0b | Vendors become Clients in code (§0.1). The code reads both the old `vendors.*` permission names and the new ones, and writes the old; the database names stay as they are for now. 0a's triggers and the old section's own rows go (see below) | None |
| 0c | The stored permission names are rewritten from `vendors.*` to `clients.*`, and the code writes the new names, still reading both. Today's clients table is dropped | None, because 0b already accepts both |
| 0d | The database's own names are renamed too, during a short planned maintenance window (Decided: see below). Any old permission name left is rewritten, and the code stops reading them. The old clients table's column on sections is dropped | None. The app is closed for about 15 minutes, at a time the product owner chooses |

The app ignores permission names it doesn't know instead of failing
(`lib/permissions/matrix.ts`), so the short overlaps above can't break
sign-in.

**How 0a keeps to this** (built):

- **Today's clients table stays until 0c.** Main's code counts it on the
  Super Admin's dashboard, so dropping it in 0a would break that page while
  0a waits for review. 0a only stops using it: a section gets a client
  column, the old column is no longer required, and a check says a section
  has exactly one of the two. 0b keeps it too, for 0a's code (below).
- **The database renames old names on the way in.** Main's code still
  writes `clients.*` while 0a waits for review, for a company created then,
  and a company's own name for the old section's side bar item. Triggers
  rename them to `records.*` and to Records as they're written, so nothing
  written meanwhile is lost to 0a's code.
- **Main's editors can't drop a Records grant.** Main's role and template
  editors save every grant they know and drop the rest, and they don't know
  `records.*`. So a `records.*` grant stays when a write that isn't 0a's
  would remove it, and main writing a grant's old name for one a role keeps
  is that grant. 0a marks its own writes, so it can still remove one
  (`lib/records-release.ts`, migration `20261104000003_records_grants_kept`).
- **0b therefore also:**
  1. deletes the old section's own rows, if any (production has none). Its
     table is dropped in 0c instead, and its column on sections in 0d: 0a's
     code, live while 0b waits for review, reads every column of a section,
     the old one too, and 0b's own does while 0c waits;
  2. drops 0a's triggers and their functions, before "clients" takes its new
     meaning, the ones keeping Records grants too, and `lib/records-release.ts`
     with its calls;
  3. sends the old `/dashboard/vendors/...` addresses on to
     `/dashboard/clients/...`, for links already sent.

**How 0b keeps to this** (built):

- **Stored names, read both ways.** Permission rows and role templates keep
  `vendors.view` and `vendors.manage`, and a company's own name and icon
  for Clients keep the module key `vendors`. The code reads both names as
  the new and writes the old (`lib/permissions/stored-names.ts`,
  `lib/modules.ts`), so 0a's code, live while 0b waits for review, sees
  every grant and name 0b writes. A query by permission, such as "who can
  do this?", asks for both names. The codes in the session token are the
  same under either name, so nobody's session reloads.
- **0a's triggers go** (migration `20261106000000_records_compat_dropped`),
  with their functions and `lib/records-release.ts`. 0a's code doesn't need
  them: it writes `records.*` itself.
- **The old addresses open the new pages:** `/dashboard/vendors` and a
  client's `/dashboard/vendors/[id]`.
- **What stays as it was:** the database's table and column names (until
  0d), and the audit log's codes for a client's changes (`CREATE_VENDOR` and
  the rest), which are stored with each entry. On screen they all say
  Client.
- **A page open from before the deploy** calls the old API addresses and
  needs a reload, as it did for 0a.
- **0c and 0d** (Decided on 2026-10-22): a grant 0b's code writes while 0c
  waits for review has the old name. So 0c's code writes the new names and
  still reads both, and 0d, with the app closed, rewrites any old name left
  and removes the reading of them. No trigger is needed.

**How 0c keeps to this** (built):

- **The stored names are rewritten** (migration
  `20261107000000_client_names_stored`): `vendors.view` and
  `vendors.manage` become `clients.view` and `clients.manage` in roles and
  templates, and a company's own name and icon for Clients move to the
  module's `clients` key. 0b's code, live while 0c waits for review, reads
  either. A role somehow holding a permission under both names keeps one.
- **The code writes the new names,** and still reads the old as the new
  (`lib/permissions/stored-names.ts`, `lib/modules.ts`), for what 0b's code
  writes meanwhile. Nobody's session reloads: the codes in it are the same.
- **Today's clients table goes,** with the old section's link to it. No
  release reads it. Its column on sections stays until 0d, as 0b's code
  selects every column of a section.

**PR 0d, the maintenance window:**

- It renames the `Vendor` table and the `vendorId` columns to their new
  names, and removes the old-name mapping from the code: the schema's
  `@map`s, and the reading of old permission names and the module's old
  key, after rewriting any 0b wrote while 0c waited for review. It also
  drops the old clients table's column on sections, which every release
  until then reads.
- It's kept small so its review is quick.
- When its checks pass:
  1. turn maintenance mode on;
  2. push the PR's last commit, which carries the migration;
  3. merge as soon as its checks pass again;
  4. turn maintenance mode off once production has deployed.

  That's about 15 minutes with the app closed.

**How 0d keeps to this** (built):

- **The code commits come first,** with the schema using the new names,
  the reading of old names gone, and the raw SQL naming `Client` and
  `clientId`. Their preview build migrates nothing, so production is
  untouched until the last commit. Only that preview is broken meanwhile.
- **The last commit is the migration**
  (`20261108000000_client_names_in_database`), with the database tests
  that need it:
  1. any `vendors.*` name or old module key that 0b's code wrote while 0c
     waited for review is rewritten, as 0c rewrote the rest;
  2. the old clients table's column on sections is dropped, and every
     section must have a client;
  3. the `Vendor` table becomes `Client`, and the `vendorId` columns on
     tasks and sections become `clientId`, with their keys and indexes.
- **The Super Admin isn't kept out by maintenance mode,** so their pages
  may fail between pushing that commit and production deploying it.

### 0.4 What production holds today

- 0 vendors, 0 clients, 0 sections and 0 notes;
- 0 audit entries for either, and no company has changed their labels or
  icons;
- **36 role permission rows** use the `vendors.*` and `clients.*` names:
  27 `clients.*` (rewritten by 0a) and 9 `vendors.*` (rewritten by 0c);
- 0 custom roles, 0 role templates, and 0 reminders sent for notes
  (checked again on 2026-10-16, before 0a).

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
  - It used to have its own search, which for a Super Admin had no company
    in it: the page listed the chosen company's costs, and the button paid
    every company's. Fixed on 2026-10-22: the page and the button share one
    search (`lib/services/costs-query.ts`).
  - With one employee picked, the page listed that employee's share of each
    task, and the button paid each task whole, the other members' shares
    too. Fixed on 2026-10-23, as the product owner asked: it pays that
    employee's shares only, and a task is paid once no share of it is left.
    The page shows only shares still to pay, so one paid this way leaves it.
- **A paid task can be deleted, and its payment record goes with it**
  (`TaskService.delete` doesn't check payment). Fixed in step 4, PR 4a
  (§4.2).
- **Deleting a vendor quietly unlinks all its tasks** (`onDelete: SetNull`).
  Fixed in step 4, PR 4b: one with tasks is archived instead (§4.3).
- **Bug: cost descriptions are thrown away.** The task's cost form sends a
  description with each cost, but the server saves only the amount ("Added
  cost: 150.00 EGP"), so every cost shows "No description". Fixed in step
  4, PR 4c (§4.4).
- **Bug: a cost not split by member broke the Costs page.** The page shows
  each member's share of a task's cost (`memberCosts`). A task with a cost
  and no shares, as tasks had before shares, was shown under
  `task.assignee`, which a task doesn't have, so the whole page failed.
  Fixed on 2026-10-23: its card names the task's assignees. With an
  employee picked it's left out, since it's no one's share. Production has
  no such task.

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
- **Changing a client's HQ is Manage locations,** in the client form too.
  Whoever may manage clients adds a client with its HQ, and gives one to a
  client without one, but sees the HQ it has as it is.

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
   - **How it moves (PR 4c).** Each cost is a row, with its id and
     description, and still an entry in the task's comments, which names
     its row. The release before reads and writes only the entries, and
     the migration runs while it's live, so it can add a cost with no row
     or remove one and leave its row. Until that's tidied, the entries say
     which costs a task has. A cost with no row is removed as before.
   - **Decided (2026-10-22):** a small PR, 4d, once 4c is live, gives the
     costs added meanwhile their rows and removes the rows left over. From
     then on the rows say which costs a task has. It comes before anything
     points at a cost (§6, §7). Built: the task's page lists the rows, and
     a cost is removed by its row. The entries are still written, for the
     release before.

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
   - **Decided (2026-10-29):** a name's filter keeps what was picked as
     it, and what was typed the same, ignoring capitals, in its company:
     older tasks and costs count too.
   - On the Costs page, the cards and the total are what's due of the
     costs of that name: each person's on a task, while their share is
     still to pay, and those that are no one's share.
   - **Decided (2026-10-29):** Mark all as paid isn't offered with a cost
     name picked. A payment is a person's share of a whole task, so it
     would pay more than the list adds up to. A line says to clear the
     cost name to pay, and the server refuses it too.
   - The archived names are offered last, marked, as what was picked as
     them is still to be found.
10. **How it's built (step 5).**
    - **Proposed:** step 5 ships as three PRs:
      - 5a: the lists, the picker, the Saved lists page, the permissions
        for new companies, and the title and cost name fields (built);
      - 5b: the permissions for the companies already there, once 5a's
        role editor is live, as for locations (§2.9) (built);
      - 5c: the bulk import matching titles to the list, and the filters
        and totals by title and cost name (§5.8–5.9) (built). An imported
        title that is a saved one, ignoring capitals, is saved as picked
        from it; an archived one isn't matched. The review screen is as it
        was.
    - **What's saved** (§5.5): the text as typed, and the name it was
      picked as only while the text is that name, ignoring capitals. Typed
      over after picking, or renamed in the meantime, it's saved as typed.
      A transfer's copy keeps its task's name.
    - **Proposed:** an archived name can't be added again with "+ Add":
      it's refused, saying whoever manages the lists can restore it, so an
      Admin's archiving isn't undone by someone typing it. A task already
      picked as it keeps it, and keeps it when edited.
    - **Proposed:** the Saved lists page (`/dashboard/lists`) sits in the
      side bar under Company Settings, for whoever manages lists. Company
      Settings' own tabs depend on the Super Admin's switch, which an
      Admin's Manage lists doesn't.
    - **Decided (2026-10-29):** 5b gives Add list names to every role in
      the companies there already are, custom ones too, as Everyone has it
      (§5.7). Taking over someone's account needs everything their role
      holds, so a custom role that manages Employees would otherwise lose
      that once Employees can add names.

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
- **Decided (2026-10-29): each cost has its own receipt photo, and it's
  optional.** Until step 6, a cost had none: photos were the task's. Each
  cost added in Add costs takes one photo, which its charge shows; a cost
  with no receipt, such as a taxi, is added without one, as is every cost
  added before.

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

### 6.8 How it's built (step 6)

- **Proposed:** step 6 ships as four PRs:
  - 6a: a receipt photo for each cost (§6.2): taken in Add costs,
    optional, kept in the company's own folder and checked to be there
    when the cost is saved, shown with the cost on the task's page, and
    removed with the cost or its task (built). A receipt is on one cost
    only, and the orphan sweep counts it as in use;
  - 6b: the charges (§6.1–6.5), the Costs page's Charged to Clients tab
    with its filters, totals, service fee and "Not charged to client"
    tick, and the three permissions (§6.6) for new companies' built-in
    roles (built);
  - 6c: the permissions for the companies already there, once 6b's role
    editor is live, as for locations (§2.9) and lists (§5.10) (built);
  - 6d: each client's page (§6.4): Due and Collected, the charges with
    their receipts, and Mark collected, with two-factor sign-in, for
    exactly the charges shown, as Mark all as paid confirms (§4.1)
    (built).
- **Proposed:** a charge isn't stored apart from its cost. A cost on a
  task with a client is charged to it, so the charge follows the task's
  client (§6.5); the cost keeps its service fee, the "Not charged to
  client" tick and when it was collected, and by whom.
- Production had no clients and no costs when step 6 began (checked
  read-only, 2026-10-29), so no cost is charged on the way in.
- **Proposed, as 6b builds them:**
  - **The tab opens on Due.** Its status filter is Due, Collected, Not
    charged to client, or all of them: a cost left off its client's bill
    is a status of its own, so it can be found and charged again.
  - **Its totals are every page's, of the charges listed:** Paid out and
    Service fees of those still charged, and Total due of those not yet
    collected. One left off the bill counts in none.
  - **Each charge shows** what was bought, on which task, its receipt,
    the client, who added it and when, Paid, Service fee, Total and its
    status. Its menu sets the fee or leaves it off the bill; one left off
    is charged again from it. A collected one has no menu: Mark
    uncollected comes with the client's page (6d).
  - **A service fee is at most 1,000,000 EGP,** so a mistyped one can't
    run the total into the millions.
  - **The Costs page opens for whoever pays costs or sees charges,** with
    the two tabs for whoever does both. Employee costs is the screen it
    was, its tabs on a panel until it's rebuilt.
  - **A task with charges can't be deleted** (§6.5): with a client, and a
    cost on it still charged. A client with tasks is already archived,
    not deleted (§4.3).
  - **Mark charges collected is in the catalogue,** with two-factor
    sign-in, from 6b, so its grants are seeded with the others; nothing
    uses it until 6d.
- **Proposed, as 6c builds it:** the companies already there get the
  charges' permissions on their built-in Admin and Team Leader roles only,
  as lib/permissions/built-in.ts has them, as they got locations' (§2.9).
  Charges aren't Everyone's, so a company's own roles are given them in the
  role editor; one that hands out the Team Leader role needs See charges
  to keep doing so, as handing out a role takes everything it holds. A
  role given one there since keeps it as it is. Production had only
  built-in roles, and no charges grants, when 6c was built (checked
  read-only, 2026-10-29).
- **Proposed, as 6d builds it:**
  - **A client's page has a Charges section** for whoever sees charges:
    the Charged to clients list for that client alone, with its search,
    status and dates, and Due and Collected tiles that don't change with
    the status picked. A Team Leader sees their team's tasks' charges.
  - **Mark collected collects the Due ones listed, every page of them,**
    with the search and dates picked, as its confirmation says: "Collect
    7 charges, 3,450.00 EGP, from Al Noor?". If any of them changed
    meanwhile, nothing is collected and the list is shown again.
  - **Mark uncollected is in a collected charge's menu,** on the client's
    page and on the tab, for whoever may mark charges collected, with
    its own confirmation and two-factor sign-in.
  - **A collected charge shows the day it was collected.** Who collected
    it is in the audit log.
  - **A Super Admin sees a client's charges on its page whichever company
    they picked,** as the page is the client's.

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

### 7.8 How it's built (step 7)

- **Proposed:** step 7 ships as four PRs:
  - 7a: the ledger (§7.4), with Given, Returned and Correction entries;
    the Super Admin's and the Admin's switches (§7.6); the two
    permissions (§7.7) for new companies' built-in roles; the Costs
    page's Cash advances tab, with each person's balance, Give advance,
    Record return, Correction and their history, and the total held
    (§7.5); and My cash advance, with Confirm receipt (§7.3) (built);
  - 7b: costs paid from the advance (§7.2, §7.4): Add cost shows the
    balance, each cost added makes its Spent entry, each cost shows From
    advance and To pay back, removing a cost puts its part back, Mark all
    as paid pays only what's owed, and the money owed is offered at
    hand-over (§7.3) (built);
  - 7c: the permissions for the companies already there, once 7a's role
    editor is live, as for charges (§6.8) (built);
  - 7d: leaving the company: a balance still held becomes a debt, its
    source a cash advance (§7.3) (built).
- **Proposed, as 7a builds it:**
  - **Each entry keeps its amount signed,** so the balance is their sum:
    Given adds, Returned takes away, and a Correction does either. The
    database refuses a Given or a Returned the wrong way round, and a
    Correction of nothing. Spent entries come with 7b.
  - **An entry is at most 1,000,000 EGP,** as a service fee is (§6.8).
  - **Give advance takes** the amount, the day it was handed over (today
    or before, where the company is), a note, and optionally a photo of
    the signed hand-over, kept in the company's own folder as receipts
    are (§6.2).
  - **Record return takes** the amount, the day and a note, and can't be
    more than the balance. **A correction takes** an amount to add or
    take away, the day, and why, which is required; it can't take the
    balance below zero.
  - **Nobody gives, returns or corrects their own advance,** whatever
    their role, as nobody sets their own pay (`ROLES_PLAN.md` §4.2). The
    Super Admin may for anyone.
  - **An advance is given only to someone at work in the company:** not
    suspended, deleted or gone. A return or a correction is still
    recorded for someone who left holding money, until 7d makes it a
    debt. Nobody is deleted for good while they hold advance money: their
    advance would go with them, so its return is recorded first.
  - **Confirm receipt is the employee's own,** on My cash advance, once
    for each advance, and it's in the audit log. The balance counts an
    advance from the moment it's given (§7.3).
  - **See cash advances is for a team or the company.** Seeing one's own
    is everyone's, on My cash advance, so it isn't a permission (§7.7:
    "their own only"), as a person's own payslips aren't.
  - **The switches are on Company Settings' General tab.** Allowing cash
    advances switches them on; the Admin switches them off and on again
    there, when the Super Admin shows them the tab (`ATTENDANCE_PLAN.md`
    §5.2). Neither switch goes off while anyone holds advance money
    (§7.6), and the card says how much is held.
  - **The Cash advances tab lists everyone at work in the company,** and
    anyone else still holding money, with their balance, what's awaiting
    confirmation and their last movement. It's searched by name and
    filtered to those holding an advance. Its tiles are the total held,
    what's awaiting confirmation, and how many hold an advance. A Team
    Leader sees their team and themselves.
  - **Each person's advance has its own page:** their balance and every
    entry, newest first, with who recorded it. Give advance, Record
    return and Correction are on it for whoever may.
  - **A Super Admin picks a company first,** as for lists (§5).
- **Proposed, as 7b builds it:**
  - **A cost is paid from its author's advance first,** as it's added
    (§7.2): the part the balance covers, never more than the cost, and only
    where the company uses cash advances. Each cost keeps its part from the
    advance, and the advance a Spent entry for it, on that cost and its
    task, made in the same step, so the balance shown is always current.
  - **What's paid back is only the rest** (§7.4). A task's shares, its
    total to pay back and Mark all as paid count only the part owed to the
    employee, so the part paid from the advance is never paid again. What
    a cost came to stays on the cost itself, as it has since 4d (§4.5).
  - **A Super Admin's costs come from no advance:** they hold none.
  - **Removing a cost puts its part back** on the balance (§7.4), as a
    Spent entry the other way round, on the same task. Entries are never
    edited, so what was spent and what came back both stay. Deleting a
    task puts back every cost's part the same way. What's put back goes
    back even where the company has stopped using cash advances since:
    the money is the person's again, and the Cash advances card shows it
    held.
  - **Two costs added at once by one person,** on two tasks, take their
    parts one after the other, under the same hold on their advance as an
    entry recorded by hand, so together they never take more than it
    holds.
  - **Each cost shows From advance and To pay back** where it's listed, on
    the task and in Employee costs, once part of it came from an advance.
    A task's total says how much of it came from cash advances. With a
    cost name picked (§5.9), what's due of the costs of that name is only
    what's to be paid back of each.
  - **Add cost says the balance:** "Your advance: 700 EGP", before the
    cost is added. There's still nothing to choose.
  - **The person's history shows each Spent entry** as Spent on a cost,
    or Put back, with its task, or that the task was deleted since.
  - **At hand-over, what's owed is offered:** giving an advance to someone
    the company owes says so ("Ahmed is owed 300 EGP") and offers to pay it
    in the same hand-over, for whoever pays costs. It's paid as Mark all as
    paid pays their costs, exactly the list it said: if that changed
    meanwhile, the advance is given and nothing is paid, and it says to
    pay from the Costs page.
- **Proposed, as 7c builds it:** the companies already there get the cash
  advances' permissions on their built-in Admin and Team Leader roles only,
  as lib/permissions/built-in.ts has them, as they got charges' (§6.8):
  See cash advances and Give and settle cash advances for the Admin, for
  the company, and See cash advances for the Team Leader, for their team.
  Cash advances aren't Everyone's, so a company's own roles are given them
  in the role editor. A role given one there since keeps it as it is. They
  open nothing until the Super Admin allows a company cash advances
  (§7.6). Production had only built-in roles, and no cash advances grants,
  when 7c was built (checked read-only, 2026-10-30).
- **Proposed, as 7d builds it:**
  - **Leaving is ending the contract,** which is how the app records it,
    with its final settlement. Whatever they still hold of a cash advance
    becomes a debt then, in the same step: its source is the cash advance,
    and it's due with the settlement.
  - **An entry of its own, Became a debt,** takes the balance to nothing,
    and the debt names it as its source, so the person's history says
    where the money went.
  - **The settlement takes it as it takes other debts** (as far as it
    covers them, oldest first). What it can't cover stays outstanding, to
    collect or write off; reinstated, they repay it through payroll as any
    debt.
  - **End Contract says so before it's ended:** "The 250 EGP of cash
    advance they still hold becomes a debt", and the debt is counted with
    the others it recovers.
  - **A movement of the advance meanwhile** (a cost added, a return
    recorded) after the settlement was worked out ends nothing: it says to
    look again, as the statement would no longer add up.
  - **An ending dated ahead:** they work on until it, so may be given an
    advance, or have a cost's part put back, after the settlement. What
    they hold when it takes effect becomes a debt too, as they're
    archived, recorded as by whoever recorded the ending.
  - **Someone whose contract has ended holds nothing:** what comes back to
    them afterwards becomes a debt at once, whether a cost's part put back
    as it's removed or a correction finding they held more.
  - **Being suspended or deleted isn't leaving:** nobody is deleted for good
    while they hold any (§7.4), and someone deleted, still holding money,
    stays on the Cash advances tab for a return or a correction.
  - **The debt shows as a cash advance** where a person's debts are listed.

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
       Merged in #81 on 2026-10-16.
  2. **Steps 0–7 above.**
     - Step 0's first PR, 0a, was merged in #82 on 2026-10-23 (§0.2,
       §0.3).
     - 0b, Vendors becoming Clients in code, was merged in #92 on
       2026-10-23 (§0.1, §0.3). It renames and nothing else: the Clients
       list page looks as it did.
     - 0c, the stored names following the code, was merged in #94 on
       2026-10-23 (§0.3).
     - 0d, the database's names following the code, was merged in #95 on
       2026-10-23 (§0.3), its migration run in a maintenance window of
       about 8 minutes.
     - Step 1, the Locations system: PR 1a was merged in #96 on
       2026-10-29 (§2). Decided (2026-10-22):
       it ships as two PRs. 1b, opened once 1a is merged and live, gives
       the companies already there their built-in roles' location
       permissions (§2.9), and makes an HQ for any client the release
       before added meanwhile. Given in 1a, the grants would reach the
       live role editor, which doesn't know them yet and would drop them
       when a role is saved. Until 1b is merged, only the Super Admin
       sees the Locations page in those companies. 1b was merged in #97
       on 2026-10-29, so step 1 is done.
     - Step 2's first PR, 2a, was merged in #98 on 2026-10-29: tasks are
       done at locations, made and edited with the client and location pickers
       (§2.3, §2.4, §3.1).
       Decided (2026-10-22): step 2 ships as two PRs. 2b moves the bulk
       upload onto locations: the Excel Locations sheet and the review
       screen's pickers (§2.7). Until then, an uploaded task still takes its
       client's own location fields, or its typed text. 2b was merged in
       #99 on 2026-10-29, so step 2 is done.
     - Step 3, filters and totals, is built (§3), as one PR after 2b. It
       stands on the fix that has Mark all as paid pay only the list shown,
       and on the date filters counting the company's days, which come
       before it in their own PRs. It was merged in #100 on 2026-10-29.
     - Step 4 (§4). Decided (2026-10-22): it ships as three PRs, and a
       fourth, small one. 4a, payment safety (§4.1, §4.2), was merged in
       #101 on 2026-10-29, 4b, archiving clients (§4.3), in #102, 4c,
       which moves costs into their own table, with their descriptions
       (§4.4, §4.5), in #103, and 4d, which tidies up after it (§4.5), in
       #104. Step 4 is done.
     - Step 5, saved lists (§5). Proposed: it ships as three PRs, 5a, 5b
       and 5c (§5.10). 5a was merged in #105 on 2026-10-29, 5b, which
       gives the companies there before it the lists' permissions, in
       #106, and 5c, the bulk import matching titles to the list and the
       filters and totals by title and cost name, in #107. Step 5 is done.
     - Step 6, client charges (§6). Proposed: it ships as four PRs, 6a
       to 6d (§6.8). 6a, a receipt photo for each cost, was merged in
       #108 on 2026-10-29, and 6b, the charges, the Costs page's Charged
       to clients tab and the permissions for new companies, in #109, and
       6c, the permissions for the companies already there, in #110, and
       6d, each client's page with Mark collected, in #111. Step 6 is
       done.
     - Step 7, cash advances (§7). Proposed: it ships as four PRs, 7a to
       7d (§7.8). 7a, the ledger, the switches, the Cash advances tab and
       My cash advance, was merged in #112 on 2026-10-30, and 7b, costs
       paid from the advance, in #113, and 7c, the permissions for the
       companies already there, in #114, and 7d, a balance held on
       leaving becoming a debt, in #115. Step 7 is done, and with it
       steps 0–7.
     - The new side bar groups land with step 0. 0a puts the Records item
       where the old Clients item was. Decided (2026-10-22): the groups come
       in a small PR straight after 0b, now that the Clients group (§2.1 of
       `UI_PLAN.md`) can hold Clients and Records, with the Clients list
       page rebuilt on the building blocks. Merged in #93 on 2026-10-23.
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
- **2026-10-16:** The older pages' PR (#81) has Codex's review findings
  fixed, still waiting to be merged (§8, `UI_PLAN.md` change log).
- **2026-10-16:** The older pages' PR (#81) also makes the side bar's
  company name readable in dark mode, at the product owner's choice
  (§8, `UI_PLAN.md` change log).
- **2026-10-16:** The older pages' PR (#81): the map's radius ring has a
  white outline, from Codex's review (§8, `UI_PLAN.md` change log).
- **2026-10-16:** The older pages' brand colour PR was merged in #81, so
  step 0 is next (§8).
- **2026-10-16:** Step 0's first PR, 0a, is built and open for review:
  records on each client's page, the Records page, `records.*` permissions
  and the reminder job (§0.2). How it keeps production working while it
  waits, and what 0b must therefore do, is in §0.3. Three choices it made
  are marked Proposed in §0.2: when a record "expires soon", who is
  reminded and when, and that a client with records can't be deleted.
- **2026-10-16:** PR 0a (#82) has Codex's review findings fixed (§0.2): a
  record can neither carry nor delete the company's other files, such as a
  photo or its logo; a form's unsaved uploads are removed again; a new
  section named by two people at once is started once; a client isn't
  deleted while a record is being added; and a reminder's record opens only
  on its own client's page. Still waiting to be merged.
- **2026-10-16:** PR 0a (#82): Codex's second review is fixed too (§0.2):
  expiry is counted in each company's own time zone; a reminder is sent
  only for the date it was found for; deleting a section takes along a
  record being added to it, with its files; the date picker shows a picked
  day as that day in every time zone; and a file dropped on a full file
  picker no longer leaves the page. Still waiting to be merged.
- **2026-10-16:** PR 0a (#82): Codex's third review is fixed too (§0.2):
  edits and deletes remove the files of the record as they find it, a
  refused removal is logged, deleting a company removes its records'
  files, the expiry date can't change while a record saves, and a deleted
  user's record no longer reads as a Super Admin's. Proposed: the Records
  page's Add record, which asks which client first, so an employee can add
  a client's first record. Still waiting to be merged.
- **2026-10-16:** PR 0a (#82): Codex's fourth review is fixed too (§0.2):
  deleting a section or a company holds its records while it lists their
  files, so an edit saved at that moment doesn't leave a file behind, and
  a record's form closed while it saves leaves that save's files to it.
  Still waiting to be merged.
- **2026-10-16:** PR 0a (#82): Codex's fifth review is fixed too (§0.2): a
  client's page says when its sections didn't load, with Try again, rather
  than showing none; and an edit is refused if someone changed the
  record's files since its form opened, so a file taken off can't come
  back on it. Still waiting to be merged.
- **2026-10-17:** PR 0a (#82): Codex's sixth review is fixed too (§0.2,
  `ROLES_PLAN.md` §4.4): sessions refreshed by the older release after the
  migration reload their grants once this one is live, so nobody is left
  without Records until they sign in again; deleting a company holds the
  company too; and a record can't be given a file as it's removed from
  storage (a new table, `RemovedRecordFile`). Still waiting to be merged.
- **2026-10-17:** PR 0a (#82): Codex's seventh review is fixed too (§0.2):
  a reminder's link says when looking the record up fails, rather than
  that it's gone; reminders still go out when whoever added a record is
  deleted as they're sent; Add record's picker finds any client by name,
  not only the first 1,000; a client's page says when its details didn't
  load; and files are removed from storage 100 at a time, as storage caps
  each call. Still waiting to be merged.
- **2026-10-17:** PR 0a (#82): Codex's eighth review is fixed too (§0.2):
  a % or _ in the Records search is that letter, not any; a client's first
  record and a section started or renamed to the same name at that moment
  no longer fail the record; and a record's file is noted as removed, and
  that committed, before storage removes it. A file storage refuses stays
  noted as removed, and the orphan sweep removes it. Still waiting to be
  merged.
- **2026-10-17:** Decided: two problems found while building 0a get PRs
  of their own, after 0a merges. The date range picker shows a picked day
  as that day west of UTC, as the date picker now does (`UI_PLAN.md`). And
  deleting a company removes everything it stored under its own folder,
  such as its logo and its people's photos, not only its records' files.
- **2026-10-17:** Decided (§0.2): the Records page's Add record opens the
  whole form there, choosing the client in it, rather than taking you to
  the client's page: a button there that leaves the page had no meaning.
  The client's sections load once it's chosen, and nothing can be added
  until they have.
- **2026-10-22:** PR 0a (#82): Codex's ninth review is fixed too (§0.2): a
  Super Admin who picks another company while Add record is open no longer
  adds the record to the last company's client; editing a record on the
  Records page says when its client's sections didn't load, rather than
  offering only the one it's in; a record deleted as it's opened is "not
  found"; files a form uploaded and didn't save are removed ten to a
  request, however many there are; and a record is given a new file only
  once storage says it has it. Still waiting to be merged.
- **2026-10-22:** PR 0a (#82): Codex's tenth review is fixed too (§0.2): a
  record moved to a section deleted at that moment is refused with "section
  not found" rather than failing; a Super Admin's own upload goes on a
  record only by a Super Admin's hand; and a failed search in Add record's
  clients says so, rather than showing the last search's. Still waiting to
  be merged.
- **2026-10-22:** PR 0a (#82): Codex's eleventh review is fixed too (§0.2):
  a record open to view, edit or delete closes when a Super Admin picks
  another company, so it can't be changed unseen; an edit refused because
  someone changed the record's files reloads the records, so opening it
  again shows them; renaming a section deleted at that moment says it's
  gone rather than failing; and a record's details in its dialog are one
  to a row on a phone. Still waiting to be merged.
- **2026-10-22:** PR 0a (#82): Codex's twelfth review is fixed too (§0.2,
  §0.3): main's role and template editors, which save every grant they know
  and drop the rest, can no longer take away a role's Records grants while
  0a waits (a new, additive migration; production has had no role saved
  since 0a's migration, so none has lost them); expiry reminders and a
  company's deletion can't deadlock; a section's rename is audited from the
  title it had as it was renamed; and the Records list reloads when the
  company's day ends, so its expiry badges and filter are that day's. Still
  waiting to be merged.
- **2026-10-22:** PR 0a (#82): Codex's thirteenth review is fixed too
  (§0.2): deleting a section holds its client first, as deleting the
  company does, so the two can't deadlock; a deleted section's audit entry
  has its title as it was when deleted; a Super Admin looking at every
  company sees a record's company on a phone and when it's opened; and a
  Super Admin who adds a record gets its reminders (a new, additive
  migration; production has no records yet, so none needs filling in).
  Still waiting to be merged.
- **2026-10-22:** Fixed, in a PR of its own (§1): a Super Admin's "Mark all
  as paid" pays only the company the Costs page shows. It paid every
  company's pending costs, because its search had no company in it for a
  Super Admin. The page and the button now share one search, and a company
  name that matches none lists and pays nothing, not everything.
- **2026-10-23:** Fixed, in a PR of its own (§1), two things on the Costs
  page. A task with a cost not split by member no longer breaks it: its card
  names the task's assignees. And, as the product owner asked, with one
  employee picked Mark all as paid pays that employee's shares only, not
  each task whole; a task is paid once no share of it is left, and the page
  shows only shares still to pay. Production has no costs yet.
- **2026-10-23:** From Codex's review of #87: paying one person's share
  from a task's page pays the task once no share is left, by the same rule
  as Mark all as paid. A status for someone with no share, or a share of
  nothing, kept the task waiting, while the Costs page showed nothing of it.
- **2026-10-23:** From Codex's second review of #87, as the product owner
  decided: what of a task's cost is no one's share (a cost from before
  shares, beside a share added since) stays to pay until the task is paid
  whole. Paying the shares no longer marks such a task paid, and the Costs
  page shows that part as the task's own card, under its assignees' names.
  No task anywhere has such a cost today.
- **2026-10-22:** Built, in a PR of its own: deleting a company removes
  everything it stored under its own folder, its logo, its people's photos
  and their tasks' files, after its records' files. Best effort, as the
  company is already gone: what storage refuses is logged and left to the
  orphan sweep. Not a file a live row still uses, such as the photo of
  someone a Super Admin moved to another company.
- **2026-10-23:** From Codex's review of #89: the list of files still in
  use, which deleting a company and the orphan sweep both trust, is read in
  pages by id, each after the last. An offset stepped past a row when an
  earlier one was deleted between pages, so a file only that row used could
  be taken for unused and removed.
- **2026-10-23:** Decided by the product owner: a person stays in the
  company they were added to. A Super Admin's edit form offered every
  company and moved the person to the one picked; it now shows their
  company greyed out, and the server refuses any other
  (`COMPANY_CHANGE_FORBIDDEN`). What a move did, ending their phones,
  places, session and acting role, is gone with it. Deleting a company
  still keeps a file another company's row uses, as a safeguard.
- **2026-10-22:** PR 0b is built (§0.1, §0.3): Vendors are Clients in the
  code, its pages and its API (`/dashboard/clients`, `/api/clients`), and
  the old page addresses open the new ones. The database keeps the old
  permission names and the module's key until 0c, read as the new; the code
  writes the old. 0a's triggers and the old section's own rows go. Today's
  clients table is now dropped in 0c rather than 0b, and its column on
  sections in 0d, as each release reads every column of a section while
  the next waits for review. It
  opens for review once 0a is merged. Proposed: the side bar groups and the
  Clients list page on the building blocks in a small PR after it (§8).
- **2026-10-22:** The product owner agreed both of 0b's proposals.
  - **Decided:** the side bar groups, and the Clients list page on the
    building blocks, come in a small PR straight after 0b (§8).
  - **Decided:** 0c writes the new permission names and still reads both,
    so a grant 0b's code writes while 0c waits for review isn't lost; 0d,
    with the app closed, rewrites any old name left and stops reading them.
    No trigger is needed (§0.3).
- **2026-10-23:** 0a was merged in #82. 0b opens for review in #92, on
  main as #83–#91 left it: its commits are as built, on that main.
- **2026-10-22:** The side bar groups and the Clients list page on the
  building blocks are built, to open for review after 0b (§8, `UI_PLAN.md`
  change log).
- **2026-10-23:** 0b was merged in #92. The side bar groups and the
  Clients list page open for review in #93.
- **2026-10-22:** PR 0c is built (§0.3): the stored permission names and
  the module's key are rewritten to `clients`, the code writes the new
  names while still reading the old, and today's clients table is dropped.
  It opens for review once 0b is merged and live, as its migration runs
  against 0b's code.
- **2026-10-23:** The side bar groups and the Clients list page were
  merged in #93. 0c opens for review in #94.
- **2026-10-22:** PR 0d is built (§0.3): the database's names follow the
  code (`Vendor` becomes `Client`, `vendorId` becomes `clientId`), the
  old section column goes, and the code stops reading the old permission
  names and module key. Its migration is its last commit, pushed in the
  maintenance window. It opens once 0c is merged and live.
- **2026-10-23:** 0c was merged in #94: production's 9 Clients grants are
  stored under their new names, and the old clients table is gone. 0d
  opens for review in #95 with its code; its migration waits for the
  maintenance window.
- **2026-10-22:** Step 1's first PR, 1a, is built (§2):
  - **The locations:** each client's current location becomes its HQ,
    with its pin when its map link has one, or marked "Needs a pin"
    (§2.8). Each location has its own check radius, 20 to 5,000 m, or
    the default 70 m (§2.5). The database keeps a client to one HQ, an
    archived location from being one, and a pin whole and on the map.
  - **The Locations page and each client's page** (§2.6): search, a filter
    by client or shared, the archived ones, adding, editing, archiving and
    restoring, and Make HQ. A client's HQ is replaced, never archived.
  - **Add location asks whose it is each time:** a client's, or Shared.
    It's never Shared by default, so a branch can't be left as no
    client's.
  - **The client form's HQ:** a new client is added with its HQ's name,
    pin and radius. Editing a client leaves its HQ as it is unless it's
    changed there, so a client whose HQ needs a pin can still have its
    phone number corrected.
  - **Permissions:** the three in §2.9. A new company's built-in roles get
    the defaults: Admin all three, Team Leader See and Add.
  - **Until step 2,** a client's own location fields follow its HQ, as the
    task form still copies them into a new task.
  - **Proposed:** step 1 ships as two PRs, 1a and 1b (§8).
- **2026-10-23:** 0d was merged in #95, so step 0 is done: Vendors are
  Clients on screen, in the code and in the database. Its migration ran
  with the app in maintenance mode from 22:35 to 22:46 UTC, and production
  had no errors after it. Step 1's first PR, 1a, opens for review in #96.
- **2026-10-24:** From Codex's review of #96: a client's HQ changes only for
  whoever may manage locations, in the client form too (§2.9). Whoever may
  manage clients still edits the rest, adds a client with its HQ, and gives
  one to a client without one. The Locations page links a location's
  client only for whoever may open the client's page.
- **2026-10-22:** PR 1b is built, for once 1a is merged and live (§8,
  §2.9): the built-in Admin and Team Leader roles of the companies already
  there get the location permissions a new company's have, and their
  holders reload them. Any client the release before added while 1a waited
  gets its HQ, as 1a's migration gave every client there then. A client
  given one since keeps it.
- **2026-10-29:** 1a was merged in #96, with Codex's two findings fixed
  in it. 1b opens for review in #97. In production it gives the three
  companies' built-in Admin and Team Leader roles their 15 location grants,
  and makes no HQ, as there are no clients yet.
- **2026-10-22:** Step 2's first PR, 2a, is built (§2.3–2.5, §3.1):
  - **A task is done at a location:** its client's, or a shared one,
    picked from the list, never typed. The client stays optional. The
    location must be the task's company's, in use, with its pin placed,
    and its client's or shared; a task with no client takes a shared one.
    The task keeps the location's name and map link as its text too, so
    the release before reads it as it did.
  - **The pickers,** on creating a task and editing one: picking a client
    picks its HQ. The locations are listed with the client's first, its
    HQ marked, then the shared ones. One with no pin is listed greyed,
    with why. "+ New location" adds one there and then, the client's or,
    by choice, shared, and picks it. Picking needs See locations (§2.9);
    someone without it is told to ask for it.
  - **The check** measures from the location's pin, within its own
    radius, or the system's when it has none (70 m unless the Super
    Admin changes it). A pin corrected later applies to open tasks, as
    the task links to its location (§2.5).
  - **Edits** check a new client and location as creating does, and
    record both by name in the task's history. A task from before
    locations keeps its text until a location is picked for it.
  - **A transferred task's copy** keeps the task's client and location.
    It used to keep only the location's text.
  - **The task page** shows the location as it is now, with its map
    link.
  - **Proposed:** step 2 ships as two PRs, 2a and 2b (§8).
- **2026-10-29:** 1b was merged in #97, so step 1 is done. Its migrations
  ran on production as it opened, giving the three companies' built-in
  Admin and Team Leader roles their 15 location grants, and production
  had no errors after them. Step 2's first PR, 2a, opens for review in #98.
- **2026-10-29:** From Codex's review of #98: a bulk upload links no
  location until its review screen picks them (2b), so it can't link
  another company's. Saving a location from a task's form saves only the
  location, and "+ New location" from a task's edit window opens above it.
- **2026-10-22:** Step 2's second PR, 2b, is built (§2.7):
  - **The Excel template** has a Locations sheet: each location a task
    can use, by its name, "Client - Location" or a shared one's own, each
    name once, numbered where two would read the same. A hidden column
    keeps the location each name stands for. The main sheet has a
    Location column after the others, a dropdown from that list.
  - **The upload** finds each row's location through the file's own
    Locations sheet, never by matching the name against the company's
    locations. A name it doesn't find exactly once, another client's
    location, or one with no pin is flagged, with what was written. A
    row with no location takes its client's HQ. A template from before
    has no Location column, so its rows take their client's HQ too.
  - **The review screen** has each row's client and location as selects,
    as on the task form: changing the client keeps a shared location or
    picks the new client's HQ.
  - **Typed locations are gone** from bulk creation too. A refused
    location names its task, instead of failing the upload as a fault.
- **2026-10-29:** 2a was merged in #98, with Codex's three findings fixed
  in it: a bulk upload linked no location until 2b, saving a location from
  a task's form saved only the location, and "+ New location" opened above
  a task's edit window. Its migration ran on production as it opened, with
  no errors after. Step 2's second PR, 2b, opens for review in #99.
- **2026-10-29:** Two fixes in 2b (#99). The review screen ties what's
  wrong with a row's location to its select, for a screen reader to read
  with it (found by the audit). And the template lists the company's
  locations only for someone who may see them, as the task form's picker
  does: a custom role that may create tasks but not see the locations gets
  it without them (found by Codex).
- **2026-10-29:** In 2b (#99), the bulk upload's review screen lists
  every location in use, as the template does, rather than the first
  2,000: past those, a row naming a location the template offered was
  refused (found by Codex).
- **2026-10-29:** In 2b (#99), the upload reads the template's Locations
  sheet below its heading: read as a location, the heading made a
  location named "Name", or "الاسم", named twice, and refused (found by
  Codex).
- **2026-10-22:** Step 3 is built (§3):
  - **A client filter** on the Tasks and Costs pages, with "No client",
    for whoever may see clients, and **a location filter** beside it for
    whoever may see locations: the picked client's locations and the
    shared ones. Both are kept in the address with the other filters.
    The Costs page has the location filter too, so Mark all as paid can
    apply it (§3.4).
  - **Mark all as paid** pays only the client's and the location's costs
    shown, with a test that it pays nothing else.
  - **The Costs page's total** is what the whole filtered list still owes,
    across every page, leaving out the parts paid; with an employee
    picked, it's their share. It showed 0 before, whatever the list held.
  - **"View tasks"** on each client, in the Clients list's row menu and on
    its page, opens Tasks filtered to it.
- **2026-10-22:** Decided by the product owner: step 1 ships as two PRs,
  1a and 1b, and step 2 as two, 2a and 2b (§8).
- **2026-10-29:** Found while preparing step 3: a task's page drew its
  deadline, comments, attachments and costs' dates on the server, in its
  time zone, so the browser drew them again in Cairo's and logged a
  hydration failure on every task page. They're drawn once the browser
  has the page now, as the task list's are.
- **2026-10-29:** 2b was merged in #99, with Codex's three findings fixed
  in it: the template listed the locations for someone who may not see
  them, the review screen's list stopped at 2,000, and the upload read
  the Locations sheet's heading as a location. So step 2 is done. Step 3
  opens for review in #100.
- **2026-10-29:** In step 3 (#100), the location filter offers the
  archived locations too, after the ones in use and marked as archived:
  a location archived after tasks were done there keeps them, and their
  costs still due, to be found and paid (found by Codex).
- **2026-10-29:** In step 3 (#100), a client or location a shared link
  sets on the Tasks or Costs page, for someone who can't pick it, still
  narrows the list, so it's counted on the Filters badge and Reset clears
  it; before, Reset left it in place (found by Codex).
- **2026-10-22:** Step 4's first PR, 4a, is built (§4.1, §4.2):
  - **Mark all as paid** asks first, "Pay 7 costs, 3,450 EGP?", counting
    each person's part still due. The page sends back a digest of exactly
    those parts, and the server pays them only if the list still comes to
    the same: the tasks are held while it checks. If anything changed, it
    pays nothing and shows the list again as it is.
  - **A task whose costs are paid, in full or in part, can't be
    deleted.** Its Delete button is gone, and a page from before is told
    why.
  - **Proposed:** step 4 ships as three PRs, 4a, 4b and 4c (§8).
- **2026-10-29:** In 4a, Mark all as paid's window says "Pay 1 cost" for
  one, not "Pay 1 costs", in English and Arabic (found by the audit).
- **2026-10-29:** In 4a, Mark all as paid reads "تحديد الكل كمدفوع" in
  Arabic, as Mark as paid's "تحديد كمدفوع" does; it read "تحدد" ("you
  mark").
- **2026-10-29:** Step 3 was merged in #100, with Codex's two findings
  fixed in it: the location filter left out archived locations, and Reset
  left a place filter in place for someone with no select for it. Step
  4's first PR, 4a, opens for review in #101.
- **2026-10-29:** In 4a (#101), deleting a task holds it before reading
  whether its costs are paid, as paying holds it: a payment recorded
  while the delete waited was missed, and the paid task deleted (found by
  Codex).
- **2026-10-29:** In 4a (#101), deleting a task reads its shares'
  payments as the task's page does, stored as JSON text too, as older
  tasks may have them: read as text, a share paid wasn't seen, and the
  task was deleted while its page hid Delete (found by Codex).
- **2026-10-22:** Step 4's second PR, 4b, is built (§4.3):
  - **A client with tasks or records is archived instead of deleted,**
    with its records, tasks and locations kept. The Clients list's menu
    says Archive for one of these and Delete for the rest, and its
    window says what archiving does.
  - **An archived client is left out of what's picked from:** the task
    form, the bulk upload's template and review, Add record and Add
    location. A task already at it keeps it, and can still be edited.
    The server refuses new work for one.
  - **It stays in filters and history:** the Tasks, Costs and Locations
    filters list it, marked archived.
  - **The Clients list** has In use and Archived. An archived client's
    page says so, with Restore for whoever manages clients.
- **2026-10-29:** In 4b, a client confirmed for archiving is archived,
  even if its last task or record went before it was confirmed, rather
  than deleted for good (found before review).
- **2026-10-29:** Decided by the product owner: an archived client takes
  nothing new. In 4b, its page offers no Add record, Add section or Add
  location, and the server refuses them (`CLIENT_ARCHIVED`), as it does a
  new task; Restore brings them back.
- **2026-10-29:** 4a was merged in #101, with Codex's two findings fixed
  in it: deleting a task didn't hold it before checking its costs were
  paid, nor read its shares' payments stored as text. Step 4's second
  PR, 4b, opens for review in #102. Its migration adds `Client.archivedAt`,
  nullable, after production's latest, `20261111000000_task_locations`
  (checked read-only).
- **2026-10-29:** In 4b (#102), creating, editing or uploading a task
  holds its client while it writes it, as archiving holds it: a client
  archived as a task was being written to it took it (found by Codex).
- **2026-10-29:** In 4b (#102), an archived client's page says so, and
  offers no Add record or Add section, to whoever may add records but not
  see clients, as the Employee role: its sections now say it's archived
  (found by Codex).
- **2026-10-29:** In 4b (#102), a client restored from its page is in
  use there at once: its details, reloaded by Restore, say whether it's
  archived ahead of its sections, which weren't reloaded and kept it
  archived (found by Codex).
- **2026-10-22:** Step 4's third PR, 4c, is built (§4.4, §4.5):
  - **Each cost is a row of its own**, with an id, and its description.
    The migration gives every cost already saved a row; none has a
    description, as they were thrown away.
  - **A cost's description is kept,** up to 200 characters, and shows on
    the task's page. One longer is refused, and the field stops at 200.
  - **A cost is removed by its id,** and only it. Costs added together
    were saved at the same moment, and removing one by that moment took
    them all off the list, though only its amount came off the totals.
  - **A cost can't be removed once its person's costs on the task are
    paid.**
  - **Two people saving the same task at once** each keep their costs.
    The task is held while it's saved; one person's costs used to go from
    the list while their total stayed.
  - **Proposed:** PR 4d, once 4c is live, finishes the move (§4.5).
- **2026-10-22:** Decided by the product owner: step 4 ships as three PRs,
  4a, 4b and 4c, and a small fourth, 4d, once 4c is live (§4.5, §8).
- **2026-10-29:** In 4c, removing a cost the server refuses for good, one
  whose person is paid, closes its window and shows the task as it is
  now, rather than offering Delete again (found by the audit).
- **2026-10-29:** 4b was merged in #102, with Codex's three findings
  fixed in it: a task written to a client as it was archived took it, an
  archived client's page didn't say so to records-only viewers, and, from
  that fix, Restore left its page archived. Its migration ran on
  production at 13:58 UTC, with no errors after. Step 4's third PR, 4c,
  opens for review in #103. Its migration adds `TaskCost` and gives each
  cost entry its row; production has none yet (checked read-only).
- **2026-10-29:** In 4c (#103), a cost is kept to the cent with half a
  cent going up, as Postgres rounds it: 1.005 was rounded down, being a
  hair under in binary, and the totals owed with it (found by Codex).
- **2026-10-22:** Step 4's small fourth PR, 4d, is built (§4.5). It opens
  once 4c is live:
  - **Its migration** gives the costs the release before added meanwhile
    their rows, and removes the rows of costs it removed. From then on the
    rows say which costs a task has, and the task's page lists them.
  - **Like 4c's, its migration removes the helpers it makes:** a database
    set up from scratch runs every migration in one go.
- **2026-10-29:** 4c was merged in #103, with Codex's finding fixed in
  it: a cost with half a cent was rounded down. Its migration ran on
  production at 14:30 UTC, with no errors after. Step 4's small fourth
  PR, 4d, opens for review in #104, now that 4c is live. Production has
  no costs yet, neither entries nor rows (checked read-only), so its
  migration changes nothing there.
- **2026-10-22:** Step 5's first PR, 5a, is built (§5):
  - **Each company keeps two lists,** of cost names and of task titles. A
    name is in a list once, ignoring capitals.
  - **The title on a new task or an edited one, and a cost's name on the
    task's page, are typed or picked:** names that contain what's typed
    are suggested, those starting with it first, and "+ Add" adds what's
    typed for whoever may add names, the only way one is added.
  - **The Saved lists page** renames, merges and archives names, with how
    often each was picked. Merging moves what was picked as one to the
    other; what was typed stays.
  - **Add list names (everyone) and Manage lists (Admin)** come to new
    companies now, and to those already there with 5b.
  - **Proposed:** the split into 5a, 5b and 5c, an archived name refused
    by "+ Add", the page's place in the side bar, and 5b giving Add list
    names to every role (§5.10).
- **2026-10-29:** 4d was merged in #104, so step 4 is done. Its
  migration ran on production at 15:23 UTC, with no errors after, and
  changed nothing there, as production had no costs. Step 5's first PR,
  5a, opens for review in #105. Its migration adds the lists' table and
  two empty links, and changes nothing already there.
- **2026-10-29:** In 5a (#105), Escape with a picker's suggestions open
  closes them and nothing else. In Edit task details it closed the whole
  window too, and what had been typed in it (found by Codex).
- **2026-10-29:** In 5a (#105), a picker's suggestions follow what's
  typed. Typed on before the list answered, it went on offering the last
  answer, and Enter picked the name under the keys for what was typed
  before, in place of what was typed since (found by Codex).
- **2026-10-29:** In 5a (#105), a name added with "+ Add" fills the field
  only while it still holds what was added. Over a slow connection, the
  answer replaced what had been typed since, and on a task's page, the
  next cost's name with the last one's (found by Codex).
- **2026-10-29:** In 5a (#105), a name added with "+ Add" in Edit task
  details keeps what else was edited while it was added. The form was
  filled as it was when Add was pressed, so a description, deadline or
  location changed meanwhile went back (found by Codex).
- **2026-10-29:** In 5a (#105), a title picked on New task stays linked to
  its name only in the company it was picked in. A Super Admin who picked
  a title and then switched company sent the first company's name with
  the task, and the task was refused; the title now keeps its text only
  (found by Codex).
- **2026-10-29:** Decided by the product owner: 5b gives Add list names
  to every role in the companies there already are, their own roles too
  (§5.10).
- **2026-10-29:** Step 5's second PR, 5b, is built (§5.10). Its
  migration gives the companies there before 5a the lists' permissions,
  now that 5a's role editor is live:
  - **Every role gets Add list names:** the built-in ones as a new
    company's have it, and the companies' own roles too.
  - **Only the built-in Admin gets Manage lists.**
  - **A role given either in the role editor since keeps it as it is,**
    and only the holders of a role given one reload their grants.
- **2026-10-29:** 5a was merged in #105, with Codex's five findings, over
  two reviews, fixed in it: all in the name picker, from Escape closing
  Edit task details to a Super Admin's title keeping another company's
  name. Its migration ran on production at 16:16 UTC, with no errors
  after. Step 5's second PR, 5b, opens for review in #106; its migration
  gives the 3 companies there the lists' permissions (12 grants on their
  9 built-in roles; none has roles of its own yet, checked read-only).
- **2026-10-29:** Decided by the product owner (§5.9): a name's filter
  keeps what was picked as it and what was typed the same, ignoring
  capitals; and Mark all as paid isn't offered with a cost name picked.
- **2026-10-29:** Step 5's third PR, 5c, is built (§5.8–5.9):
  - **The Tasks page filters by a saved title,** and the Costs page by a
    cost name, in the filter bar's panel, kept in the address.
  - **With a cost name, the Costs page lists what's due of those costs:**
    its cards say the name, and its total adds them up, one employee's
    with an employee picked. Mark all as paid gives way to a line saying
    to clear the cost name to pay, and the server refuses it too.
  - **An imported title is saved as the saved one it names,** ignoring
    capitals; never one the request names.
- **2026-10-29:** 5b was merged in #106; Codex found nothing in it. Its
  migration ran on production at 18:04 UTC: the 3 companies there hold
  the lists' permissions (12 grants on their 9 built-in roles), with no
  errors after. Step 5's third PR, 5c, opens for review in #107; it has
  no migration.
- **2026-10-29:** In 5c (#107), the Costs page with a cost name picked
  lists and counts only the tasks with a cost of that name still due. A
  task whose costs of it were all in shares paid already, or with an
  employee picked, all someone else's, was counted and paged with no card
  to show, and could fill a page while those due were on the next (found
  by Codex).
- **2026-10-29:** In 5c (#107), a name's filter takes its `%`, `_` and `\`
  as typed. What was typed the same was matched as a pattern, so
  "Cleaning_supplies" kept costs typed "Cleaning supplies", and "%" every
  cost (found by Codex).
- **2026-10-29:** Decided by the product owner (§6.2): each cost has its
  own receipt photo, and it's optional. Step 6's split into 6a–6d is
  proposed (§6.8).
- **2026-10-29:** Step 6's first PR, 6a, is built (§6.2, §6.8):
  - **Add costs takes a receipt photo for each cost,** optional: a photo
    or a PDF, up to 4 MB, picked before Add, uploaded to the company's
    receipts folder when the task is saved. One that can't be uploaded
    stops the save, rather than saving the cost without it.
  - **The server keeps only a receipt uploaded for this company's costs**
    and still in storage, on one cost only.
  - **The task's page shows each cost's receipt,** opened in a new tab,
    and removing the cost, or deleting the task, removes it from storage.
    The orphan sweep counts receipts as in use.
- **2026-10-29:** 5c was merged in #107, with Codex's two findings fixed
  in it: the Costs page with a cost name counting only tasks with some of
  it due, and a name's `%` and `_` taken as typed. It has no migration.
  Step 5 is done. Step 6's first PR, 6a, opens for review in #108; its
  migration adds each cost's receipt, none yet.
- **2026-10-29:** In 6a (#108), a cost's receipt is taken only as the
  address its upload gave. The same file spelt another way, such as
  "%31" for "1", was another address, so it could be put on a second
  cost, and removing either cost removed the other's receipt too (found
  by Codex).
- **2026-10-29:** Step 6's second PR, 6b, is built (§6.1–6.6, §6.8):
  - **A task's costs are charged to its client:** each cost keeps its
    service fee, whether it's left off the bill, and when it was
    collected, and by whom. Its migration adds them, none yet.
  - **The Costs page has a Charged to clients tab,** filtered by client,
    the day a cost was added, status and search, with Paid out, Service
    fees and Total due. Whoever manages charges sets a charge's service
    fee, by the fee or the total, and leaves a cost off its client's bill
    or charges it again. Each is in the audit log.
  - **The rules hold from now:** a collected charge is locked; a task's
    client can't change while any of its charges are collected; a cost
    whose charge was collected can't be removed; a task with charges
    can't be deleted.
  - **See charges, Manage charges and Mark charges collected** are in the
    built-in roles for new companies: Admins hold all three for the
    company, Team Leaders See charges for their team's tasks.
- **2026-10-29:** 6a was merged in #108, with Codex's finding fixed in
  it: a receipt taken only as the address its upload gave. Its migration
  ran on production with no errors after; production has no costs yet.
  Step 6's second PR, 6b, opens for review in #109; its migration adds
  each cost's service fee, "Not charged to client" tick and when it was
  collected, none yet.
- **2026-10-29:** In 6b (#109), the charges are behind the Costs module
  for the API as well as the page: a company whose package leaves Costs
  out could still list its charges and set their fees through it (found
  by Codex).
- **2026-10-29:** In 6b (#109), setting a charge's fee or its "Not
  charged to client" tick waits for its task, as deleting the task does.
  Charged to its client again while the task was being deleted, a cost
  was deleted with it, though the task couldn't be deleted with a charge
  (found by Codex).
- **2026-10-29:** Step 6's third PR, 6c, is built (§6.6, §6.8): the
  companies already there get See charges, Manage charges and Mark
  charges collected on their built-in Admin roles, for the company, and
  See charges on their built-in Team Leader roles, for their team's
  tasks, as a new company's have them. Only the holders of a role given
  one reload their grants.
- **2026-10-29:** 6b was merged in #109, with Codex's two findings fixed
  in it: the charges API behind the Costs module, and a charge's changes
  waiting for its task. Its migration ran on production at 21:30 UTC,
  with no errors after; production has no costs yet. Step 6's third PR,
  6c, opens for review in #110; its migration gives the 3 companies there
  the charges' permissions (12 grants on their 6 built-in Admin and Team
  Leader roles).
- **2026-10-29:** Step 6's fourth PR, 6d, is built (§6.4, §6.5, §6.8):
  - **Each client's page shows its charges:** Due and Collected, and each
    charge with what was bought, on which task, its receipt, and who
    added it and when.
  - **Mark collected collects exactly the Due ones listed,** as its
    confirmation says, with two-factor sign-in, or nothing if the list
    changed meanwhile. The audit log records it on the client.
  - **Mark uncollected makes a collected charge due again,** so it can be
    corrected, with two-factor sign-in; the audit log keeps both steps.
- **2026-10-29:** In 6d, the code two-factor sign-in asks for opens above
  the confirmation that sent the action. It opened under it, so its
  Confirm couldn't be clicked: Mark all as paid (§4.1) with no code
  entered in the hour couldn't go on, nor could Mark collected.
- **2026-10-29:** 6c was merged in #110; Codex found nothing in it. Its
  migration ran on production at 22:34 UTC: the 3 companies there hold
  the charges' permissions (12 grants on their 6 built-in Admin and Team
  Leader roles), with no errors after. Step 6's last PR, 6d, opens for
  review in #111; it has no migration.
- **2026-10-29:** In 6d (#111), Mark collected's confirmation sends the
  list it showed, whatever happens to the page behind it. Reloaded while
  it was open, as on reconnecting, it sent the new list, so one with a
  charge swapped for another of the same amount was collected, not
  refused as changed (found by Codex).
- **2026-10-29:** In 6d (#111), a client's charges count their days where
  its company is for a Super Admin too, whichever company they picked.
  On its page, they were counted where the platform is, so a charge near
  midnight in a company in another zone fell on the wrong day, in the
  totals and in what Mark collected took (found by Codex).
- **2026-10-29:** In 6d (#111), a client's page opens for whoever sees
  its charges, with its name and its charges only, and the Charged to
  clients tab links to it for them. A role with Mark charges collected
  but neither See clients nor See records, such as a collector's, had no
  way to the only place that marks charges collected (found by Codex).
- **2026-10-30:** Step 7, cash advances, is split into four PRs, 7a to
  7d (§7.8), and its first, 7a, is built (§7.3–§7.7):
  - **The ledger:** each movement is an entry, given, returned or a
    correction, and never edited. A balance is the entries' sum, and
    never goes below zero.
  - **The switches:** the Super Admin allows cash advances for a company,
    which switches them on, and its Admin switches them off and on again
    on Company Settings' General tab. Neither goes off while anyone holds
    advance money.
  - **The Costs page's Cash advances tab:** everyone at work in the
    company, and anyone else still holding money, with their balance,
    what's awaiting their confirmation and their last movement, and the
    total held. Give advance, Record return and Correction ask for
    two-factor sign-in; each person's history is on their own page.
  - **My cash advance,** under Me in the side bar: the balance, its
    history, and Confirm receipt on each advance given.
  - **See cash advances and Give and settle cash advances** are in new
    companies' built-in roles; the companies already there get them in
    7c.
- **2026-10-30:** 6d was merged in #111, with Codex's three findings fixed
  in it, so step 6 is done. It has no migration, and production has had no
  errors since. Step 7's first PR, 7a, opens for review in #112. Its
  migration only adds: the cash advances' table, and the two switches,
  with cash advances not allowed for any company until the Super Admin
  allows them. Production has no cash advances' table, kind or switches
  yet, and no migration unfinished (checked read-only just before).
- **2026-10-30:** In 7a (#112), deleting someone for good waits for any
  cash advance entry being recorded for them, and sees it, as each entry
  is recorded under the same hold on their advance. A correction recorded
  for someone deleted could commit after the check that they held
  nothing, and the delete then took it with them; and one recorded as
  they were deleted failed as an error, not as nobody there (found by
  Codex).
- **2026-10-30:** 7b is built: costs paid from the cash advance (§7.2,
  §7.4). A cost added is paid from its author's advance first, and only
  the rest is to be paid back, in their share, the task's total and Mark
  all as paid. Each part taken is a Spent entry on its cost and task;
  removing the cost or deleting its task puts it back. Each cost shows
  From advance and To pay back, Add cost says the balance, and giving an
  advance offers to pay what the company owes the person in the same
  hand-over (§7.8).
- **2026-10-30:** 7a was merged in #112, with Codex's finding fixed in it.
  Its migration ran in production as its preview built, and production
  has had no errors since. 7b opens for review in #113. Its migration only
  adds: each cost's part from the advance, a Spent entry's cost and task,
  and their checks. Production's last migration is 7a's, none is
  unfinished, and it has none of 7b's columns yet, no cash advance entry,
  and no company allowed cash advances (checked read-only just before).
- **2026-10-30:** In 7b (#113), a cost removed by its entry's time, as the
  older request names it, puts its part from the advance back too, and
  only what's owed comes off what's to be paid back. Only a cost removed
  by its id did: by its time, the whole cost came off, and its part from
  the advance was lost (found by Codex).
- **2026-10-30:** In 7b (#113), a cost whose author was deleted for good
  since is removed, and its task deleted, with nothing put back: their
  advance went with them. Putting it back on an advance no longer there
  failed, and the cost or task stayed (found by Codex).
- **2026-10-30:** In 7b (#113), more costs added at once than the app has
  database connections are each recorded in turn. The day each part was
  spent was read through a connection of its own while its costs were
  being recorded; with every connection held by costs waiting on the same
  advance, none was free, and all of them failed (found by Codex).
- **2026-10-30:** Step 7's third PR, 7c, is built (§7.7, §7.8): the
  companies already there get See cash advances and Give and settle cash
  advances on their built-in Admin roles, for the company, and See cash
  advances on their built-in Team Leader roles, for their team, as a new
  company's have them. Only the holders of a role given one reload their
  grants, and nothing opens until the Super Admin allows a company cash
  advances.
- **2026-10-30:** 7b was merged in #113, with Codex's three findings fixed
  in it. Its migration ran on production at 09:16 UTC, as its preview
  built, and production has had no errors since. 7c opens for review in
  #114; its migration gives the 3 companies there the cash advances'
  permissions (9 grants on their 6 built-in Admin and Team Leader roles).
  Production's last migration is 7b's, none is unfinished, it has no
  roles of a company's own and no cash advances grants yet, and no
  company is allowed cash advances (checked read-only just before).
- **2026-10-30:** Step 7's fourth PR, 7d, is built (§7.3, §7.8): ending
  someone's contract turns what they still hold of a cash advance into a
  debt, its source the advance, and an entry of its own, Became a debt,
  takes their balance to nothing. The final settlement recovers it as it
  recovers other debts, and what it can't cover stays outstanding. End
  Contract says so before the contract is ended.
- **2026-10-30:** 7c was merged in #114; Codex found nothing in it. Its
  migration ran on production at 10:40 UTC, as its preview built, giving
  the 3 companies there 9 grants on their 6 built-in Admin and Team Leader
  roles, and production has had no errors since. 7d opens for review in
  #115. Its migration only adds the entry kind Became a debt and its
  check. Production's last migration is 7c's, none is unfinished, and it
  has no cash advance entries, debts or settlements yet, and no company
  allowed cash advances (checked read-only just before).
- **2026-10-30:** In 7d (#115), an ending dated ahead turns what's held
  when it takes effect into a debt too, as the person is archived. Only
  what they held when the ending was recorded did: an advance given them
  as they worked on, or a cost's part put back, stayed with them after
  they'd gone (found by Codex).
- **2026-10-30:** In 7d (#115), what comes back to someone whose contract
  has ended becomes a debt at once: a cost's part put back as it's
  removed, or a correction finding they held more. It went back on their
  balance, and only an ending taking effect turned a balance into a debt,
  so it stayed with them (found by Codex).
- **2026-10-30:** In 7d (#115), an advance given, or a correction
  recorded, reads whether the person is at work, or gone, under the hold
  on their advance. It was read before it waited for the hold, so an
  ending that committed meanwhile went unseen: an advance could be given
  to someone gone, and a correction for them stay on their balance (found
  by Codex).
- **2026-10-30:** A username picked for someone new is refused only when
  another person has it, ignoring capitals. Prisma matched it with ILIKE,
  so its `%`, `_` and `\` were patterns: "a_b" was refused because "axb"
  was taken, and "%" because anyone was. They're taken as typed now, as
  the saved lists' names are (§5.9).
- **2026-10-30:** 7d was merged in #115, so step 7 is done, and with it
  steps 0–7. Four small fixes open for review in #116 before the rest of
  `UI_PLAN.md`: the username check above, a task's cost amounts in the
  page's language, and total tiles and tabs on phones.
- **2026-10-30:** The Costs page's Employee costs tab moves onto the
  building blocks (`UI_PLAN.md` §5). What it lists, its totals, its
  filters (§3, §5.9) and Mark all as paid (§4.1) work as they did.
- **2026-10-30:** The four small fixes were merged in #116, and the Costs
  page's Employee costs tab opens for review in #117 (`UI_PLAN.md` §5).
- **2026-10-30:** The Employee costs tab was merged in #117. The Tasks list
  moves onto the building blocks in #118 (`UI_PLAN.md` §5): its filters by
  client, location and saved title (§3, §5.9) work as they did, and each
  task shows where it's done, "Client - Location", under its title.
- **2026-10-30:** The Tasks list was merged in #118 (`UI_PLAN.md` §5), with
  where each task is done under its title.
- **2026-10-30:** Create task moves onto the building blocks in #120
  (`UI_PLAN.md` §5). Its client and location picker (§2.3) and its title
  picked from the saved list (§5) work as they did.
- **2026-10-30:** Create task was merged in #120 (`UI_PLAN.md` §5), with its
  client and location picker and its saved title as they were.
- **2026-10-30:** In #121, Create task says when the people who can be
  assigned couldn't be loaded, rather than loading for good (`UI_PLAN.md`
  §5).
- **2026-10-30:** In #121, Create task offers Try again when the people who
  can be assigned couldn't be loaded (`UI_PLAN.md` §5).
- **2026-10-30:** Add obligation was merged in #121 (`UI_PLAN.md` §5), and
  an obligation's page moves onto the building blocks in #122. Neither
  touches clients or locations.
- **2026-10-30:** In #122, the Tasks list says who decided a task by their
  name, without the role's code saved before it (`UI_PLAN.md` §5).
- **2026-10-30:** A task's page moves onto the building blocks, in two
  parts (`UI_PLAN.md` §5). In the first, where it's done and its client
  are among its details, its map pin a link; its costs and charges keep
  their own block until the second.
- **2026-10-30:** An obligation's page was merged in #122 (`UI_PLAN.md` §5),
  and a task's page opens in #123.
- **2026-10-30:** A task's costs move onto the building blocks in its
  page's second part (`UI_PLAN.md` §5): each with its description, its
  receipt and what came from a cash advance (§4.5, §6.2, §7.5), as before.
- **2026-10-30:** A task's page, part 1, was merged in #123 (`UI_PLAN.md`
  §5), and its part 2, with its costs, opens in #124.
- **2026-10-30:** A task's page, part 2, was merged in #124 (`UI_PLAN.md`
  §5), and the one Requests page opens in #125. It doesn't touch clients or
  locations.
- **2026-10-30:** The one Requests page, part 1, was merged in #125
  (`UI_PLAN.md` §2.3), and Ask for leave becomes a role's permission in
  #126. Neither touches clients or locations.
- **2026-10-30:** Ask for leave was merged in #126 (`UI_PLAN.md` §2.3), and
  the companies there get it in #127. Neither touches clients or locations.
- **2026-10-31:** The companies there got Ask for leave, merged in #127
  (`UI_PLAN.md` §2.3), and day off moves onto the Requests page in #128.
  Neither touches clients or locations.
- **2026-10-31:** Day off on the Requests page was merged in #128
  (`UI_PLAN.md` §2.3), and the Day off page sends people there in #129.
  Neither touches clients or locations.
- **2026-10-31:** The Day off page sends people to the Requests page,
  merged in #129 (`UI_PLAN.md` §2.3), and permission hours move there in
  #130. Neither touches clients or locations.
- **2026-10-31:** Permission hours join the Requests page in #130
  (`UI_PLAN.md` §2.3, part 3a). It doesn't touch clients or locations.
- **2026-10-31:** Permission hours on the Requests page were merged in #130
  (`UI_PLAN.md` §2.3), and missing punches join it in #131. Neither touches
  clients or locations.
- **2026-10-31:** Missing punches on the Requests page were merged in #131
  (`UI_PLAN.md` §2.3), and the Attendance page points there in #132. Neither
  touches clients or locations.
- **2026-10-31:** The Attendance page points to the Requests page, merged in
  #132 (`UI_PLAN.md` §2.3), and part 4 is planned in four PRs, overtime
  first in #133. None touches clients or locations.
- **2026-10-31:** Overtime on the Requests page was merged in #133
  (`UI_PLAN.md` §2.3), and check-in phones join it in #134. Neither touches
  clients or locations.
- **2026-10-31:** Check-in phones on the Requests page were merged in #134
  (`UI_PLAN.md` §2.3), and flagged check-ins join it in #135. Neither
  touches clients or locations.
- **2026-10-31:** Flagged check-ins on the Requests page were merged in #135
  (`UI_PLAN.md` §2.3), and the Attendance page points there for all of
  them in #136. Neither touches clients or locations.
