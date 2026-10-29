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
     in a small PR (§4.5);
   - the one Requests page (§2.3).

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
