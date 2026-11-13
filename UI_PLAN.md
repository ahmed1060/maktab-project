# Organising the system: names, navigation and look

This file holds the plan for making the whole app feel organised: how the
side bar is grouped, what things are called (in English and Arabic), how
pages look, and the tools used to build and check them. It's updated with
every decision; the change log at the end records each update.

Each part is marked **Decided**, **Proposed** or **Open**, as in
`CLIENTS_PLAN.md`.

---

## 1. What's there today

### 1.1 The side bar, for company users

Two flat groups (`lib/modules.ts`, `components/DashboardShell.tsx`):

| Menu (القائمة) | Management (الإدارة) |
|---|---|
| Dashboard | Costs |
| Tasks | Employees |
| Obligations | Vendors |
| Requests | Payroll |
| Day Off Requests | Role requests |
| Clients | Company Settings |
| Check in (phone app only) | |
| Attendance | |
| My payslips | |

### 1.2 The side bar, for the Super Admin

One flat list of 14 items: Super Admins, Companies, Packages, Public
Holidays, Role Templates, Policy Templates, Check-ins, Who can, Role
changes, Access reviews, All users, Audit logs, System Health, System
Settings.

### 1.3 What makes it feel disorganised

1. **Groups don't follow what people do.**
   - "Menu" mixes daily work (Tasks), self-service (My payslips, Day Off
     Requests) and business records (Clients).
   - "Management" mixes money (Costs, Payroll), people (Employees), business
     (Vendors) and admin (Role requests, Settings).
2. **Related things are apart.** Clients is under Menu and Vendors under
   Management, though they're about the same businesses. Costs and Payroll
   are both money, but sit as separate items.
3. **Five separate kinds of request, in four places:**
   - Requests (internal administrative);
   - Day Off Requests;
   - Role requests;
   - profile (name change) requests;
   - attendance requests (permission hours, overtime, missing punch), inside
     Attendance.
4. **Personal and team items are mixed.** "My payslips" sits next to pages
   that show the whole team.
5. **The Super Admin's 14 items have no grouping.**
6. **Icons are emoji.** They look different on every phone and computer,
   and don't match each other in style.
7. **Pages are styled one by one.**
   - There are about 3,400 inline style blocks, and no shared page header,
     filter bar, table or empty state. Spacing, sizes and colours drift from
     page to page.
   - **7 pages use Tailwind class names, but Tailwind isn't installed**, so
     those styles do nothing: the dashboard home, Employees, Vendors, Day
     Off Requests and the three Clients pages. Their headings and spacing
     fall back to browser defaults, which is part of why they look
     different from the rest.

---

## 2. Navigation (Decided)

### 2.1 Company users

The side bar is grouped by what people do. Each person only sees what their
permissions allow, as today.

| Group | Items |
|---|---|
| *(top)* | Dashboard · Check in (phone app only) |
| **Work** (العمل) | Tasks · Obligations |
| **Clients** (العملاء) | Clients · Locations · Records |
| **People** (الموظفون) | Employees · Attendance · Requests |
| **Money** (المالية) | Costs · Payroll |
| **Me** (حسابي) | My payslips · My attendance · My cash advance |
| *(bottom)* | Company settings · Roles and access · Saved lists |

- **Check in sits at the top,** beside Dashboard. It's what people use most
  on the phone, every day.
- **A group is hidden when the person can't see anything in it.** For
  example, an ordinary employee doesn't see an empty Money heading.
- **What the company's package doesn't include isn't there,** for anyone in
  the company (decided by the product owner on 2026-11-05, `DESIGN.md`
  §5.1). Its pages, opened by their address, say they can't be opened
  because the package doesn't include them. It was there, faded and with a
  padlock, as the way to find out what else the product does. Inside the
  pages it does include, what's of it isn't there either, such as the
  dashboard's tiles and a person's pay (`DESIGN.md` §5.5, Page layout).
- **Me holds what people often check about themselves:**
  - My payslips;
  - My attendance, for someone who can only see their own. Someone who can
    see more uses Attendance under People;
  - My cash advance, when the company uses cash advances.
- **The account menu at the top** keeps the account settings: My profile,
  Security settings, History and Sign out. History is HR's, so it's there
  where the package includes HR.
- **Costs** holds its tabs: Employee costs, Charged to clients, and Cash
  advances.
- **One Requests page** (§2.3) replaces the separate request pages: People
  has one Requests item (part 5c). Day off, name changes and role requests
  are kinds on its page, and their old pages send people there. Roles and
  access, the Role requests page's other tabs, sits beside Company settings
  for whoever gives roles (part 5b).

### 2.2 The Super Admin

| Group | Items |
|---|---|
| **Customers** | Companies · Packages · All users |
| **Templates** | Role templates · Policy templates · Public holidays |
| **Access** | Super Admins · Role changes · Access reviews · Who can |
| **Operations** | Check-ins · Audit logs · System health · System settings |

- **They come after the company's groups,** which the Super Admin sees for
  the company they've picked, as today.
- **Terminal brands joins Templates** when it's built: the list of
  fingerprint terminal brands companies pick from (`ATTENDANCE_PLAN.md`
  §17.9, round 9, #269).
- **Their Arabic names (Decided on 2026-10-22):** المشتركون (Customers), القوالب
  (Templates), الصلاحيات (Access) and التشغيل (Operations). العملاء, the
  word for a company's clients, would name two groups in the same side bar.

### 2.3 One Requests page

- **Every kind of request in one place:** day off, permission hours,
  overtime, missing punch, role changes, name changes, and internal
  requests. Missions (مأمورية) join them (`ATTENDANCE_PLAN.md` §6.10,
  round 10, Phase 5, part 3).
- **Two tabs: Mine and To review.** "To review" shows only what the person
  may decide.
- **A filter by kind,** so a manager can look at day-off requests only, for
  example.
- **Every request reads the same way:** who asked, what for, when, its
  status, and the decision buttons.

It's the largest change here, so it comes later (§5). Until then, the
existing request pages sit together under People (§2.1).

**How it's built (Decided on 2026-10-30):** in five parts, each a small PR.
Each keeps every request working, and an old page sends people to the new
one once its kind has moved in.

1. **The page:** `/dashboard/requests` on the building blocks, with:
   - Mine and To review;
   - Waiting and Done;
   - the kind filter, shown once there's more than one kind;
   - one row for every kind: who asked, what for, when, its status, and
     the buttons to decide it.

   Its first kind is internal requests, which already live there, and their
   history page folds in as Done. The rows come from one feed on the
   server, which reads each kind through its own rules for who may see and
   decide it.
2. **Day off:** asked for and decided on the page; Day off requests sends
   people there. Who may ask is a role's permission, Ask for leave (Decided
   on 2026-10-30): the built-in Employee and Team Leader hold it, as they
   ask today, and so does every custom role there already. The built-in
   Admin doesn't, and its role is locked (`ROLES_PLAN.md` §4.2, rule 7),
   so a company whose Admins ask for leave gives them an Admin-based role
   of its own that holds it. Their leave balance is a donut on Mine, above
   the list. In three PRs, so no release that doesn't know the permission can
   drop it from a role:
   1. **2a:** Ask for leave in the permissions and the role editor, and in
      a new company's built-in roles. Nothing checks it yet.
   2. **2b:** the companies there already get it, by a migration, once 2a
      is live; then asking for leave needs it (#127).
   3. **2c:** day off on the page: asked for from New request, decided
      under To review with the days to take off and from what, and the
      balance on Mine (#128). The Day off page stays meanwhile.
   4. **2d:** Day off requests sends people there, with its notifications
      and the dashboard's tile, once the page has what its list filters by
      (#129). Its dates of leave are a filter once the kind is Day off
      (Decided on 2026-10-31), as the Day off list had them; the other kinds
      have no dates to filter by.
3. **Permission hours and missing punches:** asked for and decided on the
   page; Attendance's Requests tab points there. In three PRs (Decided on
   2026-10-31), each small enough to review, nothing stopping meanwhile:
   1. **3a:** permission hours on the page (#130): asked for with the
      chosen day's limits, withdrawn while it waits or before an approved
      one begins, and approved or rejected under To review. The month's
      allowance is a line on Mine, under day off's (Decided on 2026-10-31).
   2. **3b:** missing punches on the page, the same way (#131): reported
      with the day, time, in or out and why; withdrawn while it waits;
      approved, which adds the punch, or rejected under To review.
   3. **3c:** Attendance's Requests tab, and its notifications, point there
      (#132). Overtime, phones and flagged punches stay on the tab until
      part 4; asking from a day on the Days tab still opens its forms.
4. **Overtime, phones and flagged punches:** decided under To review.
   Approving someone's phone and a flagged punch join too (Decided on
   2026-10-30), so a manager has one queue for what waits on them. Under
   To review only (Decided on 2026-10-31): nobody asks for them, so Mine
   doesn't list them; a person's own phone stays on the Attendance page,
   and so does Approve overtime ahead, which isn't a request. In four PRs
   (Decided on 2026-10-31):
   1. **4a:** overtime (#133): a day's overtime waiting, approved with all
      its minutes or rejected with a reason; a decision may be withdrawn.
   2. **4b:** check-in phones (#134): a new phone waiting, with the
      check-ins it holds, approved or rejected with a reason; once decided,
      in use, rejected, revoked, replaced or withdrawn; the one in use may
      be revoked.
   3. **4c:** flagged punches (#135), with the face photo and map link they
      show today: those still flagged, approved or rejected with a reason;
      once decided, accepted or rejected, and why.
   4. **4d:** the Attendance tab's To decide, and their notifications,
      point there (#136): the tab keeps a pointer and Approve overtime
      ahead; the Exceptions tab's requests waiting open To review; a new
      phone's notice opens it, picked out, an older one the phones.
5. **Name changes and role requests:** decided on the page; their pages
   send people there, and the side bar shows one Requests item under
   People. In three PRs (Decided on 2026-10-31):
   1. **5a:** name changes (#137): still asked for on one's profile; one's
      own on Mine, everyone else's under To review for whoever decides
      them, approved, or rejected with a reason if there is one. The
      Profile requests page, the header's count, the dashboard's tile and
      a decision's notice open them there. The header's count went in
      #204: they're counted, with all that waits, on Requests in the side
      bar.
   2. **5b:** role requests (#138): still asked for on an employee's page;
      on the Mine of whoever asked, as the Role requests page has them, and
      decided under To review for whoever gives roles, never by whoever
      asked: approved, or rejected with the reason it must have; whoever
      asked may withdraw it while it waits (Decided on 2026-10-31). The
      Role requests page sends people there. Its other tabs, asking the
      Super Admin to change a role and access reviews, are on a page of
      their own, Roles and access, beside Company settings in the side bar,
      for whoever gives roles (Decided on 2026-10-31, in place of moving
      them to Company settings → Roles, which a company's people never see).
   3. **5c:** the side bar shows one Requests item under People, and the
      old pages' items go: Day off and Profile requests (#139). Day off
      stops being a module a company names or gives an icon, since it has
      no entry of its own to name.

- **To review** is everyone else's requests the person sees, with the
  buttons where they may decide them. In the built-in roles, seeing and
  deciding go together; a custom role that may see without deciding sees
  them without buttons.
- **The Super Admin's Role changes stay their own (Decided on
  2026-10-30):** a company asking the Super Admin to change or add a role
  isn't a request between the company's people. It stays under Access, and
  on Roles and access for the company (part 5b).

---

## 3. Names (Decided)

### 3.1 Principles

1. **One word per idea, everywhere.** The side bar, the page title, the
   buttons, notifications, the audit log and the Arabic all use the same
   term. The glossary in §3.2 is the reference.
2. **Pages and lists are plural nouns,** such as "Clients" and "Locations".
3. **Buttons start with a verb,** such as "Add client" and "Mark collected".
4. **Statuses are short adjectives,** such as "Due", "Collected", "Paid" and
   "Pending".
5. **Personal pages start with "My",** such as "My payslips" and "My cash
   advance".
6. **Permissions follow one pattern:** **See** X, **Add** X, **Manage** X,
   plus a verb for anything that moves money ("Mark collected", "Give and
   settle cash advances"). In Arabic: عرض، إضافة، إدارة.
7. **No two things share a name.** Task locations and attendance check-in
   places are different things, so they get different names.

### 3.2 Glossary

| English | Arabic | Meaning |
|---|---|---|
| Client / Clients | عميل / العملاء | A business the company works for (called vendors until `CLIENTS_PLAN.md`'s 0b) |
| Location / Locations | موقع / المواقع | Where a task is done: a client's HQ or branch, or a shared place |
| HQ | المقر الرئيسي | A client's main location |
| Check-in place / Check-in places | مكان الحضور / أماكن الحضور | Where employees check in for attendance (today's "work locations") |
| Record / Records | سجل / السجلات; in the side bar, سجلات العملاء | Notes and files kept for a client, with expiry reminders |
| Task / Tasks | مهمة / المهام | |
| Obligation / Obligations | التزام / الالتزامات | |
| Cost / Costs | تكلفة / التكاليف | Money spent on a task |
| Employee cost / Employee costs | تكلفة دفعها الموظف / تكاليف دفعها الموظف | A cost the company pays back to the employee |
| Charge / Charged to clients | مستحق / مستحقات على العملاء | What a client owes the company for a cost |
| Service fee | رسوم الخدمة | Added on top of a charge |
| Due / Collected | غير محصّل / محصّل | A charge's statuses (replacing "To collect") |
| Cash advance | عهدة | Money given to an employee up front, to pay costs from |
| Request / Requests | طلب / الطلبات | |
| Day off | إجازة | |
| Payslip / Payslips | قسيمة راتب / قسائم الرواتب | |
| Payroll | الرواتب | |
| Brand colour | لون الهوية | The colour a company's pages are drawn in (§4.6) |

Three Arabic names were chosen so that no two things share a name
(principle 7):

- **Records** is **سجلات العملاء** in the side bar, to keep it apart from
  Audit logs (سجلات المراجعة).
- **Employee costs** is **تكاليف دفعها الموظف**, because تكلفة الموظف can
  read as what the employee costs the company.
- **The Due status** is **غير محصّل**, because مستحق already means a Charge.

### 3.3 The names left open in `CLIENTS_PLAN.md`

- **To collect / Collected** become **Due / Collected** (غير محصّل / محصّل).
  The total "Total to collect" becomes **Total due**.
- **Locations** stays for task locations. The attendance "work locations"
  are renamed **Check-in places**.
- **Cash advance** is the English for عهدة.
- **The permission names** follow §3.1(6), for example:
  - See locations, Add locations, Manage locations;
  - See charges, Manage charges, Mark charges collected;
  - See cash advances, Give and settle cash advances;
  - Add list names, Manage lists.

---

## 4. Look (Decided)

1. **Fix the 7 pages using missing Tailwind classes** (§1.3.7), so they
   match the rest.
   - **The dashboard home, Employees and Day Off Requests** move onto the
     building blocks in a small PR, straight after the building-blocks PR
     (§5).
     - Fixing them sooner with one-off styles would mean doing them twice.
     - Leaving them until later would keep the dashboard home, the first
       page everyone sees, broken for a long time.
     - The dashboard home is the page Impeccable is tried on first (§7.1).
   - **Vendors and the three Clients pages** are rebuilt in
     `CLIENTS_PLAN.md`'s step 0.
2. **A few shared building blocks,** used by every page:
   - a page header (title, subtitle, main button);
   - a filter bar;
   - a list or table;
   - a card;
   - a status badge (Due, Paid, Pending…);
   - tabs;
   - total tiles (such as Paid out, Service fees, Total due);
   - an empty state ("No clients yet", with the button to add one).
3. **One scale for spacing and text sizes,** set once in `app/globals.css`
   and used through the building blocks, instead of numbers typed on each
   page.
4. **Phosphor Icons instead of emoji.**
   - The set is free (MIT licence), drawn in a clean line style, and looks
     the same on every phone and computer.
   - It's the set UI/UX Pro Max uses (§7.1), so the design library and the
     app match.
   - Icons are imported one at a time, so only the ones used are shipped.
   - Arrows and other icons that point a direction are flipped in Arabic.
   - Companies rename modules, and since #225 pick each one's icon from a
     short list of 48 business icons, each module's own among them
     (`DESIGN.md` §6). Until then they picked any emoji.
   - The side bar draws Phosphor icons since #203, each item's as
     `DESIGN.md` §6 names it, and since #225 a company's own icon for a
     module as it draws the others.
   - #225 maps every stored choice, not only the defaults: each default
     emoji to its icon, and anything else to the module's own icon. A
     company's renamed labels are kept. Production had none to map on
     2026-11-08, and is checked again, read only, just before #225 is
     merged.
5. **Pages move to the building blocks one by one,** each in a small PR,
   after `CLIENTS_PLAN.md`'s steps (§5).
6. **A brand colour,** set in the settings (§4.6).

### 4.6 Brand colour (Decided)

The colour in style A (§7.2) isn't fixed: it's a setting.

- **The default** is set by the Super Admin in System Settings, next to the
  "Powered by" branding. It starts as Nizmo's own indigo, `#6366f1`. The
  default is used:
  - on the sign-in page and the Super Admin's pages;
  - for every company that hasn't chosen its own colour.
- **Each company can choose its own colour** in Company Settings → Branding,
  next to its logo.
  - Who can change it follows the logo's rule. The Super Admin always can.
    The company's Admin can when the Super Admin shows them the Branding tab.
  - "Use the default" goes back to the system colour.
  - The phone app shows the company's colour after sign-in.
- **Choosing a colour:**
  - pick from a few ready-made colours, or type a colour code;
  - a preview shows the result before saving.
- **Every shade is worked out from the one colour.** This covers buttons,
  links, the selected side bar item, tabs, the pager, counts, focus rings,
  the logo tile, and the light tint behind a selected item.
- **Text on the colour stays readable.**
  - A colour too light for white text is darkened, keeping its hue, until
    white text reads at 4.5:1 or better.
  - Nizmo's own indigo is just under that (4.47:1), so it's used as
    `#6063ea` (4.70:1), which looks almost the same.
  - Dark mode uses a lighter version of the colour.
- **Some colours never change:**
  - the status colours: Pending, In Progress, Approved, Completed, Rejected
    and Overdue. "In Progress" uses a fixed blue, not the brand colour;
  - the warning and error colours.

  A colour close to the error red gets a warning when it's chosen.
- **The older pages, the side bar and the sign-in page follow it too,**
  in a small PR after the setting's (decided on 2026-10-16). They keep
  their own look until they move onto the building blocks, with their
  indigo and violet worked out from the chosen colour (`DESIGN.md` §2.1).
- **The page opens in the right colour.** The server puts the colour into
  the page before sending it, so it doesn't flash indigo first.
- **Every change is in the audit log.**

---

## 5. Order of work, across both plans (Decided)

1. **Settle the names and the side bar groups.** Done on 2026-10-15 (§2,
   §3). These had to come before `CLIENTS_PLAN.md`'s step 0, which renames
   things and changes the side bar.
2. **The shared building blocks, in one PR** (§4.2–4.4):
   - first, the look is chosen and written down in `DESIGN.md` (§7.2).
     Done on 2026-10-15: `DESIGN.md` is written, and the PR builds from
     it;
   - page header, filter bar, list or table, card, status badge, tabs, total
     tiles and empty state;
   - the spacing and text-size scale;
   - the Phosphor icon set (§4.4);
   - the brand colour as one value that every shade is worked out from. It's
     the default indigo here; the settings come in step 3;
   - the design tools are added to the project (§7.3).

   No old page is converted in this PR.
3. **Two small PRs straight after it,** in either order:
   - **the 3 pages `CLIENTS_PLAN.md` doesn't touch:** the dashboard home,
     Employees and Day Off Requests move onto the building blocks (§4.1).
     Merged in #78 on 2026-10-15. Built with the building
     blocks alone, then refined with Impeccable's written guidance once
     question 8 was answered (§6);
   - **the brand colour setting (§4.6):** the database fields, the controls in
     System Settings and Company Settings → Branding, and the server putting
     the colour into the page. The new fields have defaults, so the preview
     build's migration of the shared database is safe for `main`'s code.
     Merged in #80 on 2026-10-16. The colour reaches what's
     built from the building blocks;
   - **the older pages, the side bar and the sign-in page follow the
     colour too (§4.6),** in a small PR straight after the brand colour
     setting's. Merged in #81 on 2026-10-16.
4. **`CLIENTS_PLAN.md`, steps 0–7.**
   - Step 0's first PR, 0a, was merged in #82 on 2026-10-23. It builds each
     client's page and the Records page on the building blocks, with five new
     ones written into `DESIGN.md` first: a back link above a page's title,
     details, files, a record's expiry, and opening an item from a list
     (§5.5). It also adds that text people type keeps its own direction in
     either language (§7).
   - The side bar groups (§2.1, §2.2) land with step 0. Decided
     (2026-10-22): in a small PR straight after 0b, which makes Vendors
     Clients in code and leaves the screens as they were, with the Clients
     list page rebuilt on the building blocks (`CLIENTS_PLAN.md` §8). Merged
     in #93 on 2026-10-23.
   - Every screen these steps create or rework uses the building blocks
     from the start: Clients, Locations, Records, the Costs tabs, Cash
     advances, and the task form's pickers.
5. **The rest of this plan:**
   - the remaining old pages move to the building blocks one by one, each
     in a small PR (§4.5). After four small fixes, merged in #116 on
     2026-10-30, the first was the Costs page's Employee costs tab, beside
     the two tabs already on them, merged in #117 on 2026-10-30. The
     second was the Tasks list, merged in #118 on 2026-10-30, and the
     third the Obligations list, merged in #119 on 2026-10-30, and the
     fourth Create task, merged in #120 on 2026-10-30, and the fifth Add
     obligation, merged in #121 on 2026-10-30, and the sixth an
     obligation's page, merged in #122 on 2026-10-30. The seventh was a
     task's page, in two parts: its page and dialogs, merged in #123 on
     2026-10-30, then its costs, location history, submission form and
     edit dialog, merged in #124 on 2026-10-30. After the one Requests
     page and the account check, merged in #140 on 2026-10-31, the eighth
     is Payroll, in three parts: its top (the page header, the month it's
     for, paying and sending, and the totals), merged in #141 on
     2026-10-31; its review cards, merged in #142 on 2026-11-01; then the
     list of everyone paid and the debts, merged in #145 on 2026-11-01.
     The ninth was Public holidays, merged in #146 on 2026-11-01. The
     tenth is Attendance, in seven parts: its frame (the page header, the
     tabs, and what it says before them), merged in #147 on 2026-11-01;
     a Super Admin's company, the company in view from the top bar,
     merged in #148 on 2026-11-01; Days, with its month, merged in #149
     on 2026-11-01; Punches, merged in #150 on 2026-11-01; Exceptions,
     merged in #151 on 2026-11-01; Import and employee numbers, merged
     in #152 on 2026-11-01; and face checks, the Requests tab and adding
     a punch, merged in #153 on 2026-11-01. The eleventh is Documents, a
     person's own payslips and the payslip and settlement they open, in
     two parts: My payslips, merged in #154 on 2026-11-01; then the
     payslip and settlement sheets, with a document in `DESIGN.md` §5.5,
     merged in #155 on 2026-11-01. The pages after it go most used
     first: the check-in page, with a section of its own in `DESIGN.md`
     §5.5, merged in #156 on 2026-11-01. The twelfth is an employee's
     history, in three parts: its frame (the page header, the tabs, kept
     in the address) and its Salary tab, merged in #157 on 2026-11-01;
     then its Day off credit and Costs tabs, merged in #158 on
     2026-11-01; then its bonuses and deductions, merged in #159 on
     2026-11-01. The thirteenth is company settings, in four parts: its
     frame (both ways in, the tabs, and the unsaved-changes question) and
     its General tab, merged in #160 on 2026-11-02; then its Branding
     and Payroll tabs, merged in #161 on 2026-11-02; then its
     Attendance tab, itself in three parts: its calendar (the
     schedules, who works which and the holidays), merged in #162 on
     2026-11-02; then the attendance policy, whose dialog the policy
     templates page shares, merged in #163 on 2026-11-02; then the
     panels for attendance in pay, the terminals, the check-in places
     and face checks, merged in #164 on 2026-11-02; then the Super
     Admin's own tabs, in three parts: Admin access and Modules, merged
     in #165 on 2026-11-02; then the Roles tab, its copy dialog and its
     access review, merged in #166 on 2026-11-02; then the role editor
     and its permission matrix, which the role templates page shares,
     merged in #167 on 2026-11-02, which finished company settings. The
     fourteenth is the Super Admin's pages, a side bar group (§2.2) at a
     time: Templates first, its role templates and policy templates
     merged in #168 on 2026-11-02 (public holidays moved in #146); then
     Access, in two parts: Role changes and Access reviews, whose lists
     the company's Roles and access page shares, merged in #169 on
     2026-11-02; then Super Admins and Who can, merged in #170 on
     2026-11-02, which finished Access; then Customers, in three parts:
     the Companies list, merged in #171 on 2026-11-02, then a company's
     payments with Packages, merged in #172 on 2026-11-03, then All
     users, merged in #173 on 2026-11-03, which finished Customers; then
     Operations, a page at a time: Check-ins, merged in #174 on
     2026-11-03, then Audit logs, merged in #175 on 2026-11-03, then
     System health in two parts, the page and its maintenance cards,
     merged in #176 on 2026-11-03, then its scheduled jobs, terminals
     and backup picker, merged in #177 on 2026-11-03; then System
     settings in two parts, the page and its four forms, merged in #178
     on 2026-11-03, then its face checks switch, merged in #179 on
     2026-11-03, which finished Operations. The pages left follow, one
     at a time: Add employee, merged in #180 on 2026-11-03, then Add a
     bonus and Add a deduction, merged in #181 on 2026-11-03, then
     Usernames, merged in #182 on 2026-11-03, then Change password and
     the maintenance screen, merged in #187 on 2026-11-04, then Security
     settings, merged in #188 on 2026-11-04, then the last confirmations
     in the old window, merged in #189 on 2026-11-04, then the last
     loading spinners, merged in #190 on 2026-11-04, then a person's
     profile, in five parts: its page, its photo and a name change
     waiting, merged in #191 on 2026-11-04, then what it shows of someone
     else's, as their details, merged in #192 on 2026-11-04, then its form,
     each field's mistake under it, merged in #193 on 2026-11-04, then its
     role field, merged in #194 on 2026-11-05, then ending a contract and
     handing over a team, merged in #195 on 2026-11-05, which finished it,
     then the sign-in page, in two parts: its screen, signing in and the
     two-factor code, merged in #196 on 2026-11-05, then Forgot your
     password, merged in #197 on 2026-11-05, which finished it, then a
     page someone can't open and a company whose subscription has ended,
     merged in #199 on 2026-11-05, then a module's page the package doesn't
     include, which says so as they do, with what the package doesn't
     include gone from the side bar, merged in #200 on 2026-11-05, then the
     notes above the page, a company's free trial or its grace and a role
     being previewed, merged in #201 on 2026-11-05, then what's of a module
     the package doesn't include inside the pages it does, merged in #202
     on 2026-11-05, then the app's frame, from a mock-up the product owner
     approved on 2026-11-05, a part at a time: the side bar, merged in
     #203 on 2026-11-05, then the count of what waits on Requests in it,
     merged in #204 on 2026-11-05, then the top bar and its account menu,
     merged in #205 on 2026-11-06, then the Super Admin's company picker,
     merged in #206 on 2026-11-06, then the bell's panel, merged in #207
     on 2026-11-06, which finished it; then the date fields, in three
     parts: the calendar a date and a range open, merged in #208 on
     2026-11-06, then the date and time of a deadline, merged in #209 on
     2026-11-06, then the browser's own date fields moved onto the same
     calendar, merged in #210 on 2026-11-06, which finished it; then the
     two windows Create task opens: the Super Admin's templates for the
     bulk upload of tasks, merged in #211 on 2026-11-06, then the bulk
     review of tasks, in two parts: its window, merged in #212 on
     2026-11-06, then reading the file's rows, merged in #213 on
     2026-11-06, which finished it; then the toasts, merged in #214 on
     2026-11-07; then the map pin picker and the place search, merged in
     #215 on 2026-11-07; then the face check's camera and a flagged
     check-in's face photos, merged in #216 on 2026-11-07; then the code a
     high-risk action asks for and the screen over a page the app has to
     leave, merged in #217 on 2026-11-07; then what an edit changed on a
     task's page, merged in #218 on 2026-11-07; then a page that broke
     and the app itself, merged in #219 on 2026-11-07; then the privacy
     policy and the terms of service, merged in #220 on 2026-11-07; then
     what was left of the dashboard's frame, merged in #221 on 2026-11-07;
     then the six old components no page used any more, removed in #222,
     merged on 2026-11-08; then the old pages' shared styles nothing used
     any more, removed in #223, merged on 2026-11-08; then the motion of
     menus, dialogs, toasts and the side bar, with Emil Design
     Engineering, merged in #224 on 2026-11-08; then the icon a company
     chooses for a module, from 48 of the app's own, merged in #225 on
     2026-11-08 (§4.4); then ending a contract where the company's
     package has no Payroll, which records no settlement, merged in #226
     on 2026-11-08; then a client's statement, to print or save as a PDF,
     merged in #227 on 2026-11-08 (`CLIENTS_PLAN.md` §6.9); then two bug
     fixes, a pay Add employee couldn't read and the sessions a new
     password ends, merged in #228 on 2026-11-08; then one's own password
     checked by the server where it's asked for, merged in #229 on
     2026-11-08; then Unlock lifting the pause on somebody's password
     tries, merged in #230 on 2026-11-08; then the saver's own password,
     checked by the server, for somebody else's password or email, merged
     in #231 on 2026-11-08; then Change password's Save before the page
     has loaded its session, the sign-in page saying a session ended, and
     the "Powered by" signature on the sign-in page, merged in #232 on
     2026-11-08; then the audit log reading a company's section names and
     icons one section at a time, merged in #233 on 2026-11-08; then what
     the building blocks draw drawn by them, not copied by hand, merged in
     #234 on 2026-11-09; then an advance for a particular task or client,
     its first part (`CLIENTS_PLAN.md` §7.9, 7e), merged in #235 on
     2026-11-09; then costs spending it first (7f), merged in #236 on
     2026-11-09; then the client statement by cost name, beside every
     charge (`CLIENTS_PLAN.md` §6.9), merged in #237 on 2026-11-09; then
     cost names only from the saved list, a company setting (§6.9),
     merged in #238 on 2026-11-09; then what's left of an advance for a
     task or client moving to the running balance (§7.9, 7g), merged in
     #239 on 2026-11-09; then a switch to turn off the high-risk
     confirmation, for every company or for one (`ROLES_PLAN.md` §6.15),
     merged in #240 on 2026-11-09; then what's held for a task following
     it when it's transferred (`CLIENTS_PLAN.md` §7.9, 7h), merged in #241
     on 2026-11-09; then a company's high-risk switch greyed, and refused
     by the server, while the system's is off (`ROLES_PLAN.md` §6.15),
     merged in #242 on 2026-11-09; then the roles tests against Postgres
     building their database with every column a company, a person and the
     system's settings have, so the three of them that had failed on `main`
     since the brand colour pass again, merged in #243 on 2026-11-09; then
     live updates (`REALTIME_PLAN.md`), in five parts, the first, tasks and
     the bell drawn again as what they show changes, merged in #244 on
     2026-11-10 and live since; the last, a little motion for what arrives
     live; then who shows as online on the Employees list and All users
     following the heartbeat, online between its beats and in the Online
     and Offline filters as the badges say, merged in #246 on 2026-11-10;
     then an account deleted while it's signed in refused and signed out,
     as a suspended one is, which went on working, merged in #247 on
     2026-11-10; then live updates' third part, someone suspended, closed
     or deleted, or whose company is banned, signed out within seconds, not
     at the heartbeat's next beat, merged in #248 on 2026-11-10; then the
     account status route answering a company's Admin, whose audit entry
     named them as a Super Admin and failed after the status was saved,
     merged in #249 on 2026-11-10; then live updates' second part, the
     Requests page and the count on Requests in the side bar drawn again
     as a request is asked for, decided or withdrawn, merged in #250 on
     2026-11-10; then live updates' fifth part, what someone else added
     or changed tinted for a moment on the task list and the Requests
     page, and the bell's count growing as it rises, merged in #251 on
     2026-11-11; then live updates' part 4a, the cash advance screens
     drawn again as the ledger changes, the person's own action theirs
     for as long as it's on its way, merged in #252 on 2026-11-11; then
     Codex's two findings on #251, after the merge: a row changed again
     starts its tint again, and the person's own action, refused, hides
     nobody else's change, merged in #253 on 2026-11-11; then the cash
     advance screens' Arabic, neutral as to who reads it and who holds the
     advance, merged in #254 on 2026-11-11; then the rest of the app's
     Arabic, speaking to no one in the masculine (`DESIGN.md` §3.4), in
     five parts: searching, picking and trying again, merged in #255 on
     2026-11-11; entering ("أدخل"، "اكتب"، "حدد"، "أضف"), merged in #256
     on 2026-11-11; the other commands in hints and notices, merged in
     #257 on 2026-11-11; "you" in the masculine ("تريد"، "تحتاج"، "متأكد"),
     merged in #258 on 2026-11-11; and someone else spoken of as "he", the
     audit log's actions included, merged in #259 on 2026-11-12; then a
     task's location sent without its accuracy marked Needs review, not
     taken as exact, its line for a reviewer saying so
     (`CLIENTS_PLAN.md` §2.5), merged in #260 on 2026-11-12; then the
     server's functions moved from Frankfurt to Dublin, next to the
     database in Ireland (`TECH_STACK.md`), merged in #261 on 2026-11-12;
     then who's online from each tab saying when it comes and goes, the
     heartbeat slowed to every 15 minutes (`REALTIME_PLAN.md` part 6a),
     merged in #262 on 2026-11-12; then the Online badge on the Employees
     list and All users changing as people come and go, untinted
     (`REALTIME_PLAN.md` part 6b), merged in #263 on 2026-11-12; then the
     Costs page's Employee costs and Charged to clients tabs, and a
     client's charges, drawn again as costs are added, paid and charged
     (`REALTIME_PLAN.md` part 4b), merged in #264 on 2026-11-12; then the
     Attendance page's Exceptions, Days and Punches tabs, and the Super
     Admin's Check-ins page, drawn again as check-ins come in, at most
     every 30 seconds (`REALTIME_PLAN.md` part 4c), merged in #265 on
     2026-11-12; then a tidy-up of part 4c, merged in #266 on 2026-11-12;
     then the code a high-risk action asks for saying when the server has
     stopped checking codes, after five in fifteen minutes, and counting
     down, where it called a right code wrong (`ROLES_PLAN.md` §6.15),
     merged in #267 on 2026-11-12; then the Super Admin's overview read
     fresh, not refreshed after its page was sent, which a frozen function
     left mid-handshake with the database, and each database connection
     given its queries one at a time (`TROUBLESHOOTING.md`), merged in #268
     on 2026-11-12; then the plan for fingerprint terminals connecting
     through the office agent or straight to Nizmo over HTTPS, chosen for
     each terminal, ZKTeco and Hikvision alike, their brands a list the
     Super Admin keeps, setting them up a permission of its own
     (`ATTENDANCE_PLAN.md` §17.1 to §17.11, Phase 4), merged in #269 on
     2026-11-13; then the plan for reading a day's scans first and last,
     and for missions (مأمورية), by days or by hours, with their allowance
     (`ATTENDANCE_PLAN.md` round 10, §6.9, §6.10, Phase 5), merged in
     #270 on 2026-11-13; then the decisions from its review: departures to
     confirm, the payroll run waiting for them, two kinds of mission by
     hours, and a mission naming a task for its reviewer (round 10,
     decisions 13 to 21), #271;
   - the one Requests page (§2.3), in five parts, the last merged in #139
     on 2026-10-31.

The other 4 pages with missing Tailwind classes (Vendors and the three
Clients pages) are rebuilt in step 0, so they're fixed there.

---

## 6. Open questions

None are open. The seven questions asked on 2026-10-15 were answered the same day:

1. **The side bar groups:** agreed, with Check in at the top and empty
   groups hidden (§2.1, §2.2).
2. **Personal pages:** a Me group in the side bar, while the account menu
   keeps the account settings (§2.1).
3. **One Requests page:** agreed, and it comes later. Until then, the request
   pages sit together under People (§2.3).
4. **The naming principles and glossary:** agreed, with three Arabic changes
   (§3.2).
5. **Due / Collected, Check-in places, Cash advance:** agreed (§3.3).
6. **Icons:** Phosphor Icons, with companies picking from a short list
   (§4.4).
7. **The 3 pages:** fixed straight after the building-blocks PR, using the
   building blocks (§4.1).

Questions 9 and 10 were answered on 2026-10-16:

9. **The older pages and the side bar:** they follow the brand colour
   now, in a small PR of their own, rather than when they move onto the
   building blocks (§4.6, §5 step 3).
10. **"Brand colour" in Arabic:** لون الهوية (§3.2).

Question 8 was answered on 2026-10-15 too:

8. **Impeccable:** add only its written guidance, without the launcher
   (§7.1, §7.3). Its launcher downloads and runs a compiled program that
   can't be read or pinned, so it's left out; 19 of its reference pages
   are copied unchanged into `.claude/skills/impeccable/`, with a
   `SKILL.md` rewritten for Nizmo (`.claude/skills/SOURCES.md`).

---

## 7. Design tools (Decided)

These tools help build the screens and check them. They were chosen from 11
reviewed on 2026-10-15, which are listed in the reference PDF "AI Design and
QA Tools for Coding Agents". The other five were turned down (§7.4).

### 7.1 The tools, and when each is used

| When | Tool | What it does here |
|---|---|---|
| Choosing the look, once | **awesome-design-md** (getdesign.md) | Design write-ups of well-known products. Two or three that suit Nizmo are the starting point for its own `DESIGN.md` (§7.2). |
| Choosing the look, once | **Frontend Design** (Anthropic) | Makes the agent settle on one clear direction before writing code. It's used in that one session and isn't kept. |
| Building | **`DESIGN.md`** (Nizmo's own) | The rulebook. It sets colours, spacing, text sizes, the building blocks, icons and the glossary (§3.2). Every screen and every agent follows it. |
| Building | **Impeccable** (its written guidance only) | Guides building and refining each screen: the quality floor, layout, type, colour, states, copy and the last polish. Its launcher isn't used (§6, question 8). First used on the dashboard home's donut chart (§4.1). |
| Building | **UI/UX Pro Max** | Chosen earlier, on the `ui-refactor` branch. It's a library of palettes, font pairings and UX rules to look things up in. |
| Checking every UI PR | **Vercel Web Design Guidelines** | Audits the changed screens for focus states, forms, accessibility, wording and edge cases. Its findings are fixed in the same PR. |
| Checking every UI PR | **Playwright** | Opens the app in a real browser and takes screenshots in English and Arabic, at phone and desktop width. Claude's cloud sessions already use it. |
| Motion | **Emil Design Engineering** | Added in #224 (`.claude/skills/emil-design-eng`) for the motion of toasts, dialogs, the side bar and menus, once the building blocks existed (`DESIGN.md` §8). It respects the device's "reduce motion" setting. |

### 7.2 Choosing the look

The product owner chooses the look from pictures rather than descriptions:

1. Claude picks two or three write-ups from awesome-design-md. Each must
   suit a calm, dense business app used in English and Arabic, on phones
   and computers.
2. One Nizmo page, such as Tasks, is drawn in each style, in both languages,
   and shown as screenshots.
3. The product owner picks one.
4. Claude writes `DESIGN.md` from that style, with Frontend Design keeping
   the direction clear.
   - It follows the reference's approach to spacing, text, colour and
     components, adapted for Arabic and right to left.
   - It keeps Nizmo's own name, logo and brand colour. Nothing of the other
     brand is copied.

**Picked on 2026-10-15: style A, "Polished"** (from Stripe's write-up).
The three choices were A (Stripe), B, "Structured" (IBM Carbon), and C,
"Warm" (Notion).

- **Look:** a soft blue-grey page, white panels with a light shadow, and
  pill-shaped buttons and status badges.
- **Fonts:** Inter for English and Noto Sans Arabic for Arabic. Both are
  free. Today the app loads no Arabic font, so Arabic text uses whatever
  each device has.
- **Colour:** the brand colour is a setting (§4.6).

### 7.3 Rules for the tools

- **`DESIGN.md` wins.** If a tool's advice disagrees with it, `DESIGN.md` is
  followed. If the tool turns out to be right, `DESIGN.md` is changed first,
  in its own commit.
- **No more than two design skills at once,** because their rules can
  contradict each other:
  - Impeccable and UI/UX Pro Max while building;
  - Frontend Design only while choosing the look;
  - Emil only for the motion work.
- **Each skill is read in full before it's added,** scripts included, and
  pinned to a fixed version.
- **Skills live in the project** (`.claude/skills/`), as UI/UX Pro Max does
  on `ui-refactor`, so every session has them.
  - They're added in the building-blocks PR.
  - Impeccable's written guidance is added in step 3a's PR, once question 8
    was answered (§6).
  - Emil was added in the motion PR, #224.
- **Playwright's MCP is optional.** It's for having Claude click through the
  app on the product owner's own computer, so nothing is added to the
  project.

### 7.4 Turned down

- **Taste Skill:** its expressive styles would fight a consistent business
  app.
- **Image To Code:** it writes one-off code, which works against shared
  building blocks.
- **Anti UI Slop (uizze):** its idea is already the plan, through
  `DESIGN.md` and the building blocks. It's also paid.
- **Agent Skills (Addy Osmani):** the project already follows a stricter
  way of working.
- **Figma connector:** not needed unless designs start being reviewed in
  Figma.

---

## Change log

- **2026-10-15:** File created. It covers:
  - what's there today and what makes it feel disorganised (§1);
  - proposed side bar groups for company users and the Super Admin, and one
    Requests page (§2);
  - naming principles and a glossary (§3);
  - fixes and shared building blocks for the look (§4);
  - timing (§5);
  - open questions (§6).
- **2026-10-15:** The order of work across both plans is decided (§5):
  1. settle the names and the side bar groups;
  2. one PR with the shared building blocks;
  3. `CLIENTS_PLAN.md`'s steps, with the side bar groups landing in step 0
     and every new screen built on the building blocks;
  4. the remaining old pages and the one Requests page.

  The 7 pages with missing Tailwind classes are split: 3 can be fixed any
  time, and 4 are rebuilt in step 0. The questions in §6 are updated.
- **2026-10-15:** The design tools are decided (§7).
  - **Choosing the look:** awesome-design-md and Frontend Design are used
    once. The product owner picks from screenshots of one page drawn in two
    or three styles, and Claude writes Nizmo's own `DESIGN.md` from the
    pick.
  - **Building:** Impeccable, with UI/UX Pro Max as the reference library.
  - **Checking every UI PR:** Vercel Web Design Guidelines and Playwright.
  - **Polish, later:** Emil Design Engineering.
  - **Rules:** `DESIGN.md` wins over any tool, no more than two design
    skills are used at once, and each skill is read in full and pinned.
    Skills are added to the project in the building-blocks PR, and Emil in
    the motion PR.
  - **Turned down:** five tools (§7.4).
  - **§5 updated:** the building-blocks PR starts by choosing the look and
    writing `DESIGN.md`, and adds the tools.
- **2026-10-15:** The seven open questions are answered (§6), so navigation,
  names and look are now **Decided** (§2–§4).
  - **Side bar (§2.1):**
    - Check in moves to the top, beside Dashboard;
    - a group is hidden when the person can't see anything in it;
    - Me holds My payslips, My attendance (for someone who sees only their
      own) and My cash advance;
    - the account menu keeps My profile, Security settings, History and
      Sign out.
  - **Requests (§2.3):** the one Requests page comes later. Until then, the
    request pages sit together under People.
  - **Names (§3):** the principles and glossary are agreed, with three
    Arabic changes:
    - Records is سجلات العملاء in the side bar;
    - Employee costs is تكاليف دفعها الموظف;
    - the statuses Due / Collected are غير محصّل / محصّل, and Total to
      collect becomes Total due.
  - **Icons (§4.4):** Phosphor Icons replace emoji. Companies pick from a
    short list of about 50.
  - **The 3 pages (§4.1, §5):** the dashboard home, Employees and Day Off
    Requests move onto the building blocks in a small PR straight after the
    building-blocks PR. The dashboard home is the first page for Impeccable.
    §5 has a new step 3; later steps are renumbered.
- **2026-10-15:** The look is chosen, and the brand colour is a setting.
  - **Style A, "Polished"** (from Stripe's write-up) was picked from
    screenshots of the Tasks page in three styles (§7.2). It uses Inter and
    Noto Sans Arabic.
  - **Brand colour (§4.6):**
    - the Super Admin sets the default in System Settings, starting as
      Nizmo's own indigo;
    - each company can choose its own in Company Settings → Branding, under
      the logo's access rule;
    - every shade is worked out from the one colour, and a colour too light
      for white text is darkened;
    - status, warning and error colours never change;
    - the colour is in the page before it's sent, and every change is
      audited.
  - **§5:** step 2 builds the colour as one value. Step 3 now has two small
    PRs, in either order: the 3 pages, and the brand colour setting.
- **2026-10-15:** `DESIGN.md` is written from style A, with Frontend Design's
  review (§7.2, step 4). It covers:
  - colours for light and dark, with checked contrast;
  - the brand colour tokens;
  - text, space, corners and depth;
  - the building blocks, icons, Arabic, motion, the quality floor, and how
    it maps to code.

  Its §11 lists what was changed from the Stripe write-up: sentence-case
  labels, no gradients, a darker helper grey, stronger field edges, a fixed
  blue for In Progress, and one corner size for each level.
- **2026-10-15:** Nizmo's indigo is used as `#6063ea` (4.70:1), not
  `#5d60e3` (§4.6). The code darkens a colour in finer steps than the
  mock-ups did, so less of the chosen colour is lost.
- **2026-10-15:** The building-blocks PR adds UI/UX Pro Max and Vercel Web
  Design Guidelines to `.claude/skills/`, pinned, with where each came from
  in `.claude/skills/SOURCES.md`. Vercel's rules are a pinned copy rather
  than fetched on every run. Impeccable is left out: it downloads and runs a
  program that can't be read or pinned (§7.3). Whether to add its written
  guidance alone is question 8 in §6.
- **2026-10-15:** The 3 pages are moved onto the building blocks (§4.1,
  §5 step 3), waiting to be merged.
  - **What they needed that the building blocks didn't have,** added to
    `DESIGN.md` first and then built:
    - page layout, sections, rows, tile links and notes;
    - the row menu, the selection bar and the dialog;
    - the text area and the radio choice.
  - **Until the app shell lands** (step 0), a page built from the building
    blocks hides the old top bar's title, so it's named once, and sits on
    `--page` rather than the old moving gradient.
  - **The dashboard home:**
    - its donut charts become a row per task status, each with its word
      and count and linking to those tasks;
    - its tiles link to the queues they count.
  - **Employees:**
    - Edit stays in each row, and the other actions are in a More actions
      menu;
    - the Super Admin's suspend toggle was a dot no keyboard could reach;
      it's now in that menu;
    - Reset points asks first.
  - **Day Off Requests:** the pie chart becomes two tiles, remaining and
    used credit. The request, approve and reject dialogs are the dialog
    building block.
  - **Fixed on the way, each with its own test:**
    - Employees' role filter was never sent, and its sort only reordered
      the page in view;
    - Day Off Requests' filters only filtered the page in view;
    - the dashboard's "Used credit" counted days taken from salary and
      past years;
    - in production, every database query built a new Prisma client and
      pool (`lib/prisma.ts`).
  - **Counts follow each language's plural forms** (`lib/plural.ts`), and
    the strings these pages use are in sentence case.
  - **Not done here:** the lists' filters and pages aren't kept in the
    URL yet, as they weren't before.
- **2026-10-15:** The dashboard home's donut charts come back, at the
  product owner's request: they preferred them to the rows of counts. They
  are a building block now (`DESIGN.md` §5.5): each part in its meaning's
  colour, the total in the middle, and a legend with every word and count
  that links to the tasks it counts. The employee's dashboard has its two
  again, tasks by status and day off credit.
- **2026-10-15:** Fixed from Codex's reviews of step 3a (#78) and of the
  building blocks (#77), each with its own test:
  - a two-day day-off request shows both its days;
  - a negative count keeps its sign ("-1 pts", not "1 pt");
  - the Day Off filters leave out a day that doesn't exist, such as
    31 February, instead of moving it or failing with a server error;
  - a notification's request is scrolled to on whichever page it turns up;
  - a Team Leader's task links on the dashboard open the Tasks page's new
    team view (`?view=team`): their team's tasks with their own among
    them, which is what the numbers count. It has no tab of its own yet;
    step 3b's Tasks page decides whether it gets one;
  - a list whose page empties, after a delete or a switch to another
    company, moves to the last page there is, and another company starts
    on page one without the last one's team, picks or employee;
  - a table wider than its panel scrolls inside it (`DESIGN.md` §5.4);
  - in dark mode, a primary button's hover and pressed shades keep its
    3:1 edge on the panel (`DESIGN.md` §2.1).
  - **No change:** a linked total tile was already a link over the whole
    tile; checked in the browser.
- **2026-10-15:** Question 8 answered: Impeccable comes in as written
  guidance only (§6, §7). Its 19 reference pages for web app screens are
  copied unchanged into `.claude/skills/impeccable/`, pinned to its
  `skill-v4.5.2` release. Its `SKILL.md` is rewritten for Nizmo: no launcher,
  `DESIGN.md` and this plan as the context, the Vercel audit, Playwright and
  the guard tests in place of its detector, and where `DESIGN.md` differs
  (the overdue bar, the total tiles). The 22 pages left out drive the
  launcher, write files Nizmo already has, or are for native apps.
- **2026-10-15:** The donut chart is redrawn: the product owner found it
  old-fashioned and left the choice between improving it and going back to
  rows to Claude. Improved, with Impeccable's guidance (craft floor, Operate
  mode, colour) and `DESIGN.md` changed first (§2.3, §5.5): a thin ring of
  rounded, separated parts; new mid-tone chart colours, since the deep
  status text colours looked heavy as shapes; a deeper shade for a part
  repeating an earlier part's meaning; each part's share in the legend;
  and pointing at a legend row picks out its part. No motion beyond that
  150ms fade, which reduced motion turns off.
- **2026-10-15:** From Codex's review of #74 and #75:
  - Profile requests sit with the other request pages under People until
    the one Requests page (§2.1);
  - the icons PR maps every stored icon choice, not only the defaults
    (§4.4).
  - Its two findings on #74 were already settled: Impeccable comes in as
    written guidance only, and the Vercel audit's rules are a pinned copy.
- **2026-10-15:** The Day Off page shows the day off credit as the
  dashboard's donut, at the product owner's request, in place of its two
  credit tiles. Both pages use one component, so they can't disagree.
- **2026-10-15:** The cash advance permission is renamed **Give and settle
  cash advances** (§3.1, §3.3), at the product owner's choice, so its name
  says it also records returns and corrections.
- **2026-10-16:** From Codex's review of #79: when someone's day off credit
  doesn't load, the Day Off page's donut says so, with Try again, and no
  total (`DESIGN.md` §5.5). It said "Loading…" for good, over 0 days.
- **2026-10-16:** From Codex's review of #78: when a Super Admin picks
  another company, the Employees and Day Off lists drop the last company's
  rows and show the spinner until the new rows come. They kept them up,
  with Edit, Delete, Approve and Reject, until then, or for good if the
  request failed. Within one company, a list still keeps its rows while the
  next page or filter loads (`lib/swr-scoped.ts`).
- **2026-10-16:** From Codex's review of #79: when an allowance is lowered
  below what's already used this year, the credit donut shows 0 days left
  and every day used as 100%. The stored credit is below 0 then, and the
  donut showed "−5 days" at −100% beside 200%.
- **2026-10-16:** At the product owner's request, Requests, Requests
  history and Payroll drop the last company's data when a Super Admin
  picks another, as Employees and Day Off Requests do. Payroll showed the
  last company's register while the next loaded, with Approve and Mark as
  paid naming the company just picked.
- **2026-10-16:** At the product owner's request, a list that didn't load
  says so, with Try again (`DESIGN.md` §5.5): Employees, Day Off Requests,
  Requests and Requests history. They said there was nothing, and offered
  to add something. Requests' total is left out until there's a count.
- **2026-10-16:** At the product owner's choice, Payroll shows no other
  register while the one picked loads, not even last month's, since Save
  draft, Approve and Mark as paid name the company, month and year picked.
  The pickers stay, over a spinner. Last month's register used to stay up
  until the next arrived, so the page didn't drop to a spinner at each
  step of the picker.
- **2026-10-16:** The brand colour setting is built (§4.6, §5 step 3):
  - the default in System Settings, beside the "Powered by" branding, and
    a company's own in Company Settings → Branding, under its logo, with
    "Use the default";
  - nine ready-made colours or a typed code, a preview in light and dark,
    and a warning for a colour close to the error red (`DESIGN.md` §2.1,
    §5.3);
  - the server puts the viewer's colour in the page: a company's for its
    people, the default for the sign-in page and the Super Admin. The phone
    app shows the site, so its pages in the new design take the company's
    colour after sign-in;
  - every change is in the audit log.

  Until the side bar and the old pages move onto the building blocks, they
  keep Nizmo's indigo. The 3 pages' PR (§5 step 3) was merged in #78.
- **2026-10-16:** Fixes from Codex's review of the brand colour PR (#80):
  - signing out from the account menu left the company's colour on the
    sign-in page. Next.js doesn't draw the root layout again when the app
    moves to another page, so the root layout now draws the default, which
    is the same for everyone, and the dashboard layout draws a company's own
    over it. Signing in or out draws the dashboard layout afresh, so the
    colour changes with it;
  - a saved colour shows at once for whoever saved it. Everyone else sees
    it the next time they open or reload a page, or sign in: moving to
    another page inside the app doesn't pick it up;
  - the settings' hints said the colour reaches the sign-in page, the side
    bar and the phone app. So far it reaches only the pages in the new
    design, and the hints now say so.
- **2026-10-16:** The brand colour costs a page no database reads of its
  own (§4.6). Counted on the scratch database, a company user's page read
  the system settings twice and its company row twice. It now reads each
  once:
  - the root layout and the dashboard layout share one read of the system
    settings;
  - a company's colour comes with the company row the dashboard layout
    already reads for its settings;
  - each colour's stylesheet is worked out once and kept. It took about
    0.15 ms a page.
- **2026-10-16:** The product owner answered two questions (§6):
  - the older pages, the side bar and the sign-in page follow the brand
    colour now, in a small PR after the setting's (§4.6, §5 step 3). It's
    built: their indigo and violet are worked out from the chosen colour,
    and Nizmo's indigo gives exactly the colours they have today
    (`DESIGN.md` §2.1). The settings' hints say the colour reaches them
    again;
  - لون الهوية is the Arabic for "brand colour" (§3.2).
- **2026-10-16:** The brand colour setting was merged in #80 (§5 step
  3). The older pages' PR (§4.6) is open, waiting to be merged.
- **2026-10-16:** From Codex's review of the older pages' PR (#81), their
  shades are held to today's readability in five more places
  (`DESIGN.md` §2.1):
  - white text on a button that brightens on hover;
  - in dark mode, a fill against the dark page, so a dark colour's
    sign-in button doesn't vanish;
  - text on the light brand tints behind it;
  - the highlight colour, which is also a link's colour;
  - the company name's gradient in the side bar.
- **2026-10-16:** At the product owner's choice, the company name at the
  top of the side bar is light in both themes, in the older pages' PR
  (#81). In dark mode it was barely readable even with Nizmo's indigo, as
  it started from the dark panel colour (`DESIGN.md` §2.1).
- **2026-10-16:** From Codex's review of #81, the check-in place's radius
  ring on the map has a thin white outline, as its pin does, so it shows on
  satellite imagery whatever the brand colour (`DESIGN.md` §2.1).
- **2026-10-16:** The older pages, the side bar and the sign-in page follow
  the brand colour, merged in #81 (§4.6, §5 step 3). Next is
  `CLIENTS_PLAN.md`'s step 0.
- **2026-10-16:** `CLIENTS_PLAN.md` step 0's first PR, 0a, is open: each
  client's page and the Records page, on the building blocks (§5 step 4).
  `DESIGN.md` gained a back link, details, files, a record's expiry and
  opening an item from a list (§5.5), and a rule that typed text keeps its
  own direction (§7). Proposed: the side bar's groups come with 0b.
- **2026-10-16:** From Codex's review of #82: a record's form keeps files
  it uploaded when a save fails, so trying again doesn't upload them twice,
  and removes them again if it closes without saving them; a client's page
  opens a reminder's record only if it's that client's (`CLIENTS_PLAN.md`
  change log).
- **2026-10-16:** From Codex's second review of #82: the date picker shows
  a picked day as that day in every time zone (it showed the day before
  west of UTC, on the Day Off page too), and a file dropped on a file
  picker that's full, or otherwise turned off, no longer opens in place of
  the page (`CLIENTS_PLAN.md` change log).
- **2026-10-16:** From Codex's third review of #82: the Records page has
  Add record, which asks which client it's for and opens its page with the
  form (Proposed, `CLIENTS_PLAN.md` §0.2); the date picker can be turned
  off, and is while a record saves; a record by a user since deleted says
  "Deleted user" rather than Super Admin.
- **2026-10-16:** From Codex's fourth review of #82: a record's form
  closed while it saves no longer removes the files that save is storing
  (`CLIENTS_PLAN.md` change log).
- **2026-10-16:** From Codex's fifth review of #82: a client's page says
  when its records didn't load, with Try again; saving a record from a
  form opened before someone else changed its files says so, and asks to
  open it again (`CLIENTS_PLAN.md` change log).
- **2026-10-17:** From Codex's seventh review of #82: Add record's picker
  has a search by name, as it lists only the first 50 clients; a client's
  page says when its details didn't load, with Try again
  (`CLIENTS_PLAN.md` change log).
- **2026-10-17:** Decided: the date range picker (Day Off, the audit log's
  and the employees' filters) gets the date picker's fix in a PR of its own
  after #82: west of UTC it showed the day before the one picked.
- **2026-10-17:** Decided: the Records page's Add record is one dialog on
  that page: which vendor (with a search once there are more than 50), its
  section, then the record (`CLIENTS_PLAN.md` §0.2). It no longer opens the
  vendor's page. A vendor's own page keeps its Add record, for that vendor.
- **2026-10-22:** From Codex's ninth review of #82: Add record on the
  Records page lists only the chosen company's clients, so a Super Admin
  who picks another company while it's open waits for that company's; and
  editing a record there says when its client's sections didn't load, with
  Try again, rather than offering only the one it's in
  (`CLIENTS_PLAN.md` change log).
- **2026-10-22:** From Codex's tenth review of #82: a failed search for a
  client in Add record says so, with Try again, rather than leaving the last
  search's clients up as if they matched (`CLIENTS_PLAN.md` change log).
- **2026-10-22:** From Codex's eleventh review of #82: on the Records page,
  a record open in a dialog closes when a Super Admin picks another
  company; an edit refused as out of date reloads the list; and a record's
  details in its dialog are one to a row on a phone, as `DESIGN.md` says
  (`CLIENTS_PLAN.md` change log).
- **2026-10-22:** From Codex's twelfth review of #82: a Records list open
  past the company's midnight reloads then, so its expiry badges and the
  expiry filter are the new day's (`CLIENTS_PLAN.md` change log).
- **2026-10-22:** From Codex's thirteenth review of #82: a Super Admin
  looking at every company's records sees each record's company on its
  phone card and in the record's details, so two companies' clients of the
  same name can't be mixed up (`CLIENTS_PLAN.md` change log).
- **2026-10-22:** At the product owner's request, a list or page that
  didn't load tries again by itself three times, half a second, one and two
  seconds apart, before it says so with Try again (`DESIGN.md` §5.5). A
  refusal or "not found" is said at once. It's in the shared fetcher
  (`lib/swr-fetcher.ts`), so every screen that loads through it does this.
- **2026-10-22:** So does anything else a screen loads, at the product
  owner's request (`DESIGN.md` §5.5): the pickers' options, a person's
  profile, a payslip, the system settings, a contract's end preview, the
  jobs card, the face check's models. A save is never sent again. A test
  reads the code for any load that would skip it.
- **2026-10-23:** And the record a reminder's link opens on the Records
  page, which came with #82 after the rest.
- **2026-10-23:** From Codex's review of #84: a load whose answer stops part
  way through is tried again too, not only one that gets no answer. The face
  check's model downloads, tens of megabytes each, start a part over and
  count its progress once.
- **2026-10-22:** Decided by the product owner: the top bar keeps its
  glass when the app shell moves onto the building blocks (`DESIGN.md`
  §5.1). Today's bar already does this (`components/DashboardShell.tsx`);
  the new shell keeps it, with its transition naming what it changes
  rather than `all`, and reduce motion respected.
- **2026-10-23:** From Codex's review of #85: where the browser can't blur,
  the glass top bar is solid instead, so its text keeps its contrast, and
  the blur eases in with the rest (`DESIGN.md` §5.1).
- **2026-10-23:** From Codex's third review of #85: text on the glass top
  bar is never the helper grey, which a dark map under it could make
  unreadable, and the bar no longer moves the page 32px as it floats, as
  today's does (`DESIGN.md` §5.1).
- **2026-10-22:** Fixed, in its own PR: the date range picker shows the
  days picked in any time zone. West of UTC it showed each day as the one
  before (Oct 1–20 read Sep 30–Oct 19 in Los Angeles); it now reads them
  as calendar days, as the date picker does.
- **2026-10-23:** Decided by the product owner: editing a person shows
  their company greyed out and can't change it; a person stays in the
  company they were added to (`CLIENTS_PLAN.md` change log). Adding a
  person still asks a Super Admin which company.
- **2026-10-22:** Fixed, in its own PR: the Tasks, Obligations and Costs
  date filters count days where the company is (a Super Admin's view of
  every company, the platform's default zone). They counted them in UTC, so
  in Cairo "to 15 January" took in the first two hours of the 16th. Mark
  all as paid uses the same days, as it shares the Costs page's search.
  Codex's review found two more: a day whose midnight the clocks skip (as
  Havana's on 8 March) started an hour early, and an employee's own
  obligations were counted in the platform's zone, not their company's.
- **2026-10-22:** `CLIENTS_PLAN.md`'s 0b is built: Vendors are Clients in
  the code and at their pages' addresses, with the old addresses opening
  the new ones. Nothing looks different. Proposed: the side bar groups, and
  the Clients list page on the building blocks, in a small PR after it
  (§5).
- **2026-10-22:** Decided by the product owner: the side bar groups, and
  the Clients list page on the building blocks, come in a small PR straight
  after 0b (§5).
- **2026-10-23:** `CLIENTS_PLAN.md`'s 0a was merged in #82, and 0b opens
  for review in #92. Nothing looks different with it.
- **2026-10-22:** The side bar groups and the Clients list page are built,
  to open for review after 0b (§2, §5):
  - the side bar is grouped as in §2.1 and §2.2, each item for those who
    may use it, and a group with nothing in it left out
    (`lib/side-bar.ts`). Group names are in sentence case. Attendance is
    under People for someone who sees others' punches, and is My
    attendance under Me for someone who sees only their own. Profile
    requests joins the other request pages under People. The Company
    Settings preview of the side bar shows the same groups;
  - the Clients list is on the building blocks: search, a table on
    computers and cards on phones, a page of 20 at a time, adding and
    editing in a dialog, and the row menu. Someone who may not see clients
    is told so, rather than that the list didn't load. Its buttons say
    "Add client", or use the company's own name for its clients when it
    has one;
  - Proposed: the Super Admin's group names in Arabic (§2.2).
- **2026-10-22:** Decided by the product owner: the Super Admin's group
  names in Arabic are المشتركون, القوالب, الصلاحيات and التشغيل (§2.2).
- **2026-10-23:** `CLIENTS_PLAN.md`'s 0b was merged in #92. The side bar
  groups and the Clients list page open for review in #93.
- **2026-10-23:** The Clients list says it's loading, not that there are
  no clients, until the session says who's looking (seen in this PR's
  screenshots).
- **2026-10-23:** The side bar groups and the Clients list page were
  merged in #93.
- **2026-10-22:** The Locations page and each client's Locations section
  are built on the building blocks (`CLIENTS_PLAN.md` step 1, PR 1a):
  - search, a filter by client or shared, and In use or Archived. A table
    on computers and cards on phones, a page of 20 at a time, and the row
    menu: Edit, Make HQ, Archive or Restore;
  - each client's HQ is marked with a badge and listed first. A location
    with no pin yet says "Needs a pin" as a problem badge;
  - adding and editing in a dialog, with the place fields of `DESIGN.md`
    §5.3: its name, a place search that drops the pin, the pin, and the
    check radius. The client form uses the same fields for its HQ;
  - two building block changes: a badge beside an item's name, and a list
    card's actions keep to its end when nothing is beside them.
- **2026-10-23:** `CLIENTS_PLAN.md`'s step 0 is done (#95), and step 1's
  first PR, 1a, opens for review in #96.
- **2026-10-24:** From Codex's review of #96: the client form shows its HQ
  as it is, with no place search or map, to someone who may not manage
  locations, and says who can. The Locations page shows a client's name
  without a link to someone who can't open the client's page.
- **2026-10-29:** A building block change, seen in the screenshots of that
  fix: a field that can't be changed is on `--page`, with a `--rule` edge
  and `--ink-2` text, and its hint says why (`DESIGN.md` §5.3). It looked
  like one that could be typed in.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 1a was merged in #96, and 1b opens
  for review in #97. With it, the Admins and Team Leaders of the companies
  already there are offered Locations in the side bar, as a new company's
  are.
- **2026-10-22:** The task form's client and location pickers are on the
  building blocks (`CLIENTS_PLAN.md` step 2, PR 2a; `DESIGN.md` §5.3, "a
  pick from a list that can grow"), on creating a task and in its edit
  window. The rest of those two screens is as it was, until their own
  turn. Two building block changes: a select's options can come in
  groups, with an option that can't be picked greyed; and fields that go
  together are spaced as in a dialog wherever they are.
- **2026-10-29:** `CLIENTS_PLAN.md`'s step 1 is done (#97), and step 2's
  first PR, 2a, opens for review in #98, with the task form's client and
  location pickers.
- **2026-10-29:** From Codex's review of #98: "+ New location" from a
  task's edit window opens above it. A dialog that opens from an older
  page's modal sits above that modal (`DESIGN.md` §5.5). Saving the
  location there no longer saves the task too.
- **2026-10-22:** The bulk upload's review screen picks each row's client
  and location with the building blocks' selects, grouped as on the task
  form (`CLIENTS_PLAN.md` step 2, PR 2b). The rest of the screen is as it
  was, until its own turn.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 2a was merged in #98, and 2b opens
  for review in #99, with the bulk upload's review screen picking each
  row's client and location.
- **2026-10-29:** In 2b (#99), the bulk upload's review screen gives a
  row's location problem as its location field's error, tied to the
  select, and spaces the row's client and location with `--space-2`. The
  template's Locations sheet is left empty for someone who may not see the
  locations.
- **2026-10-29:** In 2b (#99), the review screen's location selects offer
  every location in use, as the template's Locations sheet does.
- **2026-10-29:** In 2b (#99), a location named as the Locations sheet's
  heading is found on upload like any other.
- **2026-10-22:** The Tasks and Costs pages' filter panel takes a client
  and a location, as selects among the panel's own, until those pages get
  their own turn on the building blocks (`CLIENTS_PLAN.md` step 3). The
  Costs page's total chip is "Total due" now, and real. "View tasks" is in
  the Clients list's row menu, which everyone who sees the list now has,
  and on a client's page.
- **2026-10-29:** A task's page shows its dates as the task list does
  (`SafeDate`): the deadline as "3 Nov 2026, 9:03 am", and the comments',
  attachments' and costs' the same way.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 2b was merged in #99, so step 2 is
  done, and step 3 opens for review in #100, with the Tasks and Costs
  pages' client and location filters.
- **2026-10-29:** In step 3 (#100), the Tasks and Costs pages' location
  filter lists the archived locations after the ones in use, each marked
  "· archived", as 4b marks an archived client.
- **2026-10-29:** In step 3 (#100), the Tasks and Costs pages' filter
  panel counts a client or location filter its viewer has no select for,
  set by a shared link, and Reset clears it.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 4a: the Costs page's Mark all as
  paid asks first, in the page's own confirm window (`ConfirmModal`, not
  yet on the building blocks), "Pay 7 costs, 3,450.00 EGP?", and says one
  cost as "Pay 1 cost". A task whose costs are paid has no Delete button.
- **2026-10-29:** In 4a, the Arabic for Mark all as paid is "تحديد الكل
  كمدفوع", on the button and its window.
- **2026-10-29:** `CLIENTS_PLAN.md`'s step 3 was merged in #100, and 4a
  opens for review in #101, with the Costs page's Mark all as paid asking
  first.
- **2026-10-22:** The Clients list gets In use and Archived, and its row
  menu Archive or Restore (`CLIENTS_PLAN.md` step 4, PR 4b). An archived
  client's page has an "Archived" badge beside its name and Restore in
  its header. Costs' Mark all as paid asks first, in a confirmation
  window (PR 4a).
- **2026-10-29:** In 4b, Archive on the Clients list archives what it
  says, and its toast says "Archived"; a Delete the server turns into an
  archive still says why.
- **2026-10-29:** In 4b, an archived client's page has no Add record, Add
  section or Add location, in its header, its sections or their empty
  states: only Restore, for whoever manages clients.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 4a was merged in #101, and 4b opens
  for review in #102, with the Clients list's In use and Archived.
- **2026-10-29:** In 4b (#102), an archived client's page has its
  "Archived" badge and no Add record or Add section for someone who may
  add records but not see clients, too.
- **2026-10-29:** In 4b (#102), Restore on a client's page takes its
  "Archived" badge off and brings back Add record, Add section and Add
  location at once.
- **2026-10-22:** A task's costs show what they were for, as typed
  (`CLIENTS_PLAN.md` step 4, PR 4c). The description field stops at 200
  characters, and a long one, a link among them, wraps inside its card.
  Removing a cost the server refuses, such as one already paid, says why.
- **2026-10-29:** In 4c, a refused cost removal closes its window and
  refreshes the task, as a refused task delete does (4a).
- **2026-10-29:** `CLIENTS_PLAN.md`'s 4b was merged in #102, and 4c opens
  for review in #103, with each cost on a task's page showing what it was
  for.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 4c was merged in #103, and 4d opens
  for review in #104. A task's page looks as it did, its costs listed from
  their rows.
- **2026-10-22:** A name typed or picked from a saved list (`DESIGN.md`
  §5.3) is the title field on a new task and in Edit task details, and the
  cost name field on a task's page (`CLIENTS_PLAN.md` step 5, PR 5a). On a
  phone, Add costs' name takes its own line, the amount below it. A new
  page, Saved lists, has a tab for each list. Proposed: it sits in the side
  bar under Company Settings, for whoever manages lists.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 4d was merged in #104, so step 4 is
  done, and 5a opens for review in #105: a task's title and a cost's name
  are typed or picked from a saved list, and the Saved lists page manages
  the lists.
- **2026-10-29:** In 5a (#105), Escape with title suggestions open in Edit
  task details closes the suggestions only; the next Escape closes the
  window, as `DESIGN.md` §5.3 has it.
- **2026-10-29:** In 5a (#105), typing on while a picker's suggestions are
  open keeps only those that still match, and Enter keeps what's typed
  rather than picking the one highlighted for the text before.
- **2026-10-29:** In 5a (#105), "+ Add" answering after the field changed
  leaves the field as it is now; the name is on the list all the same.
- **2026-10-29:** In 5a (#105), "+ Add" in Edit task details fills the title
  without undoing the other fields edited while the name was added.
- **2026-10-29:** In 5a (#105), switching company on New task keeps the
  title typed or picked, as text, and its suggestions come from the
  company switched to.
- **2026-10-29:** With `CLIENTS_PLAN.md`'s 5b, everyone in the companies
  already there sees "+ Add" in a title or cost name's suggestions, and
  their Admins see Saved lists in the side bar.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 5a was merged in #105, with the name
  picker's five review fixes, and 5b opens for review in #106.
- **2026-10-29:** The filter bar's panel offers a saved title on the Tasks
  page and a cost name on the Costs page (`CLIENTS_PLAN.md` step 5, PR 5c),
  the archived names last, marked. With a cost name picked, each cost card
  names it over its amount, and Mark all as paid gives way to a line saying
  to clear the cost name to pay.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 5b was merged in #106, and 5c opens
  for review in #107.
- **2026-10-29:** In 5c (#107), the Costs page with a cost name picked
  pages through only the tasks with a cost of it still to pay: none of
  its pages is short of cards, or empty, for tasks with none.
- **2026-10-29:** In 5c (#107), a saved name with `%` or `_` in it filters
  by what's typed exactly as it, ignoring capitals, and no other.
- **2026-10-29:** With `CLIENTS_PLAN.md`'s 6a, Add costs has an "Attach
  receipt" button under the cost's name and amount, for the next cost
  added; each cost waiting to be saved shows its receipt's chip, and each
  saved cost on the task's page a Receipt chip that opens it in a new tab.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 5c was merged in #107, so step 5 is
  done, and 6a opens for review in #108.
- **2026-10-29:** With `CLIENTS_PLAN.md`'s 6b, the Costs page has two
  tabs, Employee costs and Charged to clients, for whoever both pays costs
  and sees charges; on Employee costs, not yet on the building blocks, the
  tabs sit on a panel. Charged to clients is built on them: a filter bar,
  three totals, a table that's a card per charge on a phone, and a service
  fee dialog where typing the fee or the total works out the other.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 6a was merged in #108, and 6b opens
  for review in #109.
- **2026-10-29:** With `CLIENTS_PLAN.md`'s 6c, the Admins and Team
  Leaders of the companies already there see the Costs page's Charged to
  clients tab: an Admin every charge, with each one's menu, and a Team
  Leader their team's tasks' charges, with none.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 6b was merged in #109, and 6c opens
  for review in #110.
- **2026-10-29:** With `CLIENTS_PLAN.md`'s 6d, a client's page has a
  Charges section, between Locations and Records: the charges list for
  that client, Due and Collected tiles, and Mark collected on the end of
  its heading. A collected charge shows the day it was collected under its
  status, and its menu has Mark uncollected. An empty Due list says
  nothing is due, with Show every status.
- **2026-10-29:** The code prompt for a high-risk action opens above any
  dialog (`DESIGN.md` §5.5), so it can be answered from over the
  confirmation that sent the action, as Mark all as paid's.
- **2026-10-29:** `CLIENTS_PLAN.md`'s 6c was merged in #110, and 6d opens
  for review in #111.
- **2026-10-29:** In 6d (#111), someone who sees charges and nothing else
  of clients opens a client's page from the Charged to clients tab: its
  name and its Charges section, with a way back to the tab.
- **2026-10-30:** With `CLIENTS_PLAN.md`'s 7a, the Costs page has a third
  tab, Cash advances, built on the building blocks: a filter bar, three
  totals, a table that's a card per person on a phone, and a dialog to
  give an advance, record a return or correct a balance. Each person's
  advance has its own page, and My cash advance joins Me in the side bar
  (§2.1), where the company uses cash advances. Company Settings' General
  tab has a Cash advances card, on the building blocks, for the switches.
- **2026-10-30:** `CLIENTS_PLAN.md`'s 6d was merged in #111, and 7a opens
  for review in #112.
- **2026-10-30:** With `CLIENTS_PLAN.md`'s 7b, a cost paid partly or
  wholly from a cash advance shows From advance and To pay back on its own
  line under it, on the task's page, and a task's total box says To pay
  back, with how much came from cash advances. Employee costs' cards say
  To pay back, with From advance under the amount. Add cost has a line
  with the person's advance, a cash advance's history shows Spent on a
  cost and Put back with the task, and the Give advance dialog asks
  whether to pay what the person is owed in the same hand-over.
- **2026-10-30:** `CLIENTS_PLAN.md`'s 7a was merged in #112, and 7b opens
  for review in #113.
- **2026-10-30:** With `CLIENTS_PLAN.md`'s 7c, the Admins and Team
  Leaders of the companies already there see the Costs page's Cash
  advances tab once their company is allowed cash advances: an Admin
  everyone, with Give advance, Record return and Correct balance, and a
  Team Leader their team and themselves, with History only.
- **2026-10-30:** `CLIENTS_PLAN.md`'s 7b was merged in #113, and 7c opens
  for review in #114.
- **2026-10-30:** With `CLIENTS_PLAN.md`'s 7d, End Contract's settlement
  says when the person still holds a cash advance, which becomes a debt it
  recovers as the others. A cash advance's history shows Became a debt,
  and a person's debts list shows a cash advance's as one.
- **2026-10-30:** `CLIENTS_PLAN.md`'s 7c was merged in #114, and 7d opens
  for review in #115.
- **2026-10-30:** A task's costs show their amounts in the page's
  language (`DESIGN.md` §3.3): Arabic-Indic digits in Arabic, and grouped
  thousands in both, as every other amount. They were written out by hand,
  in Latin digits either way.
- **2026-10-30:** On phones, a total tile's value stays on one line
  (`DESIGN.md` §5.5). Two tiles to a row put an amount's currency on a line
  of its own, as on the Costs page's Charged to clients and Cash advances
  tabs; a tile whose value needs more than half the row takes the row now.
- **2026-10-30:** On phones, the tabs share the row, a long label on two
  lines, so every tab shows (`DESIGN.md` §5.5). The Costs page's three ran
  past the edge in English, Cash advances cut off mid-word even when it
  was the one picked. Saved lists' two now share the row too.
- **2026-10-30:** `CLIENTS_PLAN.md`'s 7d was merged in #115, so its steps
  0–7 are done. Four small fixes open for review in #116, before the rest
  of this plan (§5 step 5).
- **2026-10-30:** On a task's page, a cost's amount stays on one line, its
  currency with it, as a total tile's does (`DESIGN.md` §5.5). On a phone,
  "350.00 EGP" had "EGP" on a line of its own; the description beside it
  wraps instead now.
- **2026-10-30:** The first of the remaining old pages moves onto the
  building blocks (§5 step 5): the Costs page's Employee costs tab, beside
  the two already on them.
  - The Costs page has its page header on every tab, its title and
    subtitle, with Mark all as paid as Employee costs' one primary button.
    The old top bar's title gives way to it, as on the other pages with
    one.
  - A filter bar: the search, the employee, the client, the location, the
    cost name, the dates, and the order within the page.
  - The tasks to pay and the total due as tiles. With a cost name picked,
    the total's tile says payments are made per task, where Mark all as
    paid would be.
  - The list as a table on computers and cards on phones: each person's
    share of a task still to pay, what their cash advance paid of it, and
    the task's status. Mark all as paid still asks first, as in 4a.
- **2026-10-30:** The four small fixes were merged in #116, and the Costs
  page's Employee costs tab opens for review in #117, the first of the
  remaining old pages (§5 step 5).
- **2026-10-30:** In #117, a filter picked on Employee costs while the
  search waits to be sent stays picked. The search's timer sent the address
  as the render that started it saw it, without the filter, and so undid it
  (found by Codex).
- **2026-10-30:** In #117, Employee costs on a page past its last, as when
  its last task is paid elsewhere and it's refreshed, goes to the last page
  there is, with its filters. The list showed only its empty state, saying
  there were no costs, with no pager to go back by (found by Codex).
- **2026-10-30:** In #117, Employee costs' filters show what's picked at
  once, and the address follows. They were read from the address, which
  changes only once its navigation lands, so the date range picker read the
  start just picked back from there for the end, and lost it (found by
  Codex). The selects showed what was picked only once the list came back,
  too.
- **2026-10-30:** In #117, the Costs page's subtitle no longer mentions
  salaries: "Monitor company expenses and financial logs". None of its
  three tabs has them, and it shows on all three now.
- **2026-10-30:** The Tasks list moves onto the building blocks (§5 step
  5), the second of the remaining old pages.
  - Its page header, with Create new task as its one primary button, and
    a Team Leader's two tabs, their own tasks and their team's.
  - A filter bar: the search, the employee, the status, the client, the
    location, the saved title, the dates, and the order within the page.
    An employee, who sees only their own tasks, has the search, as before.
  - The tasks as a table on computers and cards on phones: where each is
    done, who gave it or who it's for, its deadline, overdue in words, its
    points, its status and who decided it, and Start, Continue or View.
  - Its address is handled as the Employee costs tab's is, by the same
    hooks (`components/filters`), with the fixes Codex found on #117.
- **2026-10-30:** The Employee costs tab was merged in #117, and the Tasks
  list opens for review in #118 (§5 step 5).
- **2026-10-30:** In #118, a deadline's digits line up with the rows
  above and below it, in the Tasks list and on the dashboard (Vercel's
  web interface audit).
- **2026-10-30:** In #118, a task's card on a phone has Start task,
  Continue task or View task too, at the end of its last line. Phones show
  the cards, not the table, so whoever a task is for lost the button that
  says what's next there (found by Codex).
- **2026-10-30:** The Obligations list moves onto the building blocks (§5
  step 5), as the Tasks list did.
  - Its page header, with Add obligation as its one primary button for
    whoever manages obligations.
  - A filter bar: the search, the employee, the status, the dates, and the
    order within the page. Someone who sees only their own has the search,
    as before.
  - The obligations as a table on computers and cards on phones: how often
    each recurs, who it's for, its deadline, overdue in words, its points,
    its status and who decided it, and Start, Continue or View, on the
    phone's cards too.
  - A page past the last goes to the last there is.
- **2026-10-30:** The Tasks list was merged in #118, and the Obligations
  list opens for review in #119 (§5 step 5).
- **2026-10-30:** In #119, an obligation that doesn't recur says "One
  time", in sentence case, on the list, its page and its form.
- **2026-10-30:** Create task moves onto the building blocks (§5 step 5).
  - Its page header, with the way back to the Tasks list, and the Excel
    tools beside it as secondary buttons: the template, the usernames and
    the upload.
  - The form in one panel: each field with its visible label, its hint
    and its error below it. The title and description say how much of
    them is used; the deadline is a field like the others, in the page's
    language; the assignees are checkboxes below a search, with their
    roles. Submitting with something wrong puts the focus on the first
    field that is, in the form's order.
  - Create task is the page's one primary button.
- **2026-10-30:** The Obligations list was merged in #119, and Create task
  opens for review in #120 (§5 step 5).
- **2026-10-30:** In #120, Create task's deadline shows its time as the
  rest of the app does, "12:00 pm" rather than "12:00", and in Arabic the
  title's and description's limits are written in Arabic digits, as the
  obligation form's title limit is too.
- **2026-10-30:** In #120, reloading or closing Create task with something
  typed asks first, rather than losing it; not once it's being sent
  (Vercel's web interface audit).
- **2026-10-30:** Add obligation moves onto the building blocks (§5 step
  5), as Create task did, with the pieces they now share
  (`components/forms/AssigneeChecklist.tsx`, `lib/form-errors.ts`).
  - Its page header, with the way back to the Obligations list.
  - The form in one panel: each field with its visible label, its hint
    and its error below it. How often it recurs is a choice of radio
    buttons (DESIGN.md §5.3), one time to begin with.
  - Who it's for and its deadline are checked before it's sent, as the
    server needs them, so each says so under its field rather than the
    server's refusal above the form. The focus goes to the first field
    that's wrong.
  - Create obligation is the page's one primary button, and leaving with
    something typed asks first.
- **2026-10-30:** Create task was merged in #120, and Add obligation opens
  for review in #121 (§5 step 5).
- **2026-10-30:** In #121, both forms say when the people who can be
  assigned couldn't be loaded, once they've been tried again. Add
  obligation read a server error as an empty list, so it said no one
  matched the search; Create task (#120) never read its error, so it said
  it was loading for good. Found by trying them with the list refused.
- **2026-10-30:** In #121, Vercel's web interface audit of both forms:
  - the people who couldn't be loaded are said as a list that didn't load
    is (DESIGN.md §5.5): a warning, the line, and Try again, busy while it
    tries;
  - the fields have names, autofill is kept out of them, and a title or
    description runs in the direction of its own language.
- **2026-10-30:** Add obligation was merged in #121, and an obligation's
  page opens for review in #122 (§5 step 5).
- **2026-10-30:** An obligation's page moves onto the building blocks (§5
  step 5).
  - Its page header: its title with its status, who decided it once it's
    decided, and the way back to the list. A manager decides one handed
    in from there: Approve, the primary button, and Reject.
  - Its details in a card: its description, who assigned it, its deadline
    (marked overdue while it's still to be done), how often it comes
    round, its points and who it's for. Return to in progress (a Super
    Admin's) and Delete obligation are in its More actions.
  - Its files as chips that open them. Taking one off asks first.
  - Its assignee's submission: Attach files, the files picked, Submit
    obligation and Save draft. Past its deadline it says so, and adding
    files and saving a draft are switched off, rather than a pop-up caught
    from any click on the page that matched the buttons' words.
  - Someone it was for was deleted: a card says so and offers Reassign,
    with the shared people checklist, Mark as completed, which did nothing
    before, and Delete.
  - An address that isn't an obligation says so on a page with the way
    back, not a bare line.
  - Its words are in sentence case, and speak of an obligation, not a
    task.
- **2026-10-30:** In #122, a row menu that's open closes when the window
  is resized, or a phone turned, as it does on a scroll. It threw instead:
  it asked whether the window was inside the menu, and the window isn't
  in the page. Found on an obligation's page, and the same in every list's
  menu.
- **2026-10-30:** In #122, who decided a task or an obligation is said by
  their name, "By Hana Saad", on the Tasks list, the Obligations list and an
  obligation's page. It's saved with their role's code before it, and the
  three showed "By ADMIN Hana Saad".
- **2026-10-30:** In #122, Vercel's web interface audit of an obligation's
  page: its messages end their sentences, and "Saving…" says it's busy
  with an ellipsis, in both languages.
- **2026-10-30:** In #122, an obligation's page left open across its
  deadline locks then: it keeps the server's time for its first paint and
  moves it on just after the deadline. It held the server's time for good,
  so adding files and saving a draft stayed open until a reload (found by
  Codex on PR 122). In the browser, a deadline 30 seconds off locked the
  page after it without a reload.
- **2026-10-30:** A task's page moves onto the building blocks (§5 step 5),
  in two parts. The first is the page and its dialogs; its costs, location
  history, submission form and edit dialog keep their own blocks until the
  second.
  - Its page header: its title with its status, and once it's done, whether
    its costs are paid; who decided it once it's decided; the way back to
    the list. A manager decides one handed in from there, Approve the
    primary button and Reject, and edits one being worked on.
  - Its notices in cards: someone it was for was deleted, with Transfer
    task; and it was changed since it was given, with I understand and,
    for whoever it's for, how the title or description changed.
  - Its details in a card: its description, where it's done (its map pin a
    link that says it opens a new tab), its client, who assigned it, its
    deadline (marked overdue while it's still to be done), its points and
    who it's for. Transfer task, Mark as paid or pending, Return to in
    progress (a Super Admin's) and Delete task are in its More actions.
  - Its notes newest first, and its files as chips.
  - Its dialogs on the building blocks: Delete, Approve or Reject (with
    its points when it was transferred), Submit without adding anything,
    Delete an item or a location, Return to in progress, and Transfer task
    with the shared people checklist, asked for when it opens.
  - Past its deadline, for whoever does it, each block is told it's locked:
    the submission form says so, and adding files, costs, a location or a
    draft, and taking files, notes, costs or locations off, are switched
    off. A pop-up caught any click on the page by the words on what was
    clicked. The deadline moves on while the page is open, as on an
    obligation's page (lib/useDeadlineClock.ts).
  - An address that isn't a task says so on a page with the way back.
  - Its words are in sentence case, and its messages end their sentences.
- **2026-10-30:** An obligation's page was merged in #122, and a task's page
  opens for review in #123 (§5 step 5).
- **2026-10-30:** In #123, I understand on a task that was changed records
  that its assignee has seen it. It posted to a route that isn't there:
  the 404 was let pass, the notice hid itself, and it was back at the next
  visit. Found by trying it in the browser.
- **2026-10-30:** In #123, Vercel's web interface audit of a task's page:
  how its title or description changed closes with a button as well as
  Escape; an edit in its notes is said in words rather than as a name and
  a date with nothing under them; and its notes are headed Notes.
- **2026-10-30:** In #123, the database tests that wait for one transaction
  to be held up by another look only at their own database. They counted
  the whole server's waiting locks, and the other database tests, running
  beside them, ended the wait early: "ends nothing when the advance
  changed" failed in a full run and passed on its own.
- **2026-10-30:** In #123, a deadline changed while its page is open locks
  the page at the new deadline. The page waited from the time it was drawn
  at, not the time it is now, so a deadline moved later locked it as late
  again as the page had been open, and one moved earlier, to a time already
  passed, wasn't shown as passed until the old wait was up (found by Codex
  on PR 123). A refresh's newer time from the server is taken too.
- **2026-10-30:** A task's page, part 2 (§5 step 5): its costs, location
  history, submission form and edit dialog move onto the building blocks.
  - Its costs in a card: each a row with its description, who added it and
    when, what came from a cash advance, its receipt as a chip and its
    amount; its totals as tiles, each saying whether it's paid, someone on
    a shared task seeing their own beside the task's; and each person's
    share, with Mark as paid or unpaid, once it's reviewed.
  - Its location history in a card: each check-in a link to the map that
    says it opens a new tab, with who and when, and how it was checked as a
    status in words. A reviewer marks it right or wrong, and the lateness
    penalty is a dialog of its own.
  - What whoever it's for hands in, in a card: its files picked or dropped
    and shown as chips, its costs with their receipts, a note with its
    count, and Check in, Submit task the one primary button. It isn't a
    form, so Enter in a cost's amount hands nothing in.
  - Its edit window a dialog of the building blocks, each field labelled,
    its counts and errors under it, and who it's for pointing to Transfer
    task.
  - Its words are in sentence case, and say they're busy with an ellipsis.
- **2026-10-30:** In #124, a task's lateness penalty goes through the task's
  own penalty, for the person picked. It went to the pay adjustment of a
  person, which asks for another permission, so whoever may penalise a
  task but not adjust pay was refused; it fell on the first person the
  task is for, whoever was late; and it wasn't tied to the task. One person
  is picked already when the task is for only one. Found while moving it.
- **2026-10-30:** A task's page, part 1, was merged in #123, and its part 2
  opens for review in #124 (§5 step 5).
- **2026-10-30:** In #124, Vercel's web interface audit of a task's page,
  part 2: Mark as paid on one person's share shows it's being saved, and
  isn't sent twice meanwhile; Save changes with a field to fix goes to it;
  where whoever it's for checked in is said as it changes, its live region
  there before it; each cost they'd take off is named in its Remove; and a
  reviewer reads why a check-in needs review, which was only in a title
  read on hover.
- **2026-10-30:** In #124, found in the browser: on a phone, who added a
  cost and when, and what came from a cash advance, wrap as words. Each
  part was a column of its own beside the amount, so a word broke in two;
  a check-in's date too. And a check-in's map link is the building blocks'
  link, as the Locations list's are, rather than the browser's own blue.
- **2026-10-30:** A task's page, part 2, was merged in #124, and the one
  Requests page is planned in five parts (§2.3): the page with internal
  requests; day off; permission hours and missing punches; overtime,
  phones and flagged punches; then name changes and role requests. Phones
  and flagged punches join it, and the Super Admin's Role changes stay
  their own. The first part opens for review in #125 (§5 step 5).
- **2026-10-30:** In #125, the one Requests page, part 1 (§2.3):
  - `/dashboard/requests` on the building blocks: its page header with New
    request, Mine and To review, and a filter bar with the search, Waiting
    or Done, who asked (on To review), and the kind (once there's more than
    one).
  - Every request is a row that reads the same way: what it's for, who
    asked (on To review), when, its status as a badge in words, and its
    next step for whoever may decide it (Start, then Mark as done). Its
    details and Delete are in its More actions; its details open in a
    dialog with when it was asked, started and done.
  - Its rows come from one feed on the server (`lib/requests/feed.ts`),
    which reads each kind through its own rules of who sees and decides
    it, merges them newest first and pages them. Its first kind is
    internal requests, by the request service's own rules: To review is
    everyone else's a person sees, at their reach, and its buttons are
    where they may decide.
  - The history page folds in as Done: an old link lands there, with the
    request it picked out. A notification opens its request on its tab,
    with Waiting or Done by its status, without asking for its status
    first.
  - Asking for something is a dialog of labelled fields, with their counts,
    each checked as the server checks it and the first to fix focused.
- **2026-10-30:** In #125, found in the browser: when a request was asked
  stays on one line, its time not broken from its day in a narrow column.
- **2026-10-30:** In #125, the Requests page refuses a suspended or
  archived account, a banned company's, one whose subscription has lapsed,
  and anyone but the Super Admin under maintenance, as the requests API
  does. The page reads the database itself, past the API's handler, so it
  showed them their requests, and others' they see (found by Codex on PR
  125). The rule is one function now, which the handler asks too.
- **2026-10-30:** In #125, the feed reads each kind in the order the page
  merges them in: newest first, then by id. Read in another order, two
  requests asked at the same moment on a page's edge could each fall on
  both pages, or on neither (found by Codex on PR 125). Done is in order of
  when each was last changed, which is when it was done, as the old history
  page had it: a request done before its completion time was kept has none.
- **2026-10-30:** The one Requests page, part 1, was merged in #125, and
  its part 2, day off, is planned in three PRs (§2.3): Ask for leave
  becomes a role's permission, the companies there get it, then day off
  moves onto the page. The built-in Employee and Team Leader may ask, and
  every custom role there already; the built-in Admin may not, as today.
  Their balance is on Mine. The first opens for review in #126.
- **2026-10-30:** In #126, Ask for leave is a permission in the role
  editor's Day off group, at Own, and a new company's built-in Employee
  and Team Leader hold it. It's personal, so an Admin who may not ask for
  leave still gives somebody a role that may (`ROLES_PLAN.md` §4.2, rule
  4). Nothing asks for it yet: the companies there get it first (§2.3,
  part 2b).
- **2026-10-30:** Ask for leave was merged in #126 (§2.3, part 2a), and
  the companies there get it in #127, after which asking needs it.
- **2026-10-30:** In #127, the companies already there get Ask for leave,
  at Own: their built-in Employee and Team Leader, who ask today, and every
  role of their own, whatever its base. Not the built-in Admin, who doesn't
  ask today either. A role given it in the role editor since 2a keeps it as
  it is, and only the holders of a role given it reload their grants.
- **2026-10-30:** In #127, asking for leave needs Ask for leave: the API
  refuses anyone whose role doesn't hold it, and the Super Admin, who's
  nobody's employee and holds no personal permission. The Day off page
  offers Request day off by it, rather than to whoever doesn't see others'
  leave, so a manager whose role holds it, an HR officer say, asks too.
- **2026-10-31:** The companies there got Ask for leave, merged in #127
  (§2.3, part 2b), and day off moves onto the Requests page in two PRs
  rather than one: 2c brings it there, and 2d sends the Day off page's
  people, links and tile to it. Its first opens for review in #128.
- **2026-10-31:** In #128, day off joins the one Requests page (§2.3,
  part 2c):
  - Its rows read as any request's: the kind of leave, which days and how
    many work days (every day but Friday), who asked, when, and its status:
    Pending while waiting, then Approved or Rejected, under Done. Its kind
    is "Day off", in the kind filter and under its name.
  - From the feed, by Day off's own rules: Mine is one's own, in a company
    with Day off; To review is everyone else's whose leave one sees, at that
    reach, with Approve and Reject where one may decide it, never one's own.
  - Approving asks for the days to take and whether from the balance or the
    salary, which it has to be when the balance is short; rejecting asks for
    a reason, if there is one. Its details say what came of it.
  - New request asks what for: a general request, or a day off, for
    whoever's role may ask for leave. A day off has its type, its day or
    days, from today on, and why; a missing day is said under its picker,
    and a day asked for already, or gone, in their language.
  - Their balance is a donut on Mine, above the list.
  - The search finds a day off by its reason, as well as a request by its
    title.
  - In Arabic, a line's parts are joined with an Arabic comma: a dot beside
    a number reads as the digit zero (found in the browser).
- **2026-10-31:** Day off on the Requests page was merged in #128 (§2.3,
  part 2c), and the Day off page sends people there in #129. Decided: its
  dates of leave are a filter once the kind is Day off.
- **2026-10-31:** In #129, the Day off page sends people to the one
  Requests page (§2.3, part 2d):
  - Its address lands on Day off there: Waiting for its pending ones, Done
    for its decided ones, with the request a link picked out. Its old
    list, and the list's own helper, are gone. The side bar's Day off goes
    there through it, and a company without Day off still sees what it is.
  - A day off's notification opens it there, on its tab and with its
    status; the dashboard's waiting tile opens them under To review, and
    one's own balance and latest request open Mine.
  - Its dates of leave are a filter once the kind is Day off, by the day
    each starts, as the Day off list had them; leaving Day off, or Reset,
    takes them away.
- **2026-10-31:** The Day off page sends people to the Requests page, merged
  in #129, and part 3 is planned in three PRs (§2.3): permission hours,
  missing punches, then Attendance's Requests tab points there. The month's
  permission-hours allowance is a line on Mine, under day off's. The first
  opens for review in #130.
- **2026-10-31:** Permission hours join the Requests page in #130 (§2.3,
  part 3a):
  - Mine has one's own, To review everyone else's that this person decides
    with Decide permission hours, at its reach, in a company with
    Attendance.
  - Waiting is asked; Done is approved, rejected or withdrawn, in order of
    when it was. A permission request now keeps when it last changed;
    those already there take when they were decided or withdrawn, or else
    asked.
  - A row reads its type, its day, its hours and how long. Approve is one
    click, as on the Attendance page; Reject asks for a reason if there is
    one. Whoever asked may withdraw it from More actions while it waits, or
    once approved until it begins in the company's time.
  - New request offers permission hours to whoever has attendance of their
    own: the day, with that day's limits and what's left of its month's,
    the type the policy allows, the hours and why.
  - On Mine, what's left of this month's is a line under the day off
    balance, while the policy allows them.
- **2026-10-31:** Permission hours on the Requests page were merged in #130,
  and missing punches join it in #131 (§2.3, part 3b):
  - Mine has one's own reports; To review everyone else's that this person
    corrects with Correct attendance, at its reach, in a company with
    Attendance.
  - Waiting is reported; Done is approved, rejected or withdrawn, in order
    of when it was. A report now keeps when it last changed; those already
    there take when they were decided or withdrawn, or else reported.
  - A row reads which punch (in, out, or not stated), its day and time.
    Approve is one click, and adds the punch; Reject asks for a reason if
    there is one; whoever reported it may withdraw it while it waits.
  - New request offers a missing punch to whoever has attendance of their
    own: the day, today at the latest, the time, in or out, and why.
  - Rejecting and withdrawing are one pair of dialogs for both attendance
    kinds.
- **2026-10-31:** Found by Codex on #131: the missing punch form took today
  from the browser, which can be a day behind the company's, so just after
  the company's midnight that day's punches couldn't be picked. The page
  now passes the company's own day, which the attendance API reads times
  in, to both attendance forms: a missing punch can't be after it, and
  both start on it.
- **2026-10-31:** Missing punches on the Requests page were merged in #131,
  and the Attendance page points there in #132 (§2.3, part 3c):
  - A decision on permission hours or a missing punch opens the Requests
    page with the request picked out, from the bell and from a push on the
    check-in app. Overtime's still opens the Attendance page, until part 4.
  - The Requests page finds a picked-out permission or missing punch, as
    it does a day off, and opens it on its tab, Done once it's decided or
    withdrawn.
  - The Attendance page's Requests tab no longer lists them: My requests
    points to Mine, and whoever decides them is pointed to To review.
    Overtime, phones and flagged punches stay there until part 4.
- **2026-10-31:** The Attendance page points to the Requests page, merged in
  #132, which finishes part 3. Part 4 is planned in four PRs (§2.3):
  overtime, check-in phones, flagged punches, then the Attendance tab's To
  decide points there. They're under To review only: nobody asks for them.
  The first opens in #133.
- **2026-10-31:** Overtime joins the Requests page in #133 (§2.3, part 4a),
  under To review only:
  - Waiting is everyone else's days whose overtime waits for a decision,
    for whoever decides it with Decide overtime, at its reach, newest day
    first; Done is the decisions made, the latest first.
  - A row reads whose, which day, how much, and when they came and left;
    "asked on" is its day, which has no time of its own.
  - Approve is one click and approves all its minutes, as on the
    Attendance page; Reject asks for a reason if there is one; a decision
    may be withdrawn from More actions, and the day waits again.
  - Approve overtime ahead stays on the Attendance page, which keeps its
    overtime list until part 4d.
- **2026-10-31:** Overtime on the Requests page was merged in #133, and
  check-in phones join it in #134 (§2.3, part 4b), under To review only:
  - Waiting is everyone else's new phones, for whoever may approve the
    phones people check in from, at its reach, the latest asked for first.
    Done is those decided since: in use, rejected, revoked, replaced by a
    newer phone of theirs, or withdrawn by its owner, the latest first.
  - A row is named by the phone's model, or its system when the app kept
    none, and reads its system and app version, the check-ins it holds
    while it waits, and whether its app was shown to be genuine.
  - Approve is one click, as on the Attendance page; Reject asks for a
    reason if there is one. The phone in use may be revoked from More
    actions, with a reason if there is one.
  - A phone replaced says so, not why it was revoked: the word it keeps
    isn't anybody's, and searching doesn't find it.
  - A person's own phone stays on the Attendance page, and its phones list
    stays until part 4d.
  - Found in the browser: "1 check-ins held" read wrong. The check-ins a
    phone holds are counted in each language's plural: 1 check-in held;
    تسجيل حضور واحد معلّق، ٣ تسجيلات حضور معلّقة.
- **2026-10-31:** Check-in phones on the Requests page were merged in #134,
  and flagged check-ins join it in #135 (§2.3, part 4c), under To review
  only:
  - Waiting is everyone else's check-ins still flagged, for whoever
    corrects attendance, at its reach, the latest to arrive first. Not
    those flagged because the app couldn't prove itself, which the Super
    Admin looks at on their own page; not those withdrawn; and not those in
    a month whose payroll is approved or paid, which can't be decided, as
    the Attendance page leaves them out.
  - Done is those decided, the latest first, with why one was rejected. A
    check-in kept neither when it was decided nor why: it does now, and
    for those decided already they're found in the audit log.
  - A row is named by why it waits, reads in or out, the place and how far
    from it, and is "asked" when it was made, as the wall's clock read.
    Its details have the map of where the phone was, its address and
    phone, and, for whoever sees face photos, a failed face check's photos,
    as the Attendance page did; they're in More actions too.
  - Approve is one click and the check-in counts; Reject asks for a reason
    if there is one, and it doesn't.
  - The Attendance page's list stays until part 4d.
- **2026-10-31:** Flagged check-ins on the Requests page were merged in
  #135, and the Attendance page points there for all of them in #136
  (§2.3, part 4d), which finishes part 4:
  - The Attendance page's Requests tab no longer lists overtime, check-in
    phones or flagged check-ins: To decide points to To review, for
    whoever decides any attendance request, and keeps Approve overtime
    ahead, which isn't a request. One's own phone stays.
  - The Exceptions tab's requests waiting open To review, rather than the
    tab that only points there.
  - A new phone's notice to whoever approves phones opens it on the
    Requests page, picked out, from the bell and from a push on the
    check-in app; one sent before opens the Requests page's phones. The
    page finds a phone picked out, and opens it on To review, Done once
    it's decided.
  - Other attendance notices are about one's own days, phone or check-ins,
    which stay on the Attendance page, and still open it.
  - Found in the browser: the new phone's notice still said to approve it
    under Attendance → Requests; it says the Requests page now, in both
    languages, old notices too, since a notice is worded when it's shown.
    And Approve overtime ahead is the building blocks' button, as the link
    beside it is.
- **2026-10-31:** The Attendance page points to the Requests page for every
  request, merged in #136, which finishes part 4. Part 5 is planned in three
  PRs (§2.3): name changes, role requests, then one Requests item in the
  side bar. Role requests show on the Mine of whoever asked for them, and
  the Role requests page's other tabs move to Company settings, beside
  Roles. Name changes join in #137 (part 5a):
  - Mine is one's own, waiting or decided; To review is everyone else's in
    the company, for whoever decides name changes, never their own, or the
    picked company's for the Super Admin.
  - A row is named by the name it's for, and says the one it was. They're
    searched by the new name, and once decided by the note.
  - Approve is one click; Reject asks for a reason if there is one, which
    the Profile requests page didn't, and the person is told it.
  - The Profile requests page sends people there, with the one it picked
    out. The header's count, the dashboard's tile, and a decision's notice
    open it there too; a decision's notice names the request now, and an
    older one, which named the person, opens the kind's list.
  - Asking stays on one's profile.
- **2026-10-31:** Name changes on the Requests page were merged in #137.
  Company settings → Roles turned out to be a tab only the Super Admin
  sees, so the Role requests page's other two tabs get a page of their own
  instead, Roles and access, beside Company settings (decided again on
  2026-10-31). Role requests join in #138 (part 5b):
  - Mine is those one asked for, for whoever asks for roles; To review is
    the company's that somebody else asked for, for whoever gives roles, or
    the picked company's for the Super Admin. The person whose role it
    would be is told once it's decided, as before.
  - A row is named by the role, a built-in one in the person's language,
    and says whose it would be; an acting one says until when. They're
    searched by the note it was asked with, and once decided by the one it
    was decided with. Done is in order of when each was decided or
    withdrawn, which reminding the deciders of one waiting doesn't move.
  - Approve gives the role, as choosing it on their profile does. Reject
    needs a reason, as the Role requests page did. Whoever asked may
    withdraw it while it waits.
  - A refusal says why in the person's language: the role requests API
    answers with a code beside its words, as the attendance APIs do. One
    that can't be given here, to someone who leads a team, says to change
    it on their profile, which asks where their team goes.
  - The Role requests page sends people to the Requests page, with the one
    it picked out, and its other tabs' links to Roles and access. Asking
    for one, deciding it and reminding of it are noticed with it on the
    Requests page; the Role field on a profile links its waiting one there.
    "Your role is now" opens the dashboard, whose side bar has what the new
    role opens.
  - The side bar's Role requests item is Roles and access now, beside
    Company settings, for whoever gives roles; whoever only asks for roles
    finds theirs on the Requests page.
  - Found in the browser: a role request's row put whose role it would be
    under "Asked by", the column, the person filter and the details all
    say, beside who really asked. Its person is who asked now, as every
    row's is, and whose role it would be is beside the role, on Mine and
    To review alike, and in the details as "Whose role".
  - Found in the browser: "Your role is now" opened one's own profile,
    which has no Role field, so it said nothing of the role. It opens the
    dashboard now, whose side bar has what the new role opens.
  - Found in the screenshots: in Arabic, whose role it would be ran into
    "لـ" when the name is in Latin letters; a space keeps them apart.
- **2026-10-31:** In 5b (#138), found by Codex: an acting role's last day
  showed a day early east of UTC, Cairo included. It's kept as the start
  of that day in the company's time zone, which is the day before in UTC,
  and the page reads dates in UTC. The feed sends the company's own day
  now, as it was asked for.
- **2026-10-31:** Role requests on the Requests page were merged in #138,
  which finishes part 5b. The side bar shows one Requests item in #139
  (part 5c):
  - People is Employees, Attendance and Requests. The Day off and Profile
    requests items go; their pages already send people to the Requests
    page, and so do their notices and links.
  - Day off stops being a module: it has no entry of its own to name, so
    Company settings no longer offers a name or icon for it. One a company
    kept is dropped as any unknown key is, when the names are read.
  - A company without Day off no longer sees it in the side bar, locked, as
    something else the product does; an old link to its page still shows
    them what it is.
- **2026-10-31:** The side bar's one Requests item was merged in #139,
  which finishes the one Requests page (§2.3). Next, before the remaining
  old pages (§5): the account check the Requests page has (found by Codex
  on #125) on every page that reads the database itself, in #140. A
  suspended, archived or banned account keeps a live session, and the
  proxy holds off only maintenance and a locked subscription, so the
  dashboard home, the Tasks, Obligations and Costs pages, a task's, an
  obligation's and a record's page still sent such an account their data;
  a task's and an obligation's page marked themselves seen too. Each now
  says Access restricted before it reads anything, and a test fails for
  any page that reads the database before asking.
- **2026-10-31:** The account check was merged in #140. Payroll moves onto
  the building blocks next (§5), in two parts. The first, in #141, is its
  top:
  - The page header names the register, with its status, and says the
    month and its payday. The payday read "Month 25": it took the month's
    label.
  - The month and year are picked in a panel under it, each with its
    label, the Super Admin's company first. It's a new block in
    `DESIGN.md` (§5.3), for Attendance's month and Public holidays' year
    later too.
  - A draft's Save draft and Approve are the header's buttons. The
    register's file moves beside the totals' heading, where it doesn't
    make a third.
  - Paying and sending is one card, each half under its title. Each
    half's button is for whoever may do it; both showed to anyone with
    either permission.
  - The totals are tiles, counted in the page's own digits.
  - Approve and Mark as paid ask in the building blocks' dialog, which
    names the day being recorded. Writing off a debt keeps its own until
    part 2.
  - While the register loads, and when it doesn't, the page says so in
    its place, with the server's reason and Try again, where it showed a
    spinner and a toast.

  The review cards, the list and the debts follow in part 2.
- **2026-10-31:** Found in the browser, in #141: a paragraph straight
  inside a card kept the browser's own margins, so an approved month's
  one line on Payroll stood in a card twice its height. A card spaces
  what's in it itself, which also tightens a task page's two notices.
- **2026-10-31:** Payroll's top was merged in #141. Payroll comes in three
  parts rather than two, so each stays small: the review cards in #142,
  then the list of everyone paid and the debts.
  - A card that needs someone, or says something is wrong, has its
    meaning's bar on its start edge, a new rule in `DESIGN.md` (§5.5,
    Card). The old cards were filled with the colour.
  - What changed since the draft and since last month have their totals
    beside their titles, and a row for each person. Last month's says how
    many more changed than the eight it lists; it used to cut the rest off
    without saying so.
  - The acknowledgement stays with the people it's about, as a tickbox
    under them.
  - Attendance's dry run is a plain card: it waits on nobody.
  - Attendance that changed after a month was approved has its days in
    the page's language, and its arrow points the way the page reads.
    Mark resolved asks how it was settled in the building blocks' dialog.
    Left empty, it says so under the field; its button used to stay greyed
    with no reason given.
- **2026-10-31:** Found in the interface audit, in #142: each day changed
  after approval had a Mark resolved button with the same name, so a
  screen reader couldn't tell one row's from the next. Each is named for
  its day and person now.
- **2026-11-01:** Payroll's review cards were merged in #142. Next, before
  the rest of Payroll, four attendance tests that depended on the date are
  fixed, in #143. None of them is about the product: the code counts days
  and months in the company's time zone, as it should, and the tests
  didn't.
  - The agent's test, and two of the nightly rebuild's, took today's day or
    month from UTC. In the last two hours of a month in UTC it's already
    the next month in Cairo, so they failed then, the agent's in CI too.
    They take the company's now, as the code does.
  - A night shift's test was fixed at November 2026, the month after the
    one an earlier test approves, which was October when it was written.
    That month is the month of a check-in made today, so from 1 November
    the two clashed, and it failed on every run. It picks its months after
    the one approved, with a Monday at the month's end as before, and
    takes Cairo's own offset, +03:00 in summer.
- **2026-11-01:** The attendance tests were merged in #143. Decided on
  2026-10-31: Payroll's month is kept in its address, so a reload or a
  link opens on it, and a Super Admin's company is the company in view
  from the top bar, as on every other page. Payroll's own company picker
  goes; with it, they picked the company twice. Both are written into
  `DESIGN.md` (§5.3), for Attendance's month and Public holidays' year
  too, and Payroll follows them in #144.
- **2026-11-01:** From Codex's review of #144: the company in view
  follows the top bar in every tab, so a Super Admin who opened Approve
  or Mark as paid for one company, then picked another in a second tab,
  would have confirmed it for the other company's register, unseen. A
  confirmation now closes when the company or month changes under it,
  and "approve anyway" is unticked, so neither carries over to a register
  nobody reviewed.
- **2026-11-01:** Payroll's month in its address and the company in view
  were merged in #144. Payroll's last part moves onto the building blocks
  in #145: the list of everyone on the register, and what people owe.
  Nothing on the page is styled by hand any more.
  - Everyone on the register is a card with a row for each person. Each
    name opens that person's pay, line by line, as it did; now it says it
    opens, and whether it's open, with a caret that turns. That's a new
    rule in `DESIGN.md` (§5.5, Rows).
  - An excluded person was faded, below a readable contrast. They're shown
    as everyone else is, with the word Excluded beside their name and why
    in their detail line.
  - Each payslip link is named for its person, so a screen reader tells
    one from the next. Days paid are counted in the page's digits, as every
    other number is; they were always in English digits.
  - A deduction is no longer red: its minus says it, as on attendance's
    dry run above it.
  - What people owe is a card with a row for each debt: who, when it's
    due, what's been recovered and what's left. Write off is named for its
    person, and asks why in the building blocks' dialog, which stays open
    while it works, so the code it asks for comes up over it. Fewer than
    three characters is no reason, as the server says, and the dialog now
    says so under the field.
  - A debt's due day was read in the browser's time zone. It's due at the
    start of payday in the company's, which is the day before in UTC, so
    anyone outside Egypt saw the day before. The server sends the day
    itself now.
- **2026-11-01:** Found in the browser, in #145: in Arabic, a person's
  detail line read "٣١ · ١١", days paid then days undecided, and beside
  Arabic digits the middle dot looks like the Arabic zero, so the two
  read as one number. Days undecided say their label first in Arabic now,
  as days paid do. The dot separates parts of a line in 17 places; where
  a number can meet another across it elsewhere is a follow-up.
- **2026-11-01:** Found in the interface audit, in #145: in a row that's
  open, a line's label with no spaces in it, such as a long name, pushed
  its amount out of the row. The label wraps now, and the amount stays
  whole beside it.
- **2026-11-01:** Payroll's last part was merged in #145, so Payroll is
  on the building blocks throughout. Public holidays follows in #146.
  - The year it's about is picked under the header and kept in the
    address, as Payroll's month is (`DESIGN.md` §5.3), so a reload or a
    link opens on it. It was two arrows either side of the year.
  - Add is the header's button. Adding and editing are in the building
    blocks' dialog, not a form above the list, and a day or English name
    left out is said under its field; Save used to stay greyed with no
    reason given. A holiday saved into another year takes the page there.
  - Each holiday is a row with its day, how many companies work through
    it, counted with its word (it said "1 companies"), and a menu with
    Edit and Delete. Delete asks in the building blocks' dialog, which
    stays open while it works, and says when it's done.
  - While the year loads, and if it doesn't, the page says so, with Try
    again. A year that didn't load kept its spinner for good.
  - The helpers that keep a period in the address move from Payroll's
    file to their own, `lib/period-address.ts`, for both pages.
- **2026-11-01:** Found in the interface audit, in #146: a year with no
  holidays offered Add twice, in the header and again under it. It's the
  header's alone now, as on the Tasks and Obligations lists.
- **2026-11-01:** Public holidays was merged in #146. Attendance is the
  tenth page and the biggest left, so it moves in seven parts:
  1. its frame: the page header, the tabs, and what it says before them,
     in #147;
  2. a Super Admin's company: the company in view from the top bar, as on
     Payroll (`DESIGN.md` §5.3). Links that name a company today, from a
     company's attendance settings and face checks' notices, pick it
     there. The top bar already rewrites the address when a company is in
     view, dropping the company such a link named, so this gets a PR of
     its own and its own checks in the browser;
  3. Days, with its month picked under the header (§5.3);
  4. Punches;
  5. Exceptions;
  6. Import and employee numbers;
  7. face checks, the Requests tab, and adding a punch.

  In part 1:
  - the tabs are the building blocks' (§5.5): text, with a line under the
    one picked, the arrow keys moving between them, and what they show in
    a panel named by its tab. They were a row of buttons;
  - while it finds out the company's date, and if it can't, the page says
    so under its header. A failure was a red line with no way to try
    again; it says so with the server's word and Try again;
  - a Super Admin who hasn't opened a company is told how, in an empty
    state under the header.
- **2026-11-01:** Attendance's frame was merged in #147. Part 2 follows in
  #148: a Super Admin's company on Attendance is the company in view from
  the top bar, as on Payroll (`DESIGN.md` §5.3).
  - A link that names its company, from a company's attendance settings
    or a face check's notice, puts that company in view in the top bar,
    for the page it opens and the ones after. Before, with another company
    in view, the top bar took the link's company out of the address, and
    the page asked to open a company.
  - The link is followed once and taken out of the address. Left in, it
    would put its company back in view after a pick in another tab.
  - The Requests page keeps the company in view in its own address, so for
    a moment after a pick it still names the last one. The top bar doesn't
    take that for a link, which would undo the pick.
  - Until a company is picked, the page says to pick one at the top.
- **2026-11-01:** From Codex's review of #148: the Requests page keeps the
  company in view in its own address, and the top bar took that for a
  link. When another tab picked a company, an open Requests tab still
  named the last one, and wrote it back over the other tab's pick. Only
  the pages such links open, Attendance today, are links now.
- **2026-11-01:** From Codex's review of #148: a link naming the company
  already in view stayed in the address, since there was nothing to
  change. The page went on preferring it, and put that company back after
  another tab picked a different one. Such a link is now followed all the
  same, which takes it out of the address.
- **2026-11-01:** A Super Admin's company on Attendance was merged in
  #148. Days moves onto the building blocks in #149 (part 3):
  - the month it's about is picked under the page header, in a month
    select and a year select, and kept in the address
    (`?tab=days&year=2026&month=10`), so a reload or a link opens on it
    (`DESIGN.md` §5.3). With none, it's the company's this month, from its
    date, not the device's. It was a browser month field, in English;
  - whose days, for whoever sees other people's, is picked beside the
    month, with its visible label, since it decides the whole tab: the
    list and the month so far;
  - one person's month so far is total tiles above the list. Everyone's
    is their deductions in one tile. A list cut short has none, and says
    so above it, as before;
  - the days are a list (§5.4), a table on computers and a card for each
    on phones, under a heading naming the month. Each day's status is a
    badge at the end, with what explains it a line each below it. They
    were run together with a dot, which beside Arabic digits reads as a
    zero;
  - Recalculate this month is the list heading's button;
  - dates, times, minutes, amounts and counts are in the page's language,
    and a deduction's days in words ("1 day", "0.25 days") where it said
    "day(s)";
  - while it loads, and when it can't, it says so, with the server's word
    and Try again. It was a spinner, and a red line;
  - a day's status is in sentence case in English ("On leave", "Rest
    day"), wherever it's shown.
- **2026-11-01:** Found in the interface audit of #149:
  - a deduction's days were rounded to two places, so an eighth of a day
    showed as 0.13, and a month's 1.375 as 1.38. They're shown to the
    eighth now, as they're kept;
  - the tab's blocks, the month bar, the tiles and the list, sat against
    each other. A tab's panel spaces its blocks as the page does;
  - on a phone, a day's times read "In 09:12 , Out 17:00", each piece
    spaced apart, and a day with no punch said "In —, Out —". The times
    are one line now, and only on a day with a punch.
- **2026-11-01:** From Codex's review of #149: a count's word was picked
  for the number rounded to three places, whatever it was shown to. A
  deduction of 1.0004 days, shown to four places, read "1 day", and in
  Arabic 1.9999 days read "يومان". The word is picked for the number as
  it's shown now.
- **2026-11-01:** From Codex's review of #149: on a phone, a day's card
  gave its deduction's amount without its days, which the table gives
  below the amount, so 62.50 couldn't be checked against the policy's
  0.125 of a day. The card gives both now: "Deduction: 62.50 (0.125
  days)".
- **2026-11-01:** Days was merged in #149. Punches moves onto the building
  blocks in #150 (part 4):
  - its period is the month Days is about, picked under the page header
    and kept in the address, so the two tabs share it (`DESIGN.md` §5.3).
    A day of it is picked beside the month, and kept in the address too
    (`?day=15`), so a big company's month, cut short at 2,000 punches,
    can be read a day at a time (decided on 2026-11-01). They were two
    browser date fields, from and to, in English;
  - whose punches is picked beside the day. The punches whose number is
    nobody's yet are one of its choices, "With no person yet", for
    whoever corrects the company's attendance. They were a checkbox;
  - the punches are a list (§5.4), a table on computers and a card for
    each on phones, under a heading naming the month or the day. Each
    one's day and time are in the page's language;
  - a punch that doesn't count, or no longer does, is a badge at the end:
    Flagged, Held, Not counted or Withdrawn, with what it means and why
    below it. A withdrawn one was greyed and struck through;
  - Add a punch is the list heading's button; Withdraw is each row's;
  - withdrawing is in the building blocks' dialog: why, said under its
    field when it's missing, and the danger button, which stays while it
    works. It was the old confirm box;
  - while they load, and when they can't, the list says so, with the
    server's word and Try again. It was a spinner, and a red line.
- **2026-11-01:** Found in the interface audit of #150:
  - a check-in from the app with no place said "App, —". It says "App";
  - withdrawing didn't say which punch it was about. Its dialog names
    whose it is, when, and in or out, above why;
  - on a phone, a punch's card gave its in or out a clock, and where it
    came from the notes' icon. Each has an icon of its own.
- **2026-11-01:** Punches was merged in #150. Exceptions moves onto the
  building blocks in #151 (part 5):
  - its period is the month the other tabs are about, and a day of it,
    picked under the page header and kept in the address (`DESIGN.md`
    §5.3). Only days that are over have exceptions, so it goes up to
    yesterday: with no month in the address it opens on yesterday's
    month, a day not over yet is listed but can't be picked, and a period
    with none over says so. They were two browser date fields;
  - what waits elsewhere (requests to decide, punches with no person,
    face checks overdue) is a tile each that opens where it's decided.
    They were buttons beside the dates;
  - the kinds (late or left early, absent, punch missing, overtime,
    decided) are the building blocks' tabs, each with how many, kept in
    the address (`?kind=absent`), so a reload or a link opens on one;
  - each kind is a list (§5.4), a table on computers and a card for each
    on phones, each day dated in the page's language and whose;
  - a decision is a badge, Excused or Accepted as charged, with its
    reason;
  - excusing asks why in the building blocks' dialog, said under its
    field when it's missing, and turning overtime down asks why too, the
    reason its own to give. Each names the day and what it's about. They
    were the old confirm box;
  - while it loads, and when it can't, it says so, with the server's word
    and Try again. It was a spinner, and a red line;
  - the month, the day and numbers in the page's language are one module
    the tabs share (`attendance/period.ts`).
- **2026-11-01:** Found in the interface audit of #151:
  - a day with no punch, such as overtime asked for ahead, gave its
    times as "—–—". It gives none;
  - one day's list was "To decide in Wednesday 14 October". It's "on"
    a day, and "in" a month.
- **2026-11-01:** Exceptions was merged in #151. Import and employee
  numbers move onto the building blocks in #152 (part 6), each in a file
  of its own:
  - importing is one card: what it's for, the building blocks' file
    picker ("Choose a file"), how the file's dates are written, then
    Check the file. Once checked, which column is which, each a labelled
    select, and what importing would do, a line each, those to look at
    in their status colour, in the page's language; then Import (n).
    The rows that couldn't be read are behind a disclosure. They were a
    browser file field and hand-made rows;
  - the files imported are rows, each with its day and what it brought
    in, and Withdraw this import, or a Withdrawn badge with why. The
    counts no longer run together with a dot, which beside Arabic digits
    reads as a zero;
  - withdrawing a file is in the building blocks' dialog, naming it, and
    asking why under its field. It was the old confirm box;
  - the numbers waiting for a person are a list (§5.4), a table on
    computers and a card for each on phones, each with whose it is to
    pick and Save. Nobody is offered their own;
  - a number saved by hand is a form above the numbers saved, which are
    rows with Remove on anybody else's; removing asks first, in the
    building blocks' dialog, its confirm the danger button. It was a red
    link and the old confirm box;
  - while they load, and when they can't, each says so, with the
    server's word and Try again. They were a spinner, or nothing.
- **2026-11-01:** Found in the interface audit of #152: fields side by
  side in a card stretched to fill it, so how a file's dates are written,
  alone in its row, ran the card's whole width on a computer. They're
  sized as the period bar's now, two to a line on phones. And the files
  imported and the numbers saved were a panel in their card, a box in a
  box: they're rows straight in it, as on Public holidays.
- **2026-11-01:** Import and employee numbers were merged in #152. Face
  checks, the Requests tab and adding a punch move onto the building
  blocks in #153 (part 7, the last):
  - the Requests tab is a card each: one's check-in phone, with Cancel
    the new phone while one waits; one's requests, and what waits on
    whoever decides, each pointing to the Requests page; and, for
    whoever approves overtime, Overtime ahead. They were glass boxes
    with typed-in styles;
  - cancelling a new phone asks first in the building blocks' dialog,
    whose other button keeps the request, not another "Cancel" beside
    "Cancel the new phone". It was the old confirm box;
  - asking for permission hours or reporting a missing punch from a day,
    on Days or the check-in page, opens the Requests page's own forms in
    the building blocks' dialog, the day's date, type and hours filled
    in: one form each, not two, with what's missing said under its field
    and the server's refusals in the page's language;
  - approving overtime ahead and adding a punch are forms in the
    building blocks' dialog, each saying what's missing under its field.
    A punch's day can't be after today;
  - face verification's photos waiting and who it's asked of are lists
    (§5.4), a table on computers and a card for each on phones, each
    photo with what it's for, when it was sent, on the viewer's clock and
    in the page's language, and what to know before deciding. Whoever is
    asked has a checkbox named for them. The overdue are a card that
    waits on someone (§5.5), each since when. They were glass boxes,
    tables and dates as the server wrote them;
  - deciding a photo is in the building blocks' dialog, and rejecting
    asks why in the same dialog, so the photos stay open: closed and
    opened again they'd be fetched, and recorded, again. Asking to
    re-verify asks first there too. They were the old modal and confirm
    box;
  - a face photo has the building blocks' look wherever it's shown,
    flagged check-ins on the Requests page too;
  - while face verification loads, and when it can't, it says so, with
    the server's word and Try again. It was a spinner, or nothing.
- **2026-11-01:** Found in the interface audit of #153:
  - in a photo's dialog, Reject and Back each took away the button that
    had focus, which went to the page behind: Escape didn't close the
    dialog, and Tab started from the top of the page. Reject puts it in
    the reason now, and Back on Reject again;
  - the two photos sat one under the other in the dialog, so comparing
    them meant scrolling between them, and each had no size until it
    loaded, so the dialog grew as they came in. They're side by side,
    on a phone too, each 3 by 4 from the start;
  - adding a punch's reason had "e.g." for its placeholder, where the
    other forms have "Such as …";
  - "No phone yet" was a settings card's note, small and grey, where the
    other cards say theirs as the card's text.
  - ticking or unticking whoever is asked for face verification waited
    on the server before the box changed, so it looked as if the click
    hadn't taken. It shows at once while it saves, and goes back if it's
    refused.
- **2026-11-01:** Found in the interface audit of #153, on a phone: in
  the cards of who is asked for face verification, the checkbox stood
  alone at the card's foot, saying nothing. It says "Asked for face
  verification" beside it now. The table's column says it on a computer,
  and its box is named for the person.
- **2026-11-01:** Found by Codex on #153: a write on Attendance whose
  connection failed, or dropped before the answer was read, threw. The
  busy button reset and nothing was said, so whoever decided a face photo,
  asked it of someone or asked them to re-verify couldn't tell whether it
  was saved. The face tab had caught it before. Every Attendance write
  (`attendance/send.ts`) now says so, as a refusal does.
- **2026-11-01:** Found by Codex on #153: a face photo's dialog had only
  Reject and Approve, and the building blocks' dialog has no close button
  of its own, so on a phone, with no Escape key, it couldn't be closed
  without deciding. It has Close too, first, as Cancel is elsewhere.
- **2026-11-01:** Attendance's face checks, Requests tab and adding a
  punch were merged in #153, so all of Attendance is on the building
  blocks. Documents is next, most used first, in two parts. My payslips
  moves onto them in #154 (part 1):
  - the page header, then a row for each payslip that opens it: the
    month in the page's language, the year in its digits too, the days
    paid, and the net, lined up down the list. It was a hand-made list;
  - one approved but not paid yet says so in a badge, "Not paid yet", so
    it isn't read as money already sent. The dot that ran it into the
    days paid, which beside Arabic digits reads as a zero, is gone;
  - while it loads, when the company hasn't switched payslips on, when
    there are none yet, and when they didn't load, each says so. A
    failed load passed for none, saying there were no payslips when
    there were; it now says so, with the server's word and Try again.
- **2026-11-01:** My payslips was merged in #154. The payslip and the
  settlement statement move onto the building blocks in #155 (Documents
  part 2), with a document in `DESIGN.md` §5.5:
  - one sheet for both, `DocumentSheet` and its lines, totals and notes
    (`components/ui/Document.tsx`), in place of `DocumentFrame`: the
    company's name and the document's above a rule, the facts as details,
    each group's lines with their total, and the figure the document is
    for last. Its headings were small capitals, and its sizes, colours
    and rules typed in;
  - Print, and Send by email on a settlement, are in the page header,
    above the sheet, so neither is on the paper;
  - who owes whom on a settlement is said in words, with its colour as a
    bar on the note's start edge. It was a coloured fill, which doesn't
    print. A draft payslip's note waits on someone in the same way;
  - the period and the days paid are in the page's language, digits too;
  - printed, the sheet is the page, black on white, in dark mode too:
    the building blocks' styles load after the print ones, so the
    panel's padding, border and dark fill would have printed;
  - a document that didn't load said it didn't exist, or wasn't theirs.
    It says it didn't load now, with the server's word and Try again,
    and one that isn't there, or isn't theirs, still says so.
- **2026-11-01:** Found in the browser and the interface audit on #155:
  - printed from a phone, the sheet kept its phone padding inside the
    paper's margins: the phone rule came after the print one. A page of
    A4 between its margins is as narrow as a phone, so it's for screens
    only now;
  - printed from dark mode, the notes' bars were dark mode's pale
    colours, which all but vanish on white. On paper they're the light
    theme's;
  - a settled statement said "−0.00" for what was already paid, and a
    deduction of nothing had a minus sign too. Nothing has none.
- **2026-11-01:** The payslip and the settlement statement were merged
  in #155, so Documents is done. The check-in page, the Nizmo app's first
  screen, moves onto the building blocks in #156, with a section of its
  own in `DESIGN.md` §5.5:
  - the page header, then the phone's card: Check in and Check out side
    by side, each half the card, in the large button only this page
    has (56px). While one works it says what it's doing, and neither
    can be pressed again. A phone to register, or one waiting for
    approval, says so in that card;
  - what became of a check-in is a card under them, read out by screen
    readers: recorded, with a check in the Good colour; recorded but
    waiting on a review or the phone's approval, with the Waiting bar;
    not recorded, with the Problem bar and why. Its time and distance
    are in the page's digits, as arriving late's minutes and start are;
  - arriving late is a card with the Waiting bar and Ask for permission
    hours; face verification a titled card, one step at a time;
  - using this phone instead, and withdrawing consent, are asked in the
    building blocks' dialog, not the old confirmation window;
  - in a browser, for the Super Admin, and where the package hasn't the
    app, each says so as an empty state. Phone details that didn't load
    said only "Something went wrong"; they say what didn't load now,
    with the server's word and Try again;
  - the screen is its own file (`check-in/CheckInScreen.tsx`), given
    the phone, so it's tested without one. Emoji, typed-in sizes and
    colours, and the header set from inside the page are gone.
- **2026-11-01:** Found in the browser and the interface audit on #156,
  in Arabic:
  - Check in and Check out each wrapped onto two lines at half a
    phone's width. The large button has 12px either side now, not 24px,
    and both fit on one line;
  - a place's name ran into the Arabic sentence around it, so its full
    stop could land at the wrong end. It keeps its own direction now;
  - the reasons a check-in waits for a review were joined with ", ",
    which reads as English inside Arabic. They're listed as each
    language lists things.
- **2026-11-01:** Found by Codex on #156: Escape closed Use this phone
  instead, or Withdraw my consent, while the request went on, so it
  looked called off when it wasn't. The old confirmation window waited;
  both dialogs now stay open until it's done, as Attendance's do.
- **2026-11-01:** The check-in page was merged in #156. An employee's
  history is next, in three parts. Its frame and Salary tab move onto
  the building blocks in #157 (part 1):
  - the page header names the person, under a link back to Employees,
    which one's own history, opened from the account menu, doesn't
    have. Its tabs are the building blocks' and are kept in the
    address, so a reload or a link opens the same one; each tab's own
    action, Bonuses and deductions or Manage deductions, is in the
    header. They were hand-made buttons, the back button a lone arrow,
    and the labels Title Case;
  - the Salary tab: the current base salary as a detail, then a list of
    the months: each month's name opens its payslip where there is one,
    the days paid of the month's, what was deducted and added in days,
    and the salary, saying whether it's from the payslip or an estimate.
    In the page's language, digits too;
  - settlements are rows, each opening its statement, and debts a list:
    what's left, its state in a badge, when it's due, what was
    recovered or written off, and why. They were one line each, joined
    with " · ";
  - the whole page waited behind one spinner for all four of its lists.
    Each tab says it's loading now, and the Salary tab that it didn't
    load, with Try again. The messages of the dialogs still to come are
    the app's toasts, not a box of its own in the corner.
- **2026-11-01:** Found in the browser and the interface audit on #157:
  - on a phone, a month's salary sat beside its note, "From the payslip"
    or that it's an estimate, and wrapped mid-number. The note is on a
    line of its own under the card's details now, in the muted hint's
    size;
  - in the table, the note under an amount at the end of a row began at
    the start of its cell. A note in a column of amounts at the end
    lines up under them now, on every list that has one.
- **2026-11-01:** An employee's history part 1 was merged in #157. Its
  Day off credit and Costs tabs move onto the building blocks in #158
  (part 2):
  - the Day off credit tab gives the credit a year and what's left, in
    days, then each year's days off as a list: the date, the type in
    words, the days, what they came out of, and why. A closed year
    gives its credit and what was left at its end, and a year the reset
    had to carry rather than measure says so in the page's language.
    The types read as the database spells them, REGULAR and SICK, and
    the two figures were joined with " | ";
  - Reconsider is on each day off taken from the credit, for who can
    approve days off, and opens a dialog asking for its days, from 0 in
    halves, that stays open until they're saved. The Manage deductions
    window, which listed the same days off again, each with Reconsider,
    is gone, and so is its button in the page header;
  - the Costs tab lists each task they paid for: the task, which opens,
    its date, what's to pay them back, and whether it's been paid, in a
    badge, as the Costs page and a task's own costs say them;
  - each tab says it's loading, and that it didn't load, with Try
    again. Both were hand-made tables, aligned by language by hand. The
    13 labels only they and the old window read are gone from both
    languages.
- **2026-11-01:** Found in the browser and the interface audit on #158:
  - a day off's date was read on the screen's clock. A day off is a
    calendar day kept at midnight UTC, so west of UTC it read as the day
    before. It's read as the calendar day now, as the Requests page reads
    it, and a day off of several days gives its last day too: the
    wedding leave of 3 to 5 November read as 3 November alone;
  - a paid cost's card said "To pay back" beside its Paid badge. It says
    "Paid back" once it's paid, and the table's column is "Amount";
  - every Reconsider button was called just that. Each is named for its
    day off now, for who hears them out of their rows;
  - Enter in the dialog's field did nothing, and a refused number left
    the focus on Save. It's a form now, so Enter saves, and a refused
    number takes the focus to its field, under which it says why.
- **2026-11-01:** An employee's history part 2 was merged in #158. Its
  bonuses and deductions move onto the building blocks in #159 (part 3):
  - they're a section of the Salary tab, under the months they explain,
    for who can see salary, as their route asks. They were a window of
    their own, opened from the page header, or by a notification's
    link. The header's button is gone, and a notification's link opens
    the Salary tab with its adjustment marked and brought into view;
  - each says what it was ("2 days bonus"), the month it counts in,
    where it came from, why, and when it was entered, and a reversed or
    rolled back one says so in a badge. The amount was a coloured "+2"
    or "-1.5", a finished one was struck through with a drawn line, and
    the month and where it came from were one line with a chip;
  - Reverse and Roll back are behind each one's More actions menu, for
    who can adjust this person's pay. Each asks first in a dialog that
    says which it is for and stays open until it's done, the
    authenticator code a high-risk action asks for coming over it.
    Roll back is in the danger colour; it acted on one click. A refusal,
    such as a month already approved, says why;
  - the 12 labels only the old windows read are gone from both
    languages, and so is `--accent-solid-deep`, the colour of its "+2".
- **2026-11-01:** Found in the browser and the interface audit on #159:
  - each More actions menu is named for its bonus or deduction and its
    month, and in Arabic the two were joined with an English comma.
    They're joined as each language joins them now;
  - after Reverse or Roll back, the focus went back to the row's menu,
    which an undone row no longer has, and so fell to the page's start.
    It goes to the section's heading now.
- **2026-11-01:** Found by Codex on #159: a notification's link brought
  its adjustment into view only while it was marked, for six seconds, so
  a list that took longer to load stayed where it was. It's brought into
  view once it's listed, however long that takes, as the Tasks page
  does; the mark still fades after six seconds.
- **2026-11-01:** An employee's history was merged in #159, its third and
  last part. Decided the same day: someone who can't see salary still
  doesn't see their own bonuses and deductions, so a notification about
  one opens a history that doesn't list it, as it always has.
- **2026-11-01:** Company settings move onto the building blocks in four
  parts. The first, in #160, is the frame and the General tab:
  - both ways in, a company's own settings and the Super Admin's for any
    company, have the page header. The Super Admin's names the company,
    under a link back to Companies; it was a hand-drawn arrow, floated
    and moved on hover in the code. A company's own says what the
    settings are, where the old top bar said it;
  - the tabs are the building blocks', kept in the address as before,
    over one column of cards at a width that reads;
  - each way in says it's loading, and that it didn't load, with Try
    again. A company's own said "Access Restricted" for any failure,
    the server being down included; it says so now only when the
    answer is a refusal;
  - leaving a tab or the page with unsaved edits asks in the building
    blocks' dialog, Discard changes in the danger colour. So does
    switching cash advances off, which stays open until it's saved;
  - the General tab's setting, whether a task's submitted location is
    checked automatically, is a row in a card saying whether it's on,
    with a button to turn it off or on, as cash advances beside it say
    theirs. It was a checkbox that saved as it was ticked.
- **2026-11-01:** Found in the browser and the interface audit on #160:
  - a card's rows stretched to its edges, as settings' are, lost their
    own padding to the rule that lines rows up with a card's text, so
    their text sat against the card's border, cash advances' and a
    client's record sections' too. They keep their inset now;
  - a company that shows its people the General tab alone had a row of
    tabs holding one. It has just the cards now;
  - the page was "Company Settings", in the side bar too. It's "Company
    settings" now, in sentence case (`DESIGN.md` §3.4).
- **2026-11-02:** Company settings part 1 was merged in #160. The second
  part, in #161, moves the Branding and Payroll tabs onto the building
  blocks. The brand colour was built on them already:
  - the logo is a card. Its preview shows the logo as the side bar will,
    on the side bar's dark ground and its light plate, beside the
    company's name. Upload a logo, or Replace and Remove, sit on the
    card's end side, and only the one at work says so;
  - the payroll policy is a card of fields, each with its label above it
    and its hint or error below it, and Save on the card's end side.
    Payslips for employees is a checkbox, with its meaning read with it;
  - a payday or debt cap that isn't a whole number in range is said to
    be wrong under its field before anything is sent. Before, an emptied
    payday was sent as 0 and refused in English, and an emptied debt cap
    was saved as 0, which turns recovery off. The server's own reason
    for a field, such as the calendar's, goes under that field too, and
    the focus moves to the first field that's wrong;
  - the debt cap's label says it's a percentage, where a "%" used to
    follow the field.
- **2026-11-02:** Found in the browser and the interface audit on #161:
  - in Arabic, the calendar's zone started under the select's arrow,
    because the select was set left to right. It keeps the page's
    direction now, and a page translator leaves zone names as they are;
  - a field's error stayed after the field was put right, until Save.
    It goes as soon as the field is changed, as the other forms' do;
  - Remove deleted the logo at once. It asks first now, Remove logo in
    the danger colour, since showing it again means uploading it again;
  - the logo's preview has its size before it loads, so the card doesn't
    move, and the payday and the debt cap don't offer saved entries.
- **2026-11-02:** Found by Codex on #161: a payday or debt cap typed with
  a leading zero, such as "05", was saved as 5, but the card compared the
  text it held with the 5 it was given back. So Save stayed on, and
  leaving the tab asked about edits already kept. A typed number is
  compared as the number it is now, and after a save the field shows
  what was saved.
- **2026-11-02:** Found by Codex on #161, after that fix: a payday or debt
  cap typed over while its save was on its way was put back to what was
  sent once the answer came, and the card then counted itself saved, so
  the newer number was lost without a word. The field shows what was
  saved only if it still holds what was sent; otherwise the newer number
  stays, still a change to save.
- **2026-11-02:** Company settings part 2 was merged in #161. The
  Attendance tab is the largest part, about 2,000 lines across six files,
  so it moves in three: its calendar first, in #162, then the policy,
  then the four smaller panels above it. The calendar on the building
  blocks:
  - the schedules are a card saying what they're for, with New schedule
    and the default changes to come, then a card for each schedule: its
    name and Default, its hours, break, working days, any weekday with
    hours of its own, and how many work it, counted in the page's
    language ("1 employee", never "1 people"). Its changes to come and
    its seasonal hours are listed under their own headings, and what can
    be done to it is in a menu named for it;
  - who works which schedule lists each person with the schedule they're
    on and the move to come. Moving people is a dialog: who, picked from
    a list that can be searched as a task's assignees are, to which
    schedule, and from when;
  - the holidays have their year picked with a labelled select. The
    public ones are boxes ticked while observed, with Worked through
    beside one that isn't; the company's own each have Remove, and Add
    holiday is a dialog;
  - every change is made in the building blocks' dialog, each error under
    its field with the focus on the first. A break that isn't a whole
    number of minutes is said to be wrong, where it was sent as 0;
  - withdrawing a change, archiving a schedule and removing seasonal
    hours or a holiday each ask first, saying what it does, with the
    button in the danger colour. Withdrawing a move and removing a
    holiday used to happen at once;
  - a range of times or dates is written as the page's language writes
    one, "من 09:00 إلى 17:00" in Arabic, where a bare dash let the
    direction swap its ends; and the " · " between facts is gone.
- **2026-11-02:** Found in the browser and the interface audit on #162:
  - in Arabic, the calendar's times, its break minutes and a night
    shift's "(+1)" were in Latin digits, beside dates and counts in
    Arabic-Indic ones. They're in the page's digits now (`DESIGN.md`
    §3.3);
  - a schedule's name inside a sentence, such as "Office, the default"
    or "Night shift from 1 Dec 2026", wasn't kept apart from the words
    around it, so a name ending in a number or a mark could swap places
    with them in Arabic. It's isolated now, as in the card's title;
  - the holidays' year select had no name.
- **2026-11-02:** Company settings part 3a was merged in #162. The
  attendance policy moves onto the building blocks in #163, with the
  dialog that changes it, which the policy templates page shares:
  - the policy is a card saying what it's for, with the policy in force
    as details: since when, the working days, and each rule in lines of
    its own words, its grace, each band ("16 to 30 min: ¼ day"), the
    free ones and the cap. They were one run of facts joined by " · ",
    with a "→" in each band;
  - its numbers are in the page's digits, as its dates were, and its
    counts in the page's language: "1 day for each day absent", where
    it said "1 day(s) per absent day", and "4 hours a month";
  - Change policy and Start from a template are the card's buttons.
    Start from a template was a select whose first option was its label;
    it's a dialog now, each template with what it's for under its name;
  - the policies to come are listed under Changes to come, each
    withdrawn after asking in the building blocks' dialog, which stays
    open until it's done;
  - the dialog groups each rule under its heading with a box to switch
    it on, each field labelled above it with its hint or error below.
    An empty cap or limit says in its hint that it means none, where a
    placeholder said so;
  - each band is named by where it starts, for its end, its cost and
    Remove, and the last says it runs on;
  - every number is checked under its field before anything is sent,
    with the focus on the first that's wrong. An emptied field was sent
    as 0, which the server refused in English, or saved: an emptied
    grace became none. The server's own checks, the shortest permission
    longer than the longest or than the month's hours and no kind of
    permission left, are said under their fields too. A field left
    wrong in a rule switched off keeps the number it had;
  - the preview on last month is a group of its own, each person a row
    saying what they'd lose now and under these rules, where it was a
    table; and it checks the rules first, as saving does;
  - a template's name is asked for under its field, where Save stayed
    off until one was typed.
- **2026-11-02:** Found in the browser and the interface audit on #163:
  - a card's head didn't wrap, so the policy's Start from a template and
    Change policy ran past the card's edge on a phone and widened the
    whole page, a dialog opened from it too. A head with more than one
    button wraps them under its title now;
  - each band's start, end, cost and Remove were one line, which didn't
    fit: Remove fell to a line of its own on a computer, and a phone cut
    a cost short ("نصف يو"). A band says where it starts, with Remove, on
    one line, and its end and cost share the line under it;
  - the focus on the first field that's wrong went to the first control
    in its field, which for a band is now Remove. It goes to the control
    marked wrong, the band's end;
  - a band after one whose end came before its start said it started
    there ("From minute 11" under "From minute 16"). It doesn't say where
    it starts until the end before it is right;
  - the preview wrote its month as "2026-10", in Latin digits in Arabic
    too. It's "October 2026", "أكتوبر ٢٠٢٦";
  - the dialog's number fields had no names.
- **2026-11-02:** Found by Codex on #163: the policy dialog took a grace
  and an overtime minimum of up to 240 minutes, where the policy takes
  up to a day. A saved policy with a longer one was refused under its
  field, so it couldn't be saved again without changing it. Each field
  takes the policy's own range now.
- **2026-11-02:** Company settings part 3b was merged in #163. The four
  panels above the Attendance tab's policy move onto the building blocks
  in #164, the last of the tab:
  - attendance in payroll is a card saying whether attendance reaches
    pay and from which month. The month is a labelled field with the
    earliest under it; one missing, or before the earliest, is said
    under it, where Use attendance in payroll stayed off. Using it and
    stopping it ask first in the building blocks' dialog, which stays
    open until it's saved;
  - face verification's legal readiness says whether it's confirmed in
    a badge, with the day in the page's language, where it showed the
    date as stored ("2026-10-05"). The card stands out while face checks
    are paused. Confirming and withdrawing ask first, withdrawing in the
    danger colour;
  - the fingerprint terminals list the agents and the terminals as rows,
    each with its state as a badge, its facts joined as the language
    joins them, and what can be done to it in a menu named for it. A
    terminal's reading mode was a select in its row, changed as it was
    picked; it's in the terminal's Edit dialog with its name now, and
    its row says it. The one-time code is shown large and spaced, chosen
    whole with one click. Revoking and retiring ask first;
  - the check-in places list each place as a row, its radius, office
    IPs and who, with its map, and a menu named for it. The place
    dialog's fields each have their label above and their hint or error
    below; a missing name, a point that isn't one, or a radius outside
    20 to 5,000 metres is said under its field, where Save stayed off.
    Who may check in there is picked from a list that can be searched,
    as a task's assignees are. "↗" after the map link is gone, and "1
    people" says "1 employee";
  - each panel says when it didn't load, with the server's reason and
    Try again. Three showed nothing at all, and the places' said
    "Something went wrong" beside their title, without the server's
    reason. One the package doesn't have still isn't there.
- **2026-11-02:** Found in the browser and the interface audit on #164:
  - a link in a row's detail, such as a check-in place's map, was the
    browser's own blue. It's in the link colour, as a detail's is;
  - a row's facts, a host name, a version, a serial number or a
    person's name among them, weren't kept apart from each other, so
    one ending in a number could swap places with the words beside it
    in Arabic. Each is isolated now;
  - with no terminal yet, how a terminal reads scans ran on from "No
    terminal yet" as one paragraph. It's said once there's a terminal,
    and in its Edit dialog;
  - a place's point opened a decimal keypad on a phone, which has no
    comma or minus, so a point couldn't be typed there; the old panel
    asked for it the same way. It takes text now;
  - the place dialog's title, editing one, said only "Edit". It names
    the place.
- **2026-11-02:** With #164, 26 of the old confirm windows are left,
  where the test that each keeps its window open until its work is done
  checked its search by finding more than 30. It checks now that it
  finds every one written, however many are left.
- **2026-11-02:** Found in the browser on #164: a terminal's or a
  place's facts read "150 m , Everyone , Map", with a gap before each
  comma. A row's detail line puts a gap between its children, for its
  icon, and each fact and comma was a child of its own. They're one
  line of text in one span now.
- **2026-11-02:** Found in Codex's review of #164:
  - New code and Move to another PC, and a terminal's or a place's
    Restore, act straight from the menu, and could be chosen again
    before the first one was done. Each new code replaces the last, so
    the slower answer could leave a code on screen that no longer
    works. The old buttons were greyed while busy; these menu items
    are now too, and the panel sends one change at a time;
  - a refresh that failed after a panel had loaded swapped the whole
    panel for "didn't load", closing a half-done edit of a terminal or
    a place and losing it. The terminals refresh every minute, and
    every panel refreshes when the window comes back into focus. Once
    loaded, a panel keeps what it had, and anything open in it, and
    says it couldn't refresh, with Try again. "Didn't load" is for a
    panel that never loaded.
- **2026-11-02:** Company settings part 3c was merged in #164, which
  finishes the Attendance tab. Part 4, the Super Admin's own tabs, is
  split in two, as part 3 was: Roles carries the role editor, which the
  role templates page shares, and its copy and access review panels,
  so it goes on its own. Admin access and Modules move onto the
  building blocks first, in #165:
  - Admin access is a card with the switch, its explanation under it
    and starting where its label does, and the tabs to show as
    checkboxes in a group of their own, greyed while the switch is off.
    Save is the building blocks' button, off until something changes;
  - Modules is a card with a field for each module, labelled with the
    module's own name, where the boxes had only a placeholder for a
    name. Each icon is a button named for its module, "Choose an icon
    for Clients", where all nine said "Choose an icon";
  - an icon is picked in the building blocks' dialog, where it was a
    panel floating under the field: the palette, with the one in use
    marked as chosen, a field for any emoji pasted in, and the module's
    own icon. A pasted one that isn't an emoji, or nothing, is said
    under the field, where it was a toast;
  - the side bar preview is drawn on the side bar's own ground, as the
    logo's is, its group headings at the side bar's size;
  - Reset all and Save are the building blocks' buttons.
- **2026-11-02:** Found in the browser and the interface audit on #165:
  - the icon dialog marked the icon in use only when the company had
    chosen one: with the module's own, nothing in the palette was
    marked. It's marked either way, and picking the module's own icon
    from the palette stores nothing, the same as Use the default icon;
  - Use the default icon was among the dialog's buttons, which pushed
    Use this emoji onto a line of its own. It's a choice like the
    palette's, so it sits under it;
  - a pasted icon that isn't an emoji said only "That is not an emoji".
    It says what to do: paste a single emoji, or pick one above;
  - the line saying Roles, Modules and Admin access stay the Super
    Admin's wasn't tied to the tabs it's about. The group of tabs is
    described by it now.
- **2026-11-02:** Company settings part 4a was merged in #165. The
  Roles tab is split in two: its role editor and permission matrix,
  which the role templates page shares, go on their own as part 4c.
  The rest of the tab moves onto the building blocks in #166:
  - the roles are a card's rows, with Export, Copy roles from and New
    role in its head. Each says what it is in badges (built in, locked,
    the default for new accounts) and one line of facts: what a role of
    the company's own is based on, how many hold it and how many
    permissions it has, as the language counts them, where it read
    "1 people";
  - what can be done to a role is in a menu named for it: Edit,
    Preview, Make default and Delete, only where they apply. They were
    four links side by side on every row;
  - deleting asks first in the building blocks' dialog, in the danger
    colour, which stays open until it's done; it closed even when the
    delete failed. The roles say when they're loading, and when they
    didn't load, with Try again, where the card showed no roles;
  - copying roles from another company is the building blocks' dialog,
    the company a labelled field. Copy with none chosen says so under
    it, where the button was off without a word, and companies that
    didn't load say so, with Try again;
  - the periodic access review is a card of its own under the roles: the
    switch with its explanation under it, how often as a labelled field,
    greyed while it's off, and the next review's day in the page's
    language.
- **2026-11-02:** Found in the browser and the interface audit on #166:
  - the access review's interval said "1 months", and in Arabic "3 أشهر"
    with a Western digit beside a date in Arabic digits. It's counted as
    the language counts, "1 month", "٣ أشهر";
  - while the companies to copy from load, the copy dialog's list said
    only "Choose a company". It says they're loading under the field.
- **2026-11-02:** Company settings part 4b was merged in #166. The role
  editor and its permission matrix, which the Roles tab and the role
  templates page share, move onto the building blocks in #167, the last
  of company settings:
  - the editor is the building blocks' dialog: a template to start from,
    the name, description and base role as labelled fields, the base
    role's explanation under it. A built-in role's name shows in the
    page's language and is kept; a held role's base is kept;
  - Save says what's wrong under the field: a role with no name, or a
    new pair of duties auditors look for not kept on purpose. Save was
    off without a word in both;
  - the pairs auditors look for, and how many people a change reaches,
    are notes of their own in the dialog, with their meaning's bar, the
    count as the language counts it ("This affects 1 employee", where it
    read "1 people");
  - the built-in Admin says why it can't be changed and offers only
    Close, where Save was there and off;
  - the permission matrix's groups are rows that open, as a person's pay
    on Payroll does, with how many of each group are held. Each
    permission is a checkbox named for it, its risk a badge, its scope a
    select named for the permission ("Scope: See employees"), where every
    scope select was only "Scope";
  - what greys or marks a permission is said under it: not in the
    company's package, needed by another, or different from the template
    it was copied from, where the last two were only a tooltip.
- **2026-11-02:** Found in the browser and the interface audit on #167:
  - in the building blocks' 440px dialog, each permission's scope
    wrapped under it, doubling the list on a computer. The role editor's
    dialog is up to 640px wide, so the scope sits beside it (`DESIGN.md`
    §5.5, Dialog); on a phone it's under it still;
  - why a permission is greyed or marked (needed by another, not in the
    package, different from the template) wasn't tied to its checkbox,
    so a screen reader on a greyed box didn't say why. It is now.
- **2026-11-02:** Company settings part 4c was merged in #167, which
  finished company settings. The Super Admin's pages follow, a side bar
  group (§2.2) at a time, Templates first in #168: the role templates
  and attendance policy templates pages, whose editors moved with
  company settings:
  - each has the page header with New template, where the page's name
    was the old top bar's and the button sat alone above the list;
  - the templates are rows in a card, each with a menu named for it
    (Edit, Offer this change or Copy, Delete), where every card had its
    own links or buttons side by side;
  - a role template's row says what it's based on and how many
    permissions, counted as the language counts. A policy template's
    says the policy in words: its other name, the working days,
    lateness, absence and permission hours, each a fact of its own,
    where they ran together with " · " and said "1 day(s)" and "Off";
  - what a template is for is a note under its row, a new part of a row
    (`DESIGN.md` §5.5, Rows);
  - deleting one asks first in the building blocks' dialog, in the
    danger colour, saying what becomes of the companies' copies, and
    stays open until the delete is done. The old window closed even
    when the delete failed;
  - each page says while its templates load, and when they didn't with
    the server's reason and Try again, where a failed load said there
    were no templates yet;
  - offering a role template's change is the building blocks' dialog,
    named for the template, a box for each company role with what
    applying it would change, a scope change in words ("from Their team
    to Whole company", where it was drawn with an arrow). Apply with
    nothing picked says so under the list, where the button was off
    without a word, and the dialog says while the roles load and when
    they didn't.
- **2026-11-02:** Found in the browser and the interface audit on #168:
  - after Apply in the template offer dialog, which stays open to show
    what changed, the busy button had turned itself off and the browser
    dropped focus to the page, so Escape and Tab no longer reached the
    dialog. Focus goes back into the dialog once it's done (made general
    in Codex's review, below);
  - the templates sat in a card with no title, which kept its padding
    above the first row as an empty strip. They're a panel of rows (the
    `Rows` block) now;
  - a description written in English, under an Arabic page, put its full
    stop at its start. It's kept in its own direction;
  - lateness's grace read "٥ دقيقة" in Arabic, where Arabic says ٥ دقائق.
    Minutes are counted as each language counts them ("Lateness grace:
    5 minutes", "مهلة التأخير: ٥ دقائق");
  - a company role already the same as the template had its box greyed
    but its words not. They're greyed too.
- **2026-11-02:** From Codex's review of #168: a delete that failed left
  its dialog open, as it should, but the busy Delete had turned itself off
  and the browser dropped focus to the page, so Escape no longer closed
  it and Tab walked the page behind. It's what Apply did in the offer
  dialog, so it's fixed once for every dialog: the building blocks'
  dialog (and the older windows, through the same `useDialog`) takes
  focus back to itself when it's redrawn with focus lost to the page,
  once its first focus is placed. The offer dialog's own fix gave way to
  it.
- **2026-11-02:** The Super Admin's pages part 1 was merged in #168. The
  Access group follows in two parts, the first in #169: role change
  requests and access reviews. Each list serves both sides, the Super
  Admin's own page and a company's Roles and access page, so both move:
  - the Super Admin's two pages have the page header, where their names
    were the old top bar's;
  - asking for a role change is a card of labelled fields, the role
    picked from the ones the Admin may give, as before. Send with too
    little said says so under the field, where Send was off without a
    word;
  - each list is one card with the status to show in its head, a select
    labelled for screen readers ("All statuses"), where the statuses
    were pills of their own colours. A list with one filter and no search
    has it there (`DESIGN.md` §5.3);
  - a request is a row: the role and its status as a badge, the company,
    who asked and when as facts, then what was asked and the response a
    line each, a row's notes (`DESIGN.md` §5.5). The facts ran together
    with " · ";
  - the Super Admin's Mark done and Decline are in a menu named for the
    request. Declining asks for the response in the building blocks'
    dialog, the request in view, the response required and said so
    under its field; it stays open until it's done;
  - each access review is a part of the card, headed with its day (and
    its company, for the Super Admin) and how many lines are left. A line
    is a row: the person, the permission, its scope and the role as
    facts, and Confirm and Request change at its end, each named for the
    line. It was a table that scrolled sideways on a phone;
  - an answered line says how and by whom, with the reason as its note;
    a person's own line says someone else answers it;
  - requesting a change is the building blocks' dialog, the line in
    view, the reason required and said so under its field;
  - the request or review a notification opened is marked with the brand
    tint for a while (`DESIGN.md` §5.5, Rows), where it had a yellow fill
    or an outline that stayed;
  - each list says while it loads, and when it didn't with the server's
    reason and Try again, where a failed load said there was nothing.
- **2026-11-02:** Found in the browser and the interface audit on #169:
  - a review's rows sat inside the card's padding, so the brand tint on
    the review a notification opened touched the names. A titled part's
    rows stretch to the card's edges, as a card's own rows do;
  - the Super Admin's menu on a request was named for its role only, so
    two companies asking for "A new role" had menus of the same name. It's
    named for the role and the company.
- **2026-11-02:** The Super Admin's pages part 2a was merged in #169. Part
  2b, in #170, finishes the Access group: the Super Admins page and Who
  can do this.
  - both have the page header, where their names were the old top bar's;
  - the Super Admins are a list, a table on computers and cards on
    phones: the name, Protected as a badge, and the email. The status
    column goes: the server sends every Super Admin as active, so its
    "Online" was never true. The dialog that only repeated a row's name
    and email goes too;
  - Edit and Delete are in a menu named for the person, offered as the
    server allows them: you edit yourself, and a protected Super Admin
    edits the others and deletes any that isn't protected. Deleting asks
    first in the building blocks' dialog, which stays open until it's
    done, where an old confirmation window said "Deleting..." on its
    button;
  - Add a Super Admin is the building blocks' dialog: labelled fields,
    the password with a button that shows it (`DESIGN.md` §5.3), gender
    as two radio buttons, and Add, where the button said "Sign in".
    What's wrong is said under its field on Add, an email someone already
    has among it. The labels are new keys in sentence case, where they
    were "First Name" and "Add Super Admin", and the delete question was
    typed in English and Arabic in the page;
  - editing says where an email changes: yours in Security settings,
    which it links to, and someone else's only by them. It linked to your
    own Security settings either way;
  - a page past the first has the building blocks' pager;
  - Who can is about the company in view, picked in the top bar as on
    every other page, as Payroll is (decided on 2026-10-31); it had a
    company select of its own. Until one is picked it says to pick one;
  - its two questions, by permission and by person, are tabs, and what's
    asked is kept in the address (`?permission=salary.view`,
    `?by=person&person=…`), so a reload or a link opens on it. They were
    a toggle, and a reload lost the question;
  - by permission: the permission is a labelled select of its groups;
    who holds it are rows in a card named for it, each person with their
    role and scope as facts, where it was a table that scrolled sideways
    on a phone;
  - by person: the person is found by a labelled search, which asks the
    server once the typing stops, and picked from radio buttons in a box
    that scrolls; what they may do is a card named for them, the role
    they have it through as its note, the permissions group by group as
    rows. A person of another company isn't shown when the top bar
    changes;
  - each answer says while it loads, and when it didn't with the
    server's reason and Try again, where it was a spinner and a failed
    load said nobody held it;
  - 8 labels only the old pages used, and the --info-bg-indigo-subtle and
    --accent-deep colours only the Protected badge used, are removed.
- **2026-11-02:** Found in the browser and the interface audit on #170:
  - renaming yourself on the Super Admins page left your old name in the
    top bar until you signed in again, as the old page did. Your session
    takes the new name when it's saved, as your profile's does;
  - the box of people on Who can lists the first 20, and said nothing
    when there were more. With 20 listed, the search's hint says to type
    a name to find someone else;
  - the email in the edit dialog was set left to right, unlike every
    other field on the page. It follows the page, as the add dialog's
    does.
- **2026-11-02:** The Super Admin's pages part 2b was merged in #170, which
  finished the Access group. Customers follows, in three parts: the
  Companies list first, in #171, then a company's payments with Packages,
  then All users.
  - the Companies list has the page header, Add a company in it, where its
    name was the old top bar's;
  - it still opens on the companies that need attention. That and All
    companies are tabs, each with how many it holds, and the one shown is
    kept in the address (`?show=all`), where they were a toggle a reload
    forgot;
  - a filter bar finds a company by part of its name, which the list had
    no way to, and holds the sort, soonest date first or by name. The
    tabs' counts stay the whole list's;
  - the list is a table on computers and cards on phones: the company,
    Banned as a badge; its subscription as a badge in its meaning's colour
    (`DESIGN.md` §2.3), its date and how far off it is, and Unpaid record
    when there's one; its package and what it grants, or Core only. The
    Status column, which said "Active" of every company not banned, goes;
  - each company's settings, payments, Edit, Ban or Unban, and Delete are
    in its menu, named for it. They were five buttons of their own
    colours, the settings one only a gear;
  - adding and editing are the building blocks' dialog: the name, said
    under its field when it's too short or taken; the trial when it's new,
    the day it ends as its hint; the package. A package change that failed
    after the name saved is said, where it was dropped without a word;
  - banning asks first in the danger colour, saying what it does to the
    company's people, and lifting a ban asks too; deleting asks in the
    building blocks' dialog, and the authenticator code is asked for as
    before. Each stays open until it's done;
  - the pager says how many, and the list says while it loads, and when it
    didn't with the server's reason and Try again. Nothing needing
    attention is said, with a way to all of them;
  - 29 labels, and the --danger-bg-tint and --danger-fill-hover colours,
    only the old page used, are removed; the subscription states' colours
    of their own are the meaning colours now.
- **2026-11-02:** Found in the browser and the interface audit on #171:
  - the subscription's badge was set in from the start of its line, as a
    badge beside a name is. Badges that start a line have a line of their
    own;
  - on a phone, Banned was in the card's foot, away from the name the
    table puts it beside, and the package's line had a gap before its
    comma ("Growth , HR"). Both read as the table does;
  - two trials ending on the same day said 4 and 5 days: the server's
    count rounds hours up. The days are counted on the calendar to the
    date shown;
  - a tab's count was on a pill the colour of the page, so it couldn't be
    seen unless its tab was selected. It's in the neutral badge's colours.
- **2026-11-02:** From Codex's review of #171:
  - a search, tab or page that failed to load left the last one's rows up
    under it, with no word and no Try again. Each answer says what it was
    asked for, as the other lists' do, and one that failed says so; a
    failed refresh of the rows on screen leaves them up;
  - renaming the only company on page 2 out of the search left an empty
    page saying nothing matched. Fewer pages than the one shown goes back
    to the last there is, as a deletion already did;
  - a package refused after the name saved left the old name in the list,
    and trying again from that row renamed the company back. The list
    shows the name that saved, and the dialog stays for another try.
- **2026-11-02:** The Super Admin's pages part 3a was merged in #171. A
  company's payments and the Packages page move onto the building blocks
  in #172:
  - a company's payments are named for it in the page header, under a
    link back to Companies, with Add a payment in it. The page had a back
    arrow drawn of its own, and the company's name in a line under
    "Payment History";
  - the payments are a table on computers and cards on phones: what each
    pays for and when it was added, its amount, the period it covers or
    that it starts when it's paid, and Paid or Unpaid as a badge in its
    meaning's colour (`DESIGN.md` §2.3). A lifetime one says it never
    ends;
  - amounts are in dollars, written in the page's language and digits,
    where a dollar sign was put before a number;
  - an unpaid payment's Mark as paid asks first, saying the period it will
    pay for, worked out as the server will, and that a paid payment can't
    be deleted. It was done on one click. Deleting one asks in the
    building blocks' dialog. A paid one has nothing to do, where its row
    had a greyed "PAID" button;
  - adding one is the building blocks' dialog: what it pays for, and the
    amount, said under its field when it's missing, isn't above zero or
    has more than two decimal places. The server's reason is said, where
    it said "Something went wrong";
  - the Packages page has the page header, Add a package in it, where its
    name was the old top bar's and it waited on the session to know who
    was looking;
  - the packages are a table on computers and cards on phones: the name,
    Retired and Not listed as badges, and its description; what it
    grants, or Core only; its three prices; and how many companies are on
    it. What it grants was badges of their own colours;
  - each package's Edit and Delete are in its menu. Delete can't be picked
    while companies are on it, and says why in its label, where the
    greyed button said so only on hover;
  - adding and changing one are the building blocks' dialog: how many
    companies a change reaches, said first; the name, description and
    prices, what's wrong said under each; what it grants, the attendance
    add-ons greyed without HR and saying why; whether it can be given to
    companies and whether it's listed. A name that's taken is said under
    the name, and anything else the server refuses as it said it;
  - each list says while it loads, when it didn't with the server's
    reason and Try again, and when there's nothing yet;
  - 37 labels, and the --lifetime-fg colour, only the old pages used are
    removed.
- **2026-11-02:** Found in the browser and the interface audit on #172:
  - an amount typed in Arabic digits, as an Arabic phone's number pad
    types them, was refused as not a number. Amounts and prices are read
    in either digits, and the Arabic decimal mark, as the attendance import
    reads them;
  - in Arabic, the dollar sign turned round: "US$" read "$US" in a
    right-to-left line. Amounts say USD after the number, as Egyptian
    pounds say ج.م;
  - on a phone, a package's description was in its card's foot, by the
    menu and away from its name. It's the first line under the name, as
    in the table;
  - the package dialog's boxes were a field's gap apart. They're a group
    of choices, spaced as radio buttons are;
  - the amount field's placeholder only said what its label and its
    example already do, and goes.
- **2026-11-03:** From Codex's review of #172:
  - the period Mark as paid promised was worked out in the browser, in
    its timezone, and the one saved on the server, in its own, so near a
    month's end or midnight they could be days apart. The server says the
    period with each unpaid payment, from the same rule it saves by, and
    the list is asked again as the dialog opens.
- **2026-11-03:** The Super Admin's pages part 3b was merged in #172. All
  users moves onto the building blocks in #173, which finishes the
  Customers group:
  - it has the page header, with a way to the Super Admins, who have their
    own page (§2.2). They were a table of their own on this page's first
    page, and only there;
  - it's the Super Admin's only, as the side bar has it. Anyone else who
    opened its address was shown their own company's people;
  - the people at work and those who have left are tabs, the one shown
    kept in the address (`?show=left`). Those who had left were a window
    of their own, reached only from the last page;
  - a filter bar finds someone by name, email or company, and narrows the
    list to one company;
  - the list is a table on computers and cards on phones: the person and
    their email, their name opening their profile; their company, or No
    company; their username; their role; their points, an Admin's none, as
    on the Employees list; and whether they're online, as a badge in its
    meaning's colour, in the words and colours the Employees list uses,
    now from one place (`lib/person-status.ts`). It was a table a company,
    in colours of its own;
  - someone who has left is shown by the email they had: deleting someone
    renames them "Ghost User", and their username is a placeholder. Their
    profile opens from their email, and Delete for good is in their menu.
    It asks first in the building blocks' dialog, then for the
    authenticator code as before, and says the server's reason when it
    won't, such as cash advance money they still hold. A success said so
    in a window of its own, and a refusal in words made in the browser;
  - the pager says how many, and the list says while it loads, when it
    didn't with the server's reason and Try again, and when there's no
    one;
  - 13 labels, and the --warn-bg-yellow, --warn-fg-yellow and --warn-fill
    colours, only the old page used are removed, and the page's name is in
    sentence case.
- **2026-11-03:** From Codex's review of #173:
  - picking another company, or the other tab, left the last one's rows up
    until the next ones came, so the people at work could be drawn as
    Left rows, each with Delete for good. The rows are kept only within a
    tab and a company; across them the list says it's loading.
- **2026-11-03:** The Super Admin's pages part 3c was merged in #173,
  which finished the Customers group. Operations follows a page at a
  time, Check-ins first, which moves onto the building blocks in #174:
  - it has the page header. Its title was set in the old top bar;
  - it knows who is looking from the first paint, where it waited on the
    session;
  - what waits for the Super Admin and the last 30 days' counts are
    sections of their own, each a table on computers and cards on phones,
    where they were two glass panels with tables of their own;
  - each check-in waiting shows its company, whose it is and their phone,
    the day and time as the language writes them, in or out and the place
    it was checked against, why it waits in a sentence, and how far, how
    exactly, the network, the app check and the map. The time was the
    stored text, "2026-11-02 08:57", and the parts were split by " · ",
    which reads as the digit zero beside an Arabic number;
  - Accept and Reject name whose check-in they're for. Rejecting asks in
    the Requests page's dialog, which says whose check-in and when, and
    takes a reason; the face photos are in the row's menu where the face
    check failed, as on the Requests page. A refusal says why, as there:
    a check-in decided already, or a month whose payroll is approved;
  - each company's counts are numbers in the language's digits, with why
    each was flagged or refused, the most first, and a company's refusals
    stand out as a badge in the problem colour;
  - the page says while it loads, and when it didn't with the server's
    reason and Try again, where it said "Something went wrong" in place of
    the page; and when nothing waits, or the app has sent nothing yet;
  - a label only the old page used is removed.
- **2026-11-03:** Found in the browser and the interface audit, on #174:
  - on a computer, the reasons' long lines squeezed the company and the
    person onto two lines each, and why each company's check-ins were
    flagged or refused sat end-aligned under each count. Names stay on
    one line, the counts are numbers alone, the accepted ones among them,
    and why follows them in a column of its own, a line for flagged and a
    line for refused;
  - the network address a check-in came from and the app check's own
    words are kept as they are: left to right, and never translated, as a
    code is.
- **2026-11-03:** The Super Admin's pages, Operations part 1, was merged
  in #174. Audit logs moves onto the building blocks in #175:
  - it has the page header, its name in sentence case, which the side bar
    shares. Its title was set in the old top bar;
  - a filter bar finds an entry by its item's ID or an error's code, sent
    once typing pauses where every letter asked again, and narrows by who
    did it, what it was on, what was done and when. The Super Admins can
    be picked too, whom the old list didn't offer. The filters were a
    pop-up of their own, with Show results;
  - what's picked is kept in the address, so a link such as the
    dashboard's System errors lands filtered, as it did, and the filters
    stay on going back;
  - a calendar day picked is the whole of that day in Cairo, as every
    other list's is. It was midnight UTC, so a range "to 3 November" left
    the 3rd out (`AuditLogService.getMany`, from `lib/day-range.ts`). A
    moment, as the dashboard's link sends, is still that moment;
  - the list is a table on computers and cards on phones: when; what was
    done, as a badge in its meaning's colour, a deletion a problem and a
    creation good; what it was on and its ID, kept as it is; who did it,
    a Super Admin, a person and their role, or the system's own jobs, in
    the reader's language where they were in English or Arabic typed in;
    and what changed, its first three details and the rest, such as an
    error's stack trace, behind Show more, where they scrolled in a box;
  - the pager says how many entries there are, where the old total
    guessed from the pages, and the list says while it loads, when it
    didn't with the server's reason and Try again, and when nothing has
    been logged or nothing matches. Rows stay up only while the next page
    loads, not under another filter;
  - it asks the server nothing for anyone but the Super Admin, where it
    asked for every user's list for whoever opened it;
  - `AuditLogFilter`, eight labels and the --info-bg-indigo-faint and
    --accent-deepest colours only the old page used are removed.
- **2026-11-03:** Found in the browser, on #175:
  - Postgres keeps an entry's details shorter names first, so an error's
    stack trace came before its message and was one of the three shown,
    the message behind Show more. The three shown are short, one-line
    details; a long one, or a field's own fields, waits behind Show more,
    the shorter first;
  - "Super Admin" broke onto two lines in the By column; a name stays on
    one;
  - in Arabic, the pager counted the entries with the cash advance's word,
    حركة, a movement of money. They're إدخالات, a word of their own.
- **2026-11-03:** Found in the interface audit, on #175: an item's ID or an
  error's code is found whole, which the field didn't say, so a part of
  one found nothing with no next step. Where none matches, the list says
  to paste all of it, as it's shown.
- **2026-11-03:** From Codex's review of #175: on page 8, picking a
  company in the top bar with 3 pages kept page 8, and its empty answer
  read "Nothing has been logged yet", with no pager to go back by.
  Another company starts from its first page, as another filter does, and
  a page past the last, as an old link could give, goes to the last there
  is; meanwhile the list says it's loading.
- **2026-11-03:** Also on #175, as asked: the audit log's 208 labels in
  Title Case ("User Logged In", "All Creations", "Day Off Request") are in
  sentence case, as every other label is (`DESIGN.md` §3.4): "User logged
  in", "All creations", "Day off request". The role names (Super Admin,
  Team Leader), the Mobile App add-on and acronyms (ID, HQ, IPs) keep their
  capitals, as they do everywhere. They're the action badges, the filters'
  options and the details on the audit log, and coded values the
  Attendance, Payroll, Requests and Check-ins pages show too, such as a
  permission's type. Arabic has no capitals and is unchanged.
  `lib/audit-labels.test.ts` checks every one.
- **2026-11-03:** The Super Admin's pages, Operations part 2, was merged
  in #175. System health moves onto the building blocks in two parts, the
  page and its maintenance cards first, in #176:
  - it has the page header, its name in sentence case, which the side bar
    shares. Its title was set in the old top bar;
  - it's the Super Admin's only, and asks the server nothing for anyone
    else. It had no check of its own: anyone who opened its address saw
    its cards, empty;
  - its parts are sections: what's running, the scheduled jobs and the
    terminals, first; then housekeeping, with the stored files, the audit
    log and the notifications; then backups and recovery; then
    maintenance mode. They were nine cards in one grid, each with an
    emoji for an icon and sizes and colours typed in;
  - each count is a number in the language's digits, with what it counts:
    the files stored, or that storage can't be reached, where it showed
    "—"; and the audit log's entries and the notifications sent, with how
    many are old enough to delete and how old that is. A delete is in the
    danger colour, says how old, and is offered only where there are some;
  - finding the files nothing refers to is a look, and deletes nothing, so
    it no longer asks first, as if it would. What it finds is listed in
    the card, how many of how many and how much, each path as it's
    stored, where they ran in a box of their own making;
  - what can't be undone asks for a word typed first, as it did:
    restoring a backup, the latest or one picked, asks for RESTORE, and
    deleting the files found, for DELETE. The word is shown as the code
    has it, and the button stays off until it's typed (`DESIGN.md` §5.5,
    Dialog). Deleting old entries or notifications says how many, and
    backing up and maintenance mode ask without a word, as before. They
    were the old confirmation window;
  - maintenance mode says whether it's on as a badge, and while it's on a
    card above the sections says so, where it was a yellow strip of its
    own. Its message is a field with its label, and says how much of it
    is used;
  - results are toasts, each saying what was done, such as "Deleted 340
    entries", or why it wasn't, such as up to 3 backups an hour. They
    opened a window each (`NoticeModal`, which is removed);
  - the counts and maintenance mode say while they load, and when they
    didn't with the server's reason and Try again. The whole page was a
    spinner until the counts came;
  - labels only the old page used are removed, and its others are in
    sentence case: "Back up now", "Restore the latest backup", "Turn on
    maintenance mode". So are the --warn-border-yellow colour only it
    used, and --ok-solid, --ok-solid-hover and --ok-fg-strong, which only
    `NoticeModal` used.
- **2026-11-03:** Found in the interface audit, on #176:
  - the list of files nothing refers to scrolls within itself, but
    couldn't take focus, so it couldn't be scrolled from the keyboard. It
    takes focus now, named for what it lists;
  - a backlog can be thousands of files, every line drawn at once; only
    the lines in view are drawn;
  - a backup, a restore or maintenance mode that didn't start said only
    that. Each says what to do next: try again, and for a backup or a
    restore, start it from the GitHub Actions tab.
- **2026-11-03:** Found in the browser, on #176:
  - maintenance mode was named twice, the section and its one card titled
    the same one under the other. The card has no title now, and whether
    it's on is beside the section's;
  - in the questions, the field for the word and the buttons sat against
    the sentence and each other. They're spaced as every dialog's form is;
  - what a look for unused files found ran into its buttons. Its title,
    what was found, the list and the buttons are spaced apart.
- **2026-11-03:** From Codex's review of #176:
  - once a restore or a delete was confirmed, Cancel and Escape still
    closed the question while the work went on, so it looked called off
    and wasn't. Neither closes it until the work is done, as the old
    confirmation window kept it;
  - the backup picker, closed while its list loaded, opened again when
    the list came, over whatever had opened since. A closed picker stays
    closed, and only the list asked for last is shown.
- **2026-11-03:** The Super Admin's pages, Operations part 3a, was merged
  in #176. System health's scheduled jobs card, terminals card and backup
  picker move onto the building blocks in #177, which finishes the page:
  - the scheduled jobs card lists the backup and then each job as a row,
    its state as a badge in its meaning's colour: working, failing, or in
    the problem colour when it has never run, is overdue or has failed
    three times running, the row marked too. Each job is named in the
    reader's language, where its name came from the server in English,
    with how often it runs and when it last worked, in the language's own
    words ("2 hours ago", قبل ساعتين) where it was "2h ago". A job's last
    error is written under it, where it was a tooltip only a mouse could
    reach. The backup's two reds, Drive unreachable and no recent
    backup, keep their own words;
  - the terminals card lists each company as a row, its state as a badge
    and what's wrong fact by fact, in the language's digits, where the
    facts were joined by " · ". When it didn't load it says so with Try
    again, where it disappeared;
  - the backup picker is a dialog listing each backup by its name as
    it's stored, which kind, when (in Cairo, as every other time) and how
    big, with Restore on its end side, named for which backup to someone
    hearing the list. It says while it loads, when there are none, and
    when Google Drive didn't answer, with Try again;
  - each card says while it loads, and when it didn't with the server's
    reason and Try again;
  - their emoji, sizes and colours typed in, and the "h ago" and "d ago"
    labels are gone, and their labels are in sentence case.
- **2026-11-03:** Found in the browser, on #177:
  - when Google Drive didn't answer, the picker said it "may not be set up
    on Vercel yet", where the server had said it couldn't be reached. It
    says it couldn't load the backups, with the server's own reason under
    it;
  - in Arabic, an agent's English name and its state could swap places,
    the two one run of text. The name is a run of its own.
- **2026-11-03:** Found in the interface audit, on #177:
  - the jobs card asked once, while its times ticked on, so a job that ran
    since still read late until the page was opened again. It asks again
    every five minutes, as each ask lists the backups on Google Drive;
  - the terminals card said "Something went wrong" when it didn't load. It
    says it couldn't check the terminals.
- **2026-11-03:** The Super Admin's pages, Operations part 3b, was merged
  in #177, which finished System health. System settings moves onto the
  building blocks in two parts, the page and its four forms first, in
  #178:
  - it has the page header, its name in sentence case, which the side bar
    shares. Its title was set in the old top bar;
  - it asks the server nothing for anyone but the Super Admin, where it
    asked for the settings for whoever opened its address;
  - its cards are in three sections: defaults (the auto-verify distance
    and the default calendar), security (the high-risk confirmation's
    minutes and face checks), and branding (the "Powered by" signature and
    the default brand colour). They were one grid of forms of their own
    making, with sizes and colours typed in;
  - each form has its fields with their labels above them and their range
    below, in the language's digits, a wrong number said under its field
    and focused where it was a toast, and Save on the card's end side,
    off until something changes. Each still sends only its own fields;
  - the default calendar is picked from the zones a company's calendar
    is, a stored zone that isn't among them kept, where it was typed into
    a box. The shortlist is one, in `lib/timezone.ts`;
  - the signature's preview is a figure named as one, and the signature's
    letters aren't spaced apart in Arabic, where they join;
  - edits not yet saved are asked about before leaving the page, as
    company settings' are, the brand colour's included;
  - it says while it loads, and when it didn't with the server's reason
    and Try again, where a toast said so over forms left empty.
- **2026-11-03:** Found in the browser, on #178: a wrong number was said
  with its range typed in, Western digits in Arabic ("بين 1 و10000") and
  10000 where the hint above it said 10,000. It says its range as the hint
  does, in the language's digits.
- **2026-11-03:** Found in the web interface audit, on #178:
  - "Show the "Powered by" signature" had straight quotes, beside a title
    with curly ones. It has “Powered by” in English and «بدعم من» in Arabic;
  - with the signature off, the name's hint still counted its characters,
    of a field nobody could type in. It says to turn the signature on to
    change the name (DESIGN.md §5.3);
  - the name, a brand's, had spelling marks under it and could be changed
    by a page translator. Its field and its preview leave it as it is.
- **2026-11-03:** Found by Codex on #178:
  - a number or name typed while a save was on its way was put back to
    what was saved when the answer came, with Save off, and was lost. It's
    kept, and still counts as a change;
  - a field nobody touched kept the value it opened with when a newer one
    arrived, from another card's save or a fresher read. It read as a
    change, and saving it put the old value back over somebody else's.
    Untouched, a field now follows its stored value, and an edit is left
    alone.
- **2026-11-03:** Found by Codex's second review of #178: two cards saved
  at once could have their answers come back in another order than they
  were saved. Each answer is the whole row as its save left it, so the
  older one, taken last, put the other card's field back: the calendar
  read Cairo, with Save off, while London was saved. A save's answer now
  changes only what that save sent, and the rest is read again from the
  server, which still brings what somebody else saved.
- **2026-11-03:** Found by Codex's third review of #178: typed back to what
  was stored while a save was on its way, an edit looked like no edit, and
  the answer replaced it, with Save off; the signature's switch, turned off,
  saved and turned on again while waiting, the same. Told apart by value,
  an edit back to the stored value can't be seen, so each card's fields are
  now held still until its save comes back: read-only where they're typed
  in, so the cursor stays put, and the switch and the calendar off.
- **2026-11-03:** The Super Admin's pages, Operations part 4a, was merged
  in #178. System settings' face checks switch moves onto the building
  blocks in #179, which finishes the page:
  - it's a card, its state a badge in its meaning's colour (on, paused or
    off) with a line on what that means, where it was a sentence in a
    colour of its own;
  - its buttons are the building blocks', and its questions their
    dialogs: Pause and purge asks for PURGE typed, its button in the
    danger colour. A question stays open, its button busy, until the
    server answers, and closes once it's done, where it closed whatever
    the answer;
  - it holds the room of the most it can show while it loads, as it did
    by hand, now with a building block (`Reserve`, DESIGN.md §5.5), so the
    Branding card below it still doesn't move;
  - when it can't load, it says so with Try again in the same room, where
    it said "Something went wrong"; the photo key's section says so too,
    with Try again of its own;
  - the last purge's date and counts, and the photos left to move, are in
    the language's own date and digits, where the date was typed as the
    server keeps it;
  - the purge's text no longer says to type PURGE, as the field's label
    says it.
- **2026-11-03:** Found in the browser, on #179: the photo key's count of
  photos left sat a line's height under its heading, a paragraph's own
  margin on top of the lines' gap. A card's lines are set by their gap
  alone.
- **2026-11-03:** Found in the web interface audit, on #179: the face card's
  loading line was a status, and the failure that replaced it, the card's
  or the photo key's, was nothing a screen reader would hear. Each is said
  out loud, as the loading was.
- **2026-11-03:** The Super Admin's pages, Operations part 4b, was merged
  in #179, which finished Operations. The pages left move onto the
  building blocks one at a time, Add employee first, in #180:
  - it has the page header, with a way back to the list, where its title
    was a heading of its own making;
  - its fields are the building blocks', each label above its field, and
    the password field the building blocks' own, its eye named for what it
    does, where it was drawn by hand and placed by hand on each side;
  - each mistake is said under its field, in the reader's language, the
    first one focused. They were in English whatever the language, and the
    email's described a rule it had dropped. An email somebody already has
    is said under the email, where "Username already in use" was looked
    for and never came;
  - the role is picked from the building blocks' select, the company's
    default first; the companies and the team leaders say when they didn't
    load, with Try again, where the list was left empty;
  - somebody who may not add people is told so, and nothing is asked of
    the server, where the form showed and the server refused it;
  - leaving with something typed asks first;
  - its labels are in sentence case, "First name" and "Day off credit",
    in English as elsewhere, and on the employee's page that shares them.
- **2026-11-03:** Found in the browser, on #180: an email somebody already
  has was said under the email, and the focus went nowhere, as the fields
  were still off from sending. The field it's about takes the focus once
  the form can be used again.
- **2026-11-03:** Found in the web interface audit, on #180: a name stopped
  at its 15th character with nothing to say why. Each says how much of it
  is used, as Add obligation's fields do.
- **2026-11-03:** Found by Codex, on #180: a negative pay or day off credit
  reached the server, which said only "Validation Error", as the form takes
  over the browser's own checks and these two had none. Each is checked
  before sending and said under its field, as is the server's refusal of
  either, and each is checked and sent only for a role that has it.
- **2026-11-03:** Add employee was merged in #180. Add a bonus and Add a
  deduction move onto the building blocks together in #181, as they were
  two copies of one form, and are one now (`AddAdjustment`):
  - each has the page header, saying whose pay it is ("For Mona Adel"),
    with a way back to the list, where its title was a heading of its own
    making with each side chosen by hand for each language. The name's
    line is kept while it loads, so the form doesn't move when it comes;
  - its fields are the building blocks', the days with a hint of how many
    it takes (more than 0, up to 1,000, in the language's digits) and the
    reason marked optional, where its example was a family wedding;
  - the days are checked before sending and said under the field, which
    takes the focus: more than 0, up to 1,000, and to 2 decimal places, as
    they're kept, which the browser's own step said until the form took
    over its checks. The server's refusal of them is said there too, and
    anything else as the server said it, where every refusal was "Failed
    to add bonus";
  - the deduction's button is the primary one, as a deduction can be
    undone (DESIGN.md: the danger colour is for destroying);
  - somebody who may not adjust pay is told so, and nothing is asked of
    the server, where the form showed to anybody who reached its address.
    Their own pay is said to be somebody else's to adjust, where the form
    let them fill it in and the server refused it;
  - adding it says so as a toast and goes back to the list at once, where
    it waited 1.5 seconds on "Redirecting...";
  - leaving with something typed asks first;
  - its title and button are in sentence case, "Add a bonus" and "Add
    bonus", where it was "Add Monthly Bonus (Days)".
- **2026-11-03:** Found in the browser, on #181: on their own pay, the form
  showed until the session came, then the note. Whose pay it is is asked
  of the layout's viewer while the session loads, as the permission check
  already was.
- **2026-11-03:** Found in the web interface audit, on #181: the days took
  the focus on arrival, which opened a phone's keyboard and skipped the
  card's note above them, and the reason was offered to autofill. Neither
  is now. Their own pay is said in the active voice.
- **2026-11-03:** Add a bonus and Add a deduction were merged in #181.
  Usernames moves onto the building blocks in #182:
  - it has the page header, the download a labelled button in it, "Download
    Excel", where it was two emoji in a green of its own (its token,
    `--ok-fill`, goes with it, as nothing else used it), and its title was
    set into the top bar;
  - each person is a row of the building blocks' list, their name, role and
    username, and a card on a phone, where they were cards of its own making
    with each side chosen by hand. A username is kept as typed, apart from
    the text around it and never translated, and somebody without one says
    so, where it was a dash;
  - it can be searched by name or username, as finding one person among
    everybody was by scrolling;
  - it says it's loading, as a status, and when it couldn't load, with Try
    again, where both read "No employees found";
  - somebody who may not see people is told so, and nothing is asked of the
    server, where it asked and said it had failed;
  - the Excel file says when it couldn't be made, where it failed without a
    word; its name has the day where it was downloaded ("Usernames
    2026-11-04.xlsx"), where it took the day in London; its sheet is
    "Usernames", where it had the time in it; and no username is an empty
    cell, where it was a dash.
- **2026-11-03:** Found in the browser, on #182: Clear search went with the
  search it cleared, and the focus fell to the page. It goes back to the
  search.
- **2026-11-03:** Found in the web interface audit, on #182: the search's
  example didn't end with an ellipsis, as the employees list's does, and
  how many it found wasn't said out loud, as the list changed without a
  word. Both are now. Drawing up to 1,000 people at once stays as it was,
  as companies have tens and the search narrows them, and the search stays
  out of the address, as every list's does.
- **2026-11-03:** Decided on #182: Usernames lists only the people still
  here. Somebody who has left (archived) isn't listed or in the Excel file,
  as nothing can be given to them; suspended people stay, as they're still
  on staff.
- **2026-11-03:** Usernames was merged in #182. Signing in's limit becomes
  the account's in #183 (decided 2026-11-03):
  - wrong passwords or codes lock the account, wherever they come from,
    where they locked the address: one person's
    mistakes locked everybody behind the same office Wi-Fi, while the
    person themselves could get in from their phone. There's no limit by
    address any more;
  - an email nobody has is counted the same way, so a lock says nothing of
    which emails exist; it's kept as a hash, not as typed, and the daily
    clean-up removes counts whose fifteen minutes have passed;
  - the sign-in page says it's the account that's locked, and that it
    lifts within 15 minutes or when the company's Admin unlocks it, where
    it said "Too many attempts";
  - Employees and All users say who is locked and until when, under their
    status, with Unlock named for the person. It's for whoever may reset
    their password: a Super Admin anywhere, a company's Admin for their own
    people. Unlocking is recorded in the audit log, and it also lifts the
    count of codes asked to confirm a sensitive action;
  - resetting the password with Forgot password lifts the lock, as the code
    proves the email is theirs.
- **2026-11-03:** Found in the browser, on #183: the sign-in page told a man
  what to do in Arabic, "wait" and "ask". It says the account unlocks on its
  own within 15 minutes, or the company's Admin can unlock it now, in both
  languages.
- **2026-11-03:** Found in the web interface audit, on #183: Unlock goes once
  it's done, and the focus went with it, to the page. It goes to the
  person's name, in the same row. The time a lock lifts is in the viewer's
  own time, in the language's way of writing it, as everywhere else.
- **2026-11-03:** Decided on #183: signing in's limit is more generous,
  ten wrong tries in a row where it was five in fifteen minutes. Five in a
  row pause the account for 30 seconds, and the sign-in page says to try
  again in 30 seconds; ten lock it for fifteen minutes, which is what
  Employees and All users show, with Unlock. A sign-in that succeeds starts
  the count over, and a run is forgotten fifteen minutes after its last
  wrong try. Tries turned away during the pause or the lock aren't counted,
  and tries sent all at once get no further than one at a time would.
- **2026-11-03:** Decided on #183: the sign-in page counts down the 30
  seconds and the fifteen minutes as they pass, "You can try again in
  0:27", in the language's digits, and says "You can try signing in again"
  once it's over, where it said "30 seconds" or "within 15 minutes" and
  left it to them to count. The server says how many seconds are left, so
  a phone's clock being off doesn't matter. The time is a timer, which a
  screen reader doesn't read out every second, and Sign in stays there to
  press, as an Admin may unlock the account before the time is up. The
  same goes for the step that asks for the code and for "email me a code
  instead".
- **2026-11-03:** Found by Codex, on #183: an email nobody has was counted
  with its capitals set aside, while finding the account matches it as
  typed, so five wrong tries as NOBODY@ paused nobody@ only when nobody had
  it, which said who's registered. It's counted as typed.
- **2026-11-03:** Found by Codex, on #183: after the 30 seconds, the right
  password with two-factor started them again, as giving its try back left
  the run with the right password's time, so the code was turned away. A
  try given back puts the run's time back as it was, and the code goes
  through, as does asking for it by email.
- **2026-11-03:** Found by Codex, on #183: two tries coming together while
  one was being turned away let a third through the 30 seconds, as the one
  turned away was counted for a moment before it was given back, and the
  third found six and took the pause as over. A try is counted in one step,
  only from where the count may go on, so none is counted past the pause or
  the lock.
- **2026-11-03:** Found by Codex, on #183: unlocking also lifted the count
  of codes asked to confirm a sensitive action, and an Admin could unlock
  their own account, so somebody holding an Admin's session could guess
  codes without end. Unlocking lifts only sign-in's count, and nobody can
  unlock their own sign-in, as somebody signed in isn't locked out.
- **2026-11-03:** Found by Codex, on #183: two right passwords overlapping
  after the 30 seconds, given back in the wrong order, put back the time
  the second had found, and the 30 seconds started again and turned the
  code away. Counting a try no longer moves the run's time, past the fifth
  and the tenth, which the 30 seconds and the fifteen minutes run from; a
  wrong guess moves it, once it's known to be wrong. So giving a try back
  takes back only the count, in whatever order tries come back.
- **2026-11-03:** Found by Codex, on #183: five right passwords overlapping
  after the 30 seconds reached ten, and the tenth moved the run's time, so
  given back to five, the 30 seconds started again. Only the fifth moves
  it when counted; the fifteen minutes run from the tenth wrong try once
  it's known to be wrong.
- **2026-11-04:** Found by Codex, on #183: a try waiting on the step that
  asks for the code, given back after the account was unlocked or signed in
  and a new run paused, took one off the new run, and let a guess through
  the 30 seconds. Each run has an id of its own (a new column, added only),
  and a try is given back, or marked wrong, only in the run it was counted
  in.
- **2026-11-04:** Signing in's limit was merged in #183. Each company gets
  a username code of its own in #184 (decided 2026-11-03, option 1):
  - a username Nizmo makes up is the company's code and a number, counting
    from 0, as before (ds0, ds1). The code was the name's initials, so two
    companies with the same initials shared them and took turns with the
    numbers; now no company's code is another's, and no company's usernames
    follow another's code;
  - Add a company has a Username code field after the name, filled in from
    it with a code nobody has as the name is typed, and changeable: 2 to 8
    English letters, written left to right in either language, with an
    example of its usernames under it. Edit has it too, until the company's
    first username has been given; then it's shown fixed, and renaming the
    company doesn't change it;
  - a number is never given twice, even once its person has gone, and two
    people added at once get different ones;
  - a username typed for somebody (by a Super Admin) is refused when it's
    another company's code and a number, as that company would one day make
    it up for somebody of its own;
  - the companies already there keep the letters their people's usernames
    use, carrying on after the highest number: Karavan keeps k and goes on
    at k2. One whose usernames give it none gets a code from its name the
    first time it needs one (Nizmo Test Co: ntc).
- **2026-11-04:** Found in the browser, on #184: the example under Username
  code ended "ds0, ds1….", a full stop after the "…". The example ends the
  sentence, in both languages.
- **2026-11-04:** Found in the browser, on #184: in Arabic, the example
  under Username code came out as "nt0, :0" with "…nt1" on the next line,
  English letters inside a sentence read right to left. The example is kept
  left to right.
- **2026-11-04:** Found in the browser, on #184: a Username code that's
  fixed looked like one that could be typed in. A read-only field looks like
  a disabled one (DESIGN.md §5.3), on the page's colour, and can still be
  focused and copied. System settings' fields, read-only while they save,
  look the same for that moment.
- **2026-11-04:** Found in the web interface audit, on #184: a browser
  translating the page could turn the Username code and its example into
  words. Neither is translated.
- **2026-11-04:** Found in the web interface audit, on #184: a code another
  company has, and a username in another company's run, said what was
  wrong and not what was needed. Each says the company needs letters of its
  own, or the person another username.
- **2026-11-04:** Found by Codex, on #184: changing a company's username
  code and its name together, to a name another company has, refused the
  save but kept the new code, with nothing in the audit log. The code is
  saved with the rest, so a refused save leaves both as they were.
- **2026-11-04:** Each company's username code was merged in #184. One
  username is one account, capitals aside, in #185:
  - a username is 2 to 30 letters, digits, dots, hyphens or underscores,
    starting with a letter or digit, wherever it's typed or made up: never
    an @ or a space, so signing in can tell it from an email (next). The
    usernames already given all are;
  - nobody else has it, a company's person or a Super Admin, capitals
    aside: "Ops" and "ops" are one username. That was checked only among
    company people, and not at all when a Super Admin changed somebody's,
    which then failed with an error reference. The database now refuses
    two that differ only in capitals;
  - a Super Admin added on the Super Admins page, where no username is
    typed, gets one from their email's part before the @ (-2 after it if
    somebody has it), where they got none, so a second one couldn't be
    added at all ("Email already exists", said of an email nobody had). The
    one already added that way gets theirs the same way;
  - two people given the same username at the same moment: the second is
    told it's in use, or, made up, gets the next one;
  - a person's profile sends their username only when it's been changed,
    checked first against the same rule.
- **2026-11-04:** Found in the web interface audit, on #185: a person's
  profile spell-checked, capitalised and could translate the username typed
  in it. It's typed as it is.
- **2026-11-04:** Found by Codex, on #185: a person and a Super Admin given
  the same username at the same moment would both pass the check and both
  be saved, as each table's own index sees only its own. The database holds
  a username while it's saved and looks in the other table too: the second
  is told the username is in use.
- **2026-11-04:** One username, one account was merged in #185. Signing in
  takes the email or the username in #186 (decided 2026-11-03):
  - the sign-in page asks for "Email or username". What has an @ is an
    email, matched as before; anything else is a username, matched whatever
    its capitals, as each is one account's at most (#185);
  - the limit is the account's, whichever was typed: wrong tries with the
    username and with the email count together. A username nobody has is
    counted as an email nobody has is, so neither says who's registered;
  - "Email me a code instead" takes the username too;
  - a wrong try says "The email, username or password isn't right", where
    it named only the email;
  - Forgot your password still asks for the email, as the code goes there:
    it's filled in from the sign-in page only when an email was typed.
- **2026-11-04:** Found in the web interface audit, on #186: the sign-in
  page's email or username was written right to left in Arabic, where an
  email's @ and dots jump about as it's typed. It's left to right in both
  languages (DESIGN.md §3.3), as Add employee's email is, aligned with its
  label; the Arabic placeholder has no "…", which would land at its start.
- **2026-11-04:** Found by Codex, on #186: a username nobody has was counted
  as it was typed, while finding the account sets its capitals aside. So
  five wrong tries as NOBODY, then one as nobody, paused it only when
  somebody had it, which said who's registered without a password. A
  username nobody has is counted capitals aside, as it's looked up; an
  email nobody has is still counted exactly as typed, as it's looked up.
- **2026-11-04:** Signing in takes the email or the username was merged in
  #186. Change password and the maintenance screen move onto the building
  blocks in #187 (§5 step 5, the pages left), the two screens that hold
  somebody before the dashboard. Security settings follows on its own:
  - Change password is a page header and one card, as Add employee is.
    Each mistake is said under its field, in the reader's language, and the
    first one wrong takes the focus, where both were toasts. Each field can
    show what's typed, and the new one's hint says how long it must be. It
    changes the password of the account the layout names on the first
    paint: the session's own copy could still be loading when Save was
    pressed, and then it named no account;
  - the maintenance screen's page header says what's happening and that
    they'll be taken back by themselves. The Super Admins' message, when
    there is one, is a card under it, as they typed it, where it took that
    line's place. The wrench emoji is gone, and so is the ring that turned
    by itself beside "Checking...": nothing moves unless somebody acts
    (DESIGN.md §8).
- **2026-11-04:** Found in the browser flows, on #187, and so before it
  too: once a temporary password was changed, the page came back to
  itself, the form empty, rather than opening the dashboard, and only
  reloading let them in. Signing in had gone to the dashboard, which was
  turned to Change password, and the app kept that answer: going to the
  dashboard again within the app came straight back, asking the server
  nothing. The dashboard is loaded afresh once the password is saved.
- **2026-11-04:** Found in the web interface audit, on #187: the Super
  Admins' message on the waiting page, up to 500 characters from a text
  area, ran its lines together, and a long link in it pushed a phone's
  screen sideways. It's shown as a task's description is: each line as
  typed, and a long word broken to fit.
- **2026-11-04:** Change password and the maintenance screen were merged in
  #187. Security settings moves onto the building blocks in #188 (§5 step
  5, the pages left), the last of the three:
  - the email gate has a page header saying what it's for, and the email in
    one card, as Change password has. Once the address is verified, the
    email and two-factor authentication are settings cards side by side
    under the page header, where its title was set into the old top bar;
  - each mistake is said under its field in the reader's language, where
    the browser's own bubbles said most of them, in the browser's language,
    and an address they let through, such as a@b, came back "Validation
    Error". Where a code went is said beside its field, the address left to
    right in either language, where a toast said to check the inbox;
  - Send code is on only once the address is changed: it sent the address
    already verified a code. A change made here stays here, the new address
    in place, where it went to the dashboard; verifying in the gate loads
    the dashboard afresh, as Change password does, where it came back to
    this page;
  - turning two-factor authentication off asks for the password in a
    dialog, with the danger button, where a form opened in the card. The QR
    code is named in the reader's language, where it was "QR code" in
    either, and the key to type is left to right and never translated;
  - the trusted devices are a list under their own heading. One, or all of
    them, is removed only once it's asked, where a click removed them at
    once; and a list that didn't load says so, with Try again, where it said
    there were none;
  - which state the page is in comes from the layout on the first paint.
    Read from the session hook, which is still loading then, the server's
    first copy of the page was the email gate for everybody;
  - its Arabic asks nothing in the masculine: "تحقق" (Verify) is "تأكيد",
    and the rest is said with "يُرجى" and verbal nouns;
  - a card's note breaks a word too long for it. The address a code went
    to, with no hyphen to break at, ran past the card and pushed a phone's
    screen sideways (web interface audit);
  - the server's refusals a person meets are said under their fields in the
    reader's language too, with what to do next: a taken address, too many
    codes, a wrong code and a wrong password. They came in the server's
    English as they were, "Invalid or expired code" in Arabic too (web
    interface audit).
- **2026-11-04:** Security settings was merged in #188. The last
  confirmations move onto the building blocks in #189 (§5 step 5, the pages
  left):
  - eleven still asked in the old confirmation window, of its own making:
    resetting a person's points and deleting them on the Employees list,
    Mark all as paid on Costs, archiving or deleting a client, deleting a
    records section or a record, archiving a location or a saved name, Mark
    collected and Mark uncollected, confirming a cash advance's receipt,
    and resetting a profile photo. Each is the building blocks' dialog now,
    through a confirmation of their own (DESIGN.md §5.5, Dialog), and the
    old window is gone, with the red and amber hover colours only it used;
  - the button is in the danger colour only for what deletes or can't be
    undone. Confirming a cash advance's receipt was red, the old window's
    default; resetting points, which can't be undone, was amber;
  - each stays open, busy, until its work is done, as the old window did,
    and the photo's reset is asked over the photo window, above it;
  - their Arabic asks nothing in the masculine: "هل أنت متأكد أنك تريد" and
    "هل تريد" are verbal nouns, and "لا تؤكّد" is "يُرجى عدم التأكيد". A
    client's deletion was "Are you sure you want to delete" with the name
    and a Latin question mark stuck on the end; it's one sentence in each
    language. The photo's reset says "Reset photo", where it said "Reset
    Photo" and "Yes, Reset", and "this" photo, where an admin's said "your".
  - a dialog's title and what it says break a name with no space in it,
    such as a long reference for a section or a client. On a phone the name
    ran past the dialog's edge, and the dialog scrolled sideways (web
    interface audit).
  - a dialog's button that doesn't fit on one line takes two (DESIGN.md
    §5.5, Dialog). Mark collected's "Collect 10 charges, 4,525.50 EGP" ran
    past its own edges on a phone in Arabic, as a button keeps to one line;
    the old window's buttons had wrapped. One line is as tall as ever.
  - beside Confirm receipt, a person's own cash advance asks for each one
    to be confirmed with "يُرجى تأكيد", where it said "أكّد" in the
    masculine (web interface audit).
- **2026-11-04:** The last confirmations were merged in #189. The last
  loading spinners move onto the building blocks in #190 (§5 step 5, the
  pages left):
  - five places still waited behind the old spinner, a ring of its own
    making with "Loading data..." beside it: the dashboard's wait between
    pages, the Employees list, a client's page, My cash advance and a
    person's profile. Each says it's loading the building blocks' way now
    (DESIGN.md §5.5, Loading), in the panel with the hourglass, and the
    spinner is gone, with its two words;
  - the language's switch covers the screen in the page's colour, with the
    same block, for the moment it takes. It showed the spinner there;
  - the Employees list keeps its header and filters while its people
    load, where the spinner took the whole page;
  - a client's page has its header and back link while it loads, as when
    it doesn't load, and from the first paint: who's looking comes from
    the layout, where it waited for the session hook behind the spinner;
  - My cash advance waits in the frame its history shows while it loads,
    so nothing moves when it comes.
  - the Employees list asks for its people on the first paint, who's
    looking coming from the layout. It asked only once the session hook
    had loaded, a moment later, and until then said there was nobody, with
    Add employee; another company's list said so too, until it came. It
    says it's loading instead (browser flows).
- **2026-11-04:** The last loading spinners were merged in #190. A
  person's profile moves onto the building blocks in four parts (§5 step
  5, the pages left), each a small PR: its page, its photo and a name
  change waiting; then what it shows of someone else's, as their details
  (DESIGN.md §5.5, Details), where it showed a form whose every field was
  off; then its form, each field's mistake under it; then ending a
  contract and handing over a team. Part 1, in #191:
  - the profile is a page with the building blocks' header. Someone
    else's is under their name, saying whether it's their profile or
    being edited, with a way back to Employees, as their history has; one's
    own, from the account menu, is My profile. It was a glass card with a
    title of its own. Whose profile it is comes from the layout, so the
    header is right on the first paint, and it's there while the profile
    loads, with the panel where the profile will be;
  - their photo is a building block of its own (DESIGN.md §5.5, A person's
    photo): their photo, or their initials in an avatar's colours, where
    someone with no photo had a drawn man or woman chosen by their gender.
    Beside it, where it can be changed, are the file picker for one image
    and Remove photo, which asks first: the window of its own that showed
    the photo larger before it could be changed is gone. "Reset photo"
    says "Remove photo", what it does;
  - a file that's too large, or isn't a JPG, PNG, GIF or WebP, is said
    under the picker before anything is sent. It took any image, and the
    server's refusal of one, such as a HEIC, came back in English;
  - a photo is theirs only once it's saved. The old window never looked at
    the save's answer: a refused one said "Photo updated successfully!"
    and showed the photo, which then went again with the form's Update.
    A refusal is said under the picker now, and the photo they had stays
    (found reading the code);
  - a name change waiting is a card waiting on someone, with the name
    asked for and the request on the Requests page, where it was a yellow
    box of its own making;
  - it's one's own, asked for by whose it is. The list gives whoever may
    decide name changes the company's waiting ones, unless it's asked
    whose: someone who may, in a role of the company's on an employee's
    footing, saw the first of them on their own profile, whoever's it was,
    as their own (found reading the code);
  - its words are in sentence case: Employee profile, Edit employee, and My
    profile, which the account menu says too.
  - the photo's size keeps its number with its unit: on a phone in Arabic,
    "ميجابايت" stood alone on the line after the 4 (web interface audit).
  - a file that can't be used says what to do about it, a smaller photo or
    one of the kinds it takes, where it said only what was wrong (web
    interface audit).
  - the photo and what changes it are as wide as the form under them, at
    most: on a computer, the picker's box ran on to the card's far side
    (browser flows).
- **2026-11-04:** A person's profile, part 1, was merged in #191. Part 2,
  in #192 (§5 step 5, the pages left), is what it shows of someone else's:
  - their photo and their facts, as details (DESIGN.md §5.5, Details),
    where it was the edit form with every field turned off. Each fact is
    shown to whoever the form showed it to: pay and day off credit for
    someone paid on payroll, their role and status to whoever may change
    them, and a team leader only for an employee. What decides it is in
    one place, for the view and the form (`lib/profile-access.ts`);
  - Edit is the page header's, for whoever may edit them, as the
    Employees list has it: an Admin's only for the Super Admin. There was
    no way from someone's profile to its form;
  - resetting their password is a fact of its own, with its button. It
    asks for one's own password in the building blocks' dialog, a form,
    with a wrong one said under the field, where it was said in a toast
    over a window of its own making. Saving the form asks in the same
    dialog. The temporary password is shown once, large, in a dialog of
    its own, as an attendance agent's code is, where it sat among the
    fields as one of them;
  - a reset the route refuses says why in the page's language: a role
    that holds access the viewer's doesn't, or an Admin's, which only the
    Super Admin resets. Its English came as it was;
  - its words are in sentence case: End contract, and Assigned day off
    credit.
  - End contract, and Reinstate, are offered to whoever may end a
    contract, as their route asks, where they followed changing a status:
    a role of the company's that may change a status but not end a
    contract was offered them, and refused. An Admin's are offered only to
    the Super Admin, who alone ends one (found reading the code).
  - Reset password is offered on an Admin's profile only to the Super
    Admin, who alone resets an Admin's password: another Admin was offered
    it, asked for their password, and refused (found reading the code).
  - a password that couldn't be checked, as when the server fails, says
    so, where it was said to be wrong, and retyped (found reading the
    code).
  - told a password is wrong, the focus is back in the field, to type it
    again: the field is off while it's checked, so the focus went with it,
    and there was nowhere to type (browser flows).
  - the temporary password stays on one line on a phone, a size smaller
    than a code: its 16 characters broke over two lines, and read as two
    words (browser flows).
  - the note under a fact is spaced with a logical property, as DESIGN.md
    §7 asks, and the password field says why it's focused as the dialog
    opens: it's the one thing the dialog asks for (web interface audit).
- **2026-11-04:** A person's profile, part 2, was merged in #192. Part 3,
  in #193 (§5 step 5, the pages left), is its form, on the building blocks
  (`components/profile/ProfileForm.tsx`). The role keeps its own controls
  for now: they're the next part, so a person's profile comes in five
  parts, not four.
  - Each field's label is above it and what's wrong under it, the first
    one wrong focused, before one's own password is asked for. Its
    mistakes were said in a toast, one at a time, and the email's still
    described the rule the server had dropped,
    "user(max 20)@domain(max 10).com" (`lib/profile-form.ts`).
  - What the server refuses is said under the field it's about, where it
    can be: a username somebody has, or one that's another company's code,
    or a name, an email, a password or an amount the route found wrong.
    Anything else is said above the buttons, where it stays to be read.
  - A field that can't be changed is off, and says why: one's own email,
    changed in Security settings; a username, which only the Super Admin
    changes; one's own pay and day off credit, which the company sets, and
    someone else's to a role that may only see them; their company; and
    one's own team leader.
  - A gender and a status are radio buttons, a status said as the badge
    says it: Online, where the form said ACTIVE. An ended contract's
    status stays as it is, and says where they're reinstated.
  - A name takes up to 15 characters, as the server does, and says how
    many it has. One's own, on an employee's or a team leader's footing,
    says it's sent for approval first.
  - The new password is the building blocks' password field, which says
    how long it must be and that left empty the password stays as it is.
    Its eye was drawn by hand.
  - What the form may change is asked in one place, with what it shows
    (`lib/profile-access.ts`), so its save sends what its fields offer.
  - Update and Close are Save and Cancel, Save first; New password is in
    sentence case. The old fields' four words are gone.
  - A new password is offered only to whoever may set it: on one's own
    profile, or on someone else's with the reset permission, an Admin's
    only by the Super Admin. A role that may edit a profile but not reset
    a password was offered it, and its save was refused (found reading the
    code).
  - An email somebody else has is said under the email when someone's is
    changed: the save failed as the app failing, a 500, since only a
    username's clash was caught (found reading the code).
  - Add employee's mistakes, which the profile now says too, ask neutrally
    in Arabic: they asked in the masculine (أدخل، اختر، اتركه), as the
    profile's own words don't (found reading the words).
  - Someone who may not edit a person, at the form's address, sees their
    details: an Admin at another Admin's, as the notice of an acting role
    held back sends whoever decides roles, or a role without the edit
    permission. It was the form to fill in, and its save was refused
    (found reading the code).
  - Reloading or closing the tab with something typed asks first, as Add
    employee does; not while it's being sent, nor once it's saved (web
    interface audit).
  - Cancel is a link to their details, as every page form's Cancel is a
    link: it went back, so in a tab opened onto the form it did nothing
    (web interface audit).
  - What takes the focus on a page of the dashboard, such as the first
    field that's wrong, stops below the sticky header: told what's wrong,
    a field at the window's top edge took the focus where it was, under
    the header (browser flows).
  - One's own email isn't sent with the save, as the field is off: the
    server let an unchanged one through, but the save sent it all the same
    (browser flows).
  - In Arabic, the photo's size limit is in Arabic digits, as the page's
    other numbers are, where it was a 4 among them (browser flows).
  - Cancel shows their details as saved, not as typed: going to their
    details at the same address kept the form's state, so the details
    showed what had been typed, and Edit again brought it back to be saved.
    The view and the form are each mounted afresh now (Codex review).
  - An amount the browser can't read, such as "1e" or "-", is said to be
    wrong under its field: it read as empty, as though left empty, and was
    saved as 0 over their pay, where the old form's own check had stopped
    it (Codex review).
  - Whoever may ask for a role but may neither edit a person nor give a
    role, as HR may (ROLES_PLAN.md §6.12), asks from their details, beside
    the role: the form was the only place, which the change above made the
    details for them (Codex review). Its control is as it was until the
    role's part.
- **2026-11-05:** A person's profile, part 3, was merged in #193. Part 4,
  in #194 (§5 step 5, the pages left), is its role field, on the building
  blocks (`components/profile/RoleFields.tsx`).
  - Whoever may give a role picks one of those theirs may give, theirs
    among them where it isn't one, and once another is picked, until when,
    for an acting one, from tomorrow.
  - Whoever may only ask for one (ROLES_PLAN.md §6.12) picks one too, and
    is told it's sent to an Admin for approval: the save asks for it before
    the rest is saved. While it waits, the field is off and says which role
    waits, linked to it on the Requests page. It was a select with a button
    of its own beside it, which asked at once, apart from the save.
  - From their details, whoever may only ask asks beside the role, in a
    dialog (`components/profile/RoleRequestDialog.tsx`), and a change
    waiting is said under it. It was the form's control, put there as it
    was in part 3.
  - What's wrong is said under the role or its date, in the reader's
    language: a role theirs can't give or ask for, or one holding access
    theirs doesn't, or one that's gone; an Admin's, which only the Super
    Admin changes; the company's last Admin; a change already waiting; and
    a date that isn't after today, or isn't typed in full. They were
    toasts, in English.
  - A Super Admin's role, and an Admin's to anyone but the Super Admin, is
    off, and says why.
  - How a role may be changed, given or asked for, is asked in one place
    with the rest (`lib/profile-access.ts`).
  - The roles to pick from are the server's, as Add employee's are
    (`lib/useAssignableRoles.ts`). The old dropdown and request control are
    gone, with their styles typed in and their sides picked by hand, and
    the request control's "Request this role" with them.
  - In Arabic, the acting date's hint and an acting role's note ask nothing
    in the masculine (اتركه، يعود إلى دوره).
  - An assigner who picked another role, then picked back one theirs
    couldn't give, left the form sending the other's kind, and the server
    gave that kind's built-in role. Only a role picked is sent now, never
    its kind (found reading the code).
  - Tomorrow, the first day an acting role may end on, is the company's, as
    the server reads a return date in the company's calendar. It was UTC's,
    a day out for part of every day east or west of it (found reading the
    code), then the browser's, a day out for a viewer in another zone,
    whose own check then refused a day the server takes (Codex review).
  - The save's refusals of acting on an Admin, and of leaving a company
    with no Admin at work, carry their codes, as asking for a role's do, so
    the profile says them in the reader's language (`lib/role-errors.ts`).
  - The date an acting role ends on keeps password managers off, as the
    form's other fields do: it's not a sign-in field (web interface audit).
  - Told a role change already waits, asked for meanwhile in another tab,
    the field shows the change waiting, and the rest saves: it still
    offered the role it had picked, and every save asked again, and was
    refused again (browser flows).
  - Told a role change already waits, asked for by someone else who may
    only ask, the field is off and says so, and the rest saves: the list
    whoever may only ask is given holds their own requests alone, so the
    form never learned of it, and every save asked again (Codex review).
- **2026-11-05:** A person's profile, part 4, was merged in #194. Part 5,
  in #195 (§5 step 5, the pages left), is ending their contract, or
  reinstating it, and handing over a leader's team, in the building blocks'
  dialogs (DESIGN.md §5.5). It finishes the profile.
  - Ending a contract is a form under their name: the last working day,
    from today in the company's calendar, then the settlement it would
    record, the reason, and Cancel and End contract
    (`components/profile/EndContractDialog.tsx`). Reinstating says what it
    does, then Cancel and Reinstate. It was a window of its own making,
    titled "End Contract" or "Reinstate Employee", styled by hand, with
    Close where Cancel goes.
  - The settlement has the statement's own lines, totals and notes, as the
    statement will have them once it's issued: what was paid taken off, the
    debts they owe taken from what they're paid, who owes whom in the
    colour of what it means for them, and where the figure for what was
    paid comes from, a month whose payroll isn't paid yet being the one to
    act on. The days nobody has ruled on are counted in words. It was a
    sunk box with a heading in small capitals and colours typed in.
  - While it's worked out, it says so, and the last figures stay until the
    next are in, so the dialog doesn't jump.
  - What's wrong is said under the date, or above the buttons, in the
    reader's language: a date left empty or not typed in full, a month they
    had no salary in, an Admin's contract, which only the Super Admin ends,
    the company's last Admin, and an account with no company. They were
    toasts, in English. A settlement that didn't load says so, with Try
    again. The code prompt of a high-risk action, turned down, adds nothing.
  - Saved, it says so: ended, or the last working day recorded, as a
    contract ending later changes nothing on their details yet.
  - Handing over a team is one dialog for the profile's form and for
    ending a contract (`components/profile/TeamHandOffDialog.tsx`): who
    leaves, who's in the team, by name, and who takes them, or no one.
    Answered, it stays open until the change is sent, and a leader who
    can't take them is said under the leader, in the reader's language. It
    closed first, and the refusal was a toast, or a line above the form's
    buttons, in English. While the leaders load, it says so.
  - The employment route's refusals, and a team change's, carry their
    codes (`ApiResponse.refused`), as the save's about Admins do.
  - The green the old window typed in for "the company owes them", used
    nowhere else, is gone from the tokens (`app/globals.css`).
  - In Arabic, nothing is asked in the masculine (اختر، انقلهم، اتركهم،
    سجّل، حصّلها) and nobody is spoken of as "him" (معه، يكون فيه): it's
    يُرجى and verbal nouns, and the settlement's notes the same. A team's
    size and the days nobody ruled on are counted in words, where they were
    "day(s)" and يوم/أيام.
  - End contract waited for nothing: it took the date on the form with the
    last date's figures on screen, and after a settlement that didn't load,
    with none. It waits for the date's own now, so the figure confirmed is
    the figure recorded (found reading the code).
  - A contract ending today was said to end access at once, and by the
    viewer's calendar: it ends at the start of tomorrow, in the company's.
    Only a day before today ends it at once now (found reading the code).
  - The hand-off offered leaders whose accounts are archived, which the
    server refuses. They're left out now, as the leader who's going is
    (found reading the code).
  - End contract was offered on another Super Admin's details, who has no
    contract nor a company to settle with, and was refused. It isn't now
    (found reading the code).
  - A name with no space in it, in the list of a leader's team, breaks
    where it must, as the dialog's title and paragraphs do: it ran past the
    dialog (web interface audit).
  - A month they had no salary in says what to do: choose a day in a month
    they're paid for. It said only that the settlement couldn't be worked
    out (web interface audit).
  - Worked out again for another date, the settlement's figures were
    redrawn without a word to a screen reader. They're said once they're
    in, and not while the last date's stand in for them (web interface
    audit).
  - Asked where a leader's team goes as their contract ended, the leaders
    were still loading, so the picker was off and the focus was on Cancel
    the change. For a Team Leader, they're asked for as the dialog opens,
    so the picker has the focus (browser flows).
- **2026-11-05:** A person's profile, part 5, was merged in #195, which
  finished it. The sign-in page moves onto the building blocks next (§5 step
  5, the pages left), in two parts: its screen, signing in and the
  two-factor code, in #196, then Forgot your password (DESIGN.md §5.5,
  Sign-in).
  - The screen is a card on the flat page, titled "Sign in to Nizmo". It
    was "Welcome Back", in gradient letters on a glass card of its own
    making, over a moving gradient. The two-factor code has its own title,
    "Confirm it's you", with a line under it on what to type.
  - Its fields are the building blocks': the email or username, left to
    right in both languages, and the password with its eye button, each
    with its label and no placeholder. The password field's padding was set
    twice by hand, once more for the side its button was on in each
    language, which React warned about.
  - Stay signed in and Remember this device for 30 days are checkboxes
    with their labels. They were boxes drawn by hand, which neither a
    keyboard nor a screen reader could reach.
  - What's missing is said under its field before anything is sent, with
    the focus on the first, in the page's language: it was the browser's
    bubble, in the browser's language. What the server answers is said above
    the step's primary button, which takes the card's width; the step's
    other ways on are quiet buttons under it. They were all at the top of
    the card.
  - A wrong password readies the password to type again. Sign in, turned
    busy, took the focus with it.
  - At the code, a code that isn't six digits, or isn't right, is said under
    the code as Security settings says it, with what to do next. It was
    "Invalid code". Anything else is said as the first step says it: an
    account suspended meanwhile was "Something went wrong".
  - A code emailed instead can be sent again from its own step, which says
    so once it's sent, and a wrong or expired one says it can be. To get
    another, it was back to the app's code, then Email me a code instead
    again.
  - Remember this device is offered with an emailed code too: ticked
    before choosing one, it was hidden there and still remembered the
    device.
  - "Email me a code instead"'s refusals carry their codes
    (`ApiResponse.refused`) and are said in the page's language, as is a
    failure nothing answered for, with its reference for the admin. They
    were in English.
  - Under the card, as part of the page: the privacy policy, the terms, and
    the language and theme switches, in a row that wraps on a phone. They
    were pinned to the screen's corners, so on a phone the theme switch
    covered Sign in and the language switch the legal links. The bar that
    pinned them (`components/PreferenceBar.tsx`) is gone.
  - In Arabic, nothing is asked in the masculine (قم بتسجيل الدخول، أدخل،
    تحقق، تذكر): it's يُرجى and verbal nouns. Stay signed in is إبقاء
    تسجيل الدخول, where it was بقاء قيد تسجيل الدخول, and its 30 days are
    in Arabic's digits.
  - The old title and subtitle, the placeholders, "Signing in..." and
    "Invalid code" are gone from the dictionaries, and so is the link
    colour the old Forgot your password? was the last to use (`--link`).
  - The email or username is sent without spaces at its ends, such as one
    a phone's keyboard adds after a suggestion, which made it "not right"
    (found reading the code).
  - The words spoke as "we", which the app never does: "the code we
    emailed you", "We couldn't sign you in". They say what was done, as
    "Couldn't load your trusted devices" does (web interface audit).
  - On a phone, the language and theme switches' options were 30px tall,
    under the 44px a finger needs (DESIGN.md §9). They're 44px there; the
    switches themselves are the account menu's, until the app shell
    replaces them (web interface audit).
  - Ticked at a code, Remember this device stayed ticked after Back to sign
    in, so signing in then with an account without two-factor trusted the
    device for it, with no code given. The device is trusted only at the end
    of a sign-in that took a code (found reading the code).
- **2026-11-05:** The sign-in page, part 1, was merged in #196. Part 2,
  Forgot your password, is in #197, which finishes it (DESIGN.md §5.5,
  Sign-in).
  - It's two steps in the sign-in card, titled "Reset your password": the
    account's email, then the code sent to it with the new password, asked
    twice as Change password asks it, its hint saying how long it must be.
    It was a form of its own making, its words typed into the page in both
    languages.
  - Neither step says whether the email is on an account: the second says
    a code was sent if it is, naming the email as typed, so a mistake in it
    shows, and Use a different email goes back to put it right. Send a new
    code sends one again, saying so in the same way.
  - What's wrong with what was typed is said under its field before
    anything is sent, with the focus on the first, in the page's language:
    an email that isn't one, a code that isn't six digits, a password too
    short or not the same twice. They were the browser's bubbles, in the
    browser's language.
  - What the server answers is said above the step's primary button, by the
    codes its refusals now carry (`ApiResponse.refused`), and an email that
    isn't one or a code that isn't right, or has expired, under its field.
    They were at the top of the card, in English.
  - Too many tries are counted down, as signing in counts down an account
    held back, from how long is left in seconds, counted on the server
    (`lib/password-reset.ts`). It said a time to try again at, written on
    the server, so in the server's own time zone, and in English.
  - Reset, it's back to signing in, the email filled in and the password
    focused, saying the password was reset. It went back without a word.
    Back to sign in puts the focus back on Forgot your password?.
  - The colours the old form was the last to use are gone (`--ok-bg-strong`,
    `--grey-400`, `--hero-from`, `--hero-to`), and with them the shades of
    the brand colour worked out for two of them.
  - At signing in's emailed code, Send a new code left the focus on the
    page: turned busy, the button lost it. The code, cleared for the new
    one, takes it, as at Forgot your password (browser flows).
  - An email without a hyphen, named under the title, had nowhere to
    break: on a phone, one of 73 characters ran off the card, and the page
    was zoomed out to fit it. It wraps within the card (web interface
    audit).
- **2026-11-05:** A session the server ends signs the browser out, in #198
  (ROLES_PLAN.md §4.4). Found at the sign-in page's part 2: a reset password
  was to sign the account out wherever it was signed in, and that stranded
  the browsers it signed out.
  - The token of a session the server ended, by a role edited with "apply
    now" or a check it couldn't make, was emptied and kept. `proxy.ts`
    counted any token as signed in, and the session it made had nobody in it:
    the dashboard crashed reading it, `/login` sent the browser back into the
    dashboard, and the routes took it for somebody's.
  - An emptied token is no session now, and signed out: the routes refuse
    it, a server page sends the browser to `/api/auth/ended`, which clears
    its cookie and goes on to sign in, and a page left open signs itself out
    when a request of its own is refused, the heartbeat's at the latest (89
    seconds after, in the browser flows).
  - A session that's still good, sent to `/api/auth/ended`, goes to the
    dashboard: a link there signs nobody out.
  - A password reset signs the account out wherever it's signed in: a
    session someone opened with the old password, such as by somebody who
    had learned it, stayed open after a reset (found at the sign-in page's
    part 2).
  - Refused, the heartbeat read an answer it didn't have, and the console
    said "Heartbeat failed: TypeError" as the page signed out. It says
    nothing of a refusal now (browser flows).
- **2026-11-05:** The sign-in page, part 2, was merged in #197, which
  finished it. A page someone can't open, and a company whose subscription
  has ended, are in #199 (DESIGN.md §5.5).
  - A page someone can't open says so in its page header, in the page's
    language, and under it why, and who can change it. It was a page of its
    own making, in English only, "Access Restricted" in Title Case under a
    no-entry emoji, telling everyone to ask their administrator.
  - Why is what's true for who is asking: a role that doesn't include it,
    which an Admin of their company can add it to; a page only a Super
    Admin opens, which each of the 17 now says (an Admin was told to ask
    their administrator: themselves); a company's own page, for a Super
    Admin; and an account that can't open pages for now, such as a
    suspended one, until the heartbeat signs it out and says why.
  - Go to the dashboard is in the header, except on the dashboard itself,
    which an account that can't open pages was sent back to, and for that
    account anywhere, where every page says the same.
  - A company whose subscription has ended says so in its page header,
    with the day access was paused, in the page's language and digits, and
    that renewing it lets everyone back in. The day was in red, on the
    reader's own calendar: a phone in the Gulf showed the next day, and a
    different one from the server's. It's on Egypt's calendar now, as
    subscriptions are counted.
  - Under the header, a card says first that nothing was deleted, with a
    check in the Good colour. It was a green box under a glass card and an
    hourglass emoji.
  - Its words no longer say access is paused for everyone but
    administrators: its Admin is held on this page too, the one who can
    still sign in.
- **2026-11-05:** A page someone can't open, and a company whose
  subscription has ended, were merged in #199. What the company's package
  doesn't include is hidden, and its pages say so when opened by their
  address, in #200 (`DESIGN.md` §5.1, §5.5), decided by the product owner.
  - A module the package doesn't include isn't in the side bar, for anyone
    in the company, and a group with nothing left in it goes with it. It was
    there, faded and with a padlock, as the way to find out what else the
    product does, and Attendance was there for whoever would run it.
  - Its pages, opened by their address, say they can't be opened, as any
    page someone can't open does, and why: the company's package doesn't
    include them. They were a card under a padlock emoji naming the bundle
    to buy. The attempt is still counted for the Super Admin, though fewer
    arrive now that nothing in the app leads there.
  - An employee's history, and adding a bonus or a deduction, are HR's:
    they aren't offered in a person's row or the account menu without it,
    and opened by their address, they say so. They opened, and every part
    of them was refused.
  - The package is read from the account the layout passed until the
    session has loaded, as permissions are. Read from the session alone, it
    was empty for the first second, and an empty one includes everything:
    the padlocks came a moment after the page, and a task's Penalise could
    show for that moment, for a company without HR.
  - Part 2, to follow: what's of a module the package doesn't include, inside
    pages it does: the dashboard's tiles and cards (tasks, pay, day off),
    and a person's pay and day off credit on their profile.
- **2026-11-05:** What the package doesn't include was merged in #200.
  The notes above the page, a company's free trial or its grace and a role
  a Super Admin is previewing, are on the building blocks in #201
  (`DESIGN.md` §5.5, A note above the page).
  - Each is a panel above the page header, its meaning's bar on its start
    edge (Neutral for a trial, Problem for grace, Waiting on someone for a
    preview), in the page's language and digits. They were boxes of their
    own making under an emoji, the preview's with the old primary button.
  - A trial and grace say their last day on Egypt's calendar, as
    subscriptions are counted, and how many days there are to it: tomorrow,
    and today, on those days. The days were counted in hours from the
    date's time of day, so a trial said "0 day(s) left" all through its
    last day, and two ending on the same day could differ by one. The
    server counts them by the day on Egypt's calendar now, and the session
    carries them.
  - The trial's said "2 day(s) left" in English, and "2" in Arabic among
    Arabic-Indic digits: each language's own plural now, with its digits.
  - Grace told everyone to renew, which only an Admin can. Its Admin is
    told renewing it keeps everyone's access, and everyone else that an
    Admin of their company can renew it.
  - They're read from the account the layout passed until the session has
    loaded, so they're there from the page's first paint: the trial's and
    grace's came a moment after the page, and pushed it down.
- **2026-11-05:** The notes above the page were merged in #201. What's of a
  module the package doesn't include isn't there inside the pages it does
  either, in #202 (`DESIGN.md` §5.5, Page layout), which finishes hiding
  what the package doesn't include.
  - The dashboard: a company without HR had its team's bonuses and
    deductions, its day off requests to decide, and on one's own dashboard,
    one's pay adjustments, day off credit and latest request; one without
    Company Management had its tasks, the tasks to review, the overdue ones,
    Create new task, and one's obligations. None is there now, nor read,
    and a section left with nothing in it goes.
  - A person's pay and day off credit, on their profile and in Add
    employee, aren't shown or asked for where the package hasn't HR: pay is
    Payroll's, a day off balance Day off's. The server doesn't save them
    there either, whatever is sent, as it doesn't save what the sender's
    role may not set.
- **2026-11-05:** What's of a module the package doesn't include, inside the
  pages it does, was merged in #202. The app's frame comes next, from a
  mock-up the product owner approved on 2026-11-05, which keeps the
  "Powered by" signature as it is (decided by the product owner). The side
  bar is the first part, on the building blocks in #203 (`DESIGN.md` §5.1,
  §6).
  - It's light, on `--panel` in both themes, where it was dark slate in
    both, with the company's mark and name at its top: its logo on the
    light plate, or the first letter of its name on a brand tile. The name
    was a gradient under a rocket emoji.
  - Its items have the Phosphor icons `DESIGN.md` §6 names, filled for the
    page you're on, where they were emoji. A company that chose its own
    emoji for a module still sees it there (§4.4).
  - Company settings, Roles and access and Saved lists are pinned at its
    foot while the rest scrolls, as the Super Admin's long list does, over
    the privacy policy and the terms of service, both now in sentence case.
  - On a phone it's a drawer from the start side, 296px wide, with 44px
    items. It's a dialog while it's open: focus moves into it and stays
    there, and Escape, a tap on the page beside it, its close button or
    picking a page closes it, with focus back on the menu button. Closed,
    it isn't drawn: it only slid out of sight, and Tab went through every
    one of its links.
  - It no longer folds down to its icons. It did when its name was clicked,
    which nothing said and a keyboard couldn't do.
  - The Branding tab's logo preview and the Modules tab's side bar preview
    draw the same mark, icons and look. The old dark side bar's tokens, and
    the brand shades that followed them, are gone with it.
- **2026-11-05:** The side bar was merged in #203. The frame's second part,
  in #204: Requests in the side bar carries how many wait on this person
  under the Requests page's To review tab (`DESIGN.md` §5.1).
  - It's the number that tab's list totals as the page opens on it, with
    every kind and no filter. Each kind is counted by its own rule of who
    sees what, through the same lists the page reads
    (`lib/requests/feed.ts`), so the two can't drift apart. The Super
    Admin's is the company they're looking at, or every company's when they
    look at none, as the page opens on it, and it's asked again when they
    pick another.
  - It's a `--brand` pill at the item's end, in the language's own digits,
    and nothing when nothing waits. A screen reader hears it with the
    item's name, as "Requests, 3 requests to review".
  - It's asked again on every page, when the person comes back to the
    window, and once something is decided, deleted, withdrawn, revoked or
    asked for on the Requests page.
  - The top bar's button for name changes alone is gone, with its count:
    name changes are among what's counted on Requests. The dashboard's tile
    for them stays, for whoever decides them.
- **2026-11-06:** The count of what waits on Requests was merged in #204.
  The frame's third part, in #205: the top bar and its account menu, as the
  approved mock-up draws them (`DESIGN.md` §5.1).
  - It has no title: every page names itself in its page header. The only
    pages without one are old addresses that send people to another page.
  - The language switch shows both languages, each written in itself,
    English first in Arabic too, and "EN" and "ع" on a phone. The theme
    switch in the account menu is drawn the same way. The old toggle they
    replace is gone, with its two tokens.
  - The bell has a `--brand` pill for how many are unread, and is named
    with it. The panel it opens is unchanged until its own part.
  - The account button has the person's photo or initials, never a drawing
    that stands in for them, with their name and role; on a phone, the
    photo or initials alone. Its menu has the person and their role at
    their company, My profile, Security settings, History where it was
    before, the theme switch and Sign out. Escape, a click outside it,
    following one of its links or Tab past its end closes it; switching
    the theme doesn't.
  - At the top of the page it sits on the page, and scrolled it floats as
    glass, as today, but within the room it takes, so the page no longer
    moves 32px as it does. On a phone it floats 8px in, where its buttons
    already are.
  - What pages set its title with is gone, with its last use, on the UI
    kit page.
  - The Super Admin's company list opens from the switcher's start edge,
    now that the switcher is at the bar's start. From its end edge, as it
    opened when the switcher was at the bar's end, it ran off a phone's
    screen, 72px in English and 79px in Arabic (Codex review).
- **2026-11-06:** The top bar and its account menu were merged in #205.
  The frame's fourth part, in #206: the Super Admin's company picker, as
  the approved mock-up draws it (`DESIGN.md` §5.1).
  - The company in view is on a pill with its initials, under "Company in
    view", or with the buildings icon for All companies. On a phone, its
    tile alone.
  - It opens a panel with a search of its own, "Find a company", over the
    companies, each with its initials. Typing keeps the companies with
    what's typed in their names, capitals aside, and the first is the one
    Enter picks. When none has it, the panel says so.
  - The focus stays in the search field: the up and down arrows move
    through the list from there, and Enter picks. Escape, a click outside
    it, or Tab out of it closes it, and Escape and a pick give the focus
    back to the picker.
  - A tap opens it without the keyboard, which would cover the list on a
    phone. The search field is there to tap.
  - On a phone the panel spans the bar, 8px in from its edges.
  - The old switcher's code is gone from the top bar, with the screen
    width it watched in script. CSS does that now.
  - "All Companies" is "All companies", in sentence case.
- **2026-11-06:** The Super Admin's company picker was merged in #206.
  The frame's fifth and last part, in #207: the bell's panel, as the
  approved mock-up draws it (`DESIGN.md` §5.1).
  - It's 380px under the bar from the bell's end edge, and on a phone it
    spans the bar, 8px in from its edges. While it's open, the bell is in
    the brand's tint.
  - "Notifications" is at its top, with Mark all as read while there's one
    it can read.
  - Each notification is a link to what it's about, with its subject's
    icon (the side bar's where its subject has a page there, a calendar
    for a day off), what it says, and how long ago: "10 minutes ago",
    "Yesterday", and from a week on its date, with the exact date and time
    on hover. One with nowhere to go isn't a link.
  - An unread one is tinted, what it says in medium, with a dot, and a
    screen reader hears "Unread" before it. One to deal with now, such as
    a face check waiting, has an overdue row's look, as before.
  - Opening it doesn't read them any more. Following one reads it, through
    a new address that reads one of the person's own,
    `PATCH /api/notifications/[id]`, and Mark all as read reads the rest.
    Neither reads one to deal with now.
  - It isn't a dialog, as the account menu isn't: Escape, a click outside
    it, following one of its links, or Tab past its last one closes it.
  - Where a notification leads, its icon and how long ago it came are in
    `lib/notice-target.ts`, `lib/notice-icon.ts` and `lib/notice-age.ts`.
    The bell followed the same branches on a click. An address on another
    site that a notice names as its page is no longer followed.
  - While they're on their way it says "Loading…", and when they didn't
    load, so, with Try again; before, it said there were none.
  - The three colours only the old panel used are gone from the tokens
    (`app/globals.css`): an unread one's sky blue, a critical one's red
    edge and the panel's grey border.
- **2026-11-06:** The bell's panel was merged in #207, which finished the
  app's frame. The date fields' first part, in #208: the calendar a date
  and a range of dates open, on the building blocks (`DESIGN.md` §5.3).
  - On a computer it opens under its field, drawn as the menus are, or
    above it when there's no room below, and follows the field as the page
    scrolls; a click elsewhere closes it and goes on to what was clicked.
    On a phone it opens in the middle of the screen over the dimmed page,
    as before. It was in the middle of the screen on a computer too, where
    it dimmed a dialog a second time.
  - The day picked is in the brand colour and today in its text colour. A
    range's days are on the brand's tint. They were the info blue, the
    colour of what waits on someone, and indigo.
  - The month and the weekdays are in the page's language, and the days
    in its digits: they were Western digits in Arabic, and the weekdays
    typed in. Each day is read out as the whole date, and today as today.
  - The month before is on the start side, as the pager's previous page
    is, so in Arabic the next month is on the left, the way the days run.
    It was on the right.
  - Dates read "6 Nov 2026", and a range "6–10 Nov 2026", as Intl joins
    it; they were in American order, and a range was joined by an arrow.
    A range with one end only says "From" or "Until" that day. A day given
    as a time in full, as the dashboard's link to the audit log gives one,
    reads as its day; it read "Invalid Date".
  - Reset, in red, is Clear, a quiet button. A range's Done is in the
    translations, and its words for what to pick next no longer command
    in the masculine in Arabic.
  - A range starts again each time it opens, can be turned off, and takes
    a hint, as a single day can. A field with something wrong shows it in
    the field's colour, as other fields do.
  - Closing the calendar gives the focus back to its field, unless a click
    outside it moved the focus on to another field.
  - The field says its day once in the browser, as `SafeDate`'s dates do:
    the server's Intl and the browser's can write a date otherwise, and a
    page opened with a range in its address was drawn again.
  - The fields' old look, which only unused code still drew, is gone, with
    the two colours only the old calendar used (`app/globals.css`): Reset's
    pale red and a range's indigo text.
  - Codex's finding: on a screen too short for it, such as a phone on its
    side, the calendar ran off the screen, with its month or its Done out
    of reach. It's now as tall as the room it has, by its field or on a
    phone's screen, and scrolls inside.
- **2026-11-06:** The date fields' calendar was merged in #208. Their
  second part, in #209: a deadline's date and time on the same calendar
  (`DESIGN.md` §5.3), for Create task, Add obligation, a task's Edit
  details and the bulk review of tasks.
  - The field says "6 Nov 2026, 5:00 pm" in the page's language, once in
    the browser, as the date fields do.
  - The time is under the days, in the browser's own time field as the
    app's other times are, in 5-minute steps, with Done. It was three
    drop-downs of the deadline picker's own: the hour, the minute, and AM
    or PM.
  - Picking a day keeps the time picked, or noon, and leaves the calendar
    open for the time. A day that ends before the earliest deadline allowed
    can't be picked; a time before it says so under the time, in the words
    Create task already uses, and Done does nothing until it's put right,
    though Tab still reaches it.
  - In the bulk review of tasks, a row's deadline is the same field, its
    label read out but not shown, with what's wrong with it under it, as
    the row's place is. It was the date in American order, with its
    seconds, and a calendar emoji to change it.
  - The deadline picker's own window is gone: its month names and weekdays
    typed in, its arrow characters, its emoji, and its Confirm Selection
    in a gradient, with the brand's accent, which nothing else used
    (`app/globals.css`). The words only it used are gone too, and the
    Arabic for what to pick, and Create task's for a deadline not yet
    picked, no longer command in the masculine.
- **2026-11-06:** A deadline's date and time was merged in #209. The date
  fields' last part, in #210: the dates the browser's own date field still
  took open the same calendar (`DESIGN.md` §5.3), and say the day in the
  page's language and digits.
  - The day an acting role ends, in a person's profile and when asking for
    a role from their details: from tomorrow in the company's calendar, as
    it was, with Clear for a change for good.
  - A contract's last working day, with the settlement for it under it, as
    it was.
  - The day a cash advance changed hands: today to start from, and no day
    after it.
  - The building blocks' own page shows a date as the calendar too.
  - A date can't be half typed on the calendar, so the checks for one and
    the words asking for the whole date are gone. A date the server can't
    read, which the calendar never sends, asks for one, as an empty one
    does.
  - The calendar's field takes a name, as the profile form puts the focus
    on its first field wrong by name.
  - The Arabic for a cash advance's day after today no longer commands in
    the masculine.
- **2026-11-06:** The last date fields were merged in #210. The first of
  Create task's two windows, in #211: the Super Admin's templates for the
  bulk upload of tasks, on the building blocks (`DESIGN.md` §5.5, "A file
  that replaces one").
  - The English and the Arabic are each a section under its heading: in
    the All companies view, the one there now as a saved file that opens
    in a new tab, with when it was last uploaded, or that none has been.
    In a company's view, a line says where to see them, and the company's
    own template downloads beside Close.
  - The file picker takes one workbook. Once one is picked, its chip and
    Upload: nothing is replaced until it's pressed. A file of another kind,
    or one that couldn't be uploaded, is said under the picker; while it's
    sent, the picker is off and a line says so. A toast says it's done,
    and the one uploaded is the one there now at once, then as the store
    says: the browser flows found it left as it was, as the status wasn't
    always asked for again after an upload.
  - The date it was last uploaded is in the page's language. The English
    template's was in English in Arabic, as its own language's.
  - Gone: the window of its own making, the national flags drawn beside
    each (and the colour tests' exemption for them), the folder, inbox
    and eye emoji, its words in English whatever the page's language
    ("English Template Updated", "Upload Failed"), its tooltip borrowed
    from the clients page, and Cancel, its primary button, which is Close.
  - Create task's button for it is "Manage templates", as the window is,
    rather than "Download template".
- **2026-11-06:** The templates window was merged in #211. The first of the
  bulk review's two parts, in #212: its window on the building blocks
  (`DESIGN.md` §5.5, "Rows read from a file").
  - The file's rows are a list, a table on computers and cards on phones,
    in a dialog up to 960px wide, each with its row's number in the file,
    who it's for, its deadline and where it's done. A row with mistakes
    has the red start-edge bar and its mistakes under its title.
  - A row's Edit opens its fields in the dialog, as Create task has them,
    each with what's wrong under it; Done, or Escape, goes back to that
    row. Remove takes one out without asking, and Undo puts it back where
    it was: the old window's Delete couldn't be undone (the web interface
    audit). Leaving the page asks first while the rows are still to
    create. The main button says how many it creates;
    a row with mistakes is left out until it's fixed, and the line above
    the buttons says how many are. Once they're created, a toast says how
    many, as the server counted them: it leaves out one it refuses, and
    the old window said they all were.
  - The row checks are in one place (`lib/bulk-tasks.ts`), worked out from
    the row whenever it's shown. A username or a client the file named and
    wasn't found stays a mistake until something is picked in its place:
    any change on the old window dropped it, and the task was created
    without them. A difficulty out of range is said, and can be fixed: the
    old window left the row out with nothing said.
  - Gone: the pop-ups placed beside each cell by hand, the round plus and
    minus buttons for its people, the writing-hand emoji, the sparkles and
    the warning sign, its row numbers that counted only the rows shown,
    its words in title case ("Review Tasks", "Missing Title", "Rows with
    errors"), 19 words only it used, and `--panel-95`, which only its
    people pop-up used.
  - Next, the second part: reading the file's rows moves into
    `lib/bulk-tasks.ts`, with tests, and its words in both languages. The
    browser flows found a file picked as Create task opens read before its
    people and clients have loaded, so every username and client in it is
    one that wasn't found: the second part waits for them.
- **2026-11-06:** From Codex's review of #212: Undo stays off while the
  tasks are sent, as Edit, Remove and Cancel are. A row put back then
  wasn't among those sent, and the dialog closed without it.
- **2026-11-06:** The bulk review's window was merged in #212. Its second
  part, in #213: reading the file's rows moves into `lib/bulk-tasks.ts`
  (`readRows`, `readDeadline`), with tests (`DESIGN.md` §5.5, "Rows read
  from a file").
  - The file is read once the people and clients its rows name have
    loaded: a file picked as Create task opened was read before them, so
    every username and client in it was one that wasn't found (#212's
    browser flows). If they can't load, a toast says so.
  - A file that can't be read, such as an old .xls, which the picker
    offered, is said in a toast: it was an error in the console and
    nothing on the page. The picker takes .xlsx alone. A file with no
    tasks from row 3, or more than 50, is said in a toast too.
  - Each cell is read as the file shows it, or kept as a mistake that
    says what the file had. A date cell was the day before west of UTC, a
    time that wasn't one was midnight, a typed "1" was 1 January 2001 and
    "5.1.2027" the 1st of May, as the browser guesses, and a difficulty in
    words was 0. Arabic digits are read, and ص or م.
  - A row with no title was dropped with nothing said. It's read, and the
    review says it has no title.
  - The Upload button is busy while the file is read, and the template
    takes its rows' limits from `lib/bulk-tasks.ts`.
  - In Arabic, a sentence ending in a file's extension, «بامتداد ‎.xlsx.»,
    showed as "..xlsx", the extension's dot and the sentence's side by
    side. It's «بصيغة xlsx.» now, the sentence's dot showing before it:
    this file's message, and the templates window's from #211.
  - From the web interface audit, each toast says what to do next: a file
    with no tasks, to add them from row 3, under the headings; and the
    Excel reader not loading, as after a new release, to reload the page,
    where it would have said only that something went wrong.
- **2026-11-06:** From Codex's review of #213: a time given as a fraction
  of a day drops its seconds, as a typed one does. Rounded to the minute,
  17:45:30 was 17:46, and 23:59:45 was midnight and so not a time at all.
- **2026-11-06:** The bulk review's second part was merged in #213, which
  finished Create task's two windows. The toasts move onto the building
  blocks in #214 (`DESIGN.md` §5.5, "Toast"):
  - each is a level-2 panel on `--panel-raised`, with 8px corners, at the
    screen's top end corner, or the screen's width less 16px each side on a
    phone. They were white whatever the theme, so a dark page had a white
    box on it;
  - its meaning's colour (`DESIGN.md` §2.3) is a 3px bar on its start
    edge, with an icon before the words: a tick, a warning circle, a
    warning sign or an "i". The bar was on the left in Arabic too, the end
    side there, and its colours weren't the meanings';
  - Close is an X named for what it does, a 44px target under a finger,
    with a ring when the keyboard reaches it. It was a letter;
  - it slides in from the end side in 200ms, the other way in Arabic, and
    with "reduce motion" it's just there. It slid in from the right
    whatever the language and the setting;
  - how long each stays, and what screen readers hear, are as they were;
  - gone: the old slide's keyframes, in two places, and the toast's own
    `<style jsx>`;
  - from the web interface audit: Close takes a tap at once, with no grey
    flash, as every other control does, and a scroll past the end of a tall
    stack no longer goes on to the page under it.
- **2026-11-07:** The toasts were merged in #214. The map pin picker and
  the place search move onto the building blocks in #215 (`DESIGN.md`
  §5.3, "A place on the map"):
  - the place search suggests places in the list a name from a saved list
    has, with its keys: the arrows, Enter and Escape. Its suggestions were
    a list of its own making, reached only with a mouse;
  - it suggests up to eight places in Egypt, each by its name with the
    rest of its address under it, and only places with a point on the map,
    so a pick always drops the pin. A search for a kind of place, such as
    "Pharmacy", could be picked, and dropped no pin. A place picked names
    a new location by its name, where it was its whole address;
  - when nothing matches, or the search isn't answering, the line under
    the field says so, and that the pin can still be pasted or picked on
    the map. It said nothing. An answer to an older question than the last
    is dropped, where a slow one could take a newer one's place;
  - "Use my current location" and "Pick on the map" are the building
    blocks' secondary buttons, right below the pin, in the place fields and
    in the check-in places, where they were the older pages'. In Arabic,
    the metres a position is within show in Arabic-Indic digits;
  - the map has a field's frame and the app's ring. Its zoom buttons and
    its switch to satellite are named in Arabic too, 44px under a finger,
    and ringed in the pin's colour, which holds on their white in both
    themes. Its pin, radius and centre cross are drawn in
    `components/ui/ui.css`, the cross with logical properties;
  - `components/LocationSearchInput.tsx` is gone, for
    `components/locations/PlaceSearch.tsx`;
  - the Arabic of both no longer speaks to one person in the masculine:
    «البحث عن المكان», «استخدام موقعي الحالي», «تحديد المكان على الخريطة»,
    and يُرجى in their hints and messages;
  - from the browser flows: in a dialog, the lines under the place search
    and under the pin's buttons had no room above them, and Tab from the
    map stopped on the pin, which the keys can't move;
  - from the web interface audit: the map's zoom, its tiles' fade and its
    glide after a drag moved with "reduce motion" too, and the place
    search's field had no name.
- **2026-11-07:** From Codex's review of #215: the place under the keys is
  kept in sight. Eight places with their addresses run past the
  suggestions' 320px, and the arrow keys could reach one out of sight,
  which Enter then picked unseen.
- **2026-11-07:** From Codex's review of #215: a place's name picked and
  then typed again asks the search again, as for another branch of the
  same business. Only the pick filling the field in isn't asked about;
  the name retyped brought no suggestions at all.
- **2026-11-07:** The face check's camera and a flagged check-in's face
  photos on the building blocks (#216; `DESIGN.md` §5.5, "The face
  check's camera" and "Face photos"):
  - the camera is drawn by `components/ui/ui.css`, where its look was
    typed into `components/FaceCamera.tsx`. Its step, Close and tick are
    Phosphor icons, where they were the characters ↔, ◡, ✕ and ✓, and each
    step shows its name, which was never shown;
  - its turn gauge is left to right in Arabic too, with logical
    properties, where it was placed with left and right;
  - its words, its step's card, the test version's pill and Close are on
    the picture dimmed to 55%, which holds 4.5:1 over the lightest
    picture; the pill's words could fall to 2.7:1. The tick is black on
    the done colour, 9:1, where white on it was 2.3:1;
  - it's a dialog by `useDialog`: it takes the focus as it opens, keeps
    Tab in and ends the check on Escape, the focus going back to what
    opened it. The focus stayed on the page behind it, so Tab walked that
    page, and Escape did nothing;
  - the first download's share is in the page's digits, and with "reduce
    motion" the ring, the time left and the dot move at once;
  - its Arabic no longer speaks to one person in the masculine:
    «يُرجى النظر مباشرة إلى الكاميرا», «يُرجى إغماض العينين لحظة ثم فتحهما»
    and the rest. "Let's try that step again" no longer speaks as "we":
    "This step starts again.";
  - a flagged check-in's photos, on the Requests page and Check-ins, are
    in the building blocks' dialog, with Close (`FlaggedFaceDialog`, which
    was `FlaggedFaceModal`), where they were in the older pages' window,
    their line in `--text-soft`. Only the code a high-risk action asks for
    (`components/StepUpInterceptor.tsx`) is still in that window;
  - the watermark over face photos, in a face check's review too, has the
    time under the viewer's name, on the viewer's own clock and in the
    page's digits, as a date and a time are written
    (`lib/calendar-text.ts`). It was UTC, unlabelled and in Western
    digits in Arabic, after the name and a dot (asked on #216);
  - from the browser flows: on a 360px phone, the two photos fell one
    under the other, in a face check's review too. And `next.config.mjs`
    and `.env.example` still named `components/LocationSearchInput.tsx`,
    which #215 replaced. And in English on a 320px phone, the watermark's
    time ran past the photo's edges, cutting off "pm": on a narrow photo
    it goes under its date (`dateTimeBreakable` in `lib/calendar-text.ts`);
  - from the web interface audit: the live picture was read out as a
    video with no name; the time left and the turn's dot moved by layout;
    Close had no hover, and wasn't in the shared rule for taps; the test
    version's pill left "only." alone on its second line, and the
    download's share changed width with its digits.
- **2026-11-07:** The code a high-risk action asks for and the screen over a
  page the app has to leave on the building blocks (#217; `DESIGN.md` §5.5,
  Dialog and "A page the app has to leave"):
  - the code (`components/StepUpInterceptor.tsx`) is the building blocks'
    dialog, above every other one (`aboveAll`, 10001) and under the toasts,
    which move to 10002, over every dialog as `DESIGN.md` has them. It was
    the last of the older pages' windows, `components/Modal`, which nothing
    uses now; its Cancel was grey, of its own making;
  - it's a form: why and for how long, in the page's digits (`countOf`),
    where the minutes were in Western digits in Arabic; the six digits left
    to right; Cancel and Confirm, Cancel off and Confirm busy while it's
    checked. A code that isn't six digits is said under the field before
    anything is sent, where Confirm stayed off without saying why. A check
    that couldn't be made, as when the session update gives nothing back,
    says so (`lib/step-up-check.ts`), where it said the code was wrong;
  - Arabic digits and a space, as typed on a phone or pasted, are taken
    (`codeDigits` in `lib/security-forms.ts`): a code pasted as "123 456"
    lost its last digit to the field's length, and Arabic digits weren't
    taken at all;
  - the Arabic no longer asks one man: «يُرجى إدخال الرمز…» for «أدخل», and
    «يُرجى تفعيلها…» for «فعّلها… ثم حاول»;
  - the screen over a page the app has to leave (`components/UserHeartbeat.tsx`,
    `LeavingCover`), when an account is suspended, closed or its company
    banned, or maintenance starts: the whole screen in the page's colour
    with an empty state, nothing turning, an alert dialog screen readers
    hear at once, its focus kept and Escape doing nothing. It was a dark
    screen with a turning ring and a 🔧, titled in Title Case, and screen
    readers weren't told. Its lines say what's next in sentence case:
    "Saving your work, then signing you out…";
  - a heartbeat that couldn't reach the server, as when the page is left
    mid-request, is no longer logged as "Heartbeat failed: TypeError:
    Failed to fetch", which every browser flow had to leave out;
  - the four colours only the old screen used (`--warn-solid`,
    `--warn-fg-mid`, `--veil-30`, `--scrim-deep`) are gone from
    `app/globals.css`, in both themes;
  - found in the web interface audit, before review: a long maintenance
    message on a phone on its side started above the screen's top, out of
    the scroll's reach, a link in it ran off the side, and a focus ring was
    drawn round its message. It's in the middle by its own margins now, a
    link in it breaks where it must, and it draws no ring, as nothing on it
    can be used.
- **2026-11-07:** What an edit changed on a task's page on the building
  blocks (#218; `DESIGN.md` §5.5, "What an edit changed"):
  - the title or description changed after the task was given shows in
    its dialog as the text is now, word by word (`components/DiffViewer.tsx`):
    taken out struck through in the Problem colours, put in underlined in
    the Done or good colours, words that changed together one mark. Its
    colours were inline, `--ok-*` and `--danger-*`;
  - colour is never the only signal: a key above names each mark the text
    has, and screen readers hear "Removed:" or "Added:" before each, where
    an added word was only a green background;
  - the diff is `lib/word-diff.ts`: the longest run of words both share
    stays, so a word that stayed is never marked taken out and put back,
    as the old one did with more than ten words put in before it;
  - the text keeps its own direction, where it took the page's, so English
    in Arabic ran right to left; its line breaks are kept, what was taken
    out sitting where it was, where they were lost; and its spaces are the
    text's, where they were margins set by the language;
  - `--danger-fg-strong`, which only it used, is gone in both themes;
  - found in the browser flows: each button that opens it went as it was
    opened, so closing the dialog left the focus on nothing. They stay now
    until the change is seen, so it can be opened again, and closing it
    gives the focus back to its button.
- **2026-11-07:** A page that broke, and the app itself, on the building
  blocks (#219; `DESIGN.md` §5.5, "A page that broke" and "When the app
  itself broke"):
  - a page that broke says so in its place, in the page's language, in a
    panel as an empty state (`components/ErrorScreen.tsx`): the warning
    icon, "This page stopped working" as a heading the focus moves to,
    what to do, Reload page and Start again, neither red, and the logged
    failure's reference under them, as made, which a browser's translation
    leaves alone. It was a card of its own making, in English only, under
    a warning emoji, telling of "a client-side exception";
  - in the dashboard the side bar and top bar stay around it; on a page
    with no side bar, such as signing in, it has the whole screen;
  - `components/DashboardErrorBoundary.tsx` is Next's own boundary now
    (`catchError`, from `next/error`, as its docs advise): going to another
    page leaves it behind, where it stayed until the page was reloaded, and
    a redirect or Not found passes through it;
  - Start again (`lib/error-screen.ts`) clears what the browser keeps for
    the app, the phone's own records apart, and forgets the company a
    Super Admin picked, cookie and all, where only its storage went. It no
    longer switches the app to English;
  - when the app itself broke, `app/global-error.tsx` says the same over
    the whole screen. It brings the app's styles and fonts itself, which
    Next leaves out of it, from a font definitions file the root layout
    shares (`app/fonts.ts`), and the language and theme from the person's
    cookies, with its own copy of the words, held to the translations by a
    test, as the dictionaries are too big for every page's code. It was in
    English only, its Try Again in Title Case, with none of the app's
    styles, fonts or theme;
  - both report through the app's one report (`lib/client-error-report.ts`),
    once for each failure;
  - `--danger-border`, `--veil-40` and `--veil-60`, which only the old
    card used, are gone from `app/globals.css`, in both themes;
  - found in the browser flows: the page drawn when the app itself broke
    said nothing of how wide to be, as Next gives the root layout's pages
    their viewport and not it, so a phone could draw it at a computer's
    width. It says so itself now, as every page does.
- **2026-11-07:** The privacy policy and the terms of service on the
  building blocks (#220; `DESIGN.md` §5.5, "The privacy policy and the
  terms of service"):
  - `app/(legal)/layout.tsx` draws them in one column at reading width on
    `--page`: Nizmo's mark and name at the top, as the side bar's head
    shows a company without a logo, a link to sign in; the document on a
    sheet, as a document's is; and under it the privacy policy, the terms
    and Sign in, in the app's words. It was a column of its own making in
    seven inline styles on the older pages' grey, under Nizmo's name in
    spaced capitals, with the links under it in Title Case;
  - the whole page is marked as English, its frame too, where only its
    direction was set: in Arabic, a screen reader read the English as
    Arabic. The Arabic text rules in `components/ui/ui.css` follow the
    text's language now, not the page's, so they leave the English title
    its spacing;
  - each document's title is a page title, "Privacy policy" and "Terms of
    service", with when it was last updated under it, and its browser tab
    says "Nizmo — Privacy policy", as the app's pages say theirs. The terms
    name the privacy policy in sentence case too, and the privacy policy
    names Check in as the app's button says it. Their words are otherwise
    as they were;
  - their text is at `--text-lg` in `--ink-2`, and their headings, at
    `--text-xl`, and words in bold are at weight 500, where they were 700
    and 600; their notes have the neutral bar on their start edge, as a
    document's note has. The `.legal` block in `app/globals.css` is gone;
  - printed, the document is all there is, black on white from dark mode
    too. The app's print styles hide all but a paper it issues, so either
    page printed blank;
  - found in the web interface audit: a browser's translation, which the
    documents allow, could turn HERE, the mapping provider, into the word
    for "here". Its name is kept from translation (`translate="no"`).
- **2026-11-07:** What was left of the dashboard's frame on the building
  blocks (#221; `DESIGN.md` §5.1, and §5.5, Loading):
  - `components/DashboardShell.tsx` has no inline styles left: the frame
    is `.ui-shell` and `.ui-shell-main` in `components/ui/ui.css`, and the
    page's direction is the page's own, set with its language, where the
    shell set one of its own on the page's column;
  - the "Powered by" signature keeps its look, as the product owner decided
    on 2026-11-05: its sizes, colours and gradient are written in
    `app/globals.css`, beside where it sits, as they were drawn inline.
    Its transition of everything and a hover nothing could reach, as it
    takes no pointer, are gone, and its name is kept from a browser's
    translation, as its preview on System settings keeps it. In the
    browser, every pixel of it is as it was, in English and Arabic, light
    and dark, on a computer and a phone;
  - while the frame waits, the page says it's loading as every page does
    (`components/PageLoading.tsx`, which the dashboard's own loading
    screen is now too), in the page's language. It said "Loading
    section..." in English, in classes no stylesheet had.
- **2026-11-08:** The six old components no page used any more are gone
  (#222), as every page is on the building blocks, which do each of their
  jobs:
  - the old filter panel and its searchable select
    (`components/EmployeeFilter.tsx`, `components/SearchableSelect.tsx`),
    where the lists have the filter bar (`components/ui/FilterBar.tsx`, with
    `components/filters`); the obligation's card
    (`components/ObligationCard.tsx`); the pager (`components/Pagination.tsx`),
    where the lists have the building blocks' (`components/ui/Pager.tsx`);
    the sort control (`components/SortControl.tsx`); and the older pages'
    window (`components/Modal.tsx`), where every window is the building
    blocks' dialog;
  - what only they used went with them: the obligation card's highlight
    timer (`lib/useTemporaryHighlight.ts`) and its pulse, the filter panel's
    rule for a phone (`app/globals.css`), the 12 words only they said, in
    both languages, and the older pages' window's layer (`lib/layers.ts`);
  - so did the 28 colours only they drew with, in both themes
    (`app/globals.css`): the two paler surfaces, the borders, the body text,
    the faint text and the text on a fill, some of the green, red, blue and
    orange status colours and their fills, the two violets, two greys, a
    panel and a shadow. The two violets followed a company's brand colour,
    which no longer gives them a shade (`lib/brand-colour.ts`); the other
    shades are still held on the paler surfaces, so no company's colours
    moved;
  - the tests that read them now read what does their job: the pager's
    arrows are named on the building blocks' pager, a shared link's hidden
    filters are counted on the Tasks and Costs pages' filter bars, and the
    lists' employee filter sorts nothing it read in place. The contrast
    checks on the colours that went, went with them;
  - in the browser, the lists they once drew (Tasks, Costs, Obligations and
    Employees) are the same, pixel for pixel, in English on a computer and
    in Arabic on a phone;
  - the old pages' shared styles that lose their last users here (`.btn`
    and `.glass`) are left for a PR of their own, with the other old styles
    nothing uses, as tests still pin some of them.
- **2026-11-08:** The old pages' shared styles nothing used any more are
  gone (#223), with the animations only they ran and the values only they
  used (`app/globals.css`, DESIGN.md §10):
  - the old buttons (`.btn`, `.btn-primary`), cards (`.card`,
    `.glass-card`), fields (`.input`) and badges (`.badge`), the glass
    panels (`.glass` and its three tints), and the older pages' window
    (the eight `.modal-*` classes) with its small turning ring
    (`.spinner-small`);
  - the 14 classes that hid or showed a part by the screen's width, or
    laid out the old dashboard's grids (`.lg-hidden`, `.mobile-padding`,
    `.dashboard-stats-block` and the rest);
  - the three animations nothing ran any more (`pulse`, `fadeIn`,
    `modalScaleUp`), and a second copy of `spin`;
  - 30 values, in both themes: the glass's, the green, amber and blue
    status colours, the old field's outline, the translucent veils and
    panels, a shadow, the old faint rule (`--hairline`), the old corner
    size, the brand colour as text, the hover indigo, the pink and the
    violet. Three of them followed a company's brand colour, which no
    longer gives them a shade (`lib/brand-colour.ts`); the other shades
    are worked out as before, so no company's colours moved;
  - every class `app/globals.css` styles is now one some code puts on the
    page, and every animation in it one something runs
    (`lib/old-styles-gone.test.ts`);
  - the tests that held those styles now hold what does their job: a
    field's themed ground and text, a dialog's backdrop and the Super
    Admin's figures are checked on the building blocks, the focus ring is
    turned off only on the page's own, and nothing lifts on hover. The
    contrast checks on the colours that went, went with them;
  - in the browser, 25 pages, signed out and in, are the same, pixel for
    pixel, in English on a computer in both themes and in Arabic on a
    phone. Four first shots differed for reasons of their own and matched
    when taken again in both states: two were taken while the dev server
    restarted, and two with the pointer resting on the profile's first
    radio.
- **2026-11-08:** Menus, dialogs, toasts and the side bar move as they come
  in (#224), with Emil Design Engineering (§7.1), added to
  `.claude/skills/` as published, pinned, with a note on where `DESIGN.md`
  differs (`.claude/skills/SOURCES.md`). As `DESIGN.md` §8 now says:
  - a menu or a panel opened from its button (a row's menu, the account
    menu, the bell's panel, the company picker, and a date field's
    calendar on a computer) fades in as it grows from 96%, from the corner
    nearest its button, in 150ms. They appeared at once, in full;
  - a dialog fades in with the dimmed page and grows from 96% from its
    middle, in 200ms, and so does a date field's calendar on a phone;
  - a toast slides in as before, on the new curve. The side bar on a
    phone slides in over 200ms and out over 150ms, where it went as slowly
    as it came, and the page beside it dims as it comes in, where it went
    dark at once;
  - what comes in starts fast and settles (`--ease-out`); the side bar
    moves as a phone's own sheets do (`--ease-drawer`). Going is at once,
    but for the side bar, which stays in the page;
  - with "reduce motion" all of it is at once, fades too, where Emil
    Design Engineering would keep them: `DESIGN.md` wins (§7.3). In
    Arabic, the toast's slide still ran with "reduce motion" on, its
    right-to-left rule outranking the one meant to stop it, and was cut
    short only by the app's rule for every animation; it's stopped now;
  - the row menu and the calendar, which their code places, say which
    corner they grow from (`lib/grows-from.ts`);
  - in the browser, in English on a computer and in Arabic on a phone,
    each opens with its animation, duration, curve and corner, a row's
    menu above its button too (39 checks), and with "reduce motion" each
    is at once (22 checks). Once in, each looks as it did, pixel for
    pixel (17 shots). One first shot, the calendar's on a computer, was
    taken before the Tasks page's titles filter had loaded, as the dev
    server had just rebuilt, and matched when taken again.
- **2026-11-08:** A module's icon, chosen by its company (§4.4, #225). As
  `DESIGN.md` §6 now says:
  - a company picks each module's icon in Company settings, Modules, from
    48 of the app's own icons, each module's own among them. It picked an
    emoji, from 60 in the dialog or any one pasted into a field under
    them, and the side bar showed it at a size of its own, never filled;
  - the dialog's 48 are buttons 44px square, as many to a row as fit,
    each named for what it draws in the page's language. The one in use
    is filled, marked and heard as pressed, and focus starts on it; while
    the company has none of its own, that's the module's own. The emoji
    were 26px wide on a phone, under the 44px a finger needs, and none
    was marked while the company had none of its own;
  - the module's own, picked from the list or with Use the default icon,
    keeps nothing for the company, so it follows the module's icon;
  - the side bar draws a company's icon as it draws the others, filled on
    its page;
  - a migration maps what companies had chosen
    (`20261202000000_module_icon_names`): each emoji that was a module's
    default until #203 becomes the icon that took its place, with or
    without its variation mark, and any other goes, so the module shows
    its own. Their names for their modules are kept. Production had none
    to map on 2026-11-08: none of its 3 companies had an icon or a name of
    its own;
  - the API takes only icons from the list. The words for the emoji field
    went, and the Arabic name and tooltip of each module's icon button are
    verbal nouns now, where they told the reader what to do.
  - in the browser, against the scratch database: Delta Sites' 📊 for
    Records, 🚚 for Clients and 🔧 for Tasks became Dashboard's icon for
    Records, and nothing for the other two, once the migration ran. In
    English on a computer and in Arabic on a phone, the side bar and the
    Modules tab draw them, and the dialog's 48 are 44px, 8 to a row on a
    computer and 6 on a phone, each named, the one in use filled, marked
    and focused (65 checks). The truck picked for Clients and saved shows
    in the side bar, filled on its page. Records' own, with Use the default
    icon, and Clients' own, picked from the list, keep nothing. The emoji
    were 35px wide on a computer;
  - the web interface audit found the dialog's buttons missing from the
    list of controls that take a tap at once, with no grey flash, as the
    emoji were. They're in it now.
- **2026-11-08:** A module's icon was merged in #225. Ending a contract
  where the company's package doesn't include HR comes next, in #226
  (`DESIGN.md` §5.5, Dialog; `CLIENTS_PLAN.md` §7.3). It was left out of
  #202, as it changes what ending a contract records.
  - Ending a contract there records the ending alone, its team handed
    over as ever. It recorded a settlement, a payroll statement no screen
    there shows, and any debt the person owed back.
  - The dialog shows no settlement: it showed one, worked out from a
    salary such a company doesn't keep, and refused a day in a month they
    had none. What they still hold of a cash advance is said where the
    statement would be, as one waiting on someone. End contract still
    waits until that's worked out for the day picked.
  - That cash advance stays on their advance, on the Cash advances tab,
    to be returned. It became a debt, which only Payroll's screens show,
    as did what came back to them once they'd gone, such as a cost's part
    put back, and what they held as an ending dated ahead took effect.
  - The record follows the company's package, whoever ends the contract:
    the Super Admin's dialog reads the package from the company itself,
    where their session has everything.
  - A person's settlements, listed on their history, are Payroll's to the
    API as their payslips and debts are.
  - In the browser, against the scratch database, with Delta Sites sold
    Company Management without HR and Sami Nabil holding 750 of a cash
    advance: before, the dialog showed a settlement of 2,533.33 owed to
    them, for the company's Admin and the Super Admin alike, and ending
    their contract recorded it, the 750 a debt it took. Now the dialog
    shows no statement, as it opens or once it's worked out, for either:
    only that the 750 stays on the Cash advances tab. Ended the day
    before, the contract ends at once with no settlement or debt, and
    they're on the Cash advances tab, no longer at work, holding 750.00.
    In English on a computer and in Arabic on a phone, the Arabic's
    digits its own and nothing scrolling sideways (36 checks). With HR,
    the statement is as it was.
  - The web interface audit found nothing to change.
- **2026-11-08:** A client's statement (#227; `CLIENTS_PLAN.md` §6.9;
  `DESIGN.md` §5.5, Client statement and a document's table), from its
  mock-up. A client's charges were on screen only, on its page and the
  Costs page's Charged to clients tab: none of it could be printed or
  sent to the client.
  - Statement, beside Mark collected on the client's Charges, opens it for
    the dates picked there, or last month where none were. It's there for
    whoever sees all the company's charges: a Team Leader, who sees their
    team's only, doesn't get it, and the server refuses them too.
  - The page header has Print. Above the sheet, at its width, are the
    period, With receipts and a hint that the print dialog saves a PDF;
    the page's address keeps the period and the tick.
  - The sheet lists the period's charges in a document's table, a new
    building block: Paid, Service fee, Total and status, its foot counting
    them and summing the three. On a phone each charge is a block of
    lines. Then Charged in this period, Collected, what's still due from
    before the period, and Still due, with a note saying what's due.
  - The receipts follow, numbered as the list numbers them, each photo
    whole; printed, from a new page, four to a page. A PDF opens from its
    place, and printed, says it's a file of its own.
  - Printed, the table's headings start each page it runs onto, no row is
    split, and its rules are in a grey that prints, `--rule-on-paper`.
  - At most 200 charges: a longer period asks for a shorter one.
  - In the browser, against the scratch database, with Acme Supplies
    charged 10 times in October, three of them collected on 2 November,
    one charge from September still due, and three receipts, one of them
    a PDF: before, the client's Charges had no Statement and the address
    was no page. Now the Admin's Statement opens October, its sums as the
    database has them, printed on three A4 pages with the receipts on the
    third. Unticked, the receipts and their numbers go; 29 October alone
    has its 9 charges and what was due before it; 201 charges ask for a
    shorter period. The Team Leader gets no Statement, and the address
    says there's no such statement; a role with all the company's
    charges, and the Super Admin, get it. In English on a computer and in
    Arabic on a phone, nothing scrolling sideways (27 and 24 checks).
  - Found in the browser flows, printed: every page after the first
    showed the page's ground, the table's foot was repeated at each
    page's foot, days broke over two lines, the receipts' line saying
    whose they are was larger than their heading, and a photo whose edge
    is white covered its frame's line. On a phone, in Arabic, a charge
    described with a link put its total outside the sheet. All are fixed,
    `DESIGN.md` first. What was bought, the person's own words, keeps its
    own direction, as the client's Charges has it.
  - The web interface audit found nothing more to change. The receipts'
    photos load as the page opens, not as they're scrolled to: one not
    loaded yet could print blank.
- **2026-11-08:** From Codex's review of #227: a client's statement page
  shows only the statement fetched for its address. With the period
  cleared, the one for the dates before was kept while last month's
  loaded, shown as last month's and printable, and it stayed in place of
  last month's refusal where that had more than 200 charges. Meanwhile
  the page header still names the client, and the period is blank until
  last month's statement comes.
- **2026-11-08:** Two bug fixes (#228).
  - Add employee saved a pay typed as "1e" as 0, and a day off credit
    typed that way too. In a number field, the browser reads what it
    can't make a number of as empty, as though it had been left empty,
    and the server counts an empty one as 0. It's now said wrong under
    its field before anything is sent, and the pay field takes the focus,
    as the profile form has done since #193.
  - A new password ends the account's other sessions: a temporary one an
    Admin gives, one set on the profile, one's own or someone else's, and
    the one the Change password page asks for. Only a reset by email did
    (#198), so the account stayed signed in wherever it was, such as by
    someone who had learned the old password. Each session ends at its
    next check, within a minute. The browser a person sets their own from
    stays signed in: the account keeps it, at the version that ended the
    others (`ROLES_PLAN.md` §4.4), so nothing it asks meanwhile is
    refused.
  - In the browser, against the scratch database: before, "1e" and "-"
    were saved as a pay of 0.00 and a day off credit of 0, and a minute
    after each new password the account's other browsers were still
    signed in. Now both are said wrong under their fields and nothing is
    saved; typed again, the person is added with them. Within a minute of
    one's own password on the profile, an Admin's temporary password and
    one set on someone's profile, their other browsers are signed out.
    The browser that set its own, and the Change password page, stay
    signed in through their next check with nothing they asked refused,
    their cookies at the new version. In English on a computer and in
    Arabic on a phone (23 checks each).
  - Found in the browser flows: Save on the Change password page does
    nothing to the session if it's pressed before the page has loaded it,
    as next-auth's update() does nothing then, so the page comes back,
    the password changed. It was so before this, and seen only when the
    dev server reloaded the page; a person typing a password twice takes
    longer than the page does.
  - The web interface audit found nothing to change.
- **2026-11-08:** From Codex's review of #228: the session a new password
  of one's own keeps is worked out from the account's row as the write
  moves it on, the row locked first. Two saves at once from the same
  browser each kept it at the version after the one both had read, and
  the account, moved on twice, was past that, so the browser was signed
  out too. Set from two browsers at once, the first password still ends
  the other browser's session, and neither is kept (`ROLES_PLAN.md`
  §4.4).
- **2026-11-08:** One's own password, checked by the server (#229).
  - A new password of one's own needs the current one, sent with the
    save and checked by the server, for people and Super Admins alike.
    The profile asked for it before a save, but only in the browser, and
    the save didn't: a session someone else held could set a new password
    without knowing the old one, and since #228 that ends the owner's
    other sessions too. The forced change after a temporary password
    doesn't ask again for the one just used to sign in, from a session
    signed in since it was given.
  - Wrong tries at one's own password are counted per account, wherever
    the server asks for it: the profile's check, the save, and an Admin's
    own confirming a temporary password. Five in fifteen minutes, then
    none until the fifteen minutes are up, which the password dialog
    says. The profile's check said whether a guess was right as often as
    it was asked.
  - The audit log hides any field a request sends whose name says it's a
    password, a passcode, a token or a secret. It hid five names, and a
    temporary password's route sends the Admin's own as confirmPassword,
    which it kept as typed. No temporary password had been given in
    production yet.
  - In the browser, against the scratch database: a new password of one's
    own sent without the current one, or with a wrong one, is refused and
    nothing is written; on the profile, the password the dialog asks for
    is sent with the new one, which is saved, the browser still signed
    in. Five wrong tries in the dialog are each said wrong, and the sixth,
    the right one too, says too many tries; the same for an Admin's own
    confirming a temporary password. Signed in with a temporary password,
    the Change password page saves without asking for it again. In
    English on a computer and in Arabic on a phone (16 checks each).
  - The web interface audit found nothing to change: the new mistake is
    said under the dialog's field, as a wrong password is.
- **2026-11-08:** Unlock lifts the pause on somebody's password tries
  (#230).
  - Five wrong tries at one's own password paused it for fifteen minutes,
    with nothing to do but wait: profile saves and an Admin's temporary
    passwords with it. Unlock, beside the person's status, now lifts it
    as it lifts a sign-in lock, for whoever may reset their password: a
    Super Admin anywhere and a company's Admin for their own people
    (decided 2026-11-08), never one's own.
  - The people list says until when somebody's password tries are paused,
    beside their status on Employees and All users, with Unlock named for
    them; where sign-in is locked too, it says that, and Unlock lifts
    both. The audit log records it as unlocking sign-in and password
    tries.
  - At too many tries, the password dialog says the company's Admin can
    unlock it now, as signing in does.
  - In the browser, against the scratch database: an Admin's password
    tries paused, the Super Admin sees until when, beside their status,
    with Unlock named for them; Unlock says so, the pause goes, the right
    password works again and the audit log has it; one's own is refused.
    In English on a computer and in Arabic on a phone (8 checks each).
  - The web interface audit found nothing to change: the pause is shown
    as the sign-in lock is, with the same button.
- **2026-11-08:** Somebody else's password or email needs the saver's own,
  checked by the server (#231).
  - The profile asks for the saver's own password before every save, but
    only in the browser, and the save didn't check it: a session someone
    else held could set a person's password, or their email and then reset
    it, and sign in as them. They're the two ways into an account, which a
    temporary password already asked the saver's own for.
  - Missing or wrong, the save is refused and nothing is written, said
    above the buttons as a wrong password. Its wrong tries are counted
    with the rest of one's own: five in fifteen minutes, then none, which
    Unlock lifts.
  - The rest of a profile isn't asked for it by the server: a new salary
    asks for a recent authenticator code, and the photo and a suspension
    are saved on their own.
  - In the browser, against the scratch database: somebody else's new
    password or email sent without the saver's own, or with a wrong one,
    is refused and nothing is written, while the rest of their profile is
    saved; on their profile, a wrong one in the dialog is said under it,
    and the right one saves their new password, sent as the Admin's own;
    a refusal of the save itself is said above the buttons; after five
    wrong tries, the right one is refused too, and the dialog says so. In
    English on a computer and in Arabic on a phone (12 checks each).
  - The web interface audit found nothing to change: nothing new is shown.
- **2026-11-08:** Two leftovers from a new password ending sessions (#232).
  - Save on the Change password page, pressed before the page had loaded
    its session, did nothing to it: the session still said the password
    had to be changed, and the page came back, though it had been. Found
    in #228's browser flows. The page now asks the server to write the
    session again itself, and the minute's check catches a session up
    with the account should one be left saying so.
  - A browser the server signed out, its session ended by a new password
    or a role changed with "Apply now", came back to the sign-in page
    with nothing said. The page now says, above Sign in, as a note, that
    the session ended, as it does when the password or the role changes,
    until anything is sent (DESIGN.md §5.5, Sign-in). Signing out by
    one's own choice says nothing.
  - In the browser, against the scratch database: signed in with a
    temporary password, Save pressed while the page's session was held
    back goes to the dashboard, the new password saved and the session
    clear of the flag; the page from before this went back to Change
    password. An ordinary sign-in page says nothing; a browser whose
    session an Admin's new password ended, opening a page, and a page
    left open whose own request was refused, are each told at sign in,
    until a wrong password is said in its place; signing out from the
    account menu says nothing. In English on a computer and in Arabic on
    a phone (13 checks each).
  - The web interface audit found nothing to change: the note is the
    sign-in page's own, where its other notes are, and screen readers
    hear it.
- **2026-11-08:** The "Powered by" signature on the sign-in page (#232),
  as the product owner asked: only the dashboard had it, so the first page
  anyone sees didn't. The same mark, drawn by the same component, in the
  same places: the bottom corner on the end side on a computer, and on a
  phone at the end of the page, under the links and switches. System
  settings' switch and name apply to it as to the dashboard's.
  - In the browser, against the scratch database: in English and Arabic
    at 1280 and in English at 1024 it's in the end corner, over neither
    the card nor the links; at 768 and at 360 in both languages it's
    under the links and switches, the Arabic phone page still one screen
    tall; the name set in System settings is shown, and switched off it
    isn't there (14 checks).
- **2026-11-08:** The audit log reads a company's section names and icons
  one section at a time (#233). They're logged as the two whole maps,
  before and after, as they're written, and the log showed them as JSON:
  `{"tasks":"Jobs"} → {"tasks":"Work orders"}`. Each section that changed
  now has its own line, named as the section is by default: "Name for
  Tasks: Jobs → Work orders", "Icon for Tasks: Default → Hard hat". A
  section with nothing set reads Default; an icon from before the palette
  (#225) is shown as it was stored. What's stored is unchanged, so the
  entries already there read the same way.
  - Found in the browser: a change whose two sides were both in the other
    language's script read the wrong way round. "Vendors ← Customers" in
    an Arabic line drew as one run left to right, the arrow pointing at
    the name it had been, and two Arabic names in an English line did the
    same. Each side of a change is now drawn in its own `<bdi>`, the arrow
    between them taking the page's direction, for every change in the
    log.
  - In the browser, against the scratch database, as the Super Admin: a
    company's sections renamed twice and given an icon, as the Modules
    tab saves them, are logged as the whole maps, as before, and the
    newest entry reads one line for each section that changed, with no
    JSON; each change is drawn with its before where the line starts and
    the arrow pointing at its after, two English names in Arabic and two
    Arabic names in English included; the page doesn't scroll sideways.
    In English on a computer and in Arabic on a phone (6 checks each).
    The lines follow the order the details are stored in, the icons
    before the names, and each map's sections the side bar's order.
  - The web interface audit found nothing else to change: the lines are
    the log's own, in its own type.
- **2026-11-08:** What the building blocks draw is drawn by them, not
  copied by hand (#234). Three leftovers of the move onto the building
  blocks:
  - Two buttons had their classes typed out. The Roles card's Export, a
    file the browser fetches itself, is `ButtonDownload`, which a
    section's link to a file uses too. The Brand colour card's preview of a
    button, which no one can press or reach, is `ButtonLook`. Both look as
    they did.
  - An audit entry's phone card gave what it was on as a fragment in a line
    laid out as a row, so its type, the comma and its ID each took a place
    of their own, and in Arabic the comma fell under the type, on a line of
    its own. It's one piece of text now, as every other card's detail is.
    Found in #233's screenshots.
  - The UI kit page's inline styles: it's a page, as the others are, its
    phone cards hold their due date and points as the Tasks list's do, its
    form is as wide as a form, and its rows of samples have a class of
    their own.
  - `lib/blocks-not-by-hand.test.ts` keeps it so: no button's classes
    typed out on a page, no card detail given as a fragment, no inline
    styles on the UI kit page.
  - In the browser, against the scratch database, as the Super Admin: on a
    phone, each audit card says its type and the comma after it on one
    line, the ID after them, where the page from before this put the comma
    on a line of its own; the Roles card's Export is a secondary button
    with its icon, and pressed, the browser downloads the roles file; the
    brand preview's button is a small primary one in the colour it
    previews, in light and dark, which no one can press or reach; the UI
    kit page has no inline styles, its samples side by side and wrapping,
    its form as wide as a form. In English on a computer and in Arabic on
    a phone (11 checks each), and the card in English on a phone too.
  - The web interface audit found nothing else to change: nothing new is
    shown, and what was is drawn as before.
- **2026-11-09:** An advance for a particular task or client, its first
  part (#235; `CLIENTS_PLAN.md` §7.9, 7e). The screens, on the blocks
  they already had (`Choice`, `Select`, `Field`, `Details`, `Card`), so
  `DESIGN.md` needs nothing new:
  - **Give advance** asks what it's for: any cost, a task or a client.
    Picking a task or a client offers the open tasks the person is on, or
    the company's clients, and Give advance waits for one; with none to
    offer, it says so. Under the pick: it's kept apart from the running
    balance, for this alone. The words say what costs do with it only from
    7f, when they do.
  - **Record return and Correction** ask which part they're on, From,
    where the person holds money for a task or a client: the running
    balance or one of those, each with what's held, the name isolated so
    a name in the other script keeps its place beside the amount. The
    balance shown, and the balance after, are that part's.
  - **A person's cash advance,** theirs on My cash advance too: the running
    balance beside the balance, a card of what's held for each task and
    client, the task a link to its page, and each entry saying what it was
    for, with its note under it.
  - **The Cash advances tab:** under each balance, how much of it is for
    tasks or clients.
  - **Found in the browser and fixed:** right after an advance was given
    for a client, Record return didn't offer the client's money: the
    dialog read the person's parts as it first opened. Each entry saved
    reads them again. And on a phone, in Arabic, From cut each part's
    amount off; it says only the name and the amount now.
  - In the browser, against the scratch database, as the Admin: Give
    advance offers the open tasks the person is on and only those, and
    waits for one to be picked; an advance for a task and one for a client
    are kept each for what it was given for; Record return offers the
    running balance, the task's and the client's, refuses more than the
    task's 400, shows 400 and 250 after, and takes the 150 from the task's
    money; the person's page shows the running balance, 250 held for the
    task and 300 for the client, and what each entry was for; the Cash
    advances tab says 550 of the balance is for tasks or clients; nothing
    scrolls sideways. In English on a computer and in Arabic on a phone
    (16 checks each).
  - The web interface audit found nothing else to change.
- **2026-11-09:** Costs spend the money held for them first (#236;
  `CLIENTS_PLAN.md` §7.9, 7f). On the screens:
  - **Add cost** says what pays a cost on this task, in order, where the
    person holds money for it or its client: "400.00 EGP for this task,
    then 300.00 EGP for Nile Foods, then 665.00 EGP from your running
    balance", each amount in the number style and the client's name
    isolated. Money for any other task or client isn't counted. It said
    the whole balance, which, once part of it was for another task, a cost
    here couldn't all spend. Holding none for a task or a client anywhere,
    it says the one balance, as before.
  - **A person's cash advance:** a Spent entry says which part it took
    from, "For Nile Foods", unless it's the entry's own task, which its
    task line already says. Each entry's lines, its task, its part and its
    note, each have their icon, in the table and on a phone's card.
  - **Found in the browser and fixed:** on a phone, in Arabic, an amount
    in Add cost's line broke between its number and its currency at the
    end of a line. Each stays on one line now.
  - In the browser, against the scratch database, as the employee holding
    400 for the task and 300 for its client beside 665: Add cost says the
    task's 400, then Delta Foods' 300, then the running balance; a 500
    cost takes 400 from the task's money and 100 from Delta Foods', the
    running balance untouched, and Add cost then says Delta Foods' 200,
    then the running balance; My cash advance names Delta Foods on the
    100, and doesn't repeat the task on the 400; removed, 400 goes back on
    the task's money and 100 on Delta Foods'; nothing scrolls sideways. In
    English on a computer and in Arabic on a phone (11 checks each).
  - The web interface audit found nothing else to change.
- **2026-11-09:** The client statement in two versions (#237;
  `CLIENTS_PLAN.md` §6.9; `DESIGN.md` §5.5, Client statement), from the
  mock-up the product owner approved
  (https://claude.ai/artifact/RuPsgbZJXxa93nV2D4FTTm): a cost's name was
  there to add costs up by, and the statement listed each charge only.
  - Tabs above the sheet pick Every charge, as it opens, or By cost name,
    with a line under them on what each shows, kept in the address
    (`by=name`). The sheet says which it is under the company's name.
  - By cost name: each name, how many charges, Paid, Service fee and
    Total, highest total first; its foot counts the names and the charges.
    The totals and the note under it are Every charge's.
  - Which charges are under one name: `costNameKey()` and `byCostName()`
    in `lib/client-statement.ts`. The server reads each charge's saved
    name and the company's saved cost names with the charges, and sends
    the names with the statement.
  - The receipts are under each name, in the table's order, numbered that
    way (`receiptsByName()`), with each one's day and task, and the name's
    charges with no receipt said under them.
  - "Receipts" is a count word, in both languages.
  - **Found in the browser and fixed:** on screen, each name's heading over
    its receipts was larger and bolder than Receipts above it. It's the
    small size now, bold, and a size up on paper, where Receipts is as
    large as the sheet's company.
  - **From the web interface audit:** a name in the table, and a name or
    task over the receipts, breaks inside a long word, as a charge's does,
    rather than push the amounts out; the tabs name their panel only while
    there is one; the receipts' groups use the page's own directions.
- **2026-11-09:** Cost names only from the saved list (#238;
  `CLIENTS_PLAN.md` §6.9; `DESIGN.md` §5.3, a name typed or picked from a
  saved list), as the product owner asked, so a company can keep a client
  statement's lines by cost name exact.
  - **Company settings, General tab:** a Cost names card, for a company
    with the Costs module, on the building blocks as the Cash advances
    card is: Only names from the saved list, On or Off, with Turn on or
    Turn off, and how many names the saved list holds.
    - Turn on waits for a name on the list, and the card says so, with a
      link to Saved lists for the company's own people.
    - Whoever can only look sees it without a button.
    - The Super Admin's page for a company has it too (`/api/companies`).
  - **A task's Add cost, where it's on:** the name field says "Cost name,
    from the saved list" before anything is typed. On Add:
    - a name picked is taken;
    - a name typed in full as the list has it, capitals and the spaces
      around it aside, is taken as that name (`nameOnList()` in `lib/saved-lists.ts`);
    - anything else stays unadded, and the field says why under it, in the
      error colour, until it's typed again: pick one, or add it from the
      suggestions for whoever may add names, or ask whoever keeps the
      saved lists. With no name, it says one is needed.
  - **The server:** `costNamesFromListOnly` on the company, added by a
    migration, false for every company. Turning it on with no names is
    refused (`COST_NAMES_NONE_SAVED`). A cost's name that isn't the list's
    is refused when the task is handed in (`COST_NAME_NOT_ON_LIST`), and
    nothing of the submission is saved.
  - **Found while building it:** a typed name was matched with Prisma's
    case-insensitive `equals`, which runs as ILIKE, so "%" was taken as
    any name. It's matched as typed now.
  - **Also:** the Arabic for a name that couldn't be added to its list
    asks with يُرجى, as the app's other requests do.
  - **Found in the browser and fixed:**
    - Add read the setting from the side bar's settings after the page
      came, so a cost added first wasn't checked, and a Super Admin's
      never was. It comes with the task now, its company's, from the
      server;
    - the focus went to the name field after an error, and its
      suggestions covered the error. The error is said as it comes
      (`role="alert"`), and the focus stays on Add;
    - Add, busy while it checks, was disabled, which dropped the focus to
      the page. It says it's busy and takes no second press instead;
    - an error under the name pushed the amount and Add down below it.
      The row lines them up at their tops.
  - **From the web interface audit:** Saved lists, in the card's note, was
    the browser's own blue. It's a link in a sentence as `DESIGN.md` has
    them (`.ui-text-link`): the brand's text colour, underlined, its name
    on one line. And the note says "turned on", as its button does.
  - **Browser flows** against the scratch database, in English on a
    computer and in Arabic on a phone (27 checks each): the card with no
    names and with nine, turned on and audited; an employee's Add cost
    refusing "taxi home" with the error under the field, taking
    "  TRANSPORT " as Transport and a picked Parking, saying a name is
    needed, and saving the draft with each linked to its name; the server
    refusing a name sent past the page; turned off, any name again; and
    the Super Admin's page for the company. Nothing scrolls sideways.
  - **Codex's review, fixed:**
    - saved or handed in while Add checked a cost's name, the task went
      without that cost, which the save's clearing could then drop with its
      receipt. Save draft and Submit wait for the check now;
    - a saved name with two spaces inside it, "Taxi  home", was refused
      typed exactly: the spaces inside what was typed were made one. A
      typed name keeps its inside spaces now, on the page and on the
      server, as the list does (`DESIGN.md` §5.3).
    - while Add checked a name, the amount, the name and the receipt could
      still be changed, and Add then took what it was clicked with and
      cleared the change. The cost's fields wait for the check too.
- **2026-11-09:** What's left of an advance for a task or client moves to
  the running balance (#239; `CLIENTS_PLAN.md` §7.9, 7g), as the product
  owner decided.
  - **On its own:** a task approved, or completed, as one with no costs
    is, or deleted, and a client archived or deleted, move what anyone
    holds for it to their running balance, as a pair of Moved entries,
    recorded by whoever did it. A rejected task keeps its money: it can be
    handed in again. `CashAdvanceService.movePart()`, from the task's
    review and deletion and the client's deletion, which archives one with
    tasks.
  - **By hand:** on a person's cash advance, each task and client under
    Held for has Move to running balance beside its amount, for whoever
    may give and settle their advances (never on one's own), with
    two-factor sign-in. A confirmation says how much, what it was for and
    whose running balance it joins; its main button isn't red, as nothing
    is lost. `POST /api/cash-advances/[userId]/move`; with nothing left to
    move, `CASH_ADVANCE_NOTHING_HELD`.
  - **The history:** a Moved entry taken from a task or client since
    deleted says "From a task or client since deleted", where it said
    nothing.
  - **The audit log:** each move is a line of its own,
    `MOVE_CASH_ADVANCE`, saying how much, what it was for, and why: the
    task approved or deleted, the client archived or deleted, or by hand.
  - **From the web interface audit:** the button's name said the amount
    first, so it didn't start with the words it shows, and someone using
    voice control couldn't name it by them. It starts with them now:
    "Move to running balance: 400.00 EGP held for Clean the vents". And
    in Arabic, the amount is "مبلغ … المخصّص", agreeing with مبلغ.
  - **Browser flows** against the scratch database, in English on a
    computer and in Arabic on a phone (12 checks each): Held for with a
    Move button on the task's money and the client's, each named for what
    it moves; the deleted task's entry saying so; the confirmation's
    words; the task's 400 moved as a pair after two-factor sign-in, Held
    for then listing the client only, the toast, the focus kept on the
    other row's button, and the audit line saying by hand; and the
    employee's own My cash advance with no Move button. Nothing scrolls
    sideways.
  - **Codex's review, fixed:**
    - moving by hand while the same client was archived could leave each
      waiting on the other: the archive held the client and wanted the
      person's advance, and the move the other way round. Whatever writes
      an entry for a task or a client now holds that task, then that
      client, before anyone's advance, as approving, deleting and
      archiving do: giving, returning, correcting, moving by hand,
      spending, putting back and leaving the company
      (`holdParts()` in `lib/services/cash-advance.service.ts`);
    - a rejected task paid is approved or completed without a review, so
      its money stayed held for it. Paying it, one share or Mark all as
      paid, moves it now, the audit saying the task was paid
      (`TASK_PAID`);
    - an advance given for a task while its approval was being saved, or
      for a client while it was being archived, could be saved after the
      move and stay held for it. It waits for the task or client now, and
      then finds it decided or archived and is refused.
  - **Found while fixing them:** a cost removed after its client was
    archived put its money back on that client's, where nothing could
    spend it. It goes on to the running balance.
  - **Codex's second review, fixed:**
    - deleting a task held the people its costs' money went back to, then
      those holding money for it, in two steps: two deletions could each
      hold one and wait for the other. Everyone a deletion changes is held
      at once, in one order, first (`holdForTaskDelete()`);
    - a Super Admin removing a cost whose money then moved on from an
      archived client was logged as a user, which the audit log refused,
      and the removal with it. Who removed it is carried through, as a
      Super Admin.
  - **Codex's third review, fixed:** ending a contract, holding the
    person's row, then held the tasks their money was for as an approval
    does, while an approval holds its task and then updates that person's
    points: each could wait on the other. A task or client is held by its
    key only now, which waits for a deletion or an archive but not an
    approval; only an advance given holds it whole, to wait for an
    approval and find the task decided.
- **2026-11-09:** A switch to turn off the high-risk confirmation (#240;
  `ROLES_PLAN.md` §6.15), as the product owner decided.
  - **On System settings,** the Super Admin turns it off or on for every
    company. **On Company settings' General tab,** where it's on for all,
    a company's Admin turns it off or on for their company, and the
    Super Admin can for any company. Where it's off for all, the
    company's card says so and offers nothing to turn.
  - **Off, nothing extra is asked:** paying, approving payroll, giving
    advances, ending contracts, deleting and the other high-risk actions
    go through with no code, and need no two-factor sign-in.
  - **Turning either one off or on asks for a code once,** and the audit
    log says who did it, from what to what.
  - **What it doesn't change:** a Super Admin follows the system's switch
    only. Their own actions that aren't permissions, such as deleting a
    company, still ask for a code, and so does turning a switch.
  - **Browser flows** against the scratch database, in English on a
    computer and in Arabic on a phone (15 checks each), put back after
    each run: the Super Admin's card On with Turn off; turning it off
    asked first, its button not red, then a code, then Off with Turn on,
    and the audit line theirs; Hana's Company settings saying it's off
    for every company, with nothing to turn; on again; Hana turning her
    company's off the same way, the toast, the focus kept on the button,
    now Turn on, and the audit line hers; with it off, an advance given
    with no two-factor sign-in, and with it on, refused until it's set
    up. Nothing scrolls sideways.
  - **From the web interface audit:** nothing to change. The buttons are
    the building blocks', turning off is asked first, the toast says it's
    saved, and the focus stays on the switch's button as it flips.
  - **Codex's review, fixed:** the Super Admin's Company settings load the
    company from `/api/companies`, which sent neither the company's switch
    nor whether it's on for every company. So a company that had turned it
    off read On, with only Turn off, and where it was off for every
    company the switch was still offered. That endpoint sends both now,
    and the browser flows open the Super Admin's view of the company too
    (17 checks each).
- **2026-11-09:** What's held for a task follows it when it's transferred
  (#241; `CLIENTS_PLAN.md` §7.9, 7h), as the product owner decided.
  - **Only a transfer that makes a copy moves anything,** one that adds
    someone. Whoever's still on the copy keeps what they held, now for the
    copy, with nothing to confirm. Whoever's left off passes theirs to one
    person on the copy, who confirms receiving it on My cash advance and
    can spend it meanwhile. Passing it needs whoever transfers it to be
    able to give and settle both advances, with two-factor sign-in, asked
    once; otherwise it joins the left-off person's running balance.
  - **The ledger:** a new kind of entry, `TRANSFERRED`, in pairs, with
    `counterpartName` saying who the other was where it passed between
    two people. The migration, `20261207000000_advance_transfer`, adds the
    kind and the column, and lets a positive one be confirmed. The audit
    log has `TRANSFER_CASH_ADVANCE` for each, and Moved entries say
    "Taken off the task as it was transferred".
  - **One answer for both:** `transferPlan()` (`lib/cash-advance-transfer.ts`)
    says what happens, for the transfer (`CashAdvanceService.followTransfer`,
    from `TaskService.transfer`) and for its dialog
    (`GET /api/tasks/[id]/transfer?to=&goesTo=`).
  - **Transfer task's dialog** says it under the people picked, under a
    heading of its own (`DESIGN.md` §5.5, Dialog): a line for each person
    holding any, the amount only for whoever may see their cash advance.
    Where it passes on and the copy has more than one person, who takes
    it is picked there, and Transfer waits for the pick. Where no one's
    added, it says what's held stays with the task. It's worked out again
    as people are picked, the last lines staying meanwhile, with Try again
    if it couldn't be. Who takes it missing, or not on the copy, is
    refused in the page's language: `TRANSFER_HELD_RECEIVER_REQUIRED`,
    `TRANSFER_HELD_RECEIVER_INVALID`.
  - **On a person's cash advance,** the pair reads "Moved with the task's
    transfer", with "To" or "From" whom. Money passed on is awaiting, with
    Confirm receipt, asking whether it reached them from that person.
  - **Browser flows** against the scratch database, in English on a
    computer and in Arabic on a phone (16 checks each), put back after
    each run: Hana taking Youssef off Delta Sites' task with no one added,
    told it stays; adding Rami, told Sami keeps their 120 and Youssef's 250
    passes to whoever's picked, with Transfer waiting; Rami picked, then
    sent with a code; the entries and the audit lines as they should be;
    Youssef's history saying to whom; Rami confirming receipt from
    Youssef. Nothing scrolls sideways.
  - **From the web interface audit:** nothing to change.
  - **Codex's review, fixed:** money could pass to someone no longer at
    work, whose contract had ended, and a Super Admin's transfer to another
    company's person put it in the task's company, where they couldn't see
    or settle it. It passes now only to someone of the task's company at
    work, read under their hold, and otherwise joins the left-off person's
    running balance, as the dialog says. A Postgres test failed first.
- **2026-11-09:** A company's high-risk switch while the Super Admin has
  the system's off (#242; `ROLES_PLAN.md` §6.15), as the product owner
  decided.
  - **On Company settings' General tab,** the card reads Off, with Turn on
    still there but greyed: `aria-disabled`, not `disabled`, so the
    keyboard reaches it and a screen reader hears the note beside it as
    its reason, and clicking it does nothing (`DESIGN.md` §5.2). The note:
    "Turned off by the Super Admin. Only the Super Admin can turn it on
    again." On the Super Admin's own view of a company, a link to System
    settings follows it.
  - **The server refuses it too:** `CompanyService.update()` refuses a
    change to a company's switch while the system's is off,
    `HIGH_RISK_OFF_FOR_ALL` (409), for its Admin and the Super Admin
    alike, before any code is asked. The General tab's other settings
    still save, a refused change writes nothing to the company or the
    audit log, and the company's own choice counts again once the
    system's is on.
  - **Turned off while the page is open:** Turn off is refused, said in
    the page's language, and the card greys at once.
  - **Browser flows** against the scratch database, in English on a
    computer and in Arabic on a phone (10 checks each), put back after
    each run: Hana's card greyed, reached by the keyboard, its reason
    heard, a click doing nothing; the server's refusal, with nothing
    changed or logged; Sara's view of Delta Sites the same, with the link;
    with the system's on, a working Turn off; the system's turned off
    while Hana's page is open, refused with no code asked, and the card
    greyed. Nothing scrolls sideways.
  - **From the web interface audit:** the System settings link was in the
    note's grey, with nothing to say it was a link; it's a link in a
    sentence now, in the brand's colour and underlined, as the cost names
    card has it.
- **2026-11-09:** The roles tests against Postgres pass again (#243).
  - **Why three failed:** `lib/roles.db.test.ts` builds its database from
    the migrations it names, not all of them, and it named none of the
    ones that have added a column to a company or the system's settings
    since the brand colour (#80). Prisma reads and writes those rows
    whole, so the three tests that saved a company (a company's default
    role, copying roles, access reviews) failed on a missing column, on
    `main` too. Production has every migration, and CI has no database,
    so neither saw it.
  - **Now:** the test also runs the brand colour, cash advance, cost
    names and high-risk switch migrations, and a new test fails, naming
    them, when a column a company, a person or the system's settings have
    in the schema is missing from the database it builds. It failed
    first, naming the seven columns.
  - Only the test changes; no screen or rule does.
- **2026-11-10:** Live updates, decided with the product owner
  (`REALTIME_PLAN.md`): what someone else changes appears on the screens
  of the people it concerns, without a refresh, beginning with a task
  assigned to someone appearing in their list and their bell.
  - **Signals only:** the server says that a company's tasks changed, or
    that a person has a notification, never what; each screen draws itself
    again through its usual route and checks.
  - **Sent by the database,** from triggers, in the same transaction as
    the change, one per statement.
  - **Private channels,** behind the app's own token, for an hour, signed
    with the project's JWT secret, which the product owner adds to Vercel.
  - **In four parts:** tasks and the bell (#244); the Requests page and
    its count; an account suspended signed out within seconds; other
    screens as they're wanted.
- **2026-11-10:** Live updates part 1 is live (`REALTIME_PLAN.md`), merged
  in #244: the project's JWT secret was already in Vercel, from the
  Supabase integration, and the product owner checked it in production.
  At the product owner's request, a fifth part is planned last: a little
  motion for what arrives live (Proposed), which changes `DESIGN.md` §8
  first when it's built.
- **2026-11-10:** Who shows as online follows the heartbeat (#246). On the
  Employees list and the Super Admin's All users, someone counted as online
  for 60 seconds after their tab's last beat, while a tab beats every 90,
  so a person at work showed as Offline a third of the time.
  - **The window:** online for two beats and 20 seconds after the last
    (200 seconds), so one beat lost to a bad connection doesn't show them
    offline. The window and the beat are read from one place,
    `lib/presence.ts`.
  - **The filters:** Online and Offline list who the badges say. Offline
    listed only those who had signed out, and Online also those whose last
    tab had closed without signing out.
  - Someone who closes their last tab without signing out shows as online
    for up to 200 seconds, where it was 60.
- **2026-11-10:** An account deleted while it's signed in is refused and
  signed out (#247). It went on working on the session it had: the server
  refused only a suspended, closed or banned account, the heartbeat said a
  deleted one was active, and a row deleted outright left a session that
  matched nothing, which nothing ended.
  - **Deleted, the row kept:** refused like a suspension, by the API and
    by every page that reads the database (`lib/account-refusal.ts`), and
    the heartbeat signs the browser out once the work open on it is saved,
    under Account deleted (`DESIGN.md` §5.5).
  - **Deleted outright:** its session ends at its next check, a minute at
    most, and the browser is signed out.
- **2026-11-10:** Live updates part 3 (`REALTIME_PLAN.md`, #248): someone
  suspended, closed or deleted, or whose company is banned, sees the screen
  over a page the app has to leave (`DESIGN.md` §5.5) within seconds, and
  is signed out, where it waited for the heartbeat's next beat, up to 90
  seconds on.
  - The database signals it on the channels part 1 already has; the
    heartbeat hears it, asks at once, and goes on asking every 90 seconds
    as the safety net.
  - Nothing on the screen changes but when it comes.
- **2026-11-10:** The account status route answers a company's Admin
  (#249). They may use it (`employees.change_status`, as for the status
  field of an edit), but its audit entry named every caller as a Super
  Admin. Named as one they aren't, the entry broke its foreign key after
  the status was saved, and the route answered 500. A company's own people
  are now named as themselves, as an edit and a delete already name them.
  No screen calls the route, so nobody saw it.
- **2026-11-10:** Live updates part 2 (`REALTIME_PLAN.md`, #250): the
  Requests page and the count on Requests in the side bar draw themselves
  again as a request is asked for, decided or withdrawn, as the task list
  does (`DESIGN.md` §8): in place, keeping the tab, filters, search and
  what's typed in a dialog. The database signals it for every kind on the
  page; a check-in signals nothing unless it makes a request.
- **2026-11-11:** Live updates part 5 (`REALTIME_PLAN.md`, #251): what
  someone else added or changed is shown for a moment (`DESIGN.md` §8). A
  row on the task list or the Requests page takes the brand tint, which
  holds for half a second and fades to the row's own colour within 2
  seconds, and the bell's count grows to 115% and settles as it rises. Not
  for the person's own changes, not as a page opens, and not when they look
  at another tab, filter or page; a hidden tab shows it as it comes back.
  With "reduce motion", the tint shows and goes without fading, and the
  count doesn't grow. DataList takes the rows to mark (`arrived`), from
  `components/useArrivals.ts`.
- **2026-11-11:** Live updates part 4a (`REALTIME_PLAN.md`, #252): the
  Costs page's Cash advances tab, a person's cash advance and My cash
  advance, Add cost's line about the advance, and an open Give advance,
  Record return or Correction window draw themselves again as the ledger
  changes (`DESIGN.md` §8), keeping the search, filter, page and what's
  typed. What someone else changed is tinted on the two lists, as part 5
  does. The person's own action counts as theirs for as long as it's on its
  way, as a two-factor code can hold it longer than a signal is waited
  for, on the Requests page too.
- **2026-11-11:** Codex's two findings on #251, from its review after the
  merge (`REALTIME_PLAN.md`, #253). A row that changed again within 2
  seconds starts its tint again: DataList's `data-arrived` says `once` or
  `again`, flipping each time the row is marked while marked, and
  `ui.css` gives the two the same tint under two names. And the person's
  own action, refused, no longer hides what someone else changes next:
  `useArrivals` gives pages `saved()`, which the Requests page and the cash
  advance screens call once their change is saved; only then is the draw
  after the answer theirs.
- **2026-11-11:** The cash advance screens' Arabic is neutral as to who
  reads it and who holds the advance, as the product owner asked (#254).
  It said the holder in the masculine (معه، رصيده، عهدته، لديه، يستطيع،
  يؤكّد), addressed the reader in the masculine (حاول، أرفقه، اختر،
  ادفعه، ما تضيفه), and named whoever recorded an entry with a masculine
  verb (سجّلها). As the rest of the app does, it now asks with "يُرجى" and
  verbal nouns, says the balance rather than theirs, and uses the passive
  where it said who does what. 26 strings of 155; the English doesn't
  change. `lib/cash-advances-arabic.test.ts` checks every one of them.
- **2026-11-11:** The app's Arabic speaks to no one in the masculine, part
  1 of 5 (`DESIGN.md` §3.4, #255). A command has no neutral form in
  Arabic: "اختر" asks a man. Every search box now says "البحث في…" or
  "البحث عن…" where it said "ابحث"; a picker's prompt and the Try again
  button are verbal nouns ("اختيار شركة…"، "إعادة المحاولة"); and every
  message that said "اختر" or "حاول" asks with "يُرجى اختيار" or "يُرجى
  المحاولة". A sentence it changed lost its other masculine words too
  ("انتقل"، "اسمح"، "فعّله"، "لترى"، "تريد"). 92 strings; the English
  doesn't change. `lib/arabic-neutral.test.ts` checks every string in the
  app, and each part adds its words to it.
- **2026-11-11:** The app's Arabic speaks to no one in the masculine, part
  2 of 5 (`DESIGN.md` §3.4, #256): entering, typing, setting and adding.
  Every message that said "أدخل"، "اكتب"، "حدد"، "أضف"، "اذكر" or "الصق"
  asks with "يُرجى" and a verbal noun ("يُرجى إدخال المبلغ."); a field
  that may be left empty says so in the passive ("يُترك فارغًا"); two
  placeholders and two audit entries are verbal nouns ("إضافة ملاحظة…"،
  "تحديد رسوم الخدمة لمستحق"). A sentence it changed lost its other
  masculine words too ("أعد"، "راجعها"، "افتح"، "تحتاجه"، "مكلفًا"). 84
  strings; the English doesn't change.
- **2026-11-11:** The app's Arabic speaks to no one in the masculine, part
  3 of 5 (`DESIGN.md` §3.4, #257): every other command in a hint, a
  message or a notice. "سجّل الهاتف من جديد"، "افتح أيًا منها"، "راجع
  تبويب GitHub Actions"، "أبلغ عن الوقت"… ask with "يُرجى" and a verbal
  noun, say what can be done ("يمكن فتح أي منها"), or use the passive
  ("يُستخدم أثناء عمل…"); buttons are verbal nouns ("قبول"، "قبول العذر"،
  "فحص الملف"). Strings that only looked like commands were reworded so
  they can't be read as one ("أُنشئ بواسطة", "آخر اتصال"). The
  audit log's past-tense entries said of someone else ("أكّد"، "وافق"،
  "أرسل"، "عدّل") are left for part 5, one aside: "سجّل ردّ عهدة" is
  "تسجيل ردّ عهدة". 75 strings; the English doesn't change.
- **2026-11-11:** The app's Arabic speaks to no one in the masculine, part
  4 of 5 (`DESIGN.md` §3.4, #258): "you". Confirmations ask with a verbal
  noun, as the rest of the app does ("حذف هذه المهمة؟" for "هل أنت متأكد
  أنك تريد حذف…"); the reader's own things are said with "ك", and what
  happens to them in the passive ("لم يُسجَّل حضورك بعد"); "الذي تختاره" is
  "المختار"; and the new request window asks "نوع الطلب" and "المطلوب في
  كلمات قليلة…". A verb with "ت" is "you" or "she": a company's own verbs
  ("تطلب شركة…") stay. 34 strings; the English doesn't change.
- **2026-11-11:** The app's Arabic speaks to no one in the masculine, part
  5 of 5 (`DESIGN.md` §3.4, #259): someone else spoken of as "he". The audit
  log says what was done ("تمت إضافة موقع" for "أضاف موقعًا"); who did
  something is said with "بواسطة" ("أُضيف بواسطة" for "أضافه"), or in a
  noun phrase ("انتهت عضوية {who} في فريقك" for "غادر {who} فريقك"); a
  person a screen is about is "this account" or "this person"; a day is
  "حضور" or "غياب", and a scope "الفريق" or "الشخص نفسه". A generic "من" or
  "أحد", a role's name and a thing keep their agreement, which `DESIGN.md`
  §3.4 now says. Four commands and two "you"s the earlier parts missed go
  too. 89 strings; the English doesn't change.
- **2026-11-12:** A task's location history (`CLIENTS_PLAN.md` §2.5,
  #260): a location sent without its accuracy is Needs review, as one
  that wasn't precise enough already is. A reviewer's line under it says
  why, in words of its own: the reading didn't say how precise it was. The
  badge and the Mark correct and Mark wrong buttons don't change.
- **2026-11-12:** Every page answers sooner (`TECH_STACK.md`, #261): the
  server's functions run in Dublin, next to the database in Ireland, rather
  than in Frankfurt, so a page's database queries no longer each cross
  Europe. No screen changes.
- **2026-11-12:** Who's online on the Employees list and All users
  (`REALTIME_PLAN.md` part 6a, #262): each tab says when it's shown and when
  it goes, so someone who closes the app shows as offline at once, not up
  to 3 minutes 20 seconds later, and a phone and a laptop don't make each
  other look gone. The badge looks as before.
- **2026-11-12:** The Online badge on the Employees list and All users
  changes as people come and go (`REALTIME_PLAN.md` part 6b, #263),
  without the list being loaded again: what's typed, the filters and the
  page stay. Only the badge changes, untinted (`DESIGN.md` §8), and someone
  whose leaving wasn't heard turns Offline as their 32 minutes run out.
- **2026-11-12:** The Costs page's Employee costs and Charged to clients
  tabs, and a client's charges on their page, draw themselves again as
  costs are added, removed, paid and charged (`REALTIME_PLAN.md` part 4b,
  #264), keeping the search, filters and page. What someone else changed
  is tinted, as part 5 does; Mark all as paid and the charges' own actions
  are the person's own, and aren't.
- **2026-11-12:** The Attendance page's Exceptions, Days and Punches tabs,
  and the Super Admin's Check-ins page, draw themselves again as check-ins
  come in and attendance is corrected (`REALTIME_PLAN.md` part 4c, #265),
  at most every 30 seconds while check-ins keep coming (`DESIGN.md` §8).
  The period, filters and what's open stay. What someone else changed is
  tinted, as part 5 does; the person's own actions aren't. A list's first
  draw is never tinted, though a signal came while it loaded; before, a
  list opened as its channel was joined was tinted throughout.
- **2026-11-12:** Two findings by Codex on #265, fixed in it. The
  Exceptions tab is drawn at most every 30 seconds whatever it hears, as
  a flagged check-in sends a request too. And the Super Admin's Check-ins
  page finds a company checking in for the first time in 30 days, and
  hears the check-ins waiting for them wherever their company is
  (`REALTIME_PLAN.md` part 4c).
- **2026-11-12:** A tidy-up of part 4c (#266): the live drawer counts a
  screen it holds as no draw of the other spaced kinds it hears, and the
  Super Admin's Check-ins page's limit of about 95 companies, one channel
  for each, is written down (`REALTIME_PLAN.md` part 4c).
- **2026-11-12:** The code a high-risk action asks for says when the
  server has stopped checking codes, after five in fifteen minutes, and
  counts down until it checks again (#267; `DESIGN.md` §5.5, Dialog;
  `ROLES_PLAN.md` §6.15). It called a right code wrong meanwhile.
- **2026-11-12:** Two database fixes from production's logs (#268;
  `TROUBLESHOOTING.md`). The Super Admin's overview is read fresh, in one
  batch transaction: its 30-second cache refreshed after the page was sent,
  and Vercel froze the function mid-handshake with the database. And each
  database connection is given its queries one at a time: inside a
  transaction, Prisma's reads of several relations, and our own reads at
  once, were queued by the driver, with a warning that its next version
  refuses them.
- **2026-11-12:** The plan for fingerprint terminals that connect straight
  to Nizmo over HTTPS, without the office agent, as well as through it,
  chosen for each terminal, ZKTeco and Hikvision alike (#269;
  `ATTENDANCE_PLAN.md` round 9, §17.1 to §17.11, Phase 4). A ZKTeco terminal
  straight to Nizmo is accepted only from the office's fixed internet
  address, since it sends nothing secret. Brands are a list only the Super
  Admin keeps, on a Terminal brands page under Templates (§2.2), each
  speaking a protocol Nizmo knows, with Convoy on it from the start. Setting
  terminals up is a high-risk permission of its own, "Set up fingerprint
  terminals", and a company's people set theirs up only once the Super Admin
  turns on its switch; anyone else with the Attendance tab never sees the
  section (§17.10). The first
  customer's terminal, a Convoy that most likely speaks ZKTeco's protocol, is
  tried with the agent first. Plans only; no screen changes yet.
- **2026-11-13:** The plan for reading a day's scans first and last, and for
  missions (مأمورية) (#270; `ATTENDANCE_PLAN.md` round 10, §6.9, §6.10,
  Phase 5). A day's first scan is the arrival and its last the departure, so
  a second scan on arriving no longer leaves the day incomplete. In pairs,
  as built, is removed, and scans within 5 minutes of each other count as
  one. An employee asks for a mission on the Requests page, by days or by
  hours, and someone holding "Decide missions" approves it. Missions are on
  to start, paying no allowance until the policy sets one. A mission by
  hours covers any lateness and early leave that day, as long as the day
  has an arrival and a departure. A mission never adds overtime. Its
  allowance is paid with salary: the policy says what one day is worth, the
  employee's own day's pay or an amount typed in, and what each kind pays,
  from none to two days. Round 9's proposals 3 to 8 are the owner's now, as
  written, and three notes to it ride along: a ZKTeco terminal's office
  address must be the office's own, not one its provider shares; the first
  customer's terminal is identified with `probe` at install; and it is the
  first trial terminal, so ZKTeco straight to Nizmo goes first if it can
  push over HTTPS. Plans only; no screen changes yet.
- **2026-11-13:** The decisions from a review of round 10 (#271;
  `ATTENDANCE_PLAN.md` round 10, decisions 13 to 21). Early leave of more
  than 2 hours waits as a Departure to confirm, since it's most often a
  forgotten last scan, until HR accepts it or adds the scan; and a month's
  payroll can't be approved while such a day, or an incomplete one, is
  unsettled, with a window listing them. A mission by hours is either until
  the end of the day or from its start, and needs one scan only. A mission
  may name one of the employee's open tasks, shown to whoever decides it
  and linked to nothing else. The allowance is never a task's cost. Nizmo
  stays at `nizmo.vercel.app` until the second customer. Plans only; no
  screen changes yet.
