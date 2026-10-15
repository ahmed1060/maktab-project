# Organising the system: names, navigation and look

This file holds the plan for making the whole app feel organised: how the
side bar is grouped, what things are called (in English and Arabic), and
how pages look. It's updated with every decision; the change log at the
end records each update.

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

1. **Fix the 7 pages using missing Tailwind classes** (§1.3.7). They'd use
   the app's own styles, so they match the rest. This is small, and can go
   first.
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
5. **Pages move to the building blocks one by one,** each in a small PR, as
   agreed for the UI refactor in `CLIENTS_PLAN.md` §8.

---

## 5. When (Proposed)

| Part | When |
|---|---|
| Names (§3) | Now. Step 0 of `CLIENTS_PLAN.md` renames things anyway, and later steps need the new names |
| The side bar groups (§2.1, §2.2) | With step 0, which already changes the side bar |
| Fixing the 7 pages (§4.1) | A small PR, whenever you like |
| One Requests page (§2.3) | Later, as part of the UI refactor |
| Building blocks, spacing, icons (§4.2–4.5) | The UI refactor, after `CLIENTS_PLAN.md`'s steps, page by page |

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
   it (§4.4)?
7. **Fix the 7 pages** with missing Tailwind classes now, as a small PR
   (§4.1)?
8. **The timing** in §5?

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
