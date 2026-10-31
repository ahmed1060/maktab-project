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
| *(bottom)* | Company Settings |

- **Check in sits at the top,** beside Dashboard. It's what people use most
  on the phone, every day.
- **A group is hidden when the person can't see anything in it.** For
  example, an ordinary employee doesn't see an empty Money heading.
- **Me holds what people often check about themselves:**
  - My payslips;
  - My attendance, for someone who can only see their own. Someone who can
    see more uses Attendance under People;
  - My cash advance, when the company uses cash advances.
- **The account menu at the top** keeps the account settings: My profile,
  Security settings, History and Sign out.
- **Costs** holds its tabs: Employee costs, Charged to clients, and Cash
  advances.
- **One Requests page** (§2.3) replaces the separate request pages, later.
  Until then, the existing ones sit together under People: Requests, Day off
  requests, Role requests and Profile requests (name changes, today linked
  only from the top bar).

### 2.2 The Super Admin

| Group | Items |
|---|---|
| **Customers** | Companies · Packages · All users |
| **Templates** | Role templates · Policy templates · Public holidays |
| **Access** | Super Admins · Role changes · Access reviews · Who can |
| **Operations** | Check-ins · Audit logs · System health · System settings |

- **They come after the company's groups,** which the Super Admin sees for
  the company they've picked, as today.
- **Their Arabic names (Decided on 2026-10-22):** المشتركون (Customers), القوالب
  (Templates), الصلاحيات (Access) and التشغيل (Operations). العملاء, the
  word for a company's clients, would name two groups in the same side bar.

### 2.3 One Requests page

- **Every kind of request in one place:** day off, permission hours,
  overtime, missing punch, role changes, name changes, and internal
  requests.
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
      a decision's notice open them there.
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
      old pages' items go: Day off and Profile requests.

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
   - Companies can rename modules and pick an emoji for each today. Instead,
     they'll pick from a short list of about 50 business icons.
   - The setting stays live until the icons PR deploys, so a company can
     still pick any emoji, a pasted one included, before then. The PR maps
     every stored choice, not only the defaults: each default emoji to its
     icon, and anything else to the module's default icon. A company's
     renamed labels are kept. Production is checked again, read only, just
     before the PR is merged.
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
     edit dialog, merged in #124 on 2026-10-30;
   - the one Requests page (§2.3), in five parts. The first, the page with
     internal requests, opens for review in #125.

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
| Polish, later | **Emil Design Engineering** | Adds motion to toasts, dialogs, drawers and menus, once the building blocks exist. It respects the device's "reduce motion" setting. |

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
  - Emil is added in the motion PR.
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
    "Your role is now" opens one's own profile, which shows it.
  - The side bar's Role requests item is Roles and access now, beside
    Company settings, for whoever gives roles; whoever only asks for roles
    finds theirs on the Requests page.
  - Found in the browser: a role request's row put whose role it would be
    under "Asked by", the column, the person filter and the details all
    say, beside who really asked. Its person is who asked now, as every
    row's is, and whose role it would be is beside the role, on Mine and
    To review alike, and in the details as "Whose role".
