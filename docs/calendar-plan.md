# CalendarView — Implementation Plan

## Context

ProjectFlow's main UI is a single registered `BoardView` (`ItemView`) that contains **5 tabbed views**: Board, Subtasks, List, Backlog, and Archive. These are internal tabs (type `ViewMode = 'board' | 'backlog' | 'list' | 'parent' | 'archive'`) rendered by dedicated PanelView classes. Two additional standalone `ItemView`s exist (BacklogView, SprintPanelView) as legacy/alternate access points. A single ribbon icon (`layout-dashboard`) opens the BoardView.

There is currently no way to visualize tickets on a timeline. The calendar adds a **separate registered `ItemView`** with its own ribbon icon (`calendar-days`) and command — accessed independently from the 5-tab BoardView screen. A new `dueDate` field on tickets powers the placement, and sprint date ranges are shown as visual accents.

---

## Step 1 — Add `dueDate` to Ticket (`src/types.ts`)

- Add `dueDate?: number` (unix ms) to the `Ticket` interface, after `archivedAt`
- No data migration needed — optional field defaults to `undefined`

---

## Step 2 — Wire `dueDate` into TicketModal (`src/modals/TicketModal.ts`)

- Add `dueDate?: number` to `NewTicketContext` interface (line 7-14)
- Add a date input field in the modal form (after story points):
  - Use `new Setting(...)` with `.addText()` where `text.inputEl.type = 'date'`
  - Pre-fill from `ticket.dueDate` (edit) or `context.dueDate` (create)
  - Convert with `new Date(str).getTime()` -> store, `new Date(ts).toISOString().split('T')[0]` -> display
  - Include a "clear" button to unset
- Pass `dueDate` through in both `createTicket()` and `updateTicket()` calls

---

## Step 3 — Include `dueDate` in note sync (`src/ticketNote.ts`, `src/noteSyncWatcher.ts`)

**ticketNote.ts**: Add `due: YYYY-MM-DD` frontmatter line when `ticket.dueDate` is set

**noteSyncWatcher.ts**: Parse `fm.due` from frontmatter -> `new Date(String(fm.due)).getTime()` -> include in `updateTicket()` call and change-detection comparison

---

## Step 4 — Create `CalendarView` (`src/views/CalendarView.ts`)

### Class shape
```
CalendarView extends ItemView
  viewType: 'projectflow-calendar'
  icon: 'calendar-days'
  displayText: 'Calendar'

  State:
    viewMode: 'month' | 'week'
    currentDate: Date              (navigation anchor)
    draggedTicketId: string | null
    filterType / filterPriority / filterStatus

  Methods:
    render()                        -> clears container, calls sub-renders
    renderHeader(container)         -> project switcher, month/year title, nav arrows, Today btn, mode toggle, filters, "+ Ticket" btn
    renderMonthGrid(container, tickets, sprints)
    renderWeekGrid(container, tickets, sprints)
    renderUnscheduledSidebar(container, unscheduledTickets)
    renderTicketChip(parent, ticket) -> small draggable card
    setupDayDropZone(dayCell, date)
    applyFilters(tickets) -> filtered list
    getMonthWeeks(year, month) -> Date[][] (5-6 rows x 7 cols, Mon-start, includes overflow days)
    getWeekDays(anchor) -> Date[] (7 days)
    isSameDay / isToday / navigatePrev / navigateNext / navigateToday
```

### DOM structure (month view)
```
div.pf-cal-header
  div.pf-header-row         -> project switcher + "April 2026" + "+ Ticket" btn
  div.pf-cal-toolbar        -> [<] [Today] [>]  |  [Month] [Week]  |  filter dropdowns

div.pf-cal-content            -> flex row
  div.pf-cal-grid-wrap        -> flex: 1
    div.pf-cal-weekday-row    -> Mon | Tue | Wed | Thu | Fri | Sat | Sun
    div.pf-cal-grid           -> CSS grid 7 cols
      div.pf-cal-day          -> one per visible day (35-42 cells)
        div.pf-cal-sprint-bar -> 3px colored accent if day falls within a sprint range
        span.pf-cal-day-num   -> day number
        div.pf-cal-day-tickets -> ticket chips (max ~4, then "+N more")
          div.pf-cal-chip     -> draggable ticket chip
  div.pf-cal-sidebar          -> 220px, "Unscheduled" header + draggable chips
```

### Week view
Same grid but 1 row of 7 taller cells (`min-height: 300px`), chips show more detail.

### Interactions
| Action | Behavior |
|---|---|
| Click empty day | Open TicketModal with `dueDate` pre-filled |
| Click ticket chip | Open TicketModal in edit mode |
| Drag chip -> day | `updateTicket(id, { dueDate })` + regenerate note |
| Drag chip -> sidebar | Clear `dueDate` (set `undefined`) |
| Drag from sidebar -> day | Assign `dueDate` |
| < / > buttons | Shift month or week |
| Today button | Reset `currentDate` to now |
| Month / Week toggle | Switch `viewMode`, re-render |

### Sprint visualization
For each sprint overlapping the visible range, add a 3px colored bar at the top of each day cell within the range. Color: status-based (planning=blue, active=green, completed=gray). Sprint name as `title` tooltip. Multiple sprints = stacked bars.

### Overflow handling
Day cells get `max-height` with `overflow: hidden`. When >4 tickets on a day, show a "+N more" link that expands or opens a popover.

### Date normalization
All `dueDate` values normalized to noon local time (`new Date(y, m, d, 12, 0, 0).getTime()`) to avoid timezone day-shift issues.

---

## Step 5 — Register in plugin (`src/main.ts`)

- Import `CalendarView, CALENDAR_VIEW`
- `registerView(CALENDAR_VIEW, ...)`
- `addRibbonIcon('calendar-days', 'ProjectFlow calendar', ...)`
- `addCommand({ id: 'open-calendar', name: 'Open calendar', ... })`
- Add `CALENDAR_VIEW` to `refreshAllViews()` types array
- Add `detachLeavesOfType(CALENDAR_VIEW)` to `onunload()`

---

## Step 6 — Styles (`styles/calendar.css` + `styles/_index.txt`)

New file `calendar.css` with all `.pf-cal-*` classes. Add a few tokens to `tokens.css`:
- `--pf-cal-today-bg` (subtle accent for today cell)
- `--pf-cal-outside-opacity: 0.4` (days outside current month)
- `--pf-cal-drop-bg` (highlight on drag-over)

Add `calendar.css` to `_index.txt` before `misc.css`.

---

## Files Summary

| File | Action |
|---|---|
| `src/types.ts` | Add `dueDate?: number` |
| `src/modals/TicketModal.ts` | Add `dueDate` to `NewTicketContext`, add date input, pass through on save |
| `src/ticketNote.ts` | Add `due:` frontmatter |
| `src/noteSyncWatcher.ts` | Parse `due` from frontmatter |
| `src/views/CalendarView.ts` | **New** — ~400 lines |
| `styles/calendar.css` | **New** — calendar styles |
| `styles/tokens.css` | Add 3 calendar tokens |
| `styles/_index.txt` | Add `calendar.css` entry |
| `src/main.ts` | Register view, ribbon, command, refresh, unload |

---

## Verification

1. Build with `npm run build` — no TS errors
2. Reload Obsidian -> new calendar icon appears in left ribbon
3. Click icon -> CalendarView opens in a new leaf (separate from Board)
4. Create a ticket with a due date -> appears on the correct day cell
5. Drag a ticket chip to a different day -> dueDate updates, note frontmatter updates
6. Drag a scheduled ticket to sidebar -> dueDate cleared
7. Click empty day -> TicketModal opens with date pre-filled
8. Navigate months/weeks with arrows -> grid re-renders correctly
9. Sprint date ranges appear as colored bars on the correct days
10. Toggle month <-> week -> layout switches
11. Filter by type/priority/status -> chips filter correctly
12. Verify light and dark theme rendering
