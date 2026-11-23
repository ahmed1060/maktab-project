# Nizmo design rules

How Nizmo looks, in English and Arabic, on phones and computers. Every new
or reworked screen follows this file, and so does every agent that builds
one. When a design tool's advice disagrees with it, this file wins. If the
tool turns out to be right, this file is changed first, in its own commit
(`UI_PLAN.md` §7.3).

The look is **style A, "Polished"**, picked from screenshots of the Tasks
page in three styles (`UI_PLAN.md` §7.2). It's adapted from Stripe's
design write-up in the awesome-design-md collection. Nizmo keeps its own
name, logo and brand colour; nothing of Stripe's brand is copied.

The names used on screen are in `UI_PLAN.md` §3.

---

## 1. What Nizmo is, and what the design is for

- **The product:** an operations and HR system for service companies,
  covering tasks for clients at places like tax offices and banks,
  attendance, costs, payroll and requests.
- **Who uses it:**
  - office Admins and Team Leaders, mostly on computers, scanning lists
    and deciding things;
  - employees, mostly on phones, checking in and moving their own tasks
    on.
- **Its job:** show what's due, let people act on it in one step, and keep
  money and status correct.

So the design is **calm, dense and exact**:

- calm: one accent colour, quiet surfaces, nothing moving on its own;
- dense: many rows on screen without feeling cramped;
- exact: numbers line up, statuses read the same way everywhere, and
  nothing depends on colour alone.

**The one bold thing is the brand colour.** It marks the main action and
where you are. Everything around it stays quiet.

---

## 2. Colour

### 2.1 Brand colour

The brand colour is a setting (`UI_PLAN.md` §4.6). The Super Admin sets the
default in System Settings, and each company can choose its own in Company
Settings → Branding. Screens never use a fixed hex for it, only the tokens
below, which are all worked out from the one chosen colour.

| Token | What it is | Used for |
|---|---|---|
| `--brand` | The chosen colour, darkened if needed until white text on it reads at 4.5:1 or better | Primary button fill, the active page in the pager, counts in the side bar, the logo tile |
| `--brand-hover` | `--brand` 8% darker (in dark mode, see below) | Primary button on hover |
| `--brand-press` | `--brand` 16% darker (in dark mode, see below) | Primary button while pressed |
| `--brand-text` | The brand as text: 4.5:1 or better on the page, on panels and on both brand tints, in each theme | Links, the selected side bar item, selected tabs, focus rings |
| `--brand-tint` | 9% brand on the panel colour | Behind the selected side bar item and selected rows |
| `--brand-tint-strong` | 14% brand on the panel colour | Avatars with initials |

- **The default is Nizmo's own indigo, `#6366f1`.** White text on it is
  4.47:1, just under the rule, so it's used as `#6063ea` (4.70:1).
- **In dark mode:**
  - `--brand-text` is lightened until it reads at 4.5:1 or better on dark
    panels;
  - `--brand` stays the same for buttons while it stands out from a dark
    panel at 3:1 or better. The default indigo does. A very dark choice,
    such as navy, is lightened until it does, and if white text then
    reads under 4.5:1 on it, the button text switches to dark ink;
  - with white text, hover and press are 4% and 8% darker, half the
    light-mode steps, and `--brand` is lightened if needed until the
    pressed shade stands out from the panel at 3:1 too. Darker is towards
    the panel, and white text and a 3:1 edge leave a narrow band of shades.
    With dark ink, hover and press are 8% and 16% towards white.
- **One filled brand button per area.** A page has one primary action. Other
  actions are secondary or quiet buttons (§5.2).
- **A colour close to the error red gets a warning when it's chosen:** one
  whose hue is within 20° of the error red's and that isn't greyish (35%
  saturation or more). It can still be saved. The status, warning and error
  colours (§2.3) never take the brand colour.
- **Who sees which colour:** a company's people see its colour, or the
  default if it hasn't chosen one. The sign-in page and the Super Admin's
  pages use the default.
- **The pages not yet in this design follow the colour too:** the older
  pages, the side bar and the sign-in page (`UI_PLAN.md` §4.6). They keep
  their own look, which is drawn in Nizmo's indigo with a violet beside it:
  - each of those shades keeps the distance it has from Nizmo's indigo,
    measured from the chosen colour instead. That's the same turn of hue,
    the same share of colourfulness and the same step lighter or darker,
    as the eye sees them (OKLCH). Pale shades keep their own lightness, so
    the page's ground stays pale and light text on dark stays light;
  - so Nizmo's indigo gives exactly the colours these pages have today,
    and another colour gives the same family in its own hue: teal beside a
    blue-teal, orange beside amber;
  - each shade then keeps the readability it has today against each thing
    it's drawn on or under. It's never asked for more than WCAG's 4.5:1
    for text or 3:1 for a shape:
    - white text on a fill reads as well as it does with Nizmo's indigo,
      at rest and when a button brightens on hover;
    - in dark mode, a fill stands out from the dark page as well as it
      does now;
    - text reads as well on each ground it's drawn on as it does now,
      including the light brand tints behind it. A highlight colour that
      is also a link's colour is held as text;
    - a focus ring, a highlight bar or the map pin stands out as well as
      it does now, and so does the end of the company name's gradient in
      the side bar.

    A shade that falls short is darkened (on a dark ground, lightened)
    until it doesn't, keeping its hue;
  - the check-in place's radius ring on the map has a thin white outline,
    as its pin does, so it shows over satellite imagery as well as the
    light street map, whatever the colour;
  - the company name at the top of the side bar runs from white to a pale
    shade of the brand, in both themes, since the side bar is dark in
    both. It used to start from the page's panel colour, so in dark mode
    it began dark on the dark side bar and was barely readable;
  - the info colours, the role badges' colours, the pink glow and the
    dark mesh behind the page don't follow. Like the status
    colours (§2.3), they mean something, or are only background.

  This lasts until each page moves onto the building blocks, which use the
  tokens above.

### 2.2 Neutrals

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--page` | `#f6f9fc` | `#0a1220` | The page behind everything |
| `--panel` | `#ffffff` | `#0f1a2b` | Panels, tables, cards, the side bar; the top bar where the browser can't blur (§5.1) |
| `--panel-raised` | `#ffffff` | `#16233a` | Menus, pop-ups, dialogs, toasts |
| `--ink` | `#0d253d` | `#e6edf5` | Main text: titles and row content |
| `--ink-2` | `#273951` | `#b8c4d4` | Secondary text in rows and forms |
| `--muted` | `#5d6b82` | `#8a9ab0` | Helper text, labels, table headers, empty states |
| `--rule` | `#e3e8ee` | `#24324a` | Lines between rows; panel edges |
| `--field-line` | `#828e9f` | `#65758d` | The edge of a field, checkbox or toggle (3:1 or better on the page and on panels) |
| `--header-glass-bg` | `rgba(255, 255, 255, 0.82)` | `rgba(13, 17, 23, 0.88)` | The top bar's glass, once the page scrolls (§5.1) |
| `--header-glass-border` | `rgba(255, 255, 255, 0.45)` | `rgba(255, 255, 255, 0.1)` | The glass top bar's hairline edge |
| `--header-shadow` | `0 4px 30px rgba(0, 0, 0, 0.05)` | `0 4px 30px rgba(0, 0, 0, 0.45)` | The glass top bar's shadow |

- Text is navy, never pure black. Dark mode is deep navy, never pure black
  either.
- `--muted` was darkened from the reference's `#64748d`, which was 4.49:1
  on the page. Now it's 5.11:1 on the page and 4.70:1 on the brand tint.
- The top bar's three glass tokens are the ones the app has today, kept
  with its glass (§5.1).

### 2.3 Status and meaning

These never follow the brand colour, because their meaning has to stay the
same in every company.

| Meaning | Statuses | Light (background / text) | Dark (background / text) |
|---|---|---|---|
| Neutral | Pending, Draft | `#ebeef1` / `#3c4257` (8.6:1) | `#26324a` / `#d0d8e4` (8.9:1) |
| In motion | In Progress | `#e0ecff` / `#0b4bb3` (6.6:1) | `#16305e` / `#a9c7ff` (7.6:1) |
| Waiting on someone | Pending Confirmation, Due, Expires soon | `#fcedb9` / `#7a4b0a` (6.3:1) | `#3d2c08` / `#f5cf7a` (9.0:1) |
| Done or good | Approved, Completed, Paid, Collected | `#d7f7c2` / `#05690d` (5.9:1) | `#123d1c` / `#93e3a0` (8.0:1) |
| Problem | Rejected, Overdue, Expired, errors | `#ffe7f2` / `#b3093c` (6.0:1) | `#4a1226` / `#ffa3bd` (8.0:1) |

- **Colour is never the only signal.** A status always has its word. Overdue
  always has the warning icon and the word "Overdue" too.
- **Chart colours** are for the shapes in a chart, such as a donut's parts,
  never for text. The text colours above are deep, for reading, and look
  heavy as large shapes, so charts take a mid-tone of each meaning. Each
  stands out from a panel at 3:1 or better.

  | Meaning | Light | Dark |
  |---|---|---|
  | Neutral | `--chart-neutral` `#64748b` (4.8:1) | `#94a3b8` (6.8:1) |
  | In motion | `--chart-progress` `#2563eb` (5.2:1) | `#60a5fa` (6.9:1) |
  | Waiting on someone | `--chart-waiting` `#d97706` (3.2:1) | `#fbbf24` (10.5:1) |
  | Done or good | `--chart-good` `#059669` (3.8:1) | `#34d399` (9.1:1) |
  | Problem | `--chart-problem` `#e11d48` (4.7:1) | `#fb7185` (6.5:1) |
- **Danger text** on white is `#b3093c` (6.95:1).
- **An overdue row** gets a faint red background (`#fff8fa` in light mode,
  `#241729` in dark) and a 3px red bar on its start edge.
- **A brand colour close to the problem red** gets a warning when it's
  chosen (`UI_PLAN.md` §4.6).

---

## 3. Text

### 3.1 Fonts

- **English: Inter.** **Arabic: Noto Sans Arabic.** Both are free, and both
  are loaded by the app itself, so text looks the same on every device.
  Today no Arabic font is loaded, so Arabic text uses whatever each device
  has.
- **One font stack everywhere:** `Inter, "Noto Sans Arabic", system-ui,
  sans-serif`. An Arabic name inside an English page picks up Noto Sans
  Arabic by itself.
- **Weights:** 400 for reading, 500 for emphasis (row titles, buttons,
  selected items), and 600 only for the numbers in total tiles. Nothing
  heavier.

### 3.2 Sizes

One scale. Every size in the app is one of these.

| Token | Size / line height | Used for |
|---|---|---|
| `--text-xs` | 12 / 16px | Status badges, counts, fine print |
| `--text-sm` | 13 / 18px | Side bar group names, table headers, helper text, secondary lines |
| `--text-md` | 14 / 20px | Body text, rows, fields and buttons on computers |
| `--text-card` | 15 / 22px | Card titles (§5.5) |
| `--text-lg` | 16 / 24px | Body text, fields and buttons on phones; dialog text |
| `--text-xl` | 18 / 26px | Section and dialog titles |
| `--text-2xl` | 22 / 28px | Page titles on phones; values in total tiles |
| `--text-3xl` | 28 / 34px | Page titles on computers |
| `--text-hero` | 48 / 56px, 36 / 44px on phones | A page's one large figure: what a client owes, on their tax position (§5.5) |

- **`--text-hero` is for one figure alone,** the client's area's amount
  owed (§5.5): weight 600, even-width digits, its unit after it in
  `--text-lg` and `--muted`. Nothing else is larger than `--text-3xl`.
- **Page titles** are weight 600, with -0.4px letter spacing in English,
  as the owner's mockup of a client's tax position draws them (decided
  by the owner on 2026-11-20, for the whole app; they were 400).
- **Card titles** are `--text-card` at weight 600, as that mockup draws
  them (decided on 2026-11-20; they were `--text-xl` at 500). A section's
  heading, over several panels, stays `--text-xl`.
- **Arabic is never letter-spaced.** Spacing breaks the joins between
  letters. Arabic lines get a little more height: body text at 1.6 rather
  than 1.45.
- **Fields on phones use 16px text,** so phones don't zoom in when a field
  is tapped.
- **Lines of reading text stay under about 80 characters.** Forms and long
  text sit in a column no wider than 720px.

### 3.3 Numbers

- **Money, counts, dates and times in lists and tables use even-width
  digits** (`font-variant-numeric: tabular-nums`), so columns line up.
- **Arabic uses Arabic-Indic digits** (`ar-EG`), as the app does today.
  Dates and numbers are always formatted with `Intl` for the page's
  language, never built by hand.
- **Codes, phone numbers and emails stay left to right** inside Arabic
  text, using `<bdi>`, or `unicode-bidi: isolate` together with
  `direction: ltr`. `unicode-bidi: isolate` alone keeps the page's right to
  left direction, which turns "08:30–17:00" into "17:00–08:30".

### 3.4 Case and wording

- **Sentence case everywhere,** including side bar group names, table
  headers and buttons. No ALL CAPS, since Arabic has no capitals and the
  two languages should match.
- **Words follow `UI_PLAN.md` §3:**
  - one word per idea;
  - buttons start with a verb;
  - statuses are short adjectives;
  - personal pages start with "My".
- **A button says what will happen,** and the confirmation repeats it:
  "Delete client" leads to "Client deleted".
- **An error says what happened and how to fix it.** It doesn't apologise
  and isn't vague.
- **An empty screen invites the next step:** "No tasks yet", with the button
  to create one.
- **No decorative separators in text,** such as "A · B · C", "→" after a
  button label, or a label line above every heading.
- **Arabic speaks to no one in the masculine,** whoever reads it (the
  product owner, 2026-11-11). Arabic has no neutral "you" for a command:
  "اختر" asks a man and "اختاري" a woman. So the app asks with "يُرجى" and
  a verbal noun ("يُرجى اختيار شركة", "يُرجى المحاولة مرة أخرى"); a
  search box says "البحث في…" or "البحث عن…"; and a button, or a picker's
  prompt, is a verbal noun ("إعادة المحاولة", "اختيار عميل"). Someone
  else is spoken of through what's theirs, or in the passive ("الرصيد",
  not "رصيده"; "يُؤكَّد استلامها", not "يؤكّد"). A person a screen is about
  is "this person" or "this account", or isn't the subject at all
  ("أُضيف بواسطة {name}", not "أضافه {name}"; "تمت إضافة موقع", not "أضاف
  موقعًا"). A generic "من" or "أحد" (whoever, anyone) keeps Arabic's usual
  agreement ("من يحق له"، "لم يغادر أحد"), and so do a role's name and a
  thing ("يوافق المسؤول"، "العميل لديه مهام"). The screens move over in
  parts, listed in `UI_PLAN.md` §5.

---

## 4. Space, shape and depth

### 4.1 Spacing

A 4px base, and only these steps: **4, 8, 12, 16, 20, 24, 32, 48**.
20 is for inside a card, above and below what's in it (decided on
2026-11-20).

| Where | Computer | Phone |
|---|---|---|
| Page edge | 32px | 16px |
| Between sections and cards of a page | 16px | 16px |
| Inside a panel | 16px | 12px |
| Inside a card | 20px above and below, 24px at the sides | 16px |
| Table cell | 12px top and bottom, 16px at the sides | (cards instead) |
| Between a field's label and the field | 8px | 8px |

Component heights (buttons, fields, bars) are set in §5, not from this
scale.

### 4.2 Corners

One corner size for each level, so the level shows at a glance:

| Level | Corner |
|---|---|
| Buttons, status badges, counts, filter chips | Fully round (pill) |
| Panels, tables, cards, dialogs | 12px |
| Menus, pop-ups, toasts | 8px |
| Fields, side bar items, pager buttons | 6px |
| The top bar, floating once the page scrolls (§5.1) | 24px |

### 4.3 Depth

| Level | Light | Used for |
|---|---|---|
| 0 | Flat | The page, rows inside a table |
| 1 | `0 1px 3px rgba(13,37,61,.08)` and a `--rule` edge | Panels and cards resting on the page |
| 2 | `0 8px 24px rgba(13,37,61,.12), 0 2px 6px rgba(13,37,61,.06)` | Menus, pop-ups, dialogs, toasts |

- **In dark mode,** shadows don't show. Depth comes from `--panel-raised` and
  the hairline edge instead. The one exception is the glass top bar
  (§5.1), kept as it is today: its dark `--header-shadow` is deep enough
  to show, and with its hairline edge it sets the bar off from the page
  scrolling under it.
- **No panel inside a panel.** Sections within a panel are split by
  hairlines, not by more cards with more shadows.
- **No gradients as decoration.** The logo tile is solid `--brand`.

---

## 5. Building blocks

These are built once, in the building-blocks PR, and every page uses them
(`UI_PLAN.md` §4.2). A page never re-styles them inline.

### 5.1 The app shell

- **Side bar** (computer), as the mock-up of the app's frame approved by
  the product owner on 2026-11-05 draws it:
  - 248px wide, on the start side (right in Arabic), the window's full
    height, staying put as the page scrolls;
  - `--panel` background with a hairline `--rule` edge, in both themes. It
    was dark slate in both;
  - at its top, the company's mark and name. The mark is 32px across, with
    `--radius-menu` corners: the company's logo on its light plate
    (`--logo-plate`), which keeps a dark logo readable in dark mode, or
    else the first letter of its name in `--on-brand` on a `--brand` tile.
    The name is beside it in `--ink` at `--text-lg` and weight 500, on two
    lines at most. The Super Admin, looking at no one company, sees
    Nizmo's;
  - groups as in `UI_PLAN.md` §2.1, each with a `--text-sm` group name in
    `--muted`;
  - a group is hidden when the person can't see anything in it;
  - a module the company's package doesn't include isn't in it, for anyone
    in the company. Its pages, opened by their address, say they can't be
    opened, and why (§5.5, A page someone can't open);
  - an item is 36px tall, with `--radius-field` corners, its icon (§6) and
    its name in `--ink-2` at `--text-md`, and `--brand-tint` behind it
    under the pointer;
  - the selected item has `--brand-tint` behind it, `--brand-text` text at
    weight 500, and the filled version of its icon;
  - Requests carries how many wait on this person under its To review tab
    (`UI_PLAN.md` §2.3), the list the page opens on: a `--brand` pill at
    the item's end, 20px tall, its `--text-xs` digits in `--on-brand` and in
    the page's language, and nothing when none waits. A screen reader hears
    it with the item, as "Requests, 3 requests to review". It's asked again
    on every page, when the person comes back to the window, and once
    something is decided on the Requests page. It replaces the top bar's
    count of name changes alone, whose button is gone;
  - a company that chose its own icon for a module (§6) sees it in place
    of the module's, drawn as the others are, and filled on its page;
  - Company settings, Roles and access and Saved lists sit at the bottom,
    under a hairline, and stay there while the groups above them scroll,
    as the Super Admin's do;
  - under them, the privacy policy and the terms of service, as `--muted`
    links at `--text-xs`, side by side;
  - it doesn't fold down to its icons. The old side bar folded to 80px
    when its name was clicked, which nothing on the screen said and a
    keyboard couldn't do.
- **Side bar on phones** (narrower than 1024px): a drawer from the start
  side, opened from the menu button:
  - 296px wide, or the window's width less 48px where that's narrower, so
    the page shows beside it;
  - its items are 44px tall, with `--text-lg` names and 20px icons, and its
    legal links are 44px tall too (§9);
  - at its top, the company's mark and name, and a button that closes it;
  - it's a dialog over the dimmed page (`--scrim`): focus moves into it and
    stays there, and goes back to the menu button when it closes. Escape,
    that button, a tap on the page beside it, or picking a page closes it;
  - closed, it isn't drawn, so neither Tab nor a screen reader goes
    through its links. The old drawer only slid out of sight, and Tab went
    through every one of them;
  - it slides in over 200ms and out over 150ms (§8);
  - Check in sits at the top, beside Dashboard.
- **The "Powered by" signature** stays as it is (decided by the product
  owner on 2026-11-05): on a computer in the page's bottom corner on the
  end side, on a phone at the end of the page, and with the same look. It
  isn't in the side bar. The sign-in page has it too, in the same places
  (decided on 2026-11-08). Switched off in System settings, it's on
  neither, and the name it shows is the one set there.
- **Top bar:** 60px tall (56px on phones), as the approved mock-up of the
  app's frame draws it. It has no title: every page names itself in its
  page header (§5.5). On the end side it has the language switch, the bell
  and the account button (`UI_PLAN.md` §2.1). On a phone, the menu button
  and the company's mark, 28px across, are at its start:
  - its buttons are round and 44px across, with no fill until hovered,
    when they have `--brand-tint`, and `--ink-2` icons: 20px on a
    computer, 22px on a phone (§6);
  - **the language switch:** both languages, each written in itself,
    "EN" and "ع", in a pill with a `--rule` edge on `--panel`, the one in
    use in `--brand-text` on `--brand-tint`, on computers as on phones
    (decided by the owner on 2026-11-20; on computers they were
    "English" and "العربية"). English stays first in Arabic too: the
    switch is about language, not in one. It's named "Language" for
    screen readers, and each option is named in full, "English" and
    "العربية", and says whether it's in use. Picking the other switches
    the app to it, as today. Each option is 44px wide and 44px under a
    finger: what's tapped takes in the pill's edge and padding above and
    below it, so the bar looks as it did. The sign-in page's switch,
    under its card, isn't the top bar's, and still says them in full;
  - **the bell** is named "Notifications", and "Notifications, 2 unread"
    while some are. How many is a `--brand` pill at its top end corner,
    18px tall, its `--text-xs` digits in `--on-brand` and in the page's
    language, as the side bar's count is, and there's none when none is
    unread. While its panel is open, it's in `--brand-text` on
    `--brand-tint`;
  - **the bell's panel,** below the bar from the bell's end edge: 380px
    wide, on `--panel-raised` with a `--rule` edge, `--radius-menu`
    corners and `--elev-2`, as the menus are. On a phone it spans the
    bar, 8px in from its edges. At its top, over a hairline,
    "Notifications" at `--text-lg`, weight 500, and on its end side Mark
    all as read, a small quiet button, there while there's one it can
    read. Then the notifications, newest first, as rows split by
    hairlines (§5.5):
    - each is a link to what it's about, and one with nowhere to go is a
      row that isn't. It has its subject's icon, 16px in a 32px circle:
      the side bar's where its subject has a page, such as Tasks' for a
      task and Attendance's for a punch, and a calendar for a day off.
      Then what it says, in `--ink` at `--text-md`, and under it
      when, in `--muted` at `--text-sm`: "Just now", "10 minutes ago",
      "3 hours ago", "Yesterday", "4 days ago", and from a week on the
      date, "28 Oct 2026", with the exact date and time on hover;
    - an unread one is on `--brand-tint`, what it says at weight 500, its
      circle in `--brand-text` on `--brand-tint-strong`, with an 8px
      `--brand` dot at its end, and a screen reader hears "Unread" before
      it. A read one is on the panel, its circle in the neutral status
      colours (§2.3), and has no dot;
    - one about something to deal with now, such as a check-in terminal
      gone silent, stays at the top with an overdue row's look, the red
      start-edge bar on `--overdue-row`. It's unread until it's dealt
      with: neither following it nor Mark all as read reads it
      (`ATTENDANCE_PLAN.md` §13.4);
    - the list is as tall as its rows, up to 480px and less on a short
      screen, and scrolls past that under its head. With none, it says
      "No notifications"; while they're on their way, "Loading…"; and
      when they can't be fetched, it says so, with Try again.

    Opening it doesn't read them: following one reads it, and Mark all
    as read reads the rest. The bell's count follows. It
    isn't a dialog, as the account menu isn't: Tab moves through its
    button and links, and Escape, a click outside it, following one of
    its links, or Tab past its last one closes it. Escape gives the focus
    back to the bell, and Mark all as read moves it to the heading, as
    the button goes;
  - **the account button:** the person's photo in a 32px circle, or their
    initials in an avatar's colours (§5.5), never a drawing that stands in
    for them, alone, in a round 44px button, on computers as on phones
    (decided by the owner on 2026-11-20; on computers their name, their
    role and a caret were beside it). It's named "Account menu, Karim
    Nabil, Employee" («قائمة الحساب، كريم نبيل، موظف»), and says whether
    its menu is open. The menu names them at its top;
  - **the account menu,** below the button on the end side: 300px wide,
    on `--panel-raised` with a `--rule` edge, `--radius-menu` corners and
    `--elev-2`. At its top are the photo or initials, 40px across, the
    name, and the role with the company, "Admin at Nile Works", or the
    role alone for the Super Admin. Then, between hairlines, My profile,
    Security settings and History, the theme switch (Light and Dark,
    drawn as the language switch is), and Sign out, each 40px tall with
    its icon. History is there where the package includes Payroll, for
    anyone but an Admin or the Super Admin, as today. It isn't a dialog:
    Tab moves through its links and buttons, and Escape, a click outside
    it, following one of its links, or Tab past its last control closes
    it. Switching the theme doesn't, so the change can be seen. Escape
    gives focus back to the button;
  - **the company picker,** the Super Admin's, at its start, as the
    mock-up has it: a pill 44px tall on `--panel`, with an edge of the
    brand colour at a third, and the company in view's initials on a 32px
    tile with 8px corners, in `--brand-text` on `--brand-tint-strong`, or
    the buildings icon for All companies. Then "Company in view" in
    `--ink-2` at `--text-xs`, over the company's name in `--ink`, and a
    caret. On a phone, the tile alone. Either way it's named "Company in
    view: Nile Works", says that it opens a list, and whether it's open;
  - **its panel,** below the bar from the picker's start edge: 320px
    wide, on `--panel-raised` with a `--rule` edge, `--radius-menu`
    corners and `--elev-2`. On a phone it spans the bar, 8px in from its
    edges. At its top, "Find a company", in `--muted`, over a search
    field with "Name of a company…" in it. Then All companies and every
    company, each on a 40px row with its 28px tile (initials in
    `--status-neutral-fg` on `--status-neutral-bg`). The one in view is
    in `--brand-text` on `--brand-tint`, its tile as the picker's, with a
    check at its end, and a screen reader hears it as the current one. The
    list shows 8 rows, fewer on a short screen, and scrolls past that:
    - typing keeps the companies whose names have what's typed in them,
      capitals or not, without All companies, and the first is the one
      Enter picks. When none has, the list says "No company has that
      name";
    - it opens with the focus in the search field, which keeps it: the up
      and down arrows move through the list from there, Home and End stay
      in what's typed, and Enter picks. The row they're on has the menu's
      focus look, `--brand-tint` with a 2px `--brand-text` ring inside
      it, while the focus is in the panel, and the pointer moves it too.
      Picking one puts it in view, as today;
    - a tap on a touch screen opens it without the keyboard, the search
      field there to tap, as a phone's keyboard would cover the list;
    - Escape, a click outside it, or Tab out of it closes it. Escape and
      a pick give the focus back to the picker.

  It stays at the top as the page scrolls, and is kept as it is today
  (decided by the product owner):
  - at the top of the page it has no background of its own, and sits on
    the page;
  - once the page scrolls (past 10px), it floats as a pane of glass: 16px
    in from the page's edges (8px on a phone, where its buttons are
    already 8px from the screen's edges, so they stay where they are, as
    they do on a computer), with 24px corners, a see-through
    `--header-glass-bg` with a 20px blur and 160% saturation behind it, a
    hairline `--header-glass-border` edge and `--header-shadow`. The page
    scrolling under it shows through, blurred;
  - the bar takes the same room in both: the inset, corners, glass, edge
    and shadow are drawn on a layer inside it, so the page under it never
    moves as it floats or settles. Today's bar grows its own margins
    instead, which moves the page 32px at 10px of scroll; the rebuilt app
    shell keeps the look and not that;
  - text and icons on the bar are `--ink` or `--ink-2`, never `--muted`.
    Whatever scrolls under it, a dark map say, the glass is at its darkest
    `#d1d1d1` in light mode and its lightest `#2a2e33` in dark mode, and
    `--muted` reads only 3.5:1 on the first; `--ink-2` reads 7.7:1 on both;
  - it eases between the two over 300ms, changing only its background,
    blur (`backdrop-filter` and `-webkit-backdrop-filter`), edge, shadow,
    inset, padding and corners, so the blur comes in with the rest rather
    than at once, and the inset and padding, together, keep what's in it
    where it was. With "reduce motion" on, it changes at once;
  - where the browser can't blur, supporting neither `backdrop-filter`
    nor `-webkit-backdrop-filter` (`@supports not`), it floats on solid
    `--panel` instead, with the same edge and shadow. Without the blur the
    glass is see-through, and its helper text, over a dark page, could
    fall below 4.5:1.
- **Page area:** `--page` background, with the page-edge spacing from
  §4.1.

### 5.2 Buttons

| Kind | Look | Used for |
|---|---|---|
| Primary | `--brand` fill, white text | The one main action in an area |
| Secondary | `--panel` fill, `--field-line` edge, `--brand-text` text | Other actions |
| Quiet | No fill or edge, `--brand-text` text | Minor actions, such as Reset filters |
| Danger | `#b3093c` fill, white text | Only the confirm button of a destructive action |

- All buttons are pill-shaped. They're 36px tall on computers (30px for
  buttons inside a table row) and 44px on phones. The one exception is the
  check-in page's Check in and Check out, 56px with `--text-lg` (§5.5,
  Check-in).
- An icon is optional and goes before the label. The label is never only
  an icon, unless the button has an accessible name and a tooltip.
- **A guide's button:** where something is done mostly away from Nizmo,
  such as setting up a fingerprint terminal in an office, its card has a
  round quiet button with an "i" right after its title, 30px (44px on
  phones), named for the guide it opens, such as "How to set up a
  fingerprint terminal", in its tooltip too. It opens the guide and does
  nothing else: a short one in a dialog (§5.5, Dialog), and one long
  enough for a page of its own, such as setting up a fingerprint
  terminal, on that page, in the same tab (§5.5, A guide's page). That
  one is a link, so it can be opened in a new tab too.
- **An icon button:** where a row's own action is only an icon, such as
  a claim's Ask about this claim (§5.5): quiet, 44px square with a 20px
  icon, on phones and computers alike. Its name tells screen readers what
  it acts on, such as the claim's number, and its tooltip what it does.
- **A link in a line of text,** such as the one to System settings in a
  note, or How to get the portal's file (§5.5, A client's tax position,
  for the company's people): in `--brand-text` and underlined, so it's
  told from the words around it without its colour, and kept on one
  line. Under the pointer its underline is 2px. On a phone it's 44px
  under a finger (§9): what's tapped is laid over its line, 22px above
  its middle and 22px below, so no line around it moves. It's at least
  44px wide too: a short one, such as a mobile number of a few digits, is
  tapped 22px each way from its middle. A client's mobile number, on its
  page, is one.
- **Busy and disabled states** follow the existing rules from the buttons
  work (global CSS, and a confirmation showing its work under way, §5.5,
  Dialog).
- **A button that can't be used here,** for a reason the person can't
  change from this page, such as a company's high-risk switch while the
  Super Admin has it off for every company, stays where it would be,
  greyed, with why in a note beside it. It's `aria-disabled`, not
  `disabled`, so the keyboard still reaches it and a screen reader hears
  the note as its reason; clicking it does nothing, asking nothing and
  sending nothing. The server refuses the same change, so the page is
  never the only thing standing in its way.

### 5.3 Fields and the filter bar

- **Fields:**
  - 36px tall on computers and 44px on phones;
  - 6px corners and a 1px `--field-line` edge;
  - a visible label above every field. The placeholder is never the only
    label;
  - when focused, a 2px `--brand-text` ring;
  - when it can't be changed, it's on `--page`, with a `--rule` edge and
    `--ink-2` text, and its hint says why.
- **A change that goes for approval,** such as a role asked for by someone
  who may not give it, says so in its field's hint once it's changed.
  While one waits, the field can't be changed, and its hint is the change
  waiting, linked to the request.
- **A password** is a field with a button at its end that shows what's
  typed, and hides it again. The button shows only an eye, so it's named
  for which it will do ("Show password") and says so on hover (§5.2).
  Creating one, its hint says how long it must be.
- **A text area** is a field for more than one line, at least 88px tall,
  with how many characters are left as its hint when there's a limit.
- **A choice between a few options,** such as where a deduction comes
  from, is a set of radio buttons under a visible group label, each 36px
  tall (44px on phones). An option that can't be picked says why beside
  the group.
  - An option that isn't this company's to pick at all, such as a way of
    connecting a terminal that the Super Admin hasn't turned on for it
    (`ATTENDANCE_PLAN.md` §17.8), isn't listed.
- **A colour choice,** such as the brand colour (§2.1):
  - a row of round swatches, 32px across (44px to tap on phones), each a
    radio button named by its colour for screen readers, with a 2px ring
    around the chosen one;
  - where there's a default to go back to, "Use the default" comes first;
  - below the swatches, a field for a colour code (`#rrggbb`), which says
    what's wrong with one that isn't a colour;
  - a preview of a primary button, a link and a selected tab in the
    colour, in light and dark, before it's saved.
- **A place on the map,** such as a location's pin (`CLIENTS_PLAN.md`
  §2.5), is a group of fields under its label:
  - a place search, which drops the pin on the place picked, and gives it
    a name if it has none yet. It suggests places as it's typed, in the
    same list as a name typed or picked from a saved list (below), with
    its keys and sizes:
    - it asks once three letters are typed, a moment after the last key,
      for places in Egypt, with a small spinner at the field's end while
      it waits;
    - each suggestion is a place's name, with the rest of its address
      under it in `--muted`. Only a place with a point on the map is
      suggested, so picking one always drops the pin;
    - when nothing matches, or the search isn't answering, the line under
      the field says so, and that the pin can still be pasted or picked
      on the map;
  - the pin as coordinates (`30.0444, 31.2357`), which can be pasted from
    Google Maps, with "Use my current location" and "Pick on the map"
    right below it as secondary buttons. Once the device gives its
    position, a line under them says how close it is, in `--problem-text`
    when it's too rough for the check radius. When the device can't give
    one, the line says why, in `--problem-text` too;
  - the map opens under the buttons, 288px tall, with a field's corners
    and edge, and a 2px `--brand-text` ring when the keyboard reaches it.
    It shows the pin, a dot in the brand colour with a white edge (§2.1),
    which can be dragged, and the check radius as a circle around it. A
    cross marks its centre: the arrow keys move the map, and "Pin the
    centre", under it, drops the pin there. A map isn't mirrored in
    Arabic. Its own buttons, to zoom and to switch to satellite, are
    named in the page's language and 44px under a finger, with a 2px
    ring in the pin's colour, which holds 3:1 on them: they're white,
    as the map is light, in both themes;
  - the check radius in metres, below, with the default it takes when
    left empty as its hint.

  It's the same map as the check-in places (Company Settings), so a pin
  is placed the same way everywhere.
- **A pick from a list that can grow,** such as a task's location
  (`CLIENTS_PLAN.md` §2.3, §2.4), is a select with what can be added to
  it beside it:
  - the options in groups under their own headings, such as a client's
    locations, its HQ first and marked "HQ", then the shared ones;
  - an option that can't be picked yet stays in the list, greyed, with
    why after its name ("needs a pin"), so it isn't searched for in vain;
  - "+ New location" as a quiet button below the select, never an option
    inside it: an option that opens a form isn't what a select does. It
    opens the form in a dialog, and what's added there is picked when it
    closes.
- **A name typed or picked from a saved list,** such as a task's title or
  a cost's name (`CLIENTS_PLAN.md` §5), is a text field that suggests as
  it's typed:
  - below it, up to eight of the list's names that contain what's typed,
    the part typed in bold; nothing is shown until something is typed,
    and nothing archived;
  - what's typed can be kept as it is: it's saved as typed, with no name
    picked. Picking a suggestion fills the field with it;
  - when what's typed isn't on the list, ignoring capitals, the last line
    offers "+ Add 'X' to the list" to whoever may add names. Nothing is
    added any other way;
  - the arrow keys move through the suggestions, Enter picks one, Escape
    closes them. Each suggestion is 36px tall (44px on phones), and the
    one under the keys is shaded;
  - the field says which name it's linked to only by the suggestion
    picked: typing again unlinks it;
  - where the company keeps a list's names to the list alone, as Company
    settings' Cost names does for a cost's name, the field asks for one of
    them. Before anything is typed it says so, as "Cost name, from the
    saved list". A name typed and not picked is taken where it's one of the
    list's, capitals and the spaces around it aside, the spaces inside it
    kept, as the list keeps them. Otherwise Add leaves the cost unadded
    and says under the field, with the error colour, that the name isn't on
    the list: pick one, or add it from the suggestions for whoever may add
    names, or ask whoever keeps the saved lists for anyone else. With no
    name, it says a name is needed.
- **A name in English and in Arabic,** such as an employee's first or
  last name, a client's name or its owner's, or the company's
  (`LATER_CHANGES_PLAN.md` §3), is a group under the name's visible
  label, with a field for each language:
  - each field has its own visible label, "In English" and "In Arabic".
    The page's language comes first, on the start side; on phones they
    stack, the page's language on top. The Arabic field is right to left
    and the English one left to right, whatever the page's language;
  - each takes up to the name's limit, 40 characters for a person's, and
    says how many it has, as the name fields do today;
  - when one is typed and the other is empty, the empty one offers what
    it may be: a secondary button under it, 30px tall (44px on phones),
    "Use “Mohamed”", with where it comes from beside it in `--muted`:
    "The usual spelling", from Nizmo's list of names, or "Used for 4
    people here", from what this company has saved. Nothing goes in the
    field until the button is pressed or the name is typed, so a
    suggestion is never saved by itself;
  - a word in neither list is Nizmo's guess. It's underlined with dots in
    the button, and a line under it, in `--ink-2`, says so: "“Elshnawy”
    is a guess: check its spelling.";
  - when the empty field is focused, its spellings open under it, in the
    list a name picked from a saved list has (above), with its keys and
    sizes: this company's first, the most used first, each with how many
    it's used for on the end side, then the usual spelling. Picking one
    fills the field;
  - a business's name, a client's or the company's, puts each business
    word where its language puts it: شركة النور للتجارة is suggested as
    "El Nour Trading Company";
  - both are needed for anything new. Saved with one empty, the error is
    under that field, "Enter the last name in Arabic, or use the
    suggestion.", with the suggestion still under it;
  - a name saved before in one language is asked for the other the next
    time it's edited. A note at the top of the form says so, beside a
    round neutral icon and over a hairline: "Names are now kept in English
    and in Arabic. This name has no Arabic yet: add it to save the
    changes.";
  - a name is shown in the page's language everywhere, or in the one it
    has while it has only one, kept in its own direction (§7).
- **The names still missing a language** are listed on the Employees and
  Clients pages:
  - a panel above the filter bar says how many have only one language,
    and that each is asked for the other the next time it's edited. It
    goes once none are left;
  - the filter bar's Names select ("All names", "Missing a language")
    lists them, with a Missing column of neutral badges, "No Arabic" or
    "No English";
  - Company settings says so of the company's own name, above its fields.
- **A pick of several from a long list,** such as a task's assignees, is
  a group under its visible label:
  - a search field, which narrows the list as it's typed;
  - below it, the list as checkboxes in a box that scrolls within itself,
    240px tall, each 36px (44px on phones), with what tells two apart,
    such as a person's role, on the end side;
  - its error below the box, as a field's is.
- **A date, or a range of dates,** such as a day off, is a field whose
  button opens a calendar:
  - the button shows the date in the page's language, "6 Nov 2026", and a
    range as "6–10 Nov 2026", or "From 6 Nov 2026" and "Until 10 Nov 2026"
    when it has one end only. With none, it says what to pick, in
    `--muted`. Its hint and its error are under it, as a field's are, and
    it can be turned off as a field can;
  - on a computer, the calendar opens under the field, from its start
    edge, or above it when there's no room below. It's drawn as the menus
    are (§5.5): `--panel-raised`, a `--rule` edge, the menu's corners and
    level-2 depth. On a phone, it opens in the middle of the screen over
    the dimmed page. On a screen too short for all of it, such as a phone
    on its side, it's as tall as the room it has and scrolls inside, so
    its month, its days and its buttons can all be reached;
  - at its top, the month and year in the page's language, between the
    buttons for the month before and the month after. The month before is
    on the start side, as the pager's previous page is, so in Arabic the
    next month is on the left, the way the days run;
  - the days of the week from Sunday, as the work week starts, each by its
    shortest name in the page's language ("S", «ح»), and read out in full;
  - each day is a button 36px across (44px on phones), its number in the
    page's digits, read out as the whole date ("Friday, 6 November 2026").
    The day picked is in `--brand` with white figures. Today is in
    `--brand-text`, weight 600, and is read out as today. A range's days
    between its first and last are on `--brand-tint`, in `--brand-text`.
    A day that can't be picked is in `--muted` and does nothing, though
    the arrow keys still pass over it;
  - under the days, while there's a date: Clear, a quiet small button on
    the start side. A range also says which of its days to pick next, and
    has Done on the end side;
  - picking a day closes it, and so does a range's last day. A click
    outside it closes it too. The arrow keys move a day or a week, Page Up
    and Page Down a month, and Home and End to the week's ends. Tab stays
    inside it, and Escape closes it and gives the focus back to the field.
- **A date and a time,** such as a task's deadline, is a field whose
  button opens the same calendar, with the time under its days:
  - the button shows them in the page's language, "6 Nov 2026, 5:00 pm".
    With none, it says what to pick, in `--muted`. Its error is under it,
    as a field's is; in a table, its label is read out but not shown;
  - under the days, the time, in the browser's own time field as the
    app's other times are, with 5 minutes between its steps, and Done on
    the end side;
  - picking a day keeps the time picked, or noon when there's none, and
    leaves the calendar open for the time. Done closes it, and so does a
    click outside it. A day that ends before the earliest time allowed
    can't be picked; a time before it is said under the time, and Done is
    off until it's put right.
- **A form on a page of its own,** such as Create task, is one panel: its
  fields one under the other, at most 640px wide, then its buttons, the
  one primary button first. Submitting with something wrong shows each
  error under its field and puts the focus on the first one, below the
  sticky header, never under it.
- **The filter bar** is a panel that holds:
  - a search field, which takes the spare width;
  - the selects for that page;
  - a quiet "Reset filters" button on the end side.

  The search and the selects are the one exception to visible labels: what
  they show already names them ("Search tasks", "All statuses"), so their
  labels are kept for screen readers but not shown.
- **A list with one filter and no search,** such as role change requests
  by status, has its select in its card's head, on the end side. Its
  label is kept for screen readers and not shown, as in the filter bar.
- **On phones,** the filter bar becomes the search field plus a
  "Filters" button showing how many filters are on. The button shows the
  filters below the search, and hides them again.
- **Which period a page is about,** such as the month on Payroll, is
  chosen in a panel straight under the page header:
  - a select for the month and one for the year, each with its visible
    label, the month and year names in the page's language;
  - the page's address keeps the period picked (`?year=2026&month=10`),
    so a reload or a link opens on it. With none, it opens on this month;
  - the Super Admin's company is the company in view, picked in the top
    bar as on every other page. The page has no company select of its
    own, and until a company is picked it says to pick one.

  It isn't a filter bar: it doesn't narrow a list, it picks what the whole
  page shows. So it's never folded away. On phones the selects share the
  row, two to a line.

### 5.4 Lists: a table on computers, cards on phones

- **Table:**
  - one panel;
  - header row in `--text-sm`, `--muted`, sentence case;
  - rows separated by hairlines;
  - the first column holds the item's title in `--ink`, weight 500, with a
    secondary line below it in `--muted` and a small icon, such as the
    "Client – Location" line for tasks;
  - the status column and the action column are at the end;
  - a table wider than its panel scrolls sideways inside it, and the
    panel keeps its rounded corners, so the end columns are never cut off;
  - the pager is in the panel's footer, with the count on the start side.
- **Cards on phones:**
  - the title and status badge on the first line;
  - one line for each piece of detail, each with its icon;
  - the person, the date and small chips on the last line.
- **An overdue item** gets the red start-edge bar, the warning icon, and the
  word "Overdue" beside its date.

### 5.5 The other blocks

- **Page header:**
  - the title (`--text-3xl`, or `--text-2xl` on phones);
  - an optional one-line subtitle in `--muted`;
  - the page's primary button on the end side, with at most one secondary
    button beside it. On phones, the buttons go full width below the title.
  - On a page that belongs to another, such as a client's page under
    Clients, a quiet back link sits above the title: a back arrow, flipped
    in Arabic, and the other page's name.
  - The top bar has no title (§5.1), so a page is named once, by its page
    header. Behind a page with one, the old moving gradient gives way to
    `--page`, so text that sits on the page, such as the subtitle and
    section headings, keeps its contrast.
- **Page layout:** a page's parts are stacked with the "between sections"
  spacing from §4.1.
  - A part that belongs to a module the company's package doesn't include
    isn't there, for anyone in the company, as the module isn't in the
    side bar (§5.1): a tile, a section, a field or a link to it, such as a
    person's pay on their profile where the package hasn't Payroll. The
    rest closes up, and a section left with nothing in it goes too.
- **Section:** a part of a page made of several panels, such as a row of
  tiles. Its heading is `--text-xl`, weight 500, above the panels, with an
  optional quiet link on the end side, such as "View all", or a button,
  such as Upload from the tax portal. Where the heading's longest word
  and its link or button don't fit side by side, as on a narrow phone,
  the link or button goes on its own line under the heading, at the
  start. A long heading beside a short link still wraps beside it, as
  before. A part made of one panel uses a card's title instead.
- **Rows:** a short list inside a panel, such as the five most overdue tasks
  on the dashboard.
  - Rows are split by hairlines. Each row is a link, with the title (and an
    optional detail line in `--muted`) on the start side, and its status,
    date or count on the end side.
  - A row may carry a note under its detail line, such as what a template
    is for, in the detail's size and colour, or a note a line, such as a
    request and its response.
  - The row you came to see, such as the one a notification opened, has
    `--brand-tint` behind it, as a table's does.
  - An overdue row gets the red start-edge bar and the faint red background,
    as in a table.
  - A full list, with filters and pages, uses the table (§5.4) instead.
  - **A row that opens** shows its item's lines under it, such as a
    person's pay on Payroll, line by line. Its title and detail are the
    button that opens it, with a caret after the title that turns while
    it's open, and screen readers hear whether it is. The row's own links,
    such as the person's payslip, sit at its end, beside the button and
    never inside it. Its lines are indented, in `--text-sm` and `--muted`,
    each with its amount at the end. Where what it opens isn't lines of
    amounts, such as what a device sent (Dialog, below), that is drawn
    under the row instead, as wide as the row.
- **Row menu:** the actions on one item that don't fit in its row, behind a
  quiet "More actions" button.
  - The pop-up is level 2 (§4.3) with 8px corners, on the end side of the
    button.
  - The arrow keys move through it, Escape closes it and returns to the
    button, and choosing an item closes it.
  - A destructive item, such as Delete, is in the danger text colour and
    is last, after a hairline. It still asks before it acts.
  - **An item that others use is retired, not deleted,** such as a
    terminal brand that a terminal has used (`ATTENDANCE_PLAN.md` §17.9).
    Its menu's last item is Retire in place of Delete, in the usual text
    colour, since nothing is lost, and it asks first. A retired item stays
    on its list after the others, with a Retired badge, and isn't offered
    anywhere new; Put back, in its menu, offers it again. An item that
    nothing has used is deleted as before.
  - Where something already has a retired item, such as a terminal whose
    brand was retired, its picker keeps it chosen, with "(retired)" after
    its name, so saving other changes leaves it as it is. It's the only
    retired item offered there, and once another is picked and saved, it
    isn't offered again.
- **Dialog:** a level-2 panel (§4.3) on `--panel-raised`, with 12px
  corners and 24px inside (16px on phones), over the dimmed page.
  - The title is `--text-xl`, weight 500.
  - The buttons are at the bottom on the end side, the main one last. On
    phones they stack full width, the main one on top. A button that
    doesn't fit on one line, such as one that says a count and an amount,
    takes two.
  - Escape closes it, and focus goes back to what opened it.
  - One that holds a long list of controls, such as a role's permissions,
    is up to 640px wide, so each control sits beside what it's for.
  - A guide, opened by its button beside a card's title (§5.2), is up to
    640px wide and changes nothing: Close is its only button.
    - Where the steps depend on a choice, such as the terminal's model, a
      picker at the top asks for it, and until something is picked, a
      line says to pick it.
    - Where what's picked has more than one way to set up, such as a
      terminal the agent reads or one that sends to it, a choice (§5.3)
      under the picker asks which, the usual way picked to start with,
      and a line under it says which ones the way picked is for. A way
      that doesn't fit what was picked isn't offered.
    - The steps are numbered. Each says who does it and where, then what
      to do, a line each.
    - Anything to type or paste, such as a command or a file's contents,
      is in a box of its own, left to right and never translated in
      either language, with Copy beside it.
    - Facts kept with the choice, such as the Super Admin's notes on a
      model, show in the step they belong to, in the page's language, or
      in the other, marked with its language, when there's none in the
      page's.
  - One that opens from an older page's modal, as "+ New location" from a
    task's edit window, sits above that modal, and under the toasts.
  - The code a high-risk action asks for (two-factor sign-in) sits above
    every other dialog, under the toasts: the confirmation that sent the
    action, such as "Pay 7 costs, 3,450 EGP", stays open until the code
    is answered. It's a form: a line on why, and for how long it won't be
    asked again on this device, in the page's digits; the code's field,
    its six digits left to right; then Cancel and Confirm.
  - A code that isn't six digits is said under its field before anything
    is sent, and one that isn't right once it's checked; a check that
    couldn't be made says so, to try again, never that the code is wrong.
    While it's checked, Cancel is off and Confirm is busy. Cancel, or
    Escape, gives the action its refusal, and what was typed isn't kept.
  - After five codes in fifteen minutes, the server checks no more until
    those fifteen minutes are over. The prompt says so under the code,
    counting down in even-width digits as the sign-in page does, and never
    calls a code it didn't check wrong. Once the time is up, it says a
    code can be tried again. Confirm can still be pressed meanwhile: it
    asks the server again, which says how long is left.
  - For an account without two-factor sign-in, the same place says the
    action needs it, with Cancel and a link to set it up.
  - One that asks for the viewer's own password before an action, such as
    resetting someone else's, is a form: the password field, with what's
    wrong said under it, such as a password that doesn't match, then
    Cancel and Confirm. While the password is checked, Cancel is off and
    Confirm is busy. What was typed is never kept: each time it opens, the
    field is empty.
  - A code or a password shown once, such as an attendance agent's code
    or a temporary password, is large, left to right and never translated,
    and chosen whole with one click to copy, with a line saying it won't
    be shown again. A longer one, such as a password, is a size smaller,
    so it stays on one line on a phone. Done closes it, and then it's
    gone.
  - What to set on a device, shown once, such as the address a
    fingerprint terminal sends its scans to (`ATTENDANCE_PLAN.md` §17.7),
    is a short list: each setting under the name the device gives it,
    with its value, left to right and never translated in either
    language.
    - A value too long to type, such as the address, is in a box of its
      own with Copy beside it, as in a guide.
    - A line says which value is secret and won't be shown again, and how
      a new one is issued.
    - Done closes it, and then the secret is gone.
    - With nothing secret in it, such as what to set on a ZKTeco
      terminal, it's shown the same way after the device is added, with
      no line about being shown once, and its menu opens it again at any
      time, as What to set on it.
    - Where Nizmo lets the device in from its office's internet address
      alone, that address is asked for when it's added: a field taking one
      address or range per line, as a check-in location's office IPs do,
      left to right in either language. The device's row says it, and its
      menu changes it, asking for the step-up code as adding it did.
  - Changing how a device connects, such as a fingerprint terminal moved
    between the office agent and straight to Nizmo (`ATTENDANCE_PLAN.md`
    §17.6, §17.7), is in its menu as Change connection, only where there
    is another way open to it (§5.3). Its dialog is titled with where it
    moves to, says in a sentence or two what changes and what stays, and
    its main button says the move, such as "Move straight to Nizmo".
    - Moved where Nizmo lets it in from its office's internet address,
      the dialog asks for that address as adding it does, then the
      step-up code. What to set on it follows, as after adding it.
    - Moved where nothing is asked, it's a confirmation (below), not in
      the danger colour: nothing is lost, and its scans stay.
    - Moved straight to Nizmo, its row reads as one just added that way,
      waiting for its first contact until it calls.
  - What a device sent, kept to be read, such as a fingerprint terminal's
    first requests (`ATTENDANCE_PLAN.md` §17.8), is a list in the order
    they came, up to 640px wide. It changes nothing: Close is its only
    button.
    - A line above the list says what is kept, for how long, and what is
      taken out of it.
    - Each is a row that opens (Rows, above): what Nizmo made of it, in
      words, then when it came. Several can be open at once.
    - Opened, it shows what was sent: its headers, then its body, each
      under its own label in a box of its own with Copy beside it, as in
      a guide, left to right and never translated in either language. A
      long line scrolls inside its box and never widens the dialog, and a
      long body scrolls inside its box too. The keyboard reaches a box
      that scrolls, with the focus ring around it.
    - What was taken out is said in its place, inside the box.
    - With nothing kept, a line says so and why: nothing has come yet, or
      the time for keeping is over.
    - While it's open the list is read again every few seconds, so one
      that comes now appears without opening it again. A row that's open
      stays open.
  - One that can't be undone, such as restoring a backup, asks for a word
    typed first, such as RESTORE: the word is shown as the code has it,
    left to right and never translated, in both languages, and the main
    button stays off until it's typed as shown. Enter is the main button
    once it is.
  - A confirmation asks before an action: what it does, in a sentence or
    two, then Cancel and the button that does it, which says what it does
    as the action's own button does, such as "Delete record". The button
    is in the danger colour only when the action deletes something or
    can't be undone. Once confirmed, it stays open until the work is done:
    Cancel is off, the main button is busy, and Escape or a click outside
    does nothing, since what was sent can't be called off.
  - One that can't go ahead until something is settled elsewhere, such as
    approving a month's payroll while days of it wait on a scan or a
    decision, says so in place of asking: why, in a sentence, then what
    waits, a row for each that opens where it's settled, and Close in place
    of the button that would do it. Settled and opened again, it asks as
    any confirmation does. Refused because something came to wait after it
    opened, it stays open and shows what waits. What only needs knowing,
    such as requests not yet decided that the action doesn't wait for,
    follows under a heading of its own, a row for each kind with how many,
    opening where they're decided, whether it can go ahead or not.
  - One that records money owed, such as ending a contract, shows what
    it would record before it does: the statement's own lines, totals and
    notes (Document, below), under a heading of its own, as the statement
    will have them. While it's worked out for what's picked, such as the
    last working day, it says so, the last figures staying until the next
    are in, and the main button waits for its own: the figure confirmed is
    the figure recorded. Screen readers hear the figures once they're in.
    One that didn't load says so, with Try again.
    - Where what it would record belongs to a module the company's package
      doesn't include, it isn't there (Page layout, above), whoever opens
      the dialog: the record follows the company's package. Ending a
      contract without Payroll records no settlement, so the dialog shows
      none. What they still hold of a cash advance stays on their advance,
      to be returned, and a note waiting on someone says so, with the
      amount, where the statement would be. The main button still waits
      until it's worked out for what's picked.
  - One that asks who takes over, such as a leader's team when they stop
    leading it, names whom it's about, each in a list, then who takes
    them, with no one among the choices. Answered, it stays open until the
    change is sent, as a confirmation does, and why the one picked can't
    take them is said under the choice.
  - Transfer task, where anyone on the task holds cash advance money for
    it, says what happens to it for the people picked, under a heading of
    its own, below them: a line for each person holding any, naming them,
    then that they keep it, now for the task's copy; that it passes to
    whoever takes it, who confirms receiving it; or that it joins their
    running balance. The amount is in the line only for whoever may see
    that person's cash advance, or it's their own.
    - Where it passes on and the copy has more than one person, who takes
      it is picked from them, below the lines, and the main button waits
      for the pick.
    - Where no one's added, no copy is made, and a line says what's held
      stays with the task.
    - It's worked out again as people are picked, as a statement is
      (above): the last lines stay until the next are in, the main button
      waits for its own, and one that didn't load says so, with Try again.
- **A guide's page:** a guide too long for a dialog, such as How to set
  up a fingerprint terminal (`ATTENDANCE_PLAN.md` §17.7), has a page of
  its own, opened from its button beside its card's title (§5.2). It
  changes nothing.
  - Its header (Page header): a back link to the card's page, named for
    the card, such as "Fingerprint terminals", which opens on the card's
    tab; the guide's name as the title; a subtitle saying what's in it;
    and Print, a secondary button.
  - Then a panel of what the steps depend on, each under its label:
    - a picker for what they're for, such as the terminal's model, and
      until something is picked, a line saying to pick it;
    - the facts kept with what's picked, such as the Super Admin's notes
      on a model, as in a guide's dialog (Dialog);
    - where what's picked has more than one way to set up, a choice (§5.3)
      asking which, as in a guide's dialog;
    - where what's typed depends on the program it's typed in, a choice
      asking which, such as Command Prompt or PowerShell, Command Prompt
      picked to start with, and a line under it saying how its commands
      are written. What's picked is kept in that browser, for next time.
  - Then the steps, each in a panel of its own: its number in a round
    `--brand-tint` badge, its title in `--text-lg`, who does it and where
    in `--text-sm` and `--muted`, then what to do, a line each, as in a
    guide's dialog.
  - Anything to type is in a box of its own with Copy beside it, as in a
    guide's dialog, written for the program picked: in PowerShell, each
    of the agent's own commands starts with `.\`, in the boxes and in the
    lines alike.
  - What's seen once something's typed, such as what `ping` answers, is a
    line under its box in `--text-sm` and `--muted`.
  - Under a line whose clicks aren't plain, Show me how opens them: a
    quiet small button with a caret before its words that turns as it
    opens, which says whether it's open. Under it, in a panel on
    `--brand-tint` with a `--brand-tint-strong` hairline and
    `--radius-panel` corners, a numbered list of the clicks, a heading in
    weight 600 over each part where there's more than one, and a line
    after them where one's needed, such as going back to the terminal's
    clock. Where it shows what a command prints rather than what to do,
    it's named What it shows, with an example of what's printed, in a
    box on `--panel`, above its list. The names on the screen, such as a
    key, a menu or a button, are in weight 600. Each opens on its own,
    and all start closed.
  - On phones, as on any page: Print goes full width under the subtitle,
    a choice's options stack, 44px each, and Copy goes under its box.
  - Printed, only the guide prints, black on white: its title, a line
    naming what was picked and the day it's printed, and the steps,
    without the app's frame, the back link, the panel's controls or the
    buttons. A command too long for the page's width wraps onto the next
    line, as paper can't scroll, so it's read whole. Every Show me how
    and What it shows is open, without its button and on white, its
    list under its line, so the paper holds every click.
- **Toast:** a few words on what an action did, such as "Saved", or why it
  couldn't be done, at the top of the screen on its end side, over every
  dialog. It's a level-2 panel (§4.3) on `--panel-raised`, with 8px
  corners, up to 400px wide, or the screen's width less 16px each side on
  a phone, the newest under the others.
  - Its meaning's colour (§2.3) is a 3px bar on its start edge, as a note
    above the page's is, with an icon in the same colour before the words:
    Done or good for something done (a tick), Problem for an error (a
    warning circle), Waiting on someone for a warning (a warning sign), and
    Neutral for the rest (an "i"). The words say it, so the colour is never
    the only signal.
  - Close, an X named for what it does, is on its end side.
  - It slides in from the end side in 200ms. With "reduce motion" it's just
    there.
  - An error stays until the person moves on: a tap anywhere but on it, or
    another page. The rest go after five seconds, their clock stopped
    while the pointer, a finger or focus is on them. The same message again
    counts on the one showing, and no more than five show at once; a stack
    taller than the screen scrolls.
  - Screen readers hear each as it comes: an error at once, the rest in
    their turn.
- **Selection bar:** when items in a list are picked with their
  checkboxes, a panel above the list says how many are picked and holds
  what can be done to all of them, with a quiet "Clear selection" on the
  end side. It's gone when nothing is picked.
- **Status badge:** a pill, `--text-xs`, weight 500, with the background and
  text colours from §2.3.
- **Tabs:** text tabs with a 2px `--brand` line under the selected one, and
  a hairline under the whole row. On phones, the tabs share the row, a
  long label on two lines, so every tab shows; a row of more than fit
  scrolls sideways within itself. A tab is at most 8rem wide there and is
  never squeezed narrower than that or its label, so no label takes more
  than two lines: a row that can't fit them so scrolls rather than
  stacking its labels three and four lines high. Opened on a tab past the
  row's edge, by a link or a reload, the row scrolls to show it, and the
  page doesn't move. A tab can say how many it holds, such as the
  companies that need attention: a pill after its label in `--text-xs`,
  in the neutral badge's colours, and the brand tint's when it's the
  selected tab.
- **Total tiles:**
  - a label in `--text-sm` and `--muted`, above the value in `--text-2xl`
    and weight 600 with even-width digits;
  - an optional note under the value, in `--text-sm` and `--muted`, such
    as "This month" or "40% completed";
  - a tile can be a link to the list it counts. Its label is then in
    `--brand-text`, and the whole tile is the target;
  - up to 4 in a row on computers, 2 on phones while their values fit
    half the row. A value is never broken, an amount from its currency
    least of all: a tile whose value needs more takes the row.
- **Status counts:** how many of a list's people have each status, as a
  row of pills above the list that can show only one status, such as the
  Super Admin's All users (`LATER_CHANGES_PLAN.md` §6):
  - one pill for each status the list's Status column can show, in its
    order: the status's word, then its count in weight 600 with even-width
    digits. `--text-sm`, weight 500, fully round, 44px tall, in that
    status's badge colours (§2.3), so a word is never told by its colour
    alone;
  - every one is there, at 0 too, so the row doesn't move as counts
    change;
  - the counts are of everyone the list is for, on every page of it, such
    as the company picked. A search doesn't change them;
  - each pill is a button that shows only its status in the list. Pressed,
    it has a tick before its word and a 2px `--brand` ring outside it,
    apart from the pill by 2px of the page's colour, and says it's
    pressed to screen readers. Pressed again, it shows everyone;
  - while one is pressed, a line under the row says so, such as "Showing
    online people only.", in `--text-sm` and `--muted`, with Show everyone
    as a link-styled button;
  - between the tabs and the filter bar, wrapping onto more lines on a
    phone, never scrolling sideways.
- **Donut chart:** a ring for how a whole splits into a few parts, such as
  tasks by status or day off credit used and left.
  - The ring is 160px across and thin, a tenth of that. Its parts have
    rounded ends and a clear gap between them, with nothing drawn behind,
    and one part alone fills the ring.
  - Each part takes its meaning's chart colour (§2.3). A later part with
    the same meaning as an earlier one, such as Completed after Approved,
    takes a deeper shade of it (mixed 35% towards `--ink`), so the two read
    as two.
  - The total is in the middle in `--text-3xl`, weight 600, with even-width
    digits, and its label below in `--text-sm` and `--muted`. A total of
    more than five characters, such as "12 days", is in `--text-xl`, so it
    stays clear of the ring.
  - Beside the ring (below it on phones) is the legend. Each row has the
    part's colour mark (a 10px square with 3px corners), its word, its
    count, and its share of the total in `--muted`. The counts and shares
    line up in columns. The legend is at most 28rem wide, so on a wide page
    a count stays near its word. Screen readers read the legend, and the ring is
    hidden from them. A legend row can link to what it counts.
  - Pointing at a legend row, or moving focus to it, fades the ring's other
    parts, so the row and its part are seen together. The fade takes
    150ms and nothing moves; with reduced motion it's instant.
  - With nothing to count, the ring is a faint track, the middle says 0,
    and the legend says there's nothing yet.
  - While the numbers load, the legend says so. If they don't load, it
    says that instead, with a Try again button below. Either way the middle
    is blank, since a 0 there would read as the answer.
- **Details:** an item's facts on its own page, such as a client's owner
  and phone, in a card. Each is a label in `--text-sm` and `--muted` above
  its value, up to 3 in a row on computers and 1 on phones. A phone number
  is a link that calls it. A link that opens a new tab, such as a map, says
  so to screen readers.
  - A fact with nothing in it says so, such as "None", never a dash or a
    blank.
  - A note on a fact, such as until when someone is acting in a role, is a
    second line under its value, in `--text-sm` and `--muted`.
  - What can be done to a fact, such as ending someone's contract, is a
    small secondary button beside its value. An action with no value to
    sit beside, such as resetting someone's password, is a fact of its
    own, with its button as the value.
  - While what was asked for waits for approval, such as another role, a
    note under the value says so, linked to the request, where its button
    was.
- **Files:**
  - adding files is a secondary "Attach files" button that opens the file
    picker. On computers, files can also be dropped on it. The hint says
    which kinds and how large they may be;
  - each file, picked or saved, is a chip with a file icon, its name and
    its size. A saved file's chip opens it in a new tab, and says so to
    screen readers. A chip's remove button is named for its file;
  - a file that can be started from a template, such as attendance's
    import, has the template under the file picker: a quiet, small
    Download template button with the download icon, the label the task
    upload's template has. It's a plain link, which the browser downloads
    itself, and the template is in the page's language. Once a file is
    picked, its chip takes the picker's place, and the button goes with it.
- **A file that replaces one,** such as a template for the bulk upload of
  tasks, which the Super Admin keeps, is a section of its own under its
  heading:
  - the one there now as a saved file's chip, with when it was last
    uploaded under it, or that none has been yet;
  - the file picker (above) for one file, its hint saying which kind and
    what uploading it replaces. Once one is picked, its chip, then Upload,
    a small primary button: nothing is replaced until it's pressed;
  - a file of another kind is said under the picker before anything is
    sent, as is one that couldn't be uploaded. While it's sent, the
    picker is off, and a line under it says so, which a screen reader
    hears. Once it's uploaded, a toast says so.
- **Rows read from a file,** such as tasks uploaded from Excel, are
  checked before any is saved, in a dialog up to 960px wide:
  - the file is read once what its rows are checked against has loaded,
    such as the people they name. A file that can't be read, or has no
    rows, or more than can be added at once, is said in a toast, and the
    dialog doesn't open. A cell that isn't what its column takes, such as
    a date that isn't one, is a mistake that says what the file had,
    never a guess;
  - a line says how many rows the file has, and how many have mistakes;
  - the rows are a list (§5.4): a table on computers, cards on phones,
    each with its row's number in the file, so it can be found there. A
    row with mistakes has the red start-edge bar, and its mistakes under
    its title, each saying what's wrong;
  - a row's Edit opens its fields in the dialog, as the form it would be
    added with has them, each with what's wrong under it. Done, or
    Escape, goes back to the list, to that row. Remove takes a row out
    without asking, as nothing has been saved yet: a line under the count
    says which, which a screen reader hears, with Undo to put it back
    where it was;
  - at the bottom, Cancel, then the main button saying how many it
    creates, such as "Create 12 tasks", off while none can be. A row with
    mistakes is left out until it's fixed, and the line above the buttons
    says how many are;
  - while they're sent, Cancel is off, the main button is busy, and
    Escape does nothing. What couldn't be saved is said above the
    buttons, and the dialog stays open. Once they're saved, a toast says
    how many were, as the server counted them, and the list they're on
    opens.
- **A person's profile,** seen by someone else, is one card: their photo,
  then their facts as details (above), each only for whoever may see it.
  Edit is the page header's primary button, for whoever may edit them; the
  form is a page of its own.
- **A person's photo,** at the top of their profile's card: a circle 96px
  across, their photo filling it, or their initials in an avatar's colours
  when they have none, never a drawing that stands in for them.
  - Where it can be changed, beside it are "Upload a photo" ("Change
    photo" once there's one), the file picker (above) for one image, its
    hint saying which kinds, how large, and that it's saved as soon as
    it's uploaded, and "Remove photo", a quiet button that asks first.
  - A file that's too large, or isn't a photo, is said under the picker
    before anything is sent, as is a photo that couldn't be saved.
  - The photo is saved without the form's own button. While it's sent,
    the picker is off, and a line under it says so, which a screen reader
    hears.
- **A person's WhatsApp number, for their clients**
  (`CLIENT_PORTAL_PLAN.md` §7), as the owner's mockup draws it: a card of
  its own on their profile's form, Contacting clients, with its own Save,
  where the company's package has the client portal. It's there on one's
  own profile and for whoever may edit theirs, never on a Super Admin's.
  - One field, WhatsApp number, left to right in either language, with a
    hint under it: an Egyptian mobile starting 01, or the number with its
    country code (+), and that it can be left empty. It's kept with its
    country code, "+201001234567", and shown as it's kept.
  - Under the field, a box on `--page`: the clients' people this account
    is the responsible accountant for write to this number, then those
    clients by name, in weight 600 and joined by commas; and without a
    number they don't see the contact button. Where it's no client's
    responsible accountant yet, the box says so in place of the names.
    An archived client isn't named.
  - A number that isn't one is said under the field, before anything is
    sent; saved, a toast says so. Emptied and saved, the number is gone.
- **Face photos,** such as a flagged check-in's last frame beside the
  person's approved photo, to see whether it's the same person: in a
  dialog, side by side, on a phone too, each 3 by 4 with its name under
  it in `--muted`.
  - The viewer's name and the time the photos opened are written across
    each, three times, the time under the name: a screenshot can't be
    prevented, so it says who took it, and when. The time is on the
    viewer's own clock and in the page's digits, as a date and a time are
    written ("7 Nov 2026, 12:23 pm", «٧ نوفمبر ٢٠٢٦، ١٢:٢٣ م»). On a
    photo too narrow for them, as on a small phone, the time goes under
    its date, never past the photo's edge or with "pm" alone. A photo
    can't be dragged out or picked, and a right click offers nothing on
    it.
  - The dialog has Close, as a phone has no Escape key. Where something
    is decided on them, as a face check's review is, its buttons are
    beside Close.
- **Expiry:** an item with an expiry date, such as a record, shows the date
  with a badge beside it:
  - "Expired" (Problem, with the warning icon) once the day has passed;
  - "Expires soon" (Waiting on someone) from 30 days before, up to and
    including the day itself;
  - nothing when it's further off, or has no date.

  An "Expiring soon" filter finds exactly the items with that badge.
- **An item opened from a list:** where a list cuts an item's text short,
  such as a record's text cut to 2 lines, the item's title opens it in a
  dialog. The dialog shows all of it, with the actions the person may take
  on it.
- **What an edit changed:** when a task's title or description changes
  after it was given, whoever does it can see how, in a dialog named for
  the field ("Title changes"). It shows the text as it is now, word by
  word, with what was taken out and what was put in:
  - taken out is struck through, in the Problem colours; put in is
    underlined, in the Done or good colours (§2.3). Words next to each
    other that changed together are marked as one;
  - colour is never the only signal: a key above the text names each
    mark, and screen readers hear "Removed:" or "Added:" before each;
  - only what changed is marked, never a word that stayed, shown taken
    out and put back;
  - the text keeps its own direction (§7) and its line breaks, and a word
    with no space in it breaks where it must;
  - the buttons that open it stay until the person says they've seen the
    change, so it can be opened again, and closing it gives the focus back
    to its button.
- **Empty state:** a 40px icon in `--muted`, one line saying what's
  missing, and the button to add one. When why it's empty isn't plain, a
  second line says why, and who can change it: a Team Leader with no one
  on their team yet sees an empty list that's right, and looks broken.
- **Loading:** while a page, or a part of one, loads, it says so in the
  same block: the hourglass and one line saying what's loading, such as
  "Loading…", where it will be, which a screen reader hears. The page's
  header and filters are there from the start: a page is never given over
  to it whole. While the language changes, the whole screen says so, in
  the page's colour, for the moment it takes.
- **A list that didn't load** says so in the same block: a warning icon,
  one line saying what didn't load, and Try again, which shows it's busy
  while it tries. It never says there's nothing, or offers to add one, when
  it doesn't know.
  - Before saying so, it tries again by itself, three times: half a
    second, one second and two seconds apart, still showing that it's
    loading. So a moment's trouble with the connection or the server
    doesn't reach the screen.
  - Only a failure that can pass is tried again: no answer at all, the
    server's own error, or the server too busy. A refusal or "not found"
    is the answer, and is said at once.
  - The same goes for anything else a screen loads: a picker's options, a
    form's details, a card's numbers, a preview. Whatever it shows when it
    fails, a message, a Try again or a picker left empty, comes only after
    the three tries.
  - Only loading is tried again. A save is sent once: sent again, it
    might be done twice.
- **A page someone can't open,** such as one their role doesn't include,
  says so in its page header, in the page's language: "You can't open
  this page", and under it why, and who can change it.
  - A role that doesn't include it: an Admin of their company can add it
    to their role.
  - A page only a Super Admin opens, or, for a Super Admin, a company's
    own page: just that, as nobody's role changes it.
  - A module the company's package doesn't include: just that.
  - An account that can't open pages at all for now, such as a suspended
    one: just that, until it's signed out and told why.
  - Go to the dashboard is in the header, except on the dashboard itself
    and for an account that can't open pages: there it would only be
    told the same again. The side bar stays, as on any page.
- **A company whose subscription has ended:** the page its people are
  held on, where its Admin, the one who can still sign in, renews it.
  - Its page header says so, and under it the day access was paused, in
    the page's language and digits, on Egypt's calendar, as subscriptions
    are counted. Renewing it lets everyone back in at once.
  - Under the header, a card says first that nothing was deleted, with a
    check in the Good colour (§2.3): someone who thinks their records are
    gone doesn't renew.
- **A page the app has to leave:** when the account can't go on, as when
  it's suspended, closed, deleted or its company banned while it's open,
  or when maintenance starts. The whole screen, in the page's colour, covers the
  page while the work open on it is saved, as the language switch's does.
  - In its middle, as an empty state: its icon, what happened, why, and
    what happens next: signing out, or the maintenance page. Nothing
    turns (§8). A why longer than the screen, as the Super Admins'
    maintenance message can be, scrolls from its top, and a link in it
    breaks where it must.
  - It's a dialog with no buttons, above everything: the focus goes to it
    and stays, screen readers hear it at once, and Escape does nothing,
    as there's nothing to go back to. It draws no focus ring, as nothing
    on it can be used.
- **A page that broke:** when a page fails in a way nothing on it could
  handle, its place says so, in the page's language. The side bar and the
  top bar stay, and going to another page from them leaves it behind.
  - In its middle, in a panel, as an empty state: the warning icon, "This
    page stopped working", and what to do. Reloading the page usually puts
    it right. If it keeps happening, Start again clears what this browser
    keeps for the app, such as the company a Super Admin last picked, and
    reloads it, still signed in, in the same language and theme.
  - Reload page is the main button, and Start again is beside it. Neither
    is red, as neither deletes anything.
  - Once the failure is logged, its reference is under them, for the
    person to share with their Admin: as it was made, in Western letters
    and digits, which a browser's translation leaves as it is.
  - The focus moves to its title, where the page was, and screen readers
    hear it at once.
- **When the app itself broke,** before even the side bar could be drawn,
  the whole screen says the same, in the page's colour, with the same
  buttons and reference, in the language and theme the person chose and
  in the app's own fonts, and at a phone's own width, as every page is.
- **A note above the page,** for something true on every page for now: a
  company's free trial or its grace, or a role a Super Admin is
  previewing. It's a level-1 panel at the page's width, above the page
  header, 24px over it.
  - Its meaning's colour (§2.3) is a 3px bar on its start edge, as a
    card's is: Neutral for a trial, Problem for grace, Waiting on someone
    for a preview. The words say it, so the colour is never the only
    signal.
  - What's so is in the page's language, digits too, and the one thing to
    do about it is on its end side, if it can be done there. On a phone it
    goes under the words.
  - Screen readers hear it once, as it appears. It can't be closed: it
    goes when what it says stops being true.
  - A trial's note and grace's are for the company's Admins alone, who
    act on them; nobody else in the company sees either.
  - A trial counts its days left, and says the day it ends, on Egypt's
    calendar, as subscriptions are counted.
  - Grace says the subscription has ended, how long is left until access
    stops, and on what day, and that renewing it keeps everyone's
    access.
  - A preview says which role, at which company, and that nothing can be
    changed while it lasts, with Exit preview.
- **Card:** a level-1 panel with 12px corners, for things that aren't
  lists, such as settings sections. As the owner's mockup of a client's
  tax position draws it, everywhere (decided by the owner on 2026-11-20):
  - inside it, 20px above and below and 24px at the sides on computers,
    16px all round on phones. Rows that run to its edges run to them
    still;
  - its title is `--text-card`, weight 600, in `--ink`;
  - a titled part inside it, such as a task's costs paid person by
    person, is headed in `--text-md` at weight 600, under the card's own
    title. It was `--text-lg` at 500, larger than the card's title once
    that was 15px (found in the interface audit, 2026-11-20);
  - a page's cards are 16px apart, side by side and one under another.
  - Its title can have a line under it in `--text-xs` and `--muted`,
    saying how what's in it is ordered or counted, such as "Largest
    first".
  - A card that needs someone before going on has the Waiting on someone
    colour (§2.3) as a 3px bar on its start edge. An example is Payroll's
    people paid for days nobody has ruled on.
  - A card that says something is wrong has the Problem colour's. An
    example is the people whose month couldn't be worked out.
  - Its title says what it is, so the colour is never the only signal,
    and its background stays the panel's, so its text keeps its contrast.
  - A card that loads its own data holds the room of the most it can show
    while it loads, so nothing below it moves when it comes. Each part,
    such as its state or its row of buttons, is as tall as the tallest of
    what it can show there, failing to load included. An example is face
    verification on System settings.
- **Document:** a paper the app issues, such as a payslip or a settlement
  statement, read on screen and printed.
  - The page header names it, with Print as its primary button and
    anything else that acts on it, such as Send again, beside it. They sit
    above the sheet, never on it, so none of them is printed.
  - The sheet is a level-1 panel at reading width (736px), with 32px
    inside (16px on phones). Its head has the company's name in
    `--text-xl`, weight 500, with the document's name below it in
    `--text-sm` and `--muted`, and the company's logo on the end side,
    over a 2px rule in `--ink`.
  - Its facts, such as who it's for and the period, are details (below).
  - Its lines are a label on the start side and the amount on the end
    side, in even-width digits. An amount taken off has a minus sign (−).
    A group of lines, such as Earnings, has a heading in `--text-sm`,
    weight 500.
  - A total is in `--text-lg`, weight 600, under a 2px rule in `--ink`.
    The figure the document is for, such as the net, is its last total.
  - What to know about it is a note with its meaning's colour (§2.3) as a
    3px bar on its start edge, as a card has: a payslip not final yet
    waits on someone. A settlement says who owes whom in the colour of
    what it means for the person: good when the company owes them, a
    problem when they owe, neutral when it's settled. The words say it,
    so the colour is never the only signal, and a bar prints where a fill
    wouldn't.
  - It's in the page's language, digits too.
  - Printed, the sheet is all there is: black on white on every page it
    runs onto, without the app around it, with 18mm margins, and its notes'
    bars in the colours they have on a light screen, from dark mode too.
  - One that isn't there, or isn't theirs, says so. One that didn't load
    says that instead, with Try again (§5.5, A list that didn't load).
- **A document's table:** a document's lines with several amounts each,
  such as a client statement's charges.
  - Its column headings are `--text-sm` in `--muted`, over a 1px rule in
    `--ink`. A 1px `--rule` is between its rows. Its amounts are on the end
    side, in even-width digits. A day, and a status with its day such as
    Collected 2 Nov, stay on one line: the column saying what it is wraps
    instead. Its foot, such as how many and their sums, is weight 600, over
    a 1px rule in `--ink`.
  - On phones, each row is a block of lines, as a list's card is (§5.4):
    its day; what it is, with its total on the end side; then the rest.
  - Printed, its headings start every page it runs onto, its foot comes
    once, at its end, no row is split between two pages, and its rules are
    in `--rule-on-paper`, a grey that prints where `--rule` all but
    vanishes.
- **Client statement:** a document of what one client was charged in a
  period, with the receipts, to send to the client or check against their
  records.
  - It's opened from Statement, beside Mark collected on the client's
    Charges, by whoever sees all the company's charges. A Team Leader sees
    only their team's tasks' charges, so they don't get it: a statement
    that left some out would mislead the client.
  - Above the sheet, as for any document: Print, the page header's primary
    button. At the sheet's width, tabs pick which statement it is, Every
    charge as it opens or By cost name, with a line under them saying what
    the picked one shows. On a row of its own under them: the period, With
    receipts, ticked as it opens, and a hint that the print dialog saves it
    as a PDF. The period is the dates picked on the client's Charges, or
    last month where none were. The page's address keeps all three.
  - The sheet says which it is under the company's name: "Client
    statement, every charge" or "Client statement, by cost name".
  - Its details: the client, with its owner under its name; the period;
    and the day it was issued. Each charge's status, and what's due, are as
    they are that day.
  - Its charges are those added to the client's tasks in the period and
    not left off its bill, oldest first, in a document's table: the day;
    what was bought, with its task and its receipt's number, or No
    receipt, under it; Paid, Service fee and Total; and Due, or Collected
    and the day. Its foot counts them and sums the three amounts. With none
    in the period, the table's place says so.
  - By cost name, the same charges are added up by what they're called, in
    a document's table in place of theirs: each cost name, how many charges
    it has, and their Paid, Service fee and Total, highest total first. Its
    foot counts the names and the charges and sums the three amounts. What's
    still due is left to the totals under it.
    - A charge picked from a saved list is under that name, as the list has
      it now.
    - A typed name is under a saved name, or with other typed ones, that it
      matches with capitals, spaces, Arabic's letter forms (أ إ آ ا, ة ه,
      ى ي), its vowel marks and the stretch line (ـ) set aside. Typed only,
      it's shown as it was typed most often. Nothing else is guessed: a
      typo is a name of its own.
    - A charge with no name is under No name.
  - Its totals: Charged in this period; Collected, taken off; Still due
    from before the period's first day, only where some is; and Still due,
    the figure the statement is for, its last total.
  - A note says what's still due and for how many charges, with the
    Waiting on someone colour, or that nothing is, with the Good colour.
  - With receipts, they follow under Receipts: each one's photo, whole,
    with its number, what was bought, the day and what was paid above it,
    four to a row on computers and two on phones. Printed, they start on a
    new page, headed Receipts in `--text-xl`, as the sheet's company is,
    with a line in `--text-sm` under it saying whose statement they're
    from; four to a page, each whole. A receipt that's a PDF opens from its
    place there; printed, it says it's a file of its own.
  - By cost name, the receipts are under each name, in the table's order:
    its name and how many receipts as a heading, then each one's photo with
    its number, the day, its task and what was paid. A charge under the
    name with no receipt is said under them. They're numbered in that
    order.
  - A period with more charges than one statement holds (200) says so,
    and asks for a shorter one.
- **The client's area:** where a client's person lands after signing in,
  to see what the company keeps for their client
  (`CLIENT_PORTAL_PLAN.md` §5, §6). It isn't the app the company's own
  people use, so it has none of its frame:
  - a top bar alone, on `--panel` with a `--rule` line under it: at the
    start, the company's mark and name as at the top of the side bar
    (§5.1); at the end, the language switch and the account button, as
    the company's top bar has them (§5.1), and its menu, with Change
    password and Sign out. No side bar, notifications or search
    while the area has one page;
  - its pages are up to 1180px wide and centred, on `--page`;
  - it's in the company's brand colour (§2.1), so the client sees the
    office they deal with.
- **Bars by part:** how an amount splits into a few named parts, to
  compare them, such as what a client owes by item.
  - Each part is a row: its name in `--text-sm` and `--ink-2`, a bar, and
    its amount in `--text-sm` and weight 600, with a note in `--text-xs`
    and `--muted` under the amount, such as its share and how many there
    are. On computers the names take a column 140px wide and the amounts
    one at the end, and the bars the room between. On phones, the bar
    goes under the name and the amount to the row's end, with the note
    under the bar.
  - The bars are 8px high in `--brand`, starting at the start side, with
    their far end rounded 4px. The largest part fills the space and the
    rest are drawn to scale; a part too small to see is drawn 4px long, so
    it's still there. A part at 0 has no bar.
  - One colour, as the names say which part is which. Largest first,
    unless the parts have an order of their own, such as how long ago,
    which they keep.
  - The amounts and notes are in the text colours, never the bar's.
    Pointing at a row shows its full name and amount. No axis or grid
    lines.
  - A part can go by a short name, with its full name when pointed at
    and for screen readers, such as تأمين صحي for مساهمة تكافلية - تأمين
    صحي.
  - A name too long for its row is cut short at its own end, in its own
    direction, so an item's Arabic name on the English page keeps its
    first words.
- **Share bar:** how much of a whole is done, such as how much of a
  client's claims is paid. A line in `--text-sm` says it in words, weight
  500, such as "16% of the total claims paid", with the two amounts in
  `--muted` at its end, over a 10px bar of `--brand` on
  `--brand-tint-strong`, fully rounded. On phones the amounts go under the
  bar, in `--text-xs`. Screen readers read the line and the amounts, and
  the bar is hidden from them.
- **A client's tax position:** the client's area's page of what their
  company owes on the Tax Authority's portal, from what the company
  keeps for it (`CLIENT_PORTAL_PLAN.md` §6).
  - Its page header: the client's name in `--text-sm` and `--muted` above
    the title; a subtitle saying where the figures come from, the day they
    were last updated and the responsible accountant, such as "From the
    Tax Authority's portal, last updated 16 Nov 2026. Responsible
    accountant: …"; Contact the
    accountant as the primary button and Download the statement beside
    it. Where the client has no one to write to on WhatsApp
    (`CLIENT_PORTAL_PLAN.md` §7), Contact the accountant isn't there, nor
    is any claim's Ask about this claim, and the note under the claims
    says to contact the office.
    - The accountant is named where the client has one whose contract
      hasn't ended, the name kept on one line. One without a WhatsApp
      number is named, with no Contact the accountant.
    - Contact the accountant has a speech bubble before its words, and
      opens Contact on WhatsApp with the page's message. It's there before
      the first file too, its message then naming no day.
    - On phones the buttons go under the subtitle, full width (§5.1).
  - On a client's page for the company's people, from 30 days after the
    day the figures are from, a Waiting on someone badge beside that day
    says how long it's been, such as "Not updated for 34 days", and the
    Clients list has the same badge in the client's row. The client's own
    page has the day alone.
  - What's owed, in a panel 24px inside (as the owner's mockup draws it).
    - Its label, What the company owes, in `--text-md`, weight 500 and
      `--muted`, then the amount as the page's one large figure: 48px (36px
      on phones), weight 600, even-width digits, the currency after it in
      `--text-lg` and `--muted`. It's the only text larger than
      `--text-3xl`, and comes as `--text-hero` with the page (§3.2).
    - Under it, a Problem badge with a warning icon while claims are late:
      "All open claims are late" where there's more than one and all are,
      or how many are, such as "1 claim late".
    - Beside it, twice its width (under it on phones): how much is paid,
      as a share bar, "16% of the total claims paid", its amounts with the
      currency, such as "7,365.00 of 46,163.37 EGP". Then, under a line
      across, three facts: open claims, paid (the currency after it, in
      `--muted`), and the oldest delay in days, or None where nothing is
      late.
    - On computers the facts are in a row, each a label in `--text-xs` and
      `--muted` above its value in `--text-xl`, weight 600. On phones
      they're one to a line, between lines, the label at the start in
      `--text-sm` and the value at the end in `--text-lg`.
    - The share paid is of the open claims' original amounts, to the
      nearest whole percent, and 99% at most while something is left to
      pay, so it never says 100% then.
  - Two cards side by side, stacked on phones, each bars by part: what's
    owed by item, and how late, by time since the due date (not due yet,
    under 6 months, 6 months to a year, 1 to 2 years, more than 2 years),
    in that order. A claim whose last day to pay hasn't passed is not due
    yet, so the four late rows hold only what's late.
    - Each card's title has a line under it: "Largest first", and "From
      the last day to pay until today".
    - An item's note is its share of what's owed and how many claims it
      has, such as "64% of what's owed, 3 claims"; a row of how late has
      how many claims, or "No claims" at nothing.
    - The two usual items with long names go by short ones in the bars:
      تأمين صحي and صندوق أسر الشهداء. Pointing at the row shows the full
      name, a screen reader reads it, and the claims name every item in
      full.
    - The bars' amounts are in the currency the large figure names.
  - The claims, by item, in a card: a table on computers and cards on
    phones (§5.4).
    - Its title, Claims, has "Select an item to see its claims" at its
      end on computers and under it on phones, in `--text-xs` and
      `--muted`.
    - The table's head, on `--page` in `--text-xs`, weight 500 and
      `--muted`: Item, Claims, Original, Paid, Remaining, Earliest due
      date and Status. It's 940px at the least, and scrolls sideways in
      its card where the page is narrower. As tall as the mockup draws
      them: the head and a claim's row are 12px above and below their
      words, an item's row and the total 16px.
    - The largest item is open at first, as the owner's mockup draws it;
      the others are closed.
    - Each item's row is a button that opens its claims under it: a
      chevron pointing to the end side while closed (flipped in Arabic)
      and down while open, the item, how many claims, the original, paid
      and remaining amounts (remaining in weight 700), the earliest due
      date and the badges its claims have. The largest remaining comes
      first, and it says it's open (`aria-expanded`).
    - A claim's row, on `--page`, inset under its item's name: its number
      above its period, then its amounts, its due date and its badges.
      The number is in Latin digits, left to right, as it's typed into
      the portal. Its period is said as the portal means it: a whole
      year as "Year 2025", a whole month as "November 2025", and
      anything else from its first day to its last. An item's claims go
      the latest last day to pay first, as the mockup lists them.
      At the row's end (from step 9), Ask about this claim: a 44px icon
      button with a speech bubble, named for screen readers with the
      claim's number, opening Contact on WhatsApp with that claim's
      message. On phones it's at the end of the claim card's first line.
      - As the owner's mockup draws it: quiet, in `--brand-text` as quiet
        buttons are, a speech bubble with two lines in it, after the claim's badges and at the
        end side of its last cell; on phones after the badges on the
        card's first line. It's named "Ask about claim 000372722602 on
        WhatsApp", and pointing at it says "Ask about this claim on
        WhatsApp".
      - It's there only where Contact the accountant is.
    - A total row at its foot, on `--page`, weight 700: how many claims
      and the original, paid and remaining amounts in all.
    - An item's row, and its card on phones, is on `--brand-tint` under
      the pointer, over 150ms, where there's one: a tap leaves no colour
      behind.
    - On phones, each item is a card that opens, with how many claims and
      what remains, with its currency, on one line under its name, then
      its badges. Each claim is a card with its number and badges on its
      first line, its period and last day to pay under them ("Year 2025,
      last day to pay 30 Apr 2026"), then the original, paid and
      remaining amounts in three columns, each under its label. The
      total says how many claims, "Total, 20 claims", above the three
      amounts in all.
    - Its badges: Partly paid, with the Waiting on someone colours, then
      Late, with the Problem colours, in that order where a claim has
      both, as the mockup draws them; the same on the client's page for
      the company's people.
  - A note under the card, in `--text-xs` and `--muted`: the currency,
    the day the figures are from, that penalties for paying late aren't
    counted, and to contact the accountant about any claim, such as
    "Amounts are in Egyptian pounds, as they were on the Tax Authority's
    portal on 16 Nov 2026, and penalties for paying late aren't counted."
    Its last sentence says how to ask about a claim: with the message
    button in its row, which opens WhatsApp with its number, where Ask
    about this claim is there ("in its card" on phones, as the mockup
    says), or else from the office.
  - With no claims kept yet, the page's place is an empty state saying
    the office hasn't added the tax position yet, under the header, whose
    subtitle is only who the accountant is, where there's one.
  - With a file kept but nothing open in it, the page's place is an empty
    state saying nothing was owed on the portal on the day the figures
    are from, under the header and its subtitle, with no cards or note.
- **A client's tax position, for the company's people:** a section on
  the client's page, Tax position, for whoever may see it
  (`CLIENT_PORTAL_PLAN.md` §3.5). It has the figures of the client's own
  page and less around them, as it's one section among the client's
  others.
  - A line under its title says the day the figures are from, and who
    uploaded the portal's file and when.
  - From 30 days after the day the figures are from, counted in the
    company's own days as late is, a Waiting on someone badge after
    that line's words says how long it's been, such as "Not updated for
    34 days". The Clients list has the same badge after the client's
    name, and at the top of its card on a phone. There it names the tax
    position to screen readers, as nothing around it says what wasn't
    updated. An archived client has neither, as its figures stay as
    they were.
  - Four total tiles: what's owed, open claims, how many are late, and
    what's paid.
  - The claims, in a list (§5.4), the longest overdue first. Each has
    its number, in Latin digits and left to right as on the client's own
    page; its item; its period; its original, paid and remaining
    amounts, the remaining one standing out as a charge's total does;
    its last day to pay, with how many days late under it; and its
    badges, as on the client's own page.
  - Five claims to start with, so the client's other sections stay in
    reach. Show all claims, with how many, at the list's foot lists them
    20 to a page and becomes Show fewer. It says which it is to screen
    readers (`aria-expanded`), and stays where it is, with the focus on
    it.
  - With nothing uploaded yet, the section's place is an empty state
    saying so. With a file uploaded and no open claim in it, the line and
    the tiles stay, and the list's place says nothing was owed that day.
  - For whoever may update it, on a client that isn't archived, the
    line under the title ends with a link, How to get the portal's
    file, to the tax portal's export button's page (The tax portal's
    export button). With nothing uploaded yet, the empty state's line
    ends with it instead. On a phone the link is 44px under a finger
    (§9), here and in the upload's dialogs: what's tapped is laid over
    its line, so no line around it moves.
  - When it didn't load, the section's place says so, with Try again (A
    list that didn't load). So does a page of its claims that didn't
    load: the claims kept up from another page don't stand in for it.
  - **The responsible accountant** (`CLIENT_PORTAL_PLAN.md` §7), at the
    section's foot in a panel of its own, under the claims, as the
    owner's mockup draws it. It's there before the first file too.
    - For whoever may manage clients, on a client that isn't archived: a
      select, Responsible accountant, up to 320px wide. Its hint says the
      client sees this name on their page, and the contact button opens
      WhatsApp on this accountant's own number. Its options are No one,
      then the company's people whose contracts haven't ended, by name.
    - Picking one saves it at once. The select is off while it's sent,
      and a toast says it's saved, or removed for No one. One that
      couldn't be saved says so in a toast, and the select shows what's
      kept.
    - For anyone else, and on an archived client, the label and the name,
      or No one, as text.
    - Beside it, under it on phones, where the client's people can write
      to them: "{name}'s WhatsApp number", the number left to right as
      it's kept, and a link to their profile in `--text-sm`, Change it on
      their profile, for whoever may edit it.
    - Otherwise, in the number's place and across the section's width, a
      note on `--status-waiting-bg` in `--status-waiting-fg` says why the
      client's people can't write to anyone, with the way to fix it:
      - no one picked: "This client has no responsible accountant, so its
        people can't contact anyone on WhatsApp. Pick a responsible
        accountant.";
      - no number on their profile: "There's no WhatsApp number on
        {name}'s profile, so the client's people can't contact them.",
        then Add the number, a link to their profile, for whoever may
        edit it;
      - their contract has ended: "{name}'s contract has ended, so the
        client's people can't contact them. Pick another responsible
        accountant."
    - What's beside the select, the number or the note, is read out when
      a pick changes it.
- **Tax position statement:** a document of a client's tax position, to
  print or save as a PDF (`CLIENT_PORTAL_PLAN.md` §8), as the owner's
  mockup draws it (the Statement in the Client tax position canvas,
  redrawn on the building blocks in the Tax position statement canvas).
  It's drawn from the claims as they are, and nothing is kept or sent.
  - It's opened from Download the statement, a link that opens it in a
    new tab and says so to screen readers, as a link to another site
    does: beside Contact the accountant on the client's own page, and
    before Upload from the tax portal on the client's Tax position, for
    the company's people who may see it. It's there once the portal's
    file has been uploaded for the client.
  - Above the sheet, as for any document: the page header, with the
    client's name above "Tax position statement", a subtitle saying the
    print dialog saves it as a PDF, Print as the primary button and Close
    beside it, which closes the tab. In the client's area it's under the
    area's top bar; for the company's people, in the app's frame. On
    phones the buttons go under the subtitle, full width.
  - The sheet says "Tax position statement" under the company's name.
  - Its details: the client; the day the figures are from, with "From
    the Tax Authority's portal" under it; the responsible accountant,
    where the client's page names one; and the day it was printed, in
    the company's own days. Four to a row on computers, two on phones.
  - Then four facts in a box, with a 1px `--rule` around them and between
    them, two to a row on phones: what the company owes, with its
    currency; what's paid, with its share of the open claims' original
    amounts in brackets, as the client's page rounds it; how many claims
    are open; and how many are late, in `--problem-text` while some are.
    Each is a label in `--text-sm` and `--muted` over its value in
    `--text-lg`, weight 600.
  - Its claims in a document's table, captioned "Open claims by item":
    Claim, Last day to pay, Original, Paid, Remaining and Status.
    - The items in the client's page's order, the largest remaining
      first, each headed by a row with its full name and, at its end, how
      many claims it has, weight 600, the count in weight 400 and
      `--muted`.
    - Under it, its claims, the latest last day to pay first, as on the
      client's page: the claim's number, in Latin digits and left to
      right, with its period under it in `--text-sm` and `--muted`, said
      as the client's page says it; the last day to pay; the three
      amounts, the remaining one in weight 500; and its status: Late, in
      weight 600 and `--problem-text`, with Partly paid under it where
      some is paid; Partly paid alone; or Not due yet, in `--muted`.
    - Then Total for the item, weight 600, with its three amounts.
    - Its foot, in `--text-lg` and weight 600 under a 2px rule in
      `--ink`: how many claims, "Total, 6 claims", and the three amounts
      in all. What remains in all is the figure the statement is for.
    - On phones, each claim is a block of lines: its number, with what
      remains on the end side; its period and last day to pay; its
      original and paid amounts; its status. An item's total is a line,
      and the total in all has its original and paid amounts under it.
    - Printed, as a document's table is: its headings start every page,
      an item's heading row stays with its first claim, no claim is split
      between two pages, and its foot comes once, at its end.
  - At its foot, over a 1px `--rule`, in `--text-sm` and `--muted`: the
    amounts are in Egyptian pounds as they were on the portal that day,
    penalties for paying late aren't counted, and Late means the last day
    to pay has passed. Then "Powered by Nizmo" at its end, in
    `--text-xs`.
  - With nothing open in the portal's file, the table's place says
    nothing was owed on the portal that day.
  - In the page's language, digits too. Saved as a PDF, it's named for
    the client and the day the figures are from, as its page's title is.
  - One that isn't there, or isn't theirs, says so, and one that didn't
    load says that, with Try again, as any document does. In the client's
    area, it's always the session's own client.
  - Printed, the sheet is all there is (Document), with the late count
    and statuses in `--problem-on-paper`.
- **Uploading the tax portal's file:** how a client's tax position is
  kept up to date, by whoever may update it (`CLIENT_PORTAL_PLAN.md`
  §4.1). Its rows are read from a file and checked before any is saved
  (Rows read from a file), with these differences, as each upload
  replaces the client's claims and the file is the portal's own:
  - Upload from the tax portal is a secondary button on the end of the
    Tax position section's heading, there before the first file too. An
    archived client hasn't it. It opens the file picker for one `.xlsx`
    file.
  - A file refused whole is said in a dialog, not a toast, as it may
    name what's at fault: "This file can't be uploaded", why, and the
    columns it hasn't or the companies it names. Choose another file is
    its main button, with Close. Where the file itself is at fault, a
    link under them, How to get the portal's file, opens the tax
    portal's export button's page in a new tab, so the dialog stays as
    it is. It says so to screen readers.
  - The check screen is a dialog up to 760px wide, "Check the portal's
    file before saving". From the top:
    - the file's name and how many rows it has, with Another file;
    - the company the file names, with a badge: This client (Good)
      where it's the client's name or the one its last file named,
      otherwise Not this client's name, or No company named (Waiting
      on someone);
    - Figures as of, a date field: the day in the file's name, or
      today without one, which its hint says. It can be changed, to
      today at the latest;
    - five counts as tiles: in the file, new, changed, as they were,
      and going;
    - a line with what's owed now and what will be after saving;
    - what changes, in groups, each with its count in its title: Going
      first, with a note that they may have been paid, or hidden by
      the portal's filter; then Changed, each saying what was and what
      is; then New. A claim is its number, in Latin digits and left to
      right, its item, and what remains. Each group opens and closes
      from its title, and is open to start with where it has ten or
      fewer. Claims that stay as they were are counted, not listed;
    - how many rows were left out as having nothing left to pay, and
      each status left out with how many rows it had.
  - A row with a problem stops the save, and nothing is edited here, as
    the file is the portal's. A Problem note at the top says how many
    rows have one, and that saving the rest would delete their claims.
    It ends with the same link, in a new tab. Under it, each such row
    with its number in the file, its claim number and what's wrong. The
    main button is off, and Another file is there.
  - At the bottom, a line saying that saving replaces all of the
    client's claims and is in the audit log; then Cancel, then the main
    button saying how many it saves, such as "Save 20 claims".
  - Where the file's company isn't this client's, the main button asks
    first, in a confirmation over the dialog, with a danger button: the
    company the file names, the client's name, that saving replaces the
    client's claims, and that the name is kept so it isn't asked again.
  - While it's sent, Cancel is off, the main button is busy and Escape
    does nothing. What couldn't be saved is said above the buttons.
    Where the client's claims changed meanwhile, it says so, and the
    file is checked again against them. Once saved, a toast says how
    many claims were, and the section reads itself again. After that,
    the same toast says whether the client's people were emailed (The
    update email): to how many, how many it couldn't be sent to, or why
    none was, as the update email is off, they were emailed today
    already, or none of them has set a password yet.
- **The tax portal's export button:** a page for whoever may update
  clients' tax position, on getting the file the upload takes
  (`CLIENT_PORTAL_PLAN.md` §10). It's reached by How to get the
  portal's file, on a client's Tax position and in the upload's
  dialogs, not from the side bar. It's read more than it's used, so its
  cards are at most 640px wide, as a guide is.
  - The page header names it, with a line on what the button does, and
    Clients to go back to.
  - **Add it to the browser** comes first. On a computer, its card has
    the button itself: a link that looks like a secondary button, with
    a bookmark icon and the hand that says it can be dragged, to drag
    to the browser's bookmarks bar. A line above it says so, with the
    keys that show the bar. Pressed, it does nothing but say that it's
    dragged, in a toast: it works on the tax portal's page, not on
    Nizmo's.
    - Copy address is beside it, a secondary button, for whoever can't
      drag: a line under them says a bookmark can be added by hand with
      the address copied. Once copied, it says so, as a guide's Copy
      does.
    - A line at the card's foot says a bookmark keeps the copy it was
      made from, so after the button changes it's dragged again.
    - On a phone, the card has neither: it says the button is added on
      a computer.
  - **How to use it** is numbered, as a guide's steps are (Dialog). Each
    says where it's done, on the tax portal, in the browser or in
    Nizmo, then what to do, a line each.
  - **What to know** is a list of lines: each file is one company's,
    with one filter; a claim the portal's filter hides isn't in the
    file, and the upload lists it as going; the button reads the table
    on the screen and saves a file on the computer, sending nothing to
    Nizmo or anywhere else and keeping nothing in the browser; and the
    file holds what the portal shows when Download is pressed, the
    button gathering every page again first where the page has changed
    since.
  - What the tax portal and the button's panel call something, such as
    their buttons, is written as they have it, in Arabic and in bold,
    in either language.
- **People who can sign in:** a section on a client's page, for whoever
  may manage them, where the company's package has the client portal
  (`CLIENT_PORTAL_PLAN.md` §5.2). It comes right after Tax position, as
  they're who it's for.
  - A line under its title says who they are: from the client, and they
    see its tax position only.
  - Add person is a secondary button on the end of its heading. An
    archived client hasn't it: its people can't sign in (§5.3), and are
    still listed, to be removed.
  - Each person is a row: their initials, their name, and their email
    under it, left to right. At the row's end, when they last signed in;
    "Hasn't signed in yet" once their password is set; or, while they're
    invited, an Invited badge in the waiting tone with the day they were
    invited. Then a row menu: Resend invitation, for someone invited, and
    Remove.
  - With no one yet, the list's place is an empty state saying no one
    from the client can sign in yet. When it didn't load, it says so,
    with Try again (A list that didn't load).
  - **Add person** is a dialog (Dialog), the client's name under its
    title:
    - Name, then Email, left to right, with a line under it: an email no
      one else in Nizmo uses.
    - Language, two choices, Arabic first and chosen, as the office
      knows its client. A line under them: the invitation is
      sent in it, and the page that sets the password opens in it.
    - A line above the buttons: an invitation is emailed with a link to
      set a password, which works for 72 hours, and the account shows
      this client's tax position only.
    - Send invitation is its main button, with Cancel. A mistake that's
      one field's is under that field, an email someone has already
      under Email; anything else is said above the buttons.
    - Sent, the dialog closes, the person is in the list, and a toast
      says the invitation was sent, naming the email.
  - **Resend invitation** asks nothing first: it sends a new link and
    the earlier one stops working, as a toast says. What refuses it, such
    as one sent less than 2 minutes before, is said in a toast, in the
    page's language.
  - **Remove** asks first (ConfirmDialog, danger): they can't sign in any
    more, and one signed in is signed out at once. Removed, a toast says
    so.
  - The code a high-risk action asks for, where the company asks for
    it, comes before a send or a removal (§5.5, Dialog); the dialog
    doesn't announce it, as a company may not ask for it.
- **Contact on WhatsApp:** a dialog for writing to someone on WhatsApp,
  such as a client's accountant. Who it reaches comes first, in a box
  with a `--rule` edge: their initials in a circle, their name, and what
  they are to the client. Under it, the message, written for where it
  was opened from and in a field it can be changed in, with a hint saying
  it can also be changed in WhatsApp. Open WhatsApp is its main button,
  opening a new tab, which it says to screen readers; Cancel beside it. A
  line at its foot says it opens WhatsApp on a phone, or WhatsApp Web on
  a computer, and that the conversation stays there.
  - As the owner's mockup draws it (`CLIENT_PORTAL_PLAN.md` §7, step
    9c), it's up to 480px wide, and differs from other dialogs in three
    ways: a Close button (✕, 44px, quiet) at its title's end; Open
    WhatsApp first and Cancel after it, under the message, on the start
    side; and the line at its foot under a `--rule` edge, after the
    buttons.
  - The box: 12px inside, `--radius-field` corners. The initials are in a
    44px circle on `--brand-tint-strong`, in `--brand` and weight 600;
    the name in `--text-card` (15px) and weight 600; what they are under
    it in `--text-sm` and `--muted`, such as "Responsible accountant for Al
    Namozag Trading".
  - The message is as many lines tall as it is, and one more. Until it's
    changed, that last line says "(Write your question here)" in
    `--muted`: where the question goes, which isn't sent. The hint under
    it is in `--text-xs` and `--muted`.
  - Open WhatsApp has a speech bubble before its words, and goes to
    `wa.me` with the number and the message, the conversation's own
    address. It closes the dialog as the tab opens.
  - The line at its foot is in `--text-xs` and `--muted`, 12px under its
    edge.
  - Opened from a claim's Ask about this claim, it's titled "Ask about a
    claim", and its message names the claim's number, item, what remains
    of what was owed and its last day to pay (`CLIENT_PORTAL_PLAN.md`
    §7).
  - Nothing of it is sent through Nizmo or kept.
- **A text with fields put in by buttons:** a message written once and
  filled in for each person it's sent for, such as the client messages on
  WhatsApp (`CLIENT_PORTAL_PLAN.md` §7.1), as the owner's mockup draws it
  (Message templates).
  - **The box** is a field (§5.3) as tall as its text, and at least six
    lines, its lines with room between them, as a message's are in
    Contact on WhatsApp. Each field is a chip in its place, named in the
    page's language: `--brand-tint-strong`, in `--brand-text` at weight
    600, pill-shaped. A field is never typed: it's put in by its button,
    and goes as one piece with Backspace or Delete beside it. The text
    runs in its own language's direction, whatever the page's.
  - **The buttons,** under the box: "Add a field where the cursor is:" in
    `--text-xs` and `--muted`, then one for each field the text may
    have, "+" and its name, in `--text-sm` and `--brand-text`,
    pill-shaped with a dashed `--brand` edge, 32px tall (44px on phones),
    wrapping. A field goes where the cursor last was in the box, or at
    its end, and the cursor after it.
  - **Under them,** on one line that wraps, in `--text-xs` and `--muted`:
    how many characters of 1,000 it is, in `--problem-text` past that;
    and who changed it last and when, saying every change is in the
    audit log, or that it hasn't been changed.
  - **Save** (primary) **and Discard changes** (secondary) at its foot,
    on the start side, both disabled while the text is as it was saved.
    A mistake, such as an empty text or one too long, is said under the
    box, as a field's is, and the focus goes to the box.
  - **In two languages,** a switch between them (§5.1) beside its label,
    at the card's top on the end side: العربية, then English, in that
    order whatever the page's language. Each language keeps its own
    changes until they're saved or discarded.
- **A message's preview:** a card beside the text on computers, under it
  on phones, titled "Preview with sample figures": the message filled as
  Contact on WhatsApp fills it, from made-up figures, in its own
  language, as a chat bubble.
  - The bubble is `--chat-bubble` on a `--chat-ground` panel, in
    `--chat-ink`, with 12px corners, 12px inside the panel and on the
    start side of its language, at most 85% of the panel's width, its
    text in `--text-sm` as a chat's is. Light: `--chat-ground` `#efeae2`,
    `--chat-bubble` `#d9fdd3`, `--chat-ink` `#111b21`. Dark: `#0b141a`,
    `#005c4b` and `#e9edef`. Its text reads at 4.5:1 or better on it in
    both.
  - Under it, in `--text-xs` and `--muted`: the fields are filled from
    the client's page when the message is opened, and the client's
    person can change it before it's sent.
- **Client messages on WhatsApp:** the Super Admin's page of Nizmo's own
  messages, under Templates. Its header names it and says that a company
  that changed a message uses its own, and every other company these.
  Under it, a tab for each message, then the text with fields put in by
  buttons and its preview, side by side, the text's card three fifths of
  the width where the side bar is beside the page (1024px and wider), as
  the mockup draws them (§5.5, Page layout).
- **A company's client messages:** the Client portal tab in Company
  settings, as the owner's mockup draws it (Company messages), after
  Roles.
  - A card titled Client messages on WhatsApp, with a line under the
    title on what the messages are for. Under it a row for each message,
    Contact the accountant first, as Rows inside a card are (§5.5,
    Rows), with a rule above the first.
  - Each row's title is the message's name. Under it, a line for each
    language, Arabic first, each named in the page's language: the
    company's copy, with who changed it last and the day, or that it
    uses Nizmo's message.
  - On the row's end side: Change it for this company while both
    languages use Nizmo's; Edit, and Use Nizmo's message, while either is
    the company's. Each button's name says which message it's for.
    Change it and Edit go to the message's editor; Use Nizmo's message
    asks first, in the danger colour, naming the languages the company's
    copy goes from, and then puts back every one of them at once. On
    phones the buttons go under the lines.
  - Under the rows, in `--text-xs` and `--muted`: Edit opens the same
    editor as the Super Admin's, with the fields and the preview.
  - Loading and failing say so in the card's place, failing with Try
    again.
  - **Email when the tax position is updated:** a second card under it,
    titled so, the mockup's middle card. One row, as a card's Rows are:
    its title, Email the client's people; its line, what is sent: after
    each upload of the portal's file, one email to each of the client's
    people who has set a password, saying the office updated the tax
    position, the day the figures are from, and the link to sign in, with
    no amounts and at most one a day for a client. On the end side the
    On or Off badge and Turn on or Turn off, as the company's other
    switches are (decided on 2026-11-20, in place of the mockup's
    toggle). Neither asks first: nothing is lost, and it's turned back
    here. On phones the badge and the button go under the line, as the
    messages' buttons do. Loading and failing as the card above.
  - **The message's editor:** a page of its own, the Client messages on
    WhatsApp page's editor for that one message, with no tabs: the text
    with fields put in by buttons, Arabic or English, beside its preview.
    The header's back link goes to the Client portal tab; its title is
    the message's name, with a line under it saying whose copy it
    changes. The line under the buttons says the company's copy, who
    changed it and when, or that it uses Nizmo's message, and that every
    change is in the audit log. Leaving with unsaved changes asks first,
    as it does there.
- **Public holidays apply:** a company's one switch for the central
  calendar of public holidays (`FIRST_CHANGES_PLAN.md` §6), at the top of
  Public holidays on the Attendance tab's Holidays card, as the owner
  approved in the Public holidays off for a company canvas.
  - A row, as a card's Rows are, on `--page` with `--radius-panel`
    corners, between the heading and the year's holidays. Its title is
    Public holidays apply. Its line says what that means now: while on,
    that the public holidays listed are days off, apart from any the
    company works through; while off, from which date each is a normal
    workday, and that the company's own holidays still apply. On the end
    side, the On or Off badge and Turn off or Turn on, as the company's
    other switches are. Whoever may only look at the tab sees the badge
    and no button.
  - Turning it off or on asks first, in the building blocks' dialog:
    what changes from the date chosen, then From when?, today to start
    with. Under it, that attendance is worked out again from that date,
    and the earliest date it may be, as a month whose payroll is approved
    can't change. Its button says what it does: Turn them off, or Turn
    them on.
  - A change from a later date is a row under the switch's, as the
    default schedule's changes to come are: public holidays stop
    applying, or apply again, from that date, with Withdraw named for
    it. While one is to come, the switch has no button: it's withdrawn
    first.
  - While they're off, the year's public holidays from that date are
    still listed, each without its box and with the Worked through
    badge. A line above them says from when they're off and that, turned
    back on, those the company observed are days off again. Those before
    the date keep their boxes.
  - On phones the badge and the button go under the line, as the
    company's other switches' do.
- **Check-in:** the Nizmo app's first screen, for one task: recording
  arrival and departure.
  - The page header names it, with a line on what it's for. Its cards are
    at most 640px wide, as a form is.
  - Check in (primary) and Check out (secondary) share a card, side by
    side, each half its width, 56px tall with `--text-lg`: they're the
    app's most-pressed buttons, often pressed outdoors and in a hurry.
    While one works, it says what it's doing, such as "Finding your
    location…", and neither can be pressed again.
  - A phone not registered yet, or waiting for approval, says so in that
    card. Registering is the card's primary button.
  - What became of the check-in is a card under them, read out by screen
    readers:
    - recorded: a check icon in the Good colour (§2.3) beside the words;
    - recorded, but waiting on someone (a review, or the phone's
      approval): the Waiting on someone bar, as a card has;
    - not recorded: the Problem bar, and why.
    - Its time and distance are in the page's digits.
  - Arriving late is a card with the Waiting on someone bar: how late,
    the permission left this month, and Ask for permission hours.
  - Face verification is a titled card of its own, one step at a time:
    consent, set-up, waiting for approval, verifying again. Withdrawing
    consent, like using this phone instead of another, is confirmed in a
    dialog first.
  - In a browser it says to use the app, as an empty state. So does it,
    in its own words, for the Super Admin, who has no attendance, and
    where the company's package hasn't the app. One whose phone details
    didn't load says so, with Try again.
- **The face check's camera,** which face verification opens on the
  check-in screen (above): the front camera's picture fills the screen,
  mirrored as a mirror is, with nothing of the app around it. It's dark
  in both themes, as every camera's view is, with its guidance light over
  it (`--cam-*`).
  - An oval to fit the face in, the picture dimmed outside it, and a ring
    around it in `--cam-ink` that fills as the check takes its looks.
    Done, the ring is whole in `--cam-done`, with a tick in a circle at
    the oval's middle, the tick in `--cam-ground`. A step half or wholly
    done flashes the ring in `--cam-done`, and a step started again in
    `--cam-warn`, as the phone beeps and vibrates.
  - One line at the bottom says what to do, and screen readers hear it.
    The first time, while the face check downloads, it says how far, in
    the page's digits.
  - A step, such as turning the head, shows only when the check has
    doubts: a card above the line with the step's icon beside its name,
    arrows both ways for a turn and a closed eye for closing the eyes,
    and the time left as a bar, in `--cam-warn` for its last quarter. A
    turn adds how far the head is turned: a dot between two marks in
    `--cam-done`, which moves as the head does in the mirrored picture,
    so it isn't mirrored in Arabic.
  - Close, an X named for what it does, 44px across, is at the top on
    the start side. The test version says so in a pill on the end side.
  - The line, the card, the pill and Close are on the picture dimmed to
    55% `--cam-ground`, so their words hold 4.5:1 over the lightest
    picture. They keep clear of a phone's notch and home bar.
  - It's a dialog, named "Face check": it takes the focus as it opens,
    Tab stays in it, and Close or Escape ends the check, the focus going
    back to what opened it. The ring the keyboard shows is 2px in
    `--cam-ink`.
  - With "reduce motion", the ring fills, the bar empties and the dot
    moves at once, and the tick is just there.
- **Sign-in:** the one screen before the app, so it has no side bar and
  no top bar. It's in the default brand colour (§2.1).
  - On `--page`, a card in the middle of the screen, at most 400px wide,
    with 32px inside (24px on phones, which keep the page's 16px edge
    around it). Behind it the page is flat: no gradient, no glass and
    nothing moving (§4.3, §8).
  - The card's title says what's done here, and where: "Sign in to
    Nizmo", as a page title is (§5.5, Page header). A step after it, such
    as the two-factor code, has its own title, with a line under it on
    what to type.
  - Its fields are the building blocks' (§5.3), one under the other: the
    email or username, written left to right in both languages (§3.3),
    then the password, with its eye button. "Forgot your password?" is a
    quiet button under the password, on the end side.
  - "Stay signed in", and on the code step "Remember this device for 30
    days", are checkboxes, each with its label.
  - The step's one primary button takes the card's width. Its other
    actions, such as "Email me a code instead" and "Back to sign in", are
    quiet buttons under it.
  - What's wrong with what was typed, such as a field left empty or a
    code that isn't six digits, is said under its field before anything
    is sent, with the focus on the first. A code that isn't right is said
    under the code, too.
  - What the server says, such as a wrong password, an account held back
    after wrong tries, counting down, or a company whose subscription has
    ended, is said above the primary button, in the page's language, and
    screen readers hear it. The primary button can still be pressed while
    an account is held back, as an Admin may unlock it before the time
    is up.
  - A browser the server signed out, its session ended, as a new
    password or a role changed with "Apply now" ends it, comes back to
    sign in told so, in the same place, as a note: that its session
    ended, as it does when the password or the role changes, and to sign
    in again. It stays until something else is said there. Signing out
    by one's own choice says nothing.
  - "Forgot your password?" is two steps in the same card: the account's
    email, then the code sent to it with the new password, asked twice, as
    Change password asks it, its hint saying how long it must be. Neither
    says whether the email is on an account: the second says a code was
    sent if it is, naming the email as typed. Reset, it's back to signing
    in, the email filled in and the password focused, saying the password
    was reset.
  - Too many tries to reset a password are counted down above the primary
    button, as an account held back is, until it can be tried again.
  - Under the card, as part of the page and never over it: the privacy
    policy, the terms, and the language and theme switches, in a row that
    wraps on phones. The switches are the top bar's language switch and
    the account menu's theme switch (§5.1).
  - The "Powered by" signature, as the dashboard has it (§5.1): in the
    bottom corner on the end side on a computer, and on a phone at the
    end of the page, under the row of links and switches.
- **Setting a password from an invitation** (`CLIENT_PORTAL_PLAN.md`
  §5.2): where one of a client's people lands from the link in their
  invitation. It's the sign-in screen's frame (above): the card on the
  flat page, in the default brand colour, with the links, switches and
  signature under it.
  - The card's title is "Set your password". The line under it names who
    invited them, for whom: "<office> invited you to the tax position of
    <client>." The names are as the company and the client are named in
    Nizmo, each kept whole in either language (§3.2).
  - Their email, as a field that can't be changed, written left to right
    in both languages (§3.3): the account is theirs alone, and it's what
    they'll sign in with.
  - The password, asked twice, as Change password asks it, with its eye
    button and the hint saying how long it must be. What's wrong with
    either is said under it before anything is sent.
  - The one primary button, "Set password", takes the card's width. Under
    it, in the muted note size: the link works once, for 72 hours.
  - Set, the card says so, its title "Your password is set", with the
    email to sign in with, and Sign in as its primary button.
  - A link that can't be used says why, as the card's title and line,
    with no form: it has expired, so a new invitation is asked of the
    office; it doesn't work any more, as it was used, a newer one was
    sent, or the person was removed, so the same; or the office's portal
    isn't open to them now, so to contact the office. Each has Sign in
    under it, as a quiet button.
  - What the server says once Set password is pressed, such as a link
    that ran out while the form was open, or too many tries from one
    place, counted down, is said above the primary button, as on the
    sign-in screen, and screen readers hear it.
- **The invitation's email** (`CLIENT_PORTAL_PLAN.md` §5.2): what one of
  a client's people receives when the office adds them, or sends their
  invitation again. It's in the language they're invited in, never both
  in one email, and reads right to left in Arabic.
  - It's from the office, by its name, at the address Nizmo sends its
    email from. A reply goes to the person in the office who sent it;
    sent by a Super Admin, it has no reply address. Its subject is
    "Invitation to the tax position of <client>".
  - At its top, the office's initial on a square, and its name. Then the
    greeting, by the person's name; who invited them, for whom; and one
    button, "Set password", at least 48px tall. Under it, in the muted
    note size, the link itself, to copy into a browser where the button
    doesn't open, written left to right in both languages (§3.3).
  - Then: the link works once, for 72 hours, and the email they'll sign
    in with. Sent again, a line on the light ground says an earlier link
    no longer works. Then: if they weren't expecting it, it can be
    ignored, as the account can't be used until a password is set; and
    who to ask, the person who sent it, at the office, or the office
    alone where a Super Admin sent it.
  - Under a rule, on the light ground, in the small note size: sent
    through Nizmo on behalf of the office, and the privacy policy's link.
  - The names are as the company, the client and the person are named in
    Nizmo, each kept whole in either language (§3.2).
  - An email can't load the app's styles or follow a theme, so its
    colours are written into it: the default brand colour's shades (§2.1)
    for the button, the initial's square and the links, and the light
    theme's neutrals (§2.2) for the rest. It's at most 600px wide, and
    fits a phone. A plain-text copy goes with it, with the same words,
    for a mail app that doesn't show HTML.
- **The update email** (`CLIENT_PORTAL_PLAN.md` §4.4): what each of a
  client's people who has set a password receives when an upload of the
  portal's file is saved, where the company has turned it on, at most
  one a day for a client. In all else as the invitation's email: in the
  language their account keeps, from the office by its name, a reply
  going to whoever uploaded the file and none where a Super Admin did,
  with the same top, foot, colours, width and plain-text copy.
  - Its subject is "The tax position of <client> was updated". Then the
    greeting, by the person's name; that the office updated the client's
    tax position on Nizmo, with the day the figures are from, written
    out in the email's language (17 November 2026, ١٧ نوفمبر ٢٠٢٦); and
    one button, "Sign in", at least 48px tall, to Nizmo's sign-in page,
    with the link written out under it as the invitation's is. Then who
    to ask, as the invitation says it.
  - No amounts and no claims: what the client owes stays behind its
    sign-in.
  - Its words were agreed with the owner on 2026-11-20.
- **The privacy policy and the terms of service:** two documents anyone
  can open, signed in or not, as Google does before it lets Nizmo use
  Drive. As with sign-in, there's no side bar and no top bar, and they're
  in the default brand colour (§2.1).
  - They're in English only, the language that governs them, as the note
    at the foot of each says. So the whole page is, its frame too: left to
    right, and marked as English, so a screen reader reads it as English
    and the Arabic text rules (§3.2) leave it alone, whatever language the
    app is in.
  - A browser may translate them, as that note allows, but leaves a
    service's name that's also an English word, such as HERE, the mapping
    provider, as it is.
  - On `--page`, flat, in a column at reading width (736px), with the
    page's edge around it (32px, 16px on phones).
  - At its top, Nizmo's mark and name, as the side bar's head shows a
    company's without a logo (§5.1): a link to sign in, which takes
    someone signed in back to the app.
  - The document is a level-1 panel with 32px inside (16px on phones), as
    a document's sheet is (§5.5, Document):
    - its title as a page title is (§5.5, Page header), with when it was
      last updated under it in `--muted`, then its first paragraph, on
      what it covers, at `--text-xl`;
    - its text at `--text-lg`, as it's read through rather than scanned,
      in `--ink-2`. Its headings, at `--text-xl`, the terms it explains
      and the words it stresses are at weight 500, in `--ink`;
    - its links in `--brand-text`, underlined, as they sit in its
      sentences;
    - a note, such as the one saying English governs, has a 3px bar in the
      neutral colour on its start edge, as a document's note has.
  - Under it: the privacy policy, the terms and Sign in, as links at
    `--text-sm` in `--brand-text`, in a row that wraps on phones, each
    44px tall there (§9).
  - Printed, the document is all there is: black on white, without the
    page around it, from dark mode too.

---

## 6. Icons

- **Phosphor Icons, regular weight,** imported one at a time
  (`UI_PLAN.md` §4.4).
- **Sizes:**
  - 18px in the side bar and in buttons, and 20px in the side bar's drawer
    on phones;
  - 16px in fields and detail lines;
  - 20px in the top bar on a computer, and 22px on a phone;
  - 24px in a module's icon dialog (below);
  - 40px in empty states.
- **The selected side bar item** uses the filled version of its icon.
- **The side bar's icons** (§5.1), as the approved mock-up has them:
  - a company's: Dashboard `SquaresFour`, Check in `MapPin`, Tasks
    `CheckSquare`, Obligations `PushPin`, Clients `Handshake`, Locations
    `MapTrifold`, Records `Folders`, Employees `Users`, Attendance and My
    attendance `Clock`, Requests `Tray`, Costs `Coins`, Payroll `Receipt`,
    My payslips `FileText`, My cash advance `Wallet`, Roles and access
    `IdentificationBadge`, Saved lists `ListChecks`, Company settings
    `GearSix`;
  - the Super Admin's: Companies `Buildings`, Packages `Package`, All users
    `UsersThree`, Role templates `Stack`, Policy templates `Clock`, Public
    holidays `CalendarBlank`, Terminal brands `Fingerprint`, Client
    messages `ChatsCircle`, Super Admins `ShieldCheck`, Role changes
    `ArrowsLeftRight`, Access reviews `ListChecks`, Who can
    `MagnifyingGlass`, Check-ins `MapPin`, Audit logs `ClipboardText`,
    System health `Heartbeat`, System settings `GearSix`.
- **A module's icon, chosen by its company** (`UI_PLAN.md` §4.4): a
  company may choose its own for each of the nine modules, in Company
  settings, Modules, from a short list of 48. There are no emoji: each
  phone and computer draws them its own way.
  - The list holds each module's icon, and others a renamed module might
    want: charts, work and tools, dates, messages, files, money, people,
    trade and places. In this order: `SquaresFour`, `ChartBar`,
    `ChartLineUp`, `ChartPieSlice`, `CheckSquare`, `ListChecks`,
    `ClipboardText`, `Kanban`, `Briefcase`, `Wrench`, `Toolbox`, `Broom`,
    `PushPin`, `CalendarCheck`, `CalendarBlank`, `Clock`, `Bell`,
    `Certificate`, `Tray`, `EnvelopeSimple`, `ChatCircleText`,
    `SealCheck`, `Folders`, `FolderSimple`, `FileText`, `Archive`,
    `Coins`, `Money`, `Wallet`, `CreditCard`, `Receipt`, `Bank`, `Users`,
    `UsersThree`, `IdentificationCard`, `HardHat`, `ShieldCheck`,
    `Handshake`, `Storefront`, `Buildings`, `Factory`, `ShoppingCart`,
    `Package`, `Truck`, `MapTrifold`, `MapPin`, `House`, `Warehouse`.
  - Each module's icon is a button before the field for its name, named
    "Choose an icon for Clients". It opens a dialog titled "Icon for
    Clients", with the 48 as buttons 44px square, as many to a row as fit.
    Each is named for what it draws, in the page's language.
  - The one in use is marked as chosen: filled, on `--highlight-tint`,
    with a `--brand-primary` edge, and heard as pressed. Focus starts on
    it. While the company has none of its own, that's the module's own.
  - Picking one puts it in the form and closes the dialog; it's saved with
    the form. Use the default icon, under the list with the module's icon
    beside its words, does the same with the module's own. The module's
    own, picked either way, keeps nothing for the company.
- **Icons that point a direction are flipped in Arabic:** arrows, chevrons,
  and "back" and "next" icons. Icons that don't point (a check, a bell, a
  pin) are never flipped.
- **Icons sit beside words, not instead of them,** except in the top bar,
  where each icon button has an accessible name.

---

## 7. Arabic and right to left

- **The whole layout mirrors** through `dir="rtl"`. New code uses only
  logical properties (`margin-inline-start`, `padding-inline`,
  `inset-inline-end`, `border-inline-start`, `text-align: start`), never
  left or right.
- **Text rules** are in §3: never letter-spaced, a little more line height,
  Arabic-Indic digits, and codes kept left to right.
- **Text people type** keeps its own direction, whichever language the
  page is in: a record's text, a section's or a client's name. It's set
  with `dir="auto"` or `<bdi>`, so an English sentence in an Arabic page
  keeps its full stop at its end, and an Arabic name in an English page
  reads right to left.
- **Plurals** use `Intl.PluralRules` for both languages, so the app writes
  "1 pt" and "2 pts" in English, and نقطة واحدة, نقطتان and ٣ نقاط in
  Arabic.
- **Every screen is checked in both languages** before its PR is done
  (§9).

---

## 8. Motion

- **Things move only when someone acts:** a menu or a dialog opening, the
  side bar sliding in, a toast saying what an action did, and for a moment
  what someone else did (below). Nothing animates on page load, and cards
  don't lift on hover.
- **What someone else changed appears in place:** a task assigned
  meanwhile is in the list, the bell has its notification, a changed row
  reads as it now is (`REALTIME_PLAN.md`). No toast says so, and the page
  isn't loaded again: what the person was typing, their filters, where
  they'd scrolled to and an open dialog all stay. Changes arriving close
  together are drawn once, a second after the last, and a tab out of sight
  is drawn when it's shown again. Attendance, where check-ins pour in each
  morning, is drawn at most every 30 seconds while they keep coming
  (`REALTIME_PLAN.md`, part 4c).
- **And it's shown for a moment, so nobody has to hunt for it**
  (`REALTIME_PLAN.md`, part 5):
  - **a row that arrives or changes,** in a list such as the tasks or the
    requests, takes the soft brand tint (`--brand-tint`), which fades back
    to the row's own colour. Nothing slides, and the rows around it don't
    move;
  - **the bell's count, as it rises,** grows a little and settles back;
  - **a row that goes simply goes:** showing it leave would keep on screen
    what's gone;
  - **only for what someone else did:** not for the person's own changes,
    which they know of, and not as a page opens. What changed while a tab
    was out of sight is shown as it comes back.
  - **not for who's online:** someone coming or going changes only their
    badge on the Employees list and All users, and All users' status
    counts, in place, untinted. People
    come and go dozens of times a morning, and nobody changed the list
    (`REALTIME_PLAN.md`, part 6b).
- **How each comes in** (with Emil Design Engineering, `UI_PLAN.md` §7.1):
  - **a menu or a panel opened from its button** (a row's menu, the
    account menu, the bell's panel, the company picker, and a date field's
    calendar on a computer) fades in as it grows to its size from 96%,
    from the corner nearest its button, so it seems to come out of it.
    Nothing grows from nothing, and none from its middle;
  - **a dialog** fades in with the dimmed page and grows from 96% from its
    middle, as it's tied to no button. On a phone, a date field's calendar
    is in the middle of the screen, and opens the same way;
  - **a toast** fades in as it slides 16px in from the end side;
  - **the side bar on a phone** slides in as the page beside it dims, and
    slides out faster than it came in.
- **Going is at once** for a menu, a panel, a dialog or a toast: what was
  asked for is done, and nothing waits for it to leave. Only the side bar,
  which stays in the page, slides out.
- **The curves:**
  - what comes in starts fast and settles, on `--ease-out`
    (`cubic-bezier(0.23, 1, 0.32, 1)`), stronger than the browser's own
    ease-out;
  - the side bar moves on `--ease-drawer` (`cubic-bezier(0.32, 0.72, 0,
    1)`), as a phone's own sheets do;
  - nothing uses ease-in, which starts slow just when someone is watching.
- **Coming in, only opacity and transforms move,** so nothing else on the
  page shifts, and the browser draws each frame without laying the page
  out again.
- **Timings:**
  - 150ms ease-out for colour changes on hover and press;
  - 150ms for a menu or a panel opening, as they open many times a day;
  - 200ms for a dialog, a toast, and the side bar coming in;
  - 150ms for the side bar going;
  - 2 seconds for a row's tint: it holds for half a second, so it's seen,
    then fades evenly over the rest, as it's there to be noticed, not to
    answer a tap;
  - 250ms for the bell's count growing to 115% and settling back, on
    `--ease-out`.
- **Not animated:** what comes as someone types, such as a saved name's
  suggestions or the place search's results, and tabs. They change many
  times a minute, and a move would only slow them down.
- **The device's "reduce motion" setting is respected:** movement becomes an
  instant change, and so do fades (`app/globals.css`), as none says
  anything the still screen doesn't. Emil Design Engineering keeps fades;
  here, this rule wins (`UI_PLAN.md` §7.3). A row's tint is the one that
  says something: it shows for its 2 seconds and goes without fading, and
  the bell's count doesn't grow.

---

## 9. The quality floor

Every UI PR meets all of these, and its screenshots show it:

- **Contrast:**
  - text at 4.5:1 or better;
  - large text, field edges, focus rings and icons that carry meaning at
    3:1 or better.
- **Keyboard:**
  - everything can be reached and used with the keyboard;
  - focus is always visible (a 2px `--brand-text` ring, offset by 2px).
- **Touch:** targets are at least 44×44px on phones.
- **No meaning from colour alone** (§2.3).
- **Layout:** nothing scrolls sideways at 360px wide, except a tab row or a
  wide table inside its own panel.
- **Both languages and both themes** are checked: English and Arabic, light
  and dark, phone and computer.
- **Checked by the tools in `UI_PLAN.md` §7.1:**
  - Vercel Web Design Guidelines audits the changed screens;
  - Playwright takes the screenshots.

---

## 10. In code

- **Tokens are CSS variables,** defined once in `app/globals.css` for light
  and for `:root[data-theme="dark"]`. Pages use tokens, never hex values.
  The line colour is `--rule`. It was named so because `--hairline` already
  existed, with an older value, for the pages not yet moved; it went with
  the last styles that used it.
- **The brand tokens** (§2.1) are written into the page by the server from
  the company's or the system's colour, so the page never flashes the
  default first (`UI_PLAN.md` §4.6). Until the setting exists, they hold
  the default indigo.
- **The building blocks** live in `components/ui/`. Pages compose them and
  don't re-style them.
- **Fonts** are loaded with `next/font`, as Inter already is. Noto Sans
  Arabic is added with its Arabic subset. Outfit, the app's main font
  today, goes once no page uses it.
- **Existing colour variables** (`--primary`, `--surface`, `--text-soft`
  and the rest) stay for the pages not yet moved. When the last page using
  one moves to the building blocks, it's removed, and so is a style no
  page uses any more.

---

## 11. Changed from the reference

Frontend Design's review asks for every choice to be made for this product,
not left as a template default. These parts of the Stripe write-up were
changed:

- **Labels are sentence case,** not ALL CAPS. That's needed for Arabic, and
  it reads calmer.
- **No gradient mesh and no gradient logo.** Those belong to Stripe's
  marketing pages, not to a working app.
- **Page titles are weight 600, not 300.** At 300, Inter is too thin for
  long sessions, and Noto Sans Arabic has no 300 to match. They were 400
  until the owner's mockup of a client's tax position (2026-11-20).
- **The helper-text grey is darker** (`#5d6b82`), so it passes 4.5:1 on the
  page.
- **Field edges are `#828e9f`** instead of a pale blue, so fields stand out
  at 3:1 on the page and on panels.
- **"In Progress" uses a fixed blue,** not the brand colour, so statuses mean
  the same in every company.
- **No "A · B" strings.** Overdue shows as its own word with an icon.
- **One corner size for each level,** and no panels inside panels, instead
  of the same rounded card with the same shadow everywhere.

---

## Change log

- **2026-10-15:** File created. It sets:
  - the brief;
  - the colour tokens for light and dark, with checked contrast;
  - the brand colour as a setting;
  - text, space, corners and depth;
  - the building blocks, icons, Arabic, motion and the quality floor;
  - how it maps to code;
  - what was changed from the Stripe write-up.
- **2026-10-15:** The line token is renamed from `--hairline` to `--rule`.
  `--hairline` already exists with a different value (a faint 5% black)
  that 12 places in the old pages use.
- **2026-10-15:** Nizmo's indigo is used as `#6063ea` (4.70:1), not
  `#5d60e3`. The code darkens a colour in finer steps than the mock-ups did,
  so less of the chosen colour is lost.
- **2026-10-15:** The field edge is `#828e9f`, not `#8792a2`: the earlier
  value was 2.98:1 on the page, under the 3:1 the table promised. The dark
  overdue row (`#241729`) is now written down too.
- **2026-10-15:** The dark field edge is `#65758d`, not `#5b6b82`: the earlier
  value was 2.90:1 on a raised panel, where fields in dialogs sit.
- **2026-10-15:** In the filter bar, the search's and the selects' labels
  are kept for screen readers but not shown, as in the approved mock-ups:
  what they show already names them. On phones, the Filters button shows
  the filters below the search instead of opening a sheet, so each filter
  is on the page once.
- **2026-10-15:** Added, for the dashboard home, Employees and Day Off
  Requests (`UI_PLAN.md` §4.1): the page layout, sections, rows, the row
  menu, tile notes and tile links, and a second button in the page header.
  The old top bar hides its title on a page with a page header until the
  app shell replaces it. The row menu is the first menu, so the menu corner
  (8px) and level-2 shadow from §4.2 and §4.3 become tokens now.
- **2026-10-15:** Added the selection bar, for assigning several employees
  to a team at once.
- **2026-10-15:** Added the dialog, the text area and the radio choice,
  for Day Off Requests' request, approve and reject dialogs.
- **2026-10-15:** Added the donut chart. The product owner prefers the
  dashboard home's donuts to rows of counts, so they come back, drawn from
  the meaning colours and with a legend that carries every word and count.
- **2026-10-15:** Behind a page built from the building blocks, the old
  moving gradient gives way to `--page` until the app shell lands. On the
  gradient, the subtitle in `--muted` couldn't be read.
- **2026-10-15:** A table wider than its panel scrolls sideways inside it
  (§5.4), as §8's layout rule already allowed. It was clipped, which cut off
  the action column between phone width and a wide screen.
- **2026-10-15:** In dark mode, a primary button's hover and pressed shades
  stand out from the panel at 3:1, as the button does (§2.1). They were 8%
  and 16% darker, towards the panel, so the default indigo's pressed shade
  was 2.82:1 and navy's 2.37:1. With white text they're now 4% and 8%
  darker, and the fill is lightened if needed.
- **2026-10-15:** The donut chart is redrawn, as the product owner found it
  old-fashioned. The ring is thinner, with rounded, separated parts in new
  mid-tone chart colours (§2.3), since the deep text colours looked heavy as
  shapes. The legend adds each part's share. Pointing at a legend row
  picks out its part.
- **2026-10-15:** From Codex's review of #76: `--brand-text` reads at
  4.5:1 on both brand tints too, which the derivation already checked
  (§2.1); and `unicode-bidi: isolate` needs `direction: ltr` for an
  identifier, or a time range reads backwards in Arabic (§3.3). Its other
  two findings, the field edge and the dark-mode hover and press, were
  already fixed.
- **2026-10-15:** The donut's legend is at most 28rem wide (§5.5), for the
  Day Off page's credit donut, which spans the page.
- **2026-10-16:** From Codex's review of #79: a donut whose numbers don't
  load says so and offers Try again (§5.5), with nothing in the middle. The
  Day Off page's credit donut said "Loading…" for good when its request
  failed, over a total of 0 days.
- **2026-10-16:** A list that didn't load says so, with Try again (§5.5),
  at the product owner's request. Employees said "No employees found" and
  offered to add one.
- **2026-10-16:** The brand colour setting (§2.1, `UI_PLAN.md` §4.6): the
  colour choice field (§5.3), the warning for a colour close to the error
  red, and who sees which colour.
- **2026-10-16:** At the product owner's choice, the older pages, the side
  bar and the sign-in page follow the brand colour too (§2.1): each of
  their indigo and violet shades keeps its distance from Nizmo's indigo,
  measured from the chosen colour, and keeps the readability it has today.
  Nizmo's indigo gives exactly the colours they have now.
- **2026-10-16:** From Codex's review of #81 (§2.1): the older pages'
  shades are held to today's readability in five more places. These are
  white text on a button brightened on hover, a fill against the dark page,
  text on the light brand tints, a highlight colour that is also a link,
  and the company name's gradient in the side bar.
- **2026-10-16:** At the product owner's choice, the company name at the
  top of the side bar runs from white to a pale shade of the brand in both
  themes (§2.1). In dark mode it used to run from the dark panel colour to
  a dark indigo, on the dark side bar, and was barely readable.
- **2026-10-16:** From Codex's review of #81: the check-in place's radius
  ring on the map has a thin white outline, as its pin does (§2.1). The map
  can show satellite imagery, where a dark colour's ring disappeared.
- **2026-10-16:** For records moving onto each client's page
  (`CLIENTS_PLAN.md` §0.2): a back link above a page's title, details,
  files, a record's expiry with its two statuses, and opening an item from
  a list (§5.5, §2.3).
- **2026-10-16:** Text people type keeps its own direction in either
  language (§7). In the first Arabic check of records, an English record's
  full stop moved to its start.
- **2026-10-22:** A list or page that didn't load tries again by itself
  three times before saying so (§5.5), at the product owner's request. A
  refusal or "not found" is said at once.
- **2026-10-22:** So does anything else a screen loads (§5.5), at the
  product owner's request. A save is never sent again.
- **2026-10-22:** The top bar keeps its glass, as the product owner asked
  (§5.1): flat at the top of the page, and once it scrolls, a floating
  pane of glass with a blur behind it, 24px corners (§4.2) and a shadow,
  easing in over 300ms. It replaces the flat `--panel` bar the app shell
  was to have.
- **2026-10-23:** From Codex's review of #85: the top bar's glass tokens
  are in the neutrals table (§2.2), and `--panel` no longer names the top
  bar; where the browser can't blur, the bar is solid `--panel`, as the
  glass alone could leave helper text below 4.5:1; its blur eases in
  with the rest (§5.1); its dark shadow is the one exception to dark
  mode's depth without shadows (§4.3); its text is `--ink` or `--ink-2`,
  never `--muted`, which a dark backdrop under the glass can bring below
  4.5:1; and it takes the same room floating or not, so the page doesn't
  move.
- **2026-10-22:** A place on the map (§5.3), for the locations tasks happen
  at (`CLIENTS_PLAN.md` §2): a place search, the pin with "Use my current
  location" and "Pick on the map", and the check radius.
- **2026-10-22:** A pick from a list that can grow (§5.3), for a task's
  client and location (`CLIENTS_PLAN.md` §2.3): grouped options, one that
  can't be picked yet greyed with why, and "+ New location" as a button
  below the select.
- **2026-10-22:** A name typed or picked from a saved list (§5.3), for task
  titles and cost names (`CLIENTS_PLAN.md` §5).
- **2026-10-29:** The code a high-risk action asks for sits above every
  other dialog (§5.5, Dialog). Drawn under the confirmation that sent the
  action, as "Pay 7 costs" or "Collect 7 charges" stays open until it's
  answered, its Confirm couldn't be clicked.
- **2026-10-30:** On phones, a total tile's value is never broken (§5.5,
  Total tiles). Two tiles to a row left half the row for each, so an
  amount such as "6,355.50 EGP" had its currency on a line of its own. A
  tile whose value needs more than half takes the row.
- **2026-10-30:** On phones, the tabs share the row, a long label on two
  lines, so every tab shows (§5.5, Tabs). The Costs page's three ran past
  the edge in English, Cash advances cut off mid-word even when it was the
  one picked.
- **2026-10-30:** An empty state can say why it's empty, on a second line,
  when that isn't plain (§5.5, Empty state): the Tasks list's for a Team
  Leader with no one on their team yet.
- **2026-10-30:** A pick of several from a long list, and a form on a page
  of its own (§5.3), for Create task.
- **2026-10-31:** Which period a page is about (§5.3), for Payroll's month
  and year, and later Attendance's month and Public holidays' year. Each
  picks it its own way today: three selects squeezed in beside the title,
  a browser's month field, and arrows either side of a year.
- **2026-10-31:** A card that needs someone, or says something is wrong
  (§5.5, Card), for Payroll's review: a bar on its start edge in its
  meaning's colour, as an overdue row has. Payroll's old cards filled the
  whole card with the colour.
- **2026-10-31:** Which period a page is about (§5.3), decided the same
  day: its address keeps the period, so a reload or a link opens on it,
  and the Super Admin's company is the company in view from the top bar.
  Payroll had a company select of its own, so a Super Admin picked the
  company twice.
- **2026-11-01:** A row that opens (§5.5, Rows), for Payroll's list of
  everyone on the register. Each name opened that person's lines before
  too, but as a plain button with nothing to say it opened, or whether it
  was open, and an excluded person's row was faded below a readable
  contrast. Excluded is said in words now, with why.
- **2026-11-01:** A document (§5.5), for the payslip and the settlement
  statement. Each was a sheet of its own making: headings in small
  capitals, totals and colours typed in, the settlement's verdict a
  coloured fill that doesn't print, and a document that didn't load
  saying it didn't exist.
- **2026-11-01:** Check-in (§5.5), the app's first screen, and the large
  button it alone uses (§5.2). It was a screen of its own making: emoji
  for icons, sizes and colours typed in, the old confirmation window, and
  a failed load that said only "Something went wrong", with no way to try
  again.
- **2026-11-02:** A row's note (§5.5, Rows), under its detail line, for
  what an item is for, such as a template's description. The templates
  pages showed it in cards of their own making.
- **2026-11-02:** A row can be the one you came to see (§5.5, Rows), and
  carry a note a line; a list with one filter and no search has it in its
  card's head (§5.3). Role change requests and access reviews had their
  own pills for status, and an outline or a yellow fill for the one a
  notification opened.
- **2026-11-02:** A password field (§5.3): a button at its end shows the
  password and hides it again. The Super Admins page had an eye of its
  own making, placed by hand on each side for each language.
- **2026-11-02:** A tab can say how many it holds (§5.5, Tabs), as the
  Companies list's two do. The list's subscription states take the status
  badges' meaning colours (§2.3), where they had colours of their own.
- **2026-11-03:** A dialog can ask for a word typed first (§5.5, Dialog),
  for what can't be undone, such as restoring a backup on System health.
  The page's word was in the old confirmation window, in a box of its own
  making, with "Type" and "to confirm" on either side of it.
- **2026-11-03:** A card that loads its own data holds the room of the most
  it can show (§5.5, Card), with a building block for it. Face
  verification on System settings held it with copies of its own making.
- **2026-11-04:** A confirmation is a building block (§5.5, Dialog). The
  last eleven were the old confirmation window, of its own making, with a
  warning sign and an amber or red button, red too where nothing was
  deleted, as on confirming a cash advance's receipt. A dialog's button that
  doesn't fit on one line takes two: "Collect 10 charges, 4,525.50 EGP"
  ran past its own edges on a phone in Arabic.
- **2026-11-04:** Loading is said in the empty state's block (§5.5,
  Loading), as most pages already did. The last five places waited behind
  a spinner of their own making, which took the whole page, and the
  language's switch showed it over the whole screen.
- **2026-11-04:** A person's photo (§5.5), at the top of their profile.
  It was a circle of its own making with a drawn man or woman for someone
  with no photo, chosen by their gender, and a window of its own to see
  the photo larger before it could be changed. Its picker took any image,
  so one the server doesn't take, such as a HEIC or an AVIF, was sent
  before it was refused, in English.
- **2026-11-04:** A person's profile (§5.5), seen by someone else, is their
  details, with Edit in the page header, and the two password dialogs
  (§5.5, Dialog). It was the edit form with every field turned off, and no
  way to edit from it. A wrong password was said in a toast, over a window
  of its own making, and the temporary password sat among the fields, in
  the same size as the rest.
- **2026-11-04:** What takes the focus on a page of the dashboard, such as
  the first field that's wrong, stops below the sticky header (§5.3, a form
  on a page of its own). Told what's wrong, a field at the window's top
  edge took the focus where it was, under the header.
- **2026-11-05:** A dialog that shows what it would record before it does,
  and one that asks who takes over (§5.5, Dialog), for ending a contract
  and handing over a leader's team. Each was a window of its own making:
  the settlement in a sunk box with a heading in small capitals and
  colours typed in, its button taking a date whose figures weren't on
  screen yet, and the hand-off closing before the change was sent, its
  refusal a toast, in English.
- **2026-11-05:** The sign-in screen (§5.5, Sign-in), the one screen with
  no app shell. It was a glass card of its own making over a moving
  gradient, its title in gradient letters, its checkboxes drawn by hand
  and its words typed into the page in both languages. The language and
  theme switches and the legal links were pinned to the screen's bottom
  corners: on a phone the theme switch covered Sign in, and the language
  switch the legal links.
- **2026-11-05:** Forgot your password (§5.5, Sign-in), two steps in the
  sign-in card. It was a form of its own making, its words typed into the
  page, its mistakes said at the top of the card in English, too many
  tries a time to try again at in the server's own time zone, and once
  reset it went back to signing in without a word.
- **2026-11-05:** A page someone can't open, and a company whose
  subscription has ended (§5.5). The first was a page of its own making,
  in English only, titled "Access Restricted" under a no-entry emoji. It
  said the same to everyone, an Admin on a Super Admin's page told to ask
  their administrator, and on the dashboard itself it sent them back to
  the dashboard. The second was a glass card under an hourglass emoji,
  the day it locked in red, on the reader's own calendar.
- **2026-11-05:** A module the company's package doesn't include isn't in
  the side bar (§5.1), decided by the product owner; its pages, opened by
  their address, say so (§5.5, A page someone can't open). It was in the
  side bar, faded and with a padlock, as the way to find out what else the
  product does, and its pages were a card under a padlock emoji naming the
  bundle to buy.
- **2026-11-05:** A note above the page (§5.5), for a company's trial or
  grace and a role being previewed. Each was a box of its own making under
  an emoji. The trial's said "2 day(s) left" in English, and "2" in Arabic
  among Arabic-Indic digits; grace told everyone to renew, which only an
  Admin can; and both read their day on the reader's own calendar.
- **2026-11-05:** A part of a page that belongs to a module the company's
  package doesn't include isn't there either (§5.5, Page layout). The
  dashboard showed a company without HR its bonuses, deductions and day
  off credit, and one without Company Management its tasks and
  obligations; a profile showed pay and day off credit, and Add employee
  asked for both.
- **2026-11-05:** The side bar (§5.1, §6), as the mock-up of the app's
  frame approved by the product owner draws it: light, on `--panel` in
  both themes, with Phosphor icons where it had emoji, the privacy policy
  and the terms at its foot, and on a phone a drawer that is a dialog. It
  was dark slate in both themes, with the company's name in a gradient
  under a rocket emoji, folded to its icons when the name was clicked, and
  on a phone only slid out of sight, Tab still going through its links.
  The "Powered by" signature stays as it was, decided by the product
  owner.
- **2026-11-05:** Requests in the side bar carries how many wait on this
  person under its To review tab (§5.1), as the approved mock-up has it.
  The top bar had a button of its own for name changes, which counted those
  alone, in red, while day off, permission hours and the rest waited
  uncounted on the same page.
- **2026-11-06:** The top bar (§5.1, §6), as the approved mock-up of the
  app's frame draws it: no title, since every page names itself; the
  language switch on the bar, short on a phone and named "Language"; the
  bell's count in the brand colour, heard with its name; and the account
  button with the person's photo or initials, their name and role, opening
  the account menu with its head, My profile, Security settings, History,
  the theme switch and Sign out. On a phone, the glass floats 8px in from
  the screen's edges, where the bar's buttons are, rather than 16px. The
  bar had a title of its own, hidden where the page had a header; the
  language switch was in the account menu, named for the other language;
  the bell's count was red; the button showed a drawn man or woman for
  someone with no photo, and the role in capitals; and "Sign Out" was in
  red.
- **2026-11-06:** The Super Admin's company picker (§5.1), as the approved
  mock-up of the app's frame draws it: the company in view on a pill, with
  its initials, opening a panel with a search of its own above the
  companies, each with its initials. The picker was a see-through pill
  with the company's name alone, and its list had no search, so a Super
  Admin with many companies scrolled through them all.
- **2026-11-06:** The bell's panel (§5.1), as the approved mock-up of the
  app's frame draws it: 380px, with Mark all as read at its top, and each
  notification a link with its subject's icon, what it says and how long
  ago, tinted with a dot while unread. Opening it read them all, so none
  could be told apart as new once it was open; its rows were boxes that
  only a mouse could follow, with the full date and time on each.
- **2026-11-06:** A date, or a range of dates (§5.3). The calendar was a
  window of its own making in the middle of the screen, on a computer
  too, where it dimmed a dialog a second time: the day picked in the info
  blue, today in the colour of what waits on someone, and Reset in the
  danger red, though it only empties the field. Its month arrows were
  characters, its weekdays typed in, its days in Western digits in Arabic,
  and its dates in American order, a range joined by an arrow.
- **2026-11-06:** A date and a time (§5.3). A deadline's calendar was a
  window of its own making too: its month names and weekdays typed in,
  its time in three drop-downs of their own, the hour, the minute and AM
  or PM, and its Confirm Selection button in a gradient. In the bulk
  review of tasks, a row's deadline was a date in American order, with
  its seconds, and a calendar emoji to change it.
- **2026-11-06:** A file that replaces one (§5.5). The templates for the
  bulk upload of tasks were a window of their own making: a national flag
  drawn beside each, a folder emoji on its picker, its words in English
  whatever the page's language, and Cancel, the window's primary button,
  to close it.
- **2026-11-06:** Rows read from a file (§5.5). The bulk review of tasks
  was a window of its own making: each title and description changed in
  a pop-up placed beside it by hand, its people added and taken off with
  round plus and minus buttons, a writing-hand emoji on each Edit, and
  sparkles on its main button. Its row numbers counted only the rows
  shown, not the file's, and a row's mistake about its difficulty was
  never shown, so the row was left out with nothing said.
- **2026-11-06:** Rows read from a file (§5.5), as they're read. A file
  picked as Create task opened was read before its people and clients had
  loaded, so none of them were found, and one that couldn't be read said
  nothing. A date cell was read as the day before west of UTC, a time that
  wasn't one as midnight, a difficulty in words as 0, and a typed "1" as
  1 January 2001; a row with no title was left out with nothing said.
- **2026-11-06:** Toast (§5.5). The toasts were white whatever the theme,
  so a dark page had a white box on it; their bar of colour was on the
  left in Arabic too, the end side there, and they slid in from the right.
  Their colours weren't the meanings' (§2.3), and their ✕ was a letter.
- **2026-11-06:** A place on the map (§5.3). The place search's
  suggestions were a list of its own making, reached only with a mouse,
  and a place with no point on the map could be picked, which dropped no
  pin. A search that found nothing, or failed, said nothing. In the
  check-in places, the map's buttons were the older pages'. Its zoom
  buttons were named in English whatever the page's language, and were
  30px under a finger.
- **2026-11-07:** The face check's camera (§5.5) and face photos (§5.5).
  The camera's step, its Close and its tick were characters (↔, ◡, ✕
  and ✓), and the step's name was never shown. The test version's words
  could fall to 2.7:1 over a light picture, and the tick was white on
  green, 2.3:1. It took no focus as it opened, so Tab walked the page
  behind it, and Escape did nothing. The first download's share was in
  Western digits in Arabic. A flagged check-in's photos were in the
  older pages' window, with an X of its own making and their line in
  `--text-soft`. The watermark over them gave the time in UTC, unlabelled
  and in Western digits in Arabic, after the name and a dot.
- **2026-11-07:** The code a high-risk action asks for (§5.5, Dialog) and
  a page the app has to leave (§5.5). The code was the older pages'
  window, its Cancel grey, of its own making. A code under six digits kept
  Confirm off without saying why, a check that failed said the code was
  wrong, and its minutes were in Western digits in Arabic. When an account
  was suspended or maintenance started, a dark screen with a turning ring
  covered the page, titled in Title Case, and screen readers weren't told.
  Found in the web interface audit, before review: a long maintenance
  message on a phone on its side started above the screen's top, out of
  the scroll's reach, a link in it ran off the side, and a focus ring was
  drawn round its message.
- **2026-11-07:** What an edit changed (§5.5). Its marks were colour
  alone to a screen reader, an added word only a green background; the
  text took the page's direction, not its own, so English in Arabic ran
  right to left; its line breaks were lost; and its spaces were margins
  set by the language, not the text's own. Found in the browser flows: its
  button went as it was opened, so closing it left the focus on nothing.
- **2026-11-07:** A page that broke, and the app itself (§5.5). A page
  that broke was a card of its own making, in English only, under a
  warning emoji: it told of "a client-side exception", offered Reload
  Page and a red Reset Settings & Reload, which also switched the app to
  English, and screen readers weren't told. It stayed when the person
  went to another page, until the page was reloaded. When the app itself
  broke, its screen was in English only, its Try Again in Title Case,
  and the app's styles, fonts and the theme the person chose didn't reach
  it. Found in the browser flows: it didn't say how wide to be, so a phone
  could draw it at a computer's width, its words too small to read.
- **2026-11-07:** The privacy policy and the terms of service (§5.5). They
  were a column of their own making on the older pages' grey, in sizes
  and colours of their own: Nizmo's name above in spaced capitals, their
  titles and the links under them in Title Case, and words in bold
  heavier than the app's. In Arabic, their frame was set left to right but
  not marked as English, so a screen reader read the English as Arabic.
  Printed, either one came out as blank pages. Found in the web interface
  audit: a browser's translation could turn HERE, the mapping provider,
  into the word for "here".
- **2026-11-07:** What was left of the dashboard's frame (§5.1; §5.5,
  Loading). While the frame waited, the page said "Loading section..." in
  English, in classes no stylesheet had, where every page says it's
  loading as the building blocks do. The "Powered by" signature keeps its
  look, as decided on 2026-11-05.
- **2026-11-08:** In code (§10). The old pages' shared styles that no page
  used any more went, and so did the colours only they used: the old
  buttons, cards, fields, badges and window, the glass panels, and the
  classes that hid or showed a part by screen width. `--hairline` was one
  of those colours; the line colour keeps the name `--rule`. Nothing on
  screen changed.
- **2026-11-08:** Motion (§8; §5.1, the side bar), with Emil Design
  Engineering. Menus, panels, dialogs and the calendar appeared at once,
  in full. The side bar and the toasts moved on the browser's own
  ease-out, and the side bar went as slowly as it came. The page beside
  the side bar went dim at once.
- **2026-11-08:** A module's icon, chosen by its company (§6; §5.1, the
  side bar). A company chose an emoji for a module, from 60 in the icon
  dialog or any one pasted into a field under them. The side bar showed
  it in place of the module's icon, never filled, at a size of its own.
  The dialog marked none of the 60 while the company had none of its own,
  as the module's own wasn't among them.
- **2026-11-08:** Ending a contract where the company's package doesn't
  include Payroll (§5.5, Dialog). The dialog showed the settlement it
  would record, a payroll statement such a company has no screen for, and
  ending the contract recorded it. A cash advance still held became one of
  payroll's debts, which no screen there shows.
- **2026-11-08:** A client statement (§5.5, Client statement and a
  document's table), from `CLIENTS_PLAN.md` §9. A client's charges were on
  screen only, on its page and the Costs page's Charged to clients tab:
  none of it could be printed or sent to the client. A document's lines
  had one amount each.
- **2026-11-08:** Signed out by the server (§5.5, Sign-in). A browser
  whose session ended, as a new password or a role changed with "Apply
  now" ends it, came back to the sign-in page with nothing said: it read
  as though the app had forgotten them.
- **2026-11-08:** The "Powered by" signature on the sign-in page (§5.1;
  §5.5, Sign-in), as the product owner asked. It was only in the
  dashboard, so the first page anyone sees didn't have it.
- **2026-11-09:** A client statement in two versions (§5.5, Client
  statement), as the product owner asked: every charge, as it was, or the
  same charges added up by cost name, the saved lists' first purpose, with
  the receipts under each name.
- **2026-11-09:** A name typed or picked from a saved list (§5.3) asks for
  one of the list's where the company keeps its names to the list alone,
  as the product owner asked for cost names, so a client statement by cost
  name adds them up under the same names.
- **2026-11-09:** A name typed in full as its list has it (§5.3) is that
  name with the spaces around it aside, the spaces inside it kept, as the
  list keeps them (Codex on #238).
- **2026-11-09:** Transfer task says what happens to cash advance money
  held for the task (§5.5, Dialog), for the people picked, and who takes
  what someone left off holds is picked there (`CLIENTS_PLAN.md` §7.9, 7h).
- **2026-11-09:** A button that can't be used here stays in place, greyed
  and `aria-disabled`, with why in a note beside it (§5.2), as a company's
  high-risk switch is while the Super Admin has it off for every company
  (`ROLES_PLAN.md` §6.15).
- **2026-11-10:** What someone else changed appears in place, and still
  (§8): no toast, no movement, no reload, and what the person was doing
  stays, as live updates begin with tasks and the bell
  (`REALTIME_PLAN.md`).
- **2026-11-10:** A page the app has to leave (§5.5) also covers an
  account deleted while it's open, which went on working until then, and
  says so: Account deleted, by an administrator.
- **2026-11-11:** What someone else changed is shown for a moment (§8), as
  the product owner chose for live updates' part 5: a row that arrives or
  changes takes the brand tint, which fades over 2 seconds, and the bell's
  count grows a little as it rises. Not for the person's own changes, not
  as a page opens, and with "reduce motion" the tint shows and goes
  without fading.
- **2026-11-12:** Who's online is not tinted (§8), as the product owner
  chose for live updates' part 6b: someone coming or going changes only
  their badge on the Employees list and All users, in place.
- **2026-11-12:** Attendance is drawn again at most every 30 seconds while
  check-ins keep coming (§8), as the product owner chose for live updates'
  part 4c: a company's morning arrivals would otherwise draw an open list
  every few seconds for an hour.
- **2026-11-12:** The code a high-risk action asks for (§5.5, Dialog)
  says when the server has stopped checking codes, after five in fifteen
  minutes, and counts down until it checks again, where it called a right
  code wrong.
- **2026-11-14:** A file that can be started from a template (§5.5,
  Files), as the product owner chose for attendance's import
  (`ATTENDANCE_PLAN.md` §13.9): a quiet, small Download template button
  under the file picker, giving the template in the page's language.
- **2026-11-14:** On phones, no tab label takes more than two lines (§5.5,
  Tabs). A tab is at most 8rem wide and isn't squeezed narrower, so a row
  of more than fit scrolls instead. Attendance's Exceptions, with six kinds
  since `ATTENDANCE_PLAN.md`'s departure to confirm, had stacked "Late /
  left early" four lines high.
- **2026-11-14:** A row of tabs that scrolls opens on the picked tab when
  it's past the row's edge (§5.5, Tabs): attendance opened on Employee
  numbers, the last of its seven, showed the first ones on a phone and not
  the one picked.
- **2026-11-14:** A confirmation that can't go ahead until something is
  settled elsewhere says so in place of asking (§5.5, Dialog): what waits,
  each opening where it's settled, and Close. What only needs knowing
  follows under a heading of its own. First for approving payroll while
  days of the month wait (`ATTENDANCE_PLAN.md` §6.9, decision 14).
- **2026-11-14:** An item that others use is retired, not deleted (§5.5,
  Row menu): Retire, asking first, keeps it on its list with a Retired
  badge and offers it nowhere new, and Put back offers it again. First for
  the Super Admin's terminal brands (`ATTENDANCE_PLAN.md` §17.9).
- **2026-11-14:** Terminal brands, the Super Admin's page under Templates
  (`UI_PLAN.md` §2.2), has the side bar icon `Fingerprint` (§6).
- **2026-11-14:** A picker keeps a retired item where it's already chosen
  (§5.5, Row menu), with "(retired)" after its name, and offers it nowhere
  else. First for a terminal's brand (`ATTENDANCE_PLAN.md` §17.9).
- **2026-11-14:** A guide behind a round "i" beside a card's title (§5.2,
  §5.5, Dialog): steps for what's done mostly away from Nizmo, numbered,
  each saying who and where, what to type in boxes with Copy, and a
  picker at the top where the steps depend on a choice. First for setting
  up a fingerprint terminal, by its model, as the product owner asked.
- **2026-11-15:** What to set on a device, shown once (§5.5, Dialog): a
  short list of each setting and its value, the long one in a box with
  Copy, with a line on which is secret and how a new one is issued. And
  an option that isn't a company's to pick isn't listed (§5.3). First for
  a fingerprint terminal that sends its scans straight to Nizmo
  (`ATTENDANCE_PLAN.md` §17.7).
- **2026-11-15:** What a device sent, kept to be read (§5.5, Dialog): a
  list in the order it came, each a row that opens, saying what Nizmo
  made of it and when, onto what was sent, in boxes left to right, with
  what was taken out said in its place. The keyboard reaches a box that
  scrolls, and the list is read again while it's open. A row that opens
  (§5.5, Rows) can now open onto something other than lines of amounts.
  First for a fingerprint terminal's first requests, for the Super Admin
  (`ATTENDANCE_PLAN.md` §17.8).
- **2026-11-16:** What to set on a device with nothing secret in it
  (§5.5, Dialog) is shown after it's added and again from its menu, and a
  device let in from its office's internet address alone asks for that
  address, says it on its row, and changes it from its menu. First for a
  ZKTeco terminal that sends its scans straight to Nizmo
  (`ATTENDANCE_PLAN.md` §17.3, §17.7).
- **2026-11-16:** Changing how a device connects (§5.5, Dialog) is in
  its menu where another way is open to it: a dialog titled with where it
  moves to, asking only what that way needs, its main button saying the
  move. First for a fingerprint terminal moved between the office agent
  and straight to Nizmo (`ATTENDANCE_PLAN.md` §17.6, §17.7).
- **2026-11-16:** A guide whose steps depend on a second choice (§5.5,
  Dialog) asks it under the picker, as a choice with the usual way
  picked to start with and a line saying which ones the way picked is
  for. First for a ZKTeco terminal that sends its scans to the office
  agent (`ATTENDANCE_PLAN.md` §17.7, §17.12).
- **2026-11-17:** The client's area (§5.5), where a client's person
  lands after signing in: a top bar alone with the company's mark, the
  language switch and the account menu, in the company's colour. With it,
  bars by part, for comparing a few parts of an amount in one colour; a
  share bar, for how much of a whole is done; a client's tax position, the
  area's first page, with one figure larger than `--text-3xl` to come as
  `--text-hero`; and a dialog for writing to someone on WhatsApp
  (`CLIENT_PORTAL_PLAN.md`).
- **2026-11-17:** Ask about this claim, on each claim of a client's tax
  position (§5.5), opening the WhatsApp dialog with that claim's message;
  the page without anyone to write to; and a Waiting on someone badge
  where a client's figures are 30 days old or more, for the company's
  people (`CLIENT_PORTAL_PLAN.md` §4.3, §7).
- **2026-11-17:** A client's tax position for the company's people
  (§5.5): the section on a client's page, with the day the figures are
  from, four total tiles, and the claims in a list, five to start with
  and Show all claims at its foot (`CLIENT_PORTAL_PLAN.md` §3.5).
- **2026-11-17:** A client's tax position for the company's people
  (§5.5) says it didn't load in the section's place, for a page of its
  claims too: the claims kept up from another page don't stand in for
  the page asked for (`CLIENT_PORTAL_PLAN.md` §3.5).
- **2026-11-18:** Uploading the tax portal's file (§5.5): Upload from
  the tax portal on the Tax position section's heading; a file refused
  whole, in a dialog; the check screen, with what's new, changed and
  going; a row with a problem stopping the save; and the confirmation
  where the file's company isn't the client's (`CLIENT_PORTAL_PLAN.md`
  §4.1).
- **2026-11-18:** The tax portal's export button (§5.5): its page, with
  the button to drag to the bookmarks bar on a computer, Copy address
  for whoever can't drag, its steps numbered as a guide's are, and what
  to know (`CLIENT_PORTAL_PLAN.md` §10).
- **2026-11-18:** How to get the portal's file (§5.5): the link to the
  tax portal's export button's page. It ends the Tax position section's
  line, or its empty state's, for whoever may update it; and it opens
  in a new tab where the upload refuses a file whole or a row has a
  problem (`CLIENT_PORTAL_PLAN.md` §10). On a phone it's 44px under a
  finger. A link in a line of text (§5.2) is written down, with its
  underline 2px under the pointer.
- **2026-11-18:** Figures getting old (§5.5, A client's tax position,
  for the company's people): where the badge sits, after the line's
  words on the client's page and after the client's name in the Clients
  list, and that an archived client has none (`CLIENT_PORTAL_PLAN.md`
  §4.3).
- **2026-11-19:** Two things too small for a phone (§9). A section's
  link or button goes on its own line under the heading where the two
  don't fit side by side: Upload from the tax portal reached past a
  360px phone's edge in English. And every link in a line of text is
  44px under a finger on a phone, as How to get the portal's file was:
  Saved lists on the cost names card and System settings on the
  high-risk card were as tall as their words.
- **2026-11-19:** Setting a password from an invitation (§5.5): where
  one of a client's people lands from their invitation, on the sign-in
  screen's frame: who invited them, for whom, their email, the password
  asked twice, Set password, and a link that can't be used saying why
  (`CLIENT_PORTAL_PLAN.md` §5.2).
- **2026-11-19:** The invitation's email (§5.5): in the language the
  person is invited in alone, from the office by name, with a reply to
  whoever sent it, one Set password button, the link written out to
  copy, and the default brand colour written into it
  (`CLIENT_PORTAL_PLAN.md` §5.2).
- **2026-11-19:** People who can sign in (§5.5): a section on a
  client's page after Tax position, each person with when they last
  signed in or an Invited badge, Add person in a dialog with the
  language they're invited in, Resend invitation and Remove from the
  row's menu (`CLIENT_PORTAL_PLAN.md` §5.2).
- **2026-11-19:** Three things on a client's page too small for a phone
  (§5.1, §5.2, §9), found at 360px while People who can sign in was
  built. A client's mobile number is a link in a line of text, 44px
  under a finger, where it was 17px; a link in a line of text is at least
  44px wide under a finger, where a short one was only as wide as its
  words; and the top bar's language switch has options 44px wide and 44px
  under a finger, where they were 40px by 36px.
- **2026-11-19:** A client's tax position (§5.5): how late has a first
  row, not due yet, for claims whose last day to pay hasn't passed, before
  under 6 months, so the late rows hold only what's late (decided
  2026-11-19).
- **2026-11-19:** `--text-hero` joins the sizes (§3.2): 48 / 56px, 36 /
  44px on phones, for the client's area's one large figure, what a
  client owes, as the tax position asked for it (§5.5). And bars by part
  (§5.5) cut a long name short at its own end, in its own direction, so
  an item's Arabic name on the English page keeps its first words: found
  in the browser as the blocks were built.
- **2026-11-19:** A client's tax position (§5.5), as its top was built:
  a file with nothing open in it shows that nothing was owed that day,
  without the cards; one late claim of one is "1 claim late", and "All
  open claims are late" is for more than one; the oldest delay is None
  where nothing is late; the share paid is rounded down, so it never
  says 100% while something is left to pay; the currency is said once,
  after the large figure; and the notes under the bars say each item's
  share and claims, and each row of how late its claims.
- **2026-11-20:** A client's tax position (§5.5), as the owner's mockup
  draws it: What the company owes as a muted label rather than a card's
  title, the badge with a warning icon, the share paid twice the figure's
  width with its amounts and their currency, a line over the facts, the
  paid fact with its currency, and the phone's facts between lines; each
  card of bars with a line under its title; "of what's owed" in an item's
  note and "No claims" at nothing; short names for the two usual items
  with long names, their full names for screen readers; the mockup's words for the subtitle and the note; and
  the share paid to the nearest whole percent, as the mockup has it, 99%
  at most while something is left to pay.
  Bars by part take the mockup's sizes and a 140px name column, the share
  bar's amounts go under it on phones, and a card's title can have a line
  under it (§5.5).
- **2026-11-20:** A client's tax position (§5.5), the claims by item as
  the owner's mockup draws them: the card's hint, the table's head and
  its columns, the largest item open at first, an item's claims the
  latest last day to pay first, a claim's period said as the portal
  means it ("Year 2025", "November 2025"), the total row, its rows'
  heights, Partly paid before Late here and for the company's people, and
  on phones the claim's period with its last day to pay and the total's
  count of claims. Ask about this claim comes with step 9.
- **2026-11-20:** A person's WhatsApp number, for their clients (§5.5):
  a card of its own on their profile's form, Contacting clients, with
  one field kept with its country code and a box saying who writes to
  it, where the package has the client portal (`CLIENT_PORTAL_PLAN.md`
  §12, step 9a).
- **2026-11-20 (decided by the owner):** The app's frame and cards as the
  owner's mockup of a client's tax position draws them, everywhere
  (§3.2, §4.1, §5.1, §5.5): the top bar on computers as on phones, its
  account button the photo or initials alone and its language switch
  "EN" and "ع"; page titles at weight 600; card titles in `--text-card`
  (15px) at weight 600, with 20px above and below and 24px at the sides
  inside a card on computers; and 16px between a page's sections and
  cards on computers too. 20px joins the spacing scale for a card's
  inside.
- **2026-11-20:** A titled part inside a card is headed in `--text-md`
  at weight 600 (§5.5), so it stays under the card's 15px title; it was
  `--text-lg` at 500. Found in the interface audit of the frame and
  cards' alignment.
- **2026-11-20:** A client's tax position, for the company's people
  (§5.5): the responsible accountant at the section's foot, as the
  owner's mockup draws it. A select that saves when picked, for whoever
  may manage clients; their WhatsApp number beside it, or a note saying
  why the client's people can't write to anyone, with the way to fix it.
  A person's WhatsApp card names the clients they answer for
  (`CLIENT_PORTAL_PLAN.md` §12, step 9b).
- **2026-11-20:** A client's tax position (§5.5), and Contact on
  WhatsApp as the owner's mockup draws it: the accountant named in the
  page's subtitle where the client has one whose contract hasn't ended,
  Contact the accountant where they have a WhatsApp number, before the
  first file too. The dialog has a Close button, Open WhatsApp before
  Cancel, and its foot line under a rule, unlike other dialogs; its
  message ends, until it's changed, with where the question goes
  (`CLIENT_PORTAL_PLAN.md` §12, step 9c).
- **2026-11-20:** Ask about this claim (§5.5), as the owner's mockup
  draws it: a quiet icon button, a speech bubble with two lines, after
  each claim's badges in the table and on the phone's cards, opening
  Contact on WhatsApp titled "Ask about a claim" with that claim's
  message. The note under the claims then points to it, in its row on
  computers and its card on phones (`CLIENT_PORTAL_PLAN.md` §12, step
  9d).
- **2026-11-20:** A text with fields put in by buttons, a message's
  preview, and Client messages on WhatsApp (§5.5), as the owner's mockup
  draws them: fields as chips put in by buttons where the cursor was,
  how many characters of 1,000, who changed it last, Save and Discard
  changes, Arabic and English each with its own changes, and the message
  filled with made-up figures as a chat bubble, on three new tokens
  (`CLIENT_PORTAL_PLAN.md` §12, step 10b).
- **2026-11-20:** The update email (§5.5), as the invitation's email in
  all but its words, which the owner agreed: the client's tax position
  updated, the day the figures are from, and Sign in, with no amounts.
  Once an upload is saved, its toast says whether the client's people
  were emailed, and why not where none was (`CLIENT_PORTAL_PLAN.md`
  §12, step 11b).
- **2026-11-21:** The tax position statement (§5.5), as the owner's
  mockup draws it, redrawn on the building blocks (the Tax position
  statement canvas, approved by the owner): the client's details, four
  facts, the open claims by item with each item's total and the total in
  all, and the note, opened in a new tab from Download the statement on
  the client's page and on the client's Tax position
  (`CLIENT_PORTAL_PLAN.md` §8, §12, step 12).
- **2026-11-21:** A guide's page (§5.5), and the guide's button opening
  it (§5.2), as the owner approved in the Fingerprint terminal setup
  guide canvas: How to set up a fingerprint terminal moves from its
  dialog to a page of its own, with Print, a choice between Command
  Prompt and PowerShell that writes every command for the one picked,
  kept in the browser, and only the guide printed (`ATTENDANCE_PLAN.md`
  §17.7).
- **2026-11-21:** Show me how under a guide's lines (§5.5, A guide's
  page), as the owner approved in the Fingerprint terminal setup guide
  canvas: the clicks of a line that needs them, opened under it, and
  What it shows for what a command prints; what's seen once something's
  typed, under its box; and every one open on paper
  (`ATTENDANCE_PLAN.md` §17.7, #357).
- **2026-11-21:** A note above the page (§5.5): a company's free trial
  and its grace are said to its Admins alone, as the owner asked
  (`FIRST_CHANGES_PLAN.md` §3); grace no longer tells everyone else who
  can renew it.
- **2026-11-21:** Public holidays apply (§5.5), as the owner approved in
  the Public holidays off for a company canvas: one switch at the top of
  the Holidays card's public holidays, asked about with From when?, a
  change from a later date listed to withdraw, and the year's public
  holidays marked Worked through while it's off (`FIRST_CHANGES_PLAN.md`
  §6).
- **2026-11-23:** Status counts (§5.5), as the owner approved in the All
  users: status badges canvas: a pill for each status with its count, at 0
  too, counting everyone the list is for whatever is searched, each
  pressed to show only its status, with a line saying so and Show
  everyone; and they change in place as people come and go (§8)
  (`LATER_CHANGES_PLAN.md` §6).
- **2026-11-23:** A name in English and in Arabic, and the names still
  missing a language (§5.3), as the owner approved in the English and
  Arabic names canvas: a field for each language under the name's label,
  the other one offered as a button to press, never saved by itself, its
  spellings listed with this company's first, a guess underlined with
  dots, business words in their place, both needed for anything new, a
  name saved before asked for the other on its next edit, and the ones
  still missing listed on the Employees and Clients pages
  (`LATER_CHANGES_PLAN.md` §3).
