# Organising the system: names, navigation and look

This file holds the plan for making the whole app feel organised: how the
side bar is grouped, what things are called (in English and Arabic), how
pages look, and the tools used to build and check them. It's updated with
every decision; the change log at the end records each update.

Each part is marked **Decided**, **Proposed** or **Open**, as in
`CLIENTS_PLAN.md`. Everything here starts as **Proposed**.

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

## 2. Navigation (Proposed)

### 2.1 Company users

The side bar is grouped by what people do. Each person only sees what their
permissions allow, as today.

| Group | Items |
|---|---|
| *(top)* | Dashboard |
| **Work** (العمل) | Tasks · Obligations · Check in (phone app only) |
| **Clients** (العملاء) | Clients · Locations · Records |
| **People** (الموظفون) | Employees · Attendance · Requests |
| **Money** (المالية) | Costs · Payroll |
| **Me** (حسابي) | My payslips · My cash advance (when the company uses it) |
| *(bottom)* | Company Settings |

- **Costs** holds its tabs: Employee costs, Charged to clients, and Cash
  advances.
- **One Requests page** (§2.3) replaces the separate request pages.

### 2.2 The Super Admin

| Group | Items |
|---|---|
| **Customers** | Companies · Packages · All users |
| **Templates** | Role templates · Policy templates · Public holidays |
| **Access** | Super Admins · Role changes · Access reviews · Who can |
| **Operations** | Check-ins · Audit logs · System health · System settings |

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

This is the largest change here, so it's a candidate for later (§5).

---

## 3. Names (Proposed)

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
   plus a verb for anything that moves money ("Mark collected", "Give cash
   advances"). In Arabic: عرض، إضافة، إدارة.
7. **No two things share a name.** Task locations and attendance check-in
   places are different things, so they get different names.

### 3.2 Glossary

| English | Arabic | Meaning |
|---|---|---|
| Client / Clients | عميل / العملاء | A business the company works for (today's vendors) |
| Location / Locations | موقع / المواقع | Where a task is done: a client's HQ or branch, or a shared place |
| HQ | المقر الرئيسي | A client's main location |
| Check-in place / Check-in places | مكان الحضور / أماكن الحضور | Where employees check in for attendance (today's "work locations") |
| Record / Records | سجل / السجلات | Notes and files kept for a client, with expiry reminders |
| Task / Tasks | مهمة / المهام | |
| Obligation / Obligations | التزام / الالتزامات | |
| Cost / Costs | تكلفة / التكاليف | Money spent on a task |
| Employee cost | تكلفة الموظف | A cost the company pays back to the employee |
| Charge / Charged to clients | مستحق / مستحقات على العملاء | What a client owes the company for a cost |
| Service fee | رسوم الخدمة | Added on top of a charge |
| Due / Collected | مستحق / تم التحصيل | A charge's statuses (replacing "To collect") |
| Cash advance | عهدة | Money given to an employee up front, to pay costs from |
| Request / Requests | طلب / الطلبات | |
| Day off | إجازة | |
| Payslip / Payslips | قسيمة راتب / قسائم الرواتب | |
| Payroll | الرواتب | |

### 3.3 The names left open in `CLIENTS_PLAN.md`

- **To collect / Collected** become **Due / Collected**.
- **Locations** stays for task locations. The attendance "work locations"
  are renamed **Check-in places**.
- **Cash advance** is the English for عهدة.
- **The permission names** follow §3.1(6), for example:
  - See locations, Add locations, Manage locations;
  - See charges, Manage charges, Mark charges collected;
  - See cash advances, Give cash advances;
  - Add list names, Manage lists.

---

## 4. Look (Proposed)

1. **Fix the 7 pages using missing Tailwind classes** (§1.3.7), so they use
   the app's own styles and match the rest.
   - The dashboard home, Employees and Day Off Requests: a small PR, any time
     (§5).
   - Vendors and the three Clients pages: rebuilt in `CLIENTS_PLAN.md`'s step
     0.
2. **A few shared building blocks,** used by every page:
   - a page header (title, subtitle, main button);
   - a filter bar;
   - a list or table;
   - a card;
   - a status badge (Due, Paid, Pending…);
   - tabs;
   - total tiles (such as Paid out, Service fees, Total to collect);
   - an empty state ("No clients yet", with the button to add one).
3. **One scale for spacing and text sizes,** set once in `app/globals.css`
   and used through the building blocks, instead of numbers typed on each
   page.
4. **One icon set instead of emoji.** For example, a set of simple line
   icons, the same on every device. Companies can rename modules today and
   also pick an emoji for each; they would pick from the icon set instead.
   No company has changed an icon or label in production yet.
5. **Pages move to the building blocks one by one,** each in a small PR,
   after `CLIENTS_PLAN.md`'s steps (§5).

---

## 5. Order of work, across both plans (Decided)

1. **Settle the names and the side bar groups** (§6, questions 1–5). These
   are decisions, not code, and they come before `CLIENTS_PLAN.md`'s step 0,
   which renames things and changes the side bar.
2. **The shared building blocks, in one PR** (§4.2–4.4):
   - first, the look is chosen and written down in `DESIGN.md` (§7.2);
   - page header, filter bar, list or table, card, status badge, tabs, total
     tiles and empty state;
   - the spacing and text-size scale;
   - the icon set, if chosen (question 6);
   - the design tools are added to the project (§7.3).

   No old page is converted in this PR.
3. **`CLIENTS_PLAN.md`, steps 0–7.**
   - The side bar groups (§2.1, §2.2) land with step 0.
   - Every screen these steps create or rework uses the building blocks
     from the start: Clients, Locations, Records, the Costs tabs, Cash
     advances, and the task form's pickers.
4. **The rest of this plan:**
   - the remaining old pages move to the building blocks one by one, each
     in a small PR (§4.5);
   - the one Requests page (§2.3).

**Any time:** a small PR fixing the 3 pages with missing Tailwind classes
that `CLIENTS_PLAN.md` doesn't touch: the dashboard home, Employees and Day
Off Requests. The other 4 (Vendors and the three Clients pages) are rebuilt
in step 0, so they're fixed there.

---

## 6. Open questions

1. **The side bar groups** for company users (§2.1) and for the Super Admin
   (§2.2): agreed, or changes?
2. **A "Me" group** in the side bar for personal pages, or put them in the
   menu under the user's name at the top?
3. **One Requests page** (§2.3): agreed? Later, or sooner?
4. **The naming principles and glossary** (§3.1, §3.2): agreed, or changes?
   Arabic wording especially.
5. **Due / Collected, Check-in places, Cash advance** (§3.3)?
6. **Icons:** move from emoji to one icon set, with companies picking from
   it (§4.4)? This is needed before the building blocks PR.
7. **When to fix the 3 pages** not touched by `CLIENTS_PLAN.md` (§4.1): now,
   or later?

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
| Building | **Impeccable** | Builds the shared building blocks, then redesigns the pages one by one. It's tried on one page first. |
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
