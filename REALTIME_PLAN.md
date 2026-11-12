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
  heartbeat. The heartbeat ran every 90 seconds; since part 6a it runs every
  15 minutes while a tab is shown, and as a tab comes back into view.
  - Until part 6a the heartbeat also said who's online on the Employees
    list: a person showed as online for two beats and 20 seconds after
    their last (`lib/presence.ts`, #246). Since part 6a each tab says when
    it comes and goes, so the heartbeat could slow without the badge going
    stale (§3).
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
  - Cash advances' signals (part 4a) are heard the same way. The ledger
    changes far less often than tasks: an advance given, returned,
    confirmed or spent on a cost.

---

## 3. Built in parts

| Part | What it covers | PR |
|---|---|---|
| 1 | The token, the channels' rules and the triggers; one connection per tab; the task list, a task's page and the bell drawn again when what they show changes | #244, merged 2026-11-10 |
| 2 | The Requests page, and the count on Requests in the side bar | #250 |
| 3 | A suspended, archived, deleted or banned person signed out within seconds, not 90; the heartbeat kept as the safety net | #248 |
| 4a | Cash advances: the Cash advances tab, a person's cash advance and My cash advance, Add cost's line about the advance, and an open Give advance, Record return or Correction window | #252 |
| 4b | Costs and charges: the Employee costs and Charged to clients tabs, and a client's charges | |
| 4c | Attendance | |
| 5 | A little motion for what arrives live: what changed is shown for a moment, so nobody has to hunt for it | #251, merged 2026-11-11; Codex's two findings after the merge, fixed in #253 |
| 6a | Who's online: each tab says when it's shown and when it goes, and the heartbeat slows to every 15 minutes, as the safety net | #262 |
| 6b | The Online badge on the Employees list and All users drawn again as people come and go | #263 |

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
- **Part 4, other screens,** in three PRs, the product owner choosing
  cash advances first: 4a cash advances, 4b costs and charges, 4c
  attendance. Attendance's waits for a decision on what a check-in
  signals, as a signal for each would draw every open attendance page in
  the company with every check-in (part 2 sends none for them).
- **Part 4a, cash advances (#252):** the screens that show a cash advance
  draw themselves again as the ledger changes, through the same routes as
  any visit:
  - the Costs page's Cash advances tab, keeping its search, filter and
    page;
  - a person's cash advance, and My cash advance: the balance, what's
    held for a task or a client, what awaits confirmation, and the
    history;
  - Add cost's line about the person's advance on a task's page, keeping
    the cost being typed;
  - an open Give advance, Record return or Correction window: what the
    person holds, and what they'd hold after, keeping what's typed. An
    advance given is weighed against the balance as the server says it
    now, not as the row said when the window opened. A task or client
    picked under From, then spent or moved elsewhere, stays picked,
    holding nothing, so the amount typed is refused as more than they hold
    rather than saved against the running balance (found by Codex on
    #252).
  - **The signal** is `advances`, empty as the others are, on the
    company's channel (`tasks:<id>`), and on each Super Admin's own
    (`notices:<id>`): a Super Admin opens anyone's cash advance with
    another company in view, or none, and hears no company's channel then.
    No new channel, and no change to who may listen
    (`prisma/migrations/20261211000000_live_advances`).
  - **Every way the ledger changes is covered,** from its one table: an
    advance given, returned or corrected, a receipt confirmed, a cost paid
    from it or put back, money moved to the running balance or passed on
    with a transfer, a balance turned into a debt as a contract ends, and
    an entry's task, cost or client deleted, which its history line says.
    One signal per statement for each company it touched.
  - **The helper it's sent with,** `live_company_signal(event,
    companies)`, signals a statement's companies and every Super Admin,
    for parts 4b and 4c to use too.
  - **Joining a channel draws them once too,** as it draws the requests.
  - **Part 5's tint** marks a row of either list that someone else added
    or changed. Their search, filter and page aren't in the page's
    address, so each list is told apart by the address it's loaded from
    (`useArrivalsIn`).
  - **Giving, returning, correcting, confirming and moving are the
    person's own,** and aren't tinted. All but Confirm receipt are
    high-risk, and a two-factor code asked for on the way holds the action
    for as long as the code takes to type, longer than a signal is waited
    for (10 seconds). So the person's own action now counts as theirs for
    as long as it's on its way, and the 10 seconds start once it's
    answered; whatever is drawn meanwhile is taken as theirs. On the
    Requests page too. Since #253, the draw after the answer is theirs
    only once their page says the change is saved.
- **Part 5, motion (#251), as the product owner chose:** what someone
  else changed is shown arriving, briefly, and then the screen is still
  again (`DESIGN.md` §8, changed first, in its own commit).
  - **A row that arrives or changes,** on the task list and the Requests
    page, and since part 4a on the cash advance lists, takes the brand
    tint (`--brand-tint`). It holds for half a
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
      its dialogs' too, says as it starts, before it sends anything, and
      as it's answered (`ActionStarts`, `lib/useBusyAction.ts`), and every
      draw while it's on its way is taken as theirs (part 4a). Once their
      change is saved, the page says so (`saved()`), and the draw after it
      is theirs too: their change's own signal can come before their
      answer, if the server goes on working after saving it. Refused, it
      saved nothing, and what someone else changed meanwhile is tinted
      (#253, found by Codex on #251 after the merge). The task list has
      no actions of its own: a task is changed on its page, and the list
      is drawn afresh as the person comes back to it;
    - a signal whose draw changed nothing is forgotten after 10 seconds,
      so it can't claim a change the person makes later;
    - each draw's rows are unmarked 2 seconds after it, whatever draws
      come after, so a steady stream of changes doesn't keep earlier rows
      tinted; a row that changes again is marked for the later draw's 2
      seconds, and its tint starts again: it takes the same tint under
      another name, as an animation whose name stays carries on where it
      was (#253, found by Codex on #251 after the merge);
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

- **Part 6: who's online (decided with the product owner on 2026-11-12).**
  The Employees list and All users show who's online. It came from the
  heartbeat: a person was online for two beats and 20 seconds after their
  last, so someone who'd closed the app showed as online for up to 3
  minutes 20 seconds, and the heartbeat ran every 90 seconds, the app's
  busiest call, for that above all.
  - **6a (#262): each tab says when it comes and goes.**
    - Each open tab has a row of its own (`OpenTab`: the person, and an id
      the tab makes for itself). It's added, or brought up to date, as the
      tab is shown, and taken away as the tab is closed or has been out of
      sight for 2 minutes. A tab closing says so with
      `navigator.sendBeacon`, which still goes as the page closes.
    - A person is online while any tab of theirs has a fresh row, so a
      laptop and a phone, or two tabs, don't make each other look gone. A
      tab looked at again within the 2 minutes sends nothing at all.
    - The heartbeat stays, every 15 minutes while a tab is shown, as the
      safety net: for a tab whose leaving wasn't heard, such as a phone's
      app closed by the phone in the background, whose row is left to run
      out after two beats and 2 minutes (32 minutes); and for the account
      and maintenance checks, which part 3 and the maintenance channel made
      instant. A tab coming back into view asks them too.
    - A tab whose old script hasn't loaded the new one yet still beats as
      before: its beat stands for the person's one tab until it's reloaded.
    - Two reports from one tab can reach the server either way round, as a
      closing tab's beacon overtaking the beat it sent just before. Each
      carries its place in the tab's order, and the row keeps a report only
      if none after it has arrived. A tab that goes is marked gone rather
      than deleted, so a report sent before, arriving after, can't bring it
      back (Codex on #262).
    - Signing out closes, on the server, every tab of that browser's
      session (the id its token is given at sign-in), and none of the
      person's other devices. The tabs can't say so themselves: the session
      ends before they hear of it, and the server refuses them after. Left
      to them, the person showed as online for 32 minutes after leaving
      (Codex on #262).
    - **Known limit:** a tab opened just as another tab of the same browser
      signs out can still show the person as online, for up to 32 minutes.
      Its first report, let in before the sign-out, can add its row a
      moment after the sign-out closed the others. Closing that gap needs a
      table of ended sessions, checked on every report, the app's most
      frequent call, for a race of milliseconds that touches only the
      Online badge. The product owner chose to leave it, and to look at it
      again with 6b if it's ever seen (Codex on #262).
    - The heartbeat started again each time the session was fetched again,
      every 5 minutes, and called the server as it did, from every tab,
      shown or not. Found while building 6a: it now starts only as someone
      signs in.
    - Rows are swept daily, with the other old records (`/api/cron/prune`).
  - **6b (#263): the badge is live.** The Employees list and All users are
    drawn again as someone comes or goes, on a channel only those screens
    join, so a coming or going is heard by the one to three people looking,
    not by every tab.
    - **The channel** is `online:<company id>`, one for each company,
      joined only while a screen that shows the badge is open. The
      Employees list joins its company's, the company in view's for the
      Super Admin. All users, and the Employees list for a Super Admin with
      no company in view, join the channel of each company on the page
      shown. Every other tab stays off them.
      - Turned down: one channel for every company, for the Super Admin's
        lists of everyone. Supabase counts a signal once as it's sent,
        whoever listens, so each coming and going in every company would
        have cost a message more, for screens open a few minutes a week.
    - **Who may listen:** a company's people who may see the Employees list
      (`employees.view`), their own company's channel only; and the Super
      Admin, any company's. The rule on Supabase's side can't read the
      app's permissions, so the token says whether its person may see the
      list. A signal says only that someone in the company came or went,
      never who.
    - **The signal** is `changed`, empty as the others are, sent by the
      database: a trigger on `"OpenTab"`, once per statement for each
      company it touched (`prisma/migrations/20261214000000_live_online`):
      - a tab here for the first time, or here again after it went;
      - a tab gone: closed, out of sight for 2 minutes, or signed out;
      - a tab here again after its row had run out, as a phone that paused
        the app for over 32 minutes wakes it;
      - not the heartbeat's beat, which keeps a tab here as it was, and not
        the daily sweep, which removes only rows that had run out already.
      - A tab's coming or going is signalled even while another tab of the
        person's keeps them online, and the list is drawn the same. Telling
        the two apart would mean the trigger reading the person's other
        tabs, as their own reports change them.
    - **A tab whose leaving wasn't heard** runs out with nothing written, so
      no signal says so. The list is drawn again, too, as the first person
      it shows online would run out if nothing is heard from them first.
      The server says how long that is, by its own clock.
    - **On the screen:** the badge, and the Online and Offline filters, show
      what the server says now. What the person typed, their filters, page
      and where they'd scrolled stay. The rows aren't tinted
      (`DESIGN.md` §8, changed first, as the product owner chose): people
      come and go dozens of times a morning, and nobody changed the list.
      Joining draws once, as the other channels do.
  - **Turned down: Supabase Presence.** It needs no table, but a tab is seen
    only by joining the company's channel, and every tab there hears every
    other come and go, so a company's messages grow with the square of its
    size. At about 10 comings and goings a person a working day, that's
    about 550,000 messages a month for 50 people, 2.2 million for 100 and
    8.8 million for 200, against the free plan's 2 million a month for
    every company together, and its 20 Presence messages a second, which
    the morning's arrivals would pass.
  - **What it costs, a company of 200 with a tab each:** about 200,000
    calls a month to the server, where the 90-second heartbeat made about
    1.6 million; with 6b, about 90,000 messages a month. That's about 10
    comings and goings a person a working day, 44,000 signals a month,
    each counted once as it's sent and once for each screen listening:
    about 90,000 with one person watching all day.

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
- **2026-11-11:** Part 4 split into three PRs, the product owner choosing
  cash advances first: 4a cash advances, 4b costs and charges, 4c
  attendance. Part 4a built (#252): the Cash advances tab, a person's cash
  advance and My cash advance, Add cost's line about the advance, and an
  open Give advance, Record return or Correction window draw themselves
  again as the ledger changes, for the company's people and each Super
  Admin, and part 5's tint marks what someone else changed on the two
  lists. The person's own action now counts as theirs for as long as it's
  on its way, as a two-factor code can hold it longer than a signal is
  waited for; the Requests page's actions too.
- **2026-11-11:** A finding by Codex on #252, fixed in it: Record return
  or Correction, drawn again while open, lost a task or client picked
  under From once it was spent or moved elsewhere, and would have saved
  the amount typed against the running balance. The part picked now
  stays, holding nothing, until another is picked.
- **2026-11-11:** Two findings by Codex on #251, from its review after the
  merge, fixed in #253. A row that changed again within 2 seconds of the
  last showed only the end of its first fade: it now takes the same tint
  under another name, so it starts again. And the person's own action,
  refused, took the next draw as theirs, so what someone else changed in
  the next 10 seconds wasn't tinted: their page now says when their
  change is saved, and only then is the draw after it theirs.
- **2026-11-11:** A finding by Codex on #253, fixed in it: a change of the
  person's own, saved while another action of theirs was on its way, was
  kept past its own draw. That other action, refused, then left it to hide
  what someone else changed next. A draw now spends the change saved, as
  it spends a signal; only actions still on their way carry over.
- **2026-11-12:** Part 6, decided with the product owner: who's online
  comes from each tab saying when it comes and goes (6a, #262), and the
  badge is drawn again live (6b, Proposed). The heartbeat slows to every 15
  minutes with 6a. Supabase Presence was turned down for what it would
  cost as companies grow.
- **2026-11-12:** Part 6a merged in #262. Codex found five things in it.
  Four were fixed there: reports kept in order; signing out closing the
  browser's tabs on the server, then those already gone too; and a
  closing tab saying away even after an earlier away. The fifth, a new
  tab's first report racing another tab's sign-out, is left as a known
  limit, as the product owner chose.
- **2026-11-12:** Part 6b planned (#263): a channel for each company's
  comings and goings, `online:<company id>`, joined only while the
  Employees list or All users is open, and heard only by those who may see
  the list and the Super Admin. The database signals a tab coming, going,
  or coming back after its row ran out. The list is drawn again, too, as
  its first person online would run out unheard. The rows aren't tinted,
  as the product owner chose (`DESIGN.md` §8). One channel for every
  company was turned down for what it would cost.
