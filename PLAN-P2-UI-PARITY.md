# UI parity plan — ONE shell mirrors cloud Roster + Thread + Composer

Problem: TeamChat grew its own roster sidebar, bot creation is a bare
name/role form (no chief, no color/shape), and the thread looks nothing
like cloud's. Fix: the main sidebar owns the roster (cloud `Roster`
pattern), creation matches `NewBotModal` semantics, the thread matches
cloud bubbles. No `models.Bot` anywhere — everything stays file-backed.

## Phase A — team bot model (outer-sandbox server)

1. `TeamBotSchema` += `shape: enum(blob|circle|squircle|pebble)`,
   `isChiefOfStaff: boolean` (default false). `color` already exists —
   constrain to the 7 Mascot colors.
2. `saveTeamBot`: auto-assign a free color/shape combo (7×4 palette minus
   used, random from free — same rule as cloud `AppShell.createBot`)
   when the caller omits them.
3. One-chief enforcement server-side: saving `isChiefOfStaff: true`
   unsets it on all other bot files (rewrite + manifest update).
4. `toRosterEntry` unchanged (the agent loop needs id/name/role only).
5. Rebuild image? No — `npm run dev` serves `src/` via tsx; the image
   rebuilds only at the next publish. Note it in the publish checklist.

Acceptance: create 3 bots → distinct mascot combos; set a chief →
previous chief unset; history/threads untouched.

## Phase B — NewBotModal + chief (ONE frontend)

1. Port cloud `NewBotModal` → `components/shell/NewBotModal.tsx`
   (name-pool suggestion, chief checkbox, framer-motion + portal —
   both already installed). Copy: "Name your Bot".
2. `onCreate(name, isChief)`: `saveTeamBot({ name, isChiefOfStaff,
   role: isChief ? 'Chief of staff' : undefined })`. If a chief exists
   and the box is checked, the modal warns "replaces X as chief"
   (server does the unset).
3. Add `blinkDelay` to ONE `Mascot` (one prop, roster shimmer parity).
4. New deps: none.

Acceptance: modal suggests an untaken name, creates chief with star,
second chief replaces with warning, combos never collide.

## Phase C — roster moves to the main sidebar (ONE frontend)

1. New `components/shell/TeamRoster.tsx` mirroring `RosterItem`:
   Mascot md + name + chief star (`fill-bamber`) + subtitle (role, or
   last thread line) + busy dot while that bot has a run in flight.
   Active row = white card (`bg-white shadow-sm`), else hover.
2. `Sidebar.tsx`: replace the bot-slot placeholder with the roster +
   port the header actions (search toggle + new button open the modal)
   and a filter. Reuse cloud `RosterSearch` behavior (filter-as-you-type).
3. State lifts to `OneShell`: it owns `bots` + `selectedId` (ready-gated
   load + 5s retry net moves up from TeamChat), passes to both
   `Sidebar` (roster) and `TeamChat` (thread).
4. `TeamChat` becomes thread-only: props `{ bot, disabled,
   disabledHint }`. Delete its inner roster column + new-bot form.
5. New deps: none.

Acceptance: sidebar lists team with distinct mascots + stars; click
switches thread; search filters; new-bot button opens the modal;
no second sidebar anywhere.

## Phase D — thread + composer parity (ONE frontend)

1. Bubbles: user `ml-auto max-w-[85%] rounded-2xl rounded-br-sm
   bg-cta text-white`; assistant white card + rendered Markdown;
   typing-dots bubble while `busy`; container `max-w-2xl text-[15px]`.
2. Empty thread: greeting + suggestion cards (port cloud
   `CHIEF_SUGGESTION` / `MEMBER_SUGGESTION` + generic three; tap sends).
   Suggestions vanish after the first user message.
3. Header: name + role + `observed` badge + gear opening TrustCenter
   settings (ONE's equivalent of cloud's bot-settings panel).
4. Composer: keep input + send; send button shows spinner while busy;
   placeholder shows `disabledHint` when gated. Attachments, voice,
   skills/MCP pickers, @mentions: explicitly out (no backend for them).
5. Port cloud `Markdown.tsx` minus `VmImage` (plain `<img>`), with
   `react-markdown` + `remark-gfm` + `rehype-highlight` +
   `highlight.js` + github.css.

Acceptance: markdown reply (code block, list) renders styled; typing
indicator during runs; suggestions on empty thread send on tap;
busy dot on the roster row mirrors the run.

## Build order

A → B → C → D. A is server-only (no UI breakage); B–D are frontend-only
against the running local server. Full E2E: create chief + member from
the sidebar, distinct mascots, chat with a markdown reply, suggestions
on the empty thread, select from the sidebar, history persists.

## Explicitly out

Bot edit (color/shape/name changes post-create — cloud `BotEditModal`;
separate pass), bot delete, attachments/voice/skills/MCP, @mentions,
VmImage bearer images.
