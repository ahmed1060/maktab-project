# Live updates: plan

What someone else changes appears on the screens of the people it
concerns, without anyone refreshing the page. The first example, and the
reason for it: a task assigned to an employee appears in their task list,
and their bell, as it's assigned.

Decided with the product owner on 2026-11-10.

---

## 1. What's there today

- **Maintenance mode** is live already: the Super Admin turning it on
  reaches every open page at once, over a public Supabase Realtime channel,
  `maintenance-status` (`components/UserHeartbeat.tsx`,
  `lib/services/realtime-broadcast.service.ts`). It's public because
  "maintenance is on" is no secret.
- **Everything else waits to be asked:**
  - a page shows what was true when it was opened, and is drawn again
    after its own person's actions (`router.refresh()`);
  - the bell asks every 5 minutes (`components/NotificationBell.tsx`);
  - the heartbeat asks every 90 seconds, while the tab is shown, whether
    the account was suspended, archived, deleted or banned, and whether
    maintenance is on.
- **The server refuses whatever the page no longer may do,** whatever the
  page shows: a suspended person's next request is refused, live or not.

---

## 2. How it works (Decided)

- **A signal says only that something changed, never what.** The server
  sends "tasks changed" to a company's people. Each open screen that shows
  tasks draws itself again, through the same route and the same checks as
  any visit. So:
  - nothing anyone may not see travels over the connection: no names, no
    amounts, no ids;
  - a signal lost, late or sent twice costs a refresh, or a later one,
    and nothing else;
  - what a screen shows is always what the server says now.
- **The database sends the signals,** from triggers on the tables that
  change, with Supabase's `realtime.send`. A signal is written in the same
  transaction as the change, so it goes out only if the change is saved,
  and every way a task can change is covered without anyone having to
  remember to send one: the forms, bulk upload, a transfer, a cron job.
  - One signal per statement, not per row: a bulk upload of 50 tasks is
    one signal for its company.
  - A signal that can't be sent never stops the save: the trigger catches
    the error and only warns.
  - On a database without Supabase's `realtime` schema, such as the
    Postgres the tests use, the triggers do nothing.
- **Private channels (Decided: the product owner's choice of two).**
  Supabase lets a browser listen to a channel only if a rule on
  `realtime.messages` lets its token in:
  - `tasks:<company id>`: the company's people, and the Super Admin. It
    says when the company's requests change too (part 2);
  - `notices:<person id>`: that person, or that Super Admin, alone.
  - The browser can send nothing on them: there's no rule for that.
  - The token is the app's own: `GET /api/realtime/token` signs one for
    the person signed in, for an hour, with the project's JWT secret
    (`SUPABASE_JWT_SECRET`, in Vercel). It names the person, their company,
    and whether they're the Super Admin, and the browser asks for a new one
    before it ends. A person suspended, archived, deleted or banned is
    given none.
  - Turned down: public channels with names too long to guess. No set-up,
    but a name once known stays known, after its person has left, and
    anyone holding it could send false signals.
- **One connection per open tab,** opened once the dashboard is drawn and
  loaded only then, as the maintenance channel's is. Screens say which
  signals they want; the connection listens to the topics they need.
- **On the screen** (`DESIGN.md` §8):
  - signals arriving close together are drawn once, a second after the
    last;
  - a hidden tab draws nothing, and catches up when it's shown again;
  - joining draws once: as the page opens, for a change saved while it
    was on its way, and on reconnecting, after a laptop sleeps or a phone
    loses its signal, for whatever was missed;
  - what someone else changed appears in place: no toast, nothing
    slides, and what the person was typing, their filters and where
    they'd scrolled to stay. Since part 5, it's tinted for a moment, so
    it's found (§3).
- **The secret it's signed with** is Supabase's legacy JWT secret. The
  project has moved to Supabase's newer signing keys, and Supabase still
  accepts tokens signed with the old secret: its dashboard calls it
  "still used". Revoking it, or switching the project to Supabase's
  publishable and secret API keys, which turns it off, would turn live
  updates off too, and the app's public key with them. Either is done
  only after the token is signed another way.
- **What still asks, as a safety net:** the bell every 5 minutes, and the
  heartbeat every 90 seconds. Either can be slowed once the live path has
  run in production for a while.
  - The heartbeat also says who's online on the Employees list: a person
    shows as online for two beats and 20 seconds after their last
    (`lib/presence.ts`, #246). Slowing it widens that window with it, so
    someone who closed their last tab shows as online for longer.
- **Cost:** about one connection per open tab, and one signal per change
  per company. Supabase's free plan allows 200 connections at once and
  2 million messages a month; at 50 to 200 people, both are far off.
  - Each signal is counted once for every tab that hears it, and every
    open tab of a company hears its tasks' signals, not only those on a
    task page. A company of 200 with 150 tabs open and 300 task changes a
    day would use about 1.35 million a month. Supabase's usage page is
    checked after the first weeks; if it runs high, a tab joins a channel
    only while a screen that listens to it is open.
  - Requests' signals (part 2) are heard as tasks' are, by every open tab
    of the company, and by each Super Admin's. Requests change far less
    often than tasks, and a check-in sends none.

---

## 3. Built in parts

| Part | What it covers | PR |
|---|---|---|
| 1 | The token, the channels' rules and the triggers; one connection per tab; the task list, a task's page and the bell drawn again when what they show changes | #244, merged 2026-11-10 |
| 2 | The Requests page, and the count on Requests in the side bar | #250 |
| 3 | A suspended, archived, deleted or banned person signed out within seconds, not 90; the heartbeat kept as the safety net | #248 |
| 4 | Other screens, as they're wanted: cash advances, attendance, costs | |
| 5 | A little motion for what arrives live: what changed is shown for a moment, so nobody has to hunt for it | #251 |

- Each part is its own PR, merged on the product owner's word.
- **Part 1 has been live since it merged.** `SUPABASE_JWT_SECRET` was
  already in Vercel, for Production, Preview and Development, added with
  the Supabase integration on 2026-09-03, so nothing had to be added. The
  product owner checked it in production the same day: a task given to an
  employee appeared on their open Tasks page, and Supabase's Realtime logs
  showed no refused joins.
- **Part 2 (#250):** the Requests page and the count on Requests in the
  side bar draw themselves again when a request is asked for, decided or
  withdrawn, through the same routes as any visit.
  - **The signal** is `requests`, empty as the others are, on the
    company's channel (`tasks:<id>`), and on each Super Admin's own
    (`notices:<id>`): with no company in view, their page and count are
    every company's, and they hear no company's channel then. No new
    channel, and no change to who may listen
    (`prisma/migrations/20261210000000_live_requests`).
  - **Every kind on the page is covered,** from the table it's read from.
    The attendance kinds signal only for the rows a request is made of: a
    check-in flagged, reviewed, or withdrawn once flagged or reviewed; a
    day whose overtime waits, is decided, or is worked out again while it
    waits; a phone asked for or decided. A check-in writes a punch, works
    its day out again and counts on its phone, and a signal for each would
    draw every open Requests page and count in the company.
  - **Joining a channel draws them once too,** as it draws the tasks.
- **Part 3 (#248):** the screen of someone who can't go on asks the
  heartbeat at once, which signs it out as it does at its beat, saving the
  work open on it first.
  - **The signal** is `account`, empty as the others are, on the channels
    part 1 already lets the right people hear: the person's own
    (`notices:<id>`) when they're suspended, closed or deleted, and their
    company's (`tasks:<id>`) when it's banned
    (`prisma/migrations/20261209000000_live_account`).
  - **The triggers** run for a row only when its column changed to what
    ends access: `AFTER UPDATE OF status` on `"User"`, to suspended,
    archived or deleted, and of `"isBanned"` on `"Company"`, to banned. The
    heartbeat writes `"User"` every 90 seconds for each open tab
    (`lastActivity`), and signing in and out write its status, so a
    trigger on any update would signal with each of them. Being let back
    in sends nothing: the person is signed out already.
  - **Joining a channel asks once too,** for a suspension saved while the
    page was on its way or a laptop slept.
  - **A row deleted outright** sends nothing: its session ends at its next
    check, a minute at most, and the next beat signs the browser out
    (#247).
- **Part 5, motion (#251), as the product owner chose:** what someone
  else changed is shown arriving, briefly, and then the screen is still
  again (`DESIGN.md` §8, changed first, in its own commit).
  - **A row that arrives or changes,** on the task list and the Requests
    page, takes the brand tint (`--brand-tint`). It holds for half a
    second, so it's seen, and fades evenly back to the row's own colour,
    an overdue row's too, within 2 seconds. Only its colour changes: it
    doesn't slide, and the rows around it don't move. On a phone, the
    card is tinted.
  - **The bell's count, as it rises,** grows to 115% and settles back, in
    250ms on `--ease-out`.
  - **A row that goes simply goes:** showing it leaving would mean
    keeping on screen what the server says is gone.
  - **Only for what someone else did** (`components/useArrivals.ts`):
    - each draw of a list is compared with the one before it, row by row,
      and only the draw that follows a signal is marked;
    - not as a page opens, which has nothing before it, and not when the
      person looks at another tab, filter or page, which is another list;
    - not for the person's own changes: each action on the Requests page,
      its dialogs' too, says as it starts, before it sends anything, that
      the next draw is theirs (`ActionStarts`, `lib/useBusyAction.ts`).
      Their change's own signal can come before their answer, if the
      server goes on working after saving it, and the draw it brings is
      still theirs. The task list has no actions of its own: a task is
      changed on its page, and the list is drawn afresh as the person comes
      back to it;
    - a signal whose draw changed nothing is forgotten after 10 seconds,
      so it can't claim a change the person makes later;
    - each draw's rows are unmarked 2 seconds after it, whatever draws
      come after, so a steady stream of changes doesn't keep earlier rows
      tinted; a row that changes again is marked for the later draw's 2
      seconds;
    - what changed while a tab was out of sight is shown as it comes back,
      as the tab is drawn then;
    - the bell's count grows as it rises from one answer to the next: not
      as a page opens, and not as it falls.
  - **One case the page can't tell:** a change the person makes in
    another tab of theirs reaches this one as anyone's would, and is
    tinted here.
  - **With "reduce motion",** the tint shows for its 2 seconds and goes
    without fading, and the count doesn't grow.
  - In both languages and both themes, from the colour tokens, with
    Emil Design Engineering's motion guidance (`UI_PLAN.md` §7.1).

---

## 4. Not covered here

- **The phone app in the background:** it hears nothing while it's
  closed. That's native push, which today sends only check-in reminders
  (`lib/services/push.service.ts`); sending every notification by push is
  its own piece of work.
- **The maintenance channel** stays public, as it is.

---

## Change log

- **2026-11-10:** File created, with the product owner's decisions:
  signals that say only what changed, sent by the database; private
  channels, behind the app's own short-lived token; and part 1 covering
  tasks and the bell.
- **2026-11-10:** Part 1 merged in #244, and live since: the secret was
  already in Vercel, from the Supabase integration, and the product owner
  checked it in production. Added, at the product owner's request, part 5:
  a little motion for what arrives live (Proposed). Noted the legacy
  secret that the token depends on, what part 3's trigger listens to,
  and how the messages are counted.
- **2026-11-10:** Noted that the Online window on the Employees list
  follows the heartbeat (#246), so slowing the heartbeat widens it.
- **2026-11-10:** A deleted account is refused and signed out like a
  suspended one (#247), so part 3 signals a person deleted too.
- **2026-11-10:** Part 3 built (#248): someone suspended, closed or
  deleted, or whose company is banned, is signed out within seconds, by a
  signal on the channels part 1 already has. The heartbeat stays as the
  safety net.
- **2026-11-10:** Part 2 built (#250): the Requests page and the count on
  Requests in the side bar draw themselves again when a request changes,
  for the company's people and each Super Admin. Check-ins send no signal
  unless they make a request.
- **2026-11-11:** Part 5 built (#251), as the product owner chose: a row
  someone else added or changed, on the task list and the Requests page,
  takes the brand tint, which fades over 2 seconds, and the bell's count
  grows a little as it rises. Not for the person's own changes, not as a
  page opens, and not on another tab, filter or page. `DESIGN.md` §8
  changed first. Noted the one case the page can't tell: the person's own
  change, made in another tab of theirs.
- **2026-11-11:** Two findings by Codex on #251, both fixed in it: the
  person's own action now says it's theirs as it starts, not once its
  answer comes, as its live signal can come first; and each draw's rows
  are unmarked after their own 2 seconds, where a later draw used to keep
  every marked row marked, which with "reduce motion" could keep rows
  tinted while changes kept coming.
