# Implementation Decisions — Calendar Phase 2

## Code Facts (read from source, do not re-derive)

### CalendarView.ts (748 lines)
- `viewMode: 'month' | 'week'` — expand to `'month' | 'week' | 'day' | 'agenda'`
- `HOUR_HEIGHT = 64`, `HOURS = 0..23`, `WEEKDAY_LABELS = ['Mon'..'Sun']`
- `renderWeekGrid()` → builds day columns at lines 352–458; timed blocks per day at lines 438–448
- `renderTimedBlock(col, ticket, day)` → sets `block.style.top/height` via absolute px; segment types: single/start/middle/end
- `renderTicketChip(parent, ticket)` → used by month + sidebar + all-day row
- `setupDayDropZone(cell, day)` — keeps time when dragging between days
- `navigatePrev/Next` — month: -1 month, week: -7 days; need day: -1 day
- `getWeekDays(anchor)` returns Mon–Sun array of 7 Dates
- `dateOnlyMs(d)` → midnight timestamp; `hasTime(ts)` → non-midnight check
- `applyFilters(tickets)` — filter by type/priority/status
- Sidebar drop clears dueDate+startDate, then calls `render()` + `refreshAllViews()`

### types.ts
- `Ticket` interface ends at line 61 — add `recurrence?` after `dueDate?`
- `Project` interface ends at line 20 — add `color?: string` after `boardPriorityEdges?`
- `AppData.filterStates` is `Record<string, { type, priority, status, hasSubtasks? }>`

### main.ts
- Commands registered at lines 48–73 via `this.addCommand()`
- `refreshAllViews()` loops BOARD_VIEW, BACKLOG_VIEW, SPRINT_VIEW, CALENDAR_VIEW

### ProjectModal.ts
- Fields: name, description, cycleDays, tag, tagManuallyEdited, useSprints, autoCreateSprint, autoSpillover, autoArchiveDone
- Color field: add `private color = ''` + color picker input in `onOpen()` body; initialize from `project.color`
- Save in `submit()` alongside other project fields

### TicketModal.ts
- Fields: title, description, type, priority, status, points, startDate, dueDate
- Date section pattern at lines 220–275 — replicate for recurrence below dueDate section
- `submit()` calls `store.updateTicket` or `store.createTicket` with field bag

### store.ts (not fully read)
- `updateTicket(id, patch)`, `createTicket(data)`, `getTicket(id)`, `getTickets({projectId})`, `getSprints(projectId)`, `getChildTickets(ticketId)`, `getProjectStatuses(projectId)`, `getProject(id)`, `getProjects()`, `getActiveProjectId()`, `setActiveProject(id)`
- `getFilterState(key)` / `setFilterState(key, val)` — persist UI toggles

### CSS facts
- `.pf-cal-block` — `position: absolute; left: 3px; right: 3px; z-index: 2`
- `.pf-cal-week-day-col` — `position: relative; height: 1536px`
- `.pf-cal-chip` — used in month/sidebar/all-day
- Build: esbuild concatenates CSS from `styles/_index.txt`

---

## Phase-by-Phase Decisions

### Phase 1 — Week View Overlap (Option C)
**Approach:**
1. After collecting `dayTimed` tickets for a column, call `buildOverlapLayout(dayTimed)` which returns `Map<ticketId, {colIndex, colCount, childrenHidden: Ticket[]}>`.
2. Sort by startTime. Build clusters (tickets whose time ranges intersect).
3. Within cluster, separate parent-child pairs: parent gets full width (colIndex=0, colCount=1), children get `childrenHidden` list attached to parent.
4. Unrelated overlapping tickets: assign columns 0..N-1.
5. Pass layout info to `renderTimedBlock(col, ticket, day, layoutInfo?)`.
6. Block width: `left: calc(${colIndex/colCount*100}% + 3px); right: calc(${(1-colIndex/colCount-1/colCount)*100}% + 3px)` — simpler: set width explicitly.
7. Parent with children: add `.pf-cal-child-badge` showing `+N`. Click toggles expanded children.

**CSS additions:** `.pf-cal-child-badge`, `.pf-cal-block-parent`, `.pf-cal-block-child`

### Phase 9 — Sprint Overlay Toggle
- Add `private showSprints = true` state on CalendarView
- Toolbar button with eye icon (text `👁` or `⊙` since no lucide import needed — use text `◉ Sprints` / `○ Sprints`)
- Wrap all `renderSprintBars()` calls + week stripe creation in `if (this.showSprints)` guards
- Persist with `store.setFilterState('cal-sprints', { type: showSprints ? 'on' : 'off', priority: 'all', status: 'all' })`

### Phase 7 — Keyboard Shortcuts
- `registerDomEvent(document, 'keydown', handler)` in `onOpen()`
- Guard: `if (this.app.workspace.getActiveViewOfType(CalendarView) !== this) return`
- Guard: `if (target is INPUT/TEXTAREA/SELECT/[contenteditable]) return`
- Keys: ArrowLeft=prev, ArrowRight=next, t=today, m=month, w=week, d=day, a=agenda, n=new ticket, Escape=close popovers
- Also add as Obsidian commands in main.ts: calendar-prev, calendar-next, calendar-today

### Phase 6 — Jump to Date Picker
- Click handler on `pf-view-title` h2 in `renderHeader()`
- Create popover div `.pf-cal-jump-popover` appended to the header row, positioned below the title
- Contains: `<input type="month">` (YYYY-MM) + Go button
- On Go: parse value → set `this.currentDate` → close popover → render
- Close on click-outside (document mousedown) or Escape
- `input[type=month]` value format: `2026-04`

### Phase 5 — Day View
- Extend `viewMode` type: `'month' | 'week' | 'day' | 'agenda'`
- Add "Day" button in mode toggle group (after Month/Week)
- `renderDayGrid(container, tickets, sprints)` — same structure as week grid but single column, full width
- Navigation in day mode: ±1 day
- Header title: `this.currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })`
- Block shows description preview and checklist `N/M` count when tall enough (height > 80px)

### Phase 4 — Mini Calendar
- `renderMiniCalendar(container)` called at top of `renderUnscheduledSidebar()` — inserts before the list
- Compact 7×6 grid, only day numbers, 7-col CSS grid
- Click day → set `currentDate` to that date, switch to day view (if week/day mode) or just navigate month
- Dot indicator on days that have scheduled tickets
- Mini calendar tracks its own displayed month separately? No — use `currentDate`'s month
- Mini nav arrows: prev/next month for the mini calendar only → store `private miniCalMonth: Date`

### Phase 10 — Agenda View
- `viewMode = 'agenda'` — no grid, scrollable list
- `renderAgendaView(container, tickets)` 
- Shows tickets with dueDate, sorted by dueDate asc, grouped by calendar date
- Overdue: dueDate < today → grouped at top as "Overdue" in red
- Range: next 30 days + overdue
- Each item: time bubble | type badge | title | priority edge color | status badge
- Click → TicketModal
- Inline done checkbox → updateTicket status to first status with id='done'

### Phase 3 — Project Colors
- Add `color?: string` to Project interface
- ProjectModal: add `private color = ''`; color input `<input type="color">` in body
- Default: cycle through palette `['#4c9be8','#e8854c','#4ce87a','#e84c9b','#9b4ce8','#e8d44c']` based on project count
- CalendarView: when rendering chips/blocks, if `project.color` exists, use it as `border-left-color` override
- Apply via inline style: `chip.style.borderLeftColor = project.color`
- "All projects" mode: add option to project switcher; when selected, `projectId = 'all'`, get tickets from all projects

### Phase 2 — Recurring Tickets
- Add to Ticket: `recurrence?: { rule: 'daily'|'weekly'|'monthly'|'custom'; interval: number; endDate?: number; customDays?: number[] }`
- TicketModal: recurrence section below due date; only visible when dueDate set
- CalendarView: `expandRecurrences(tickets, rangeStart, rangeEnd)` → generate ghost instances
- Ghost = spread copy of ticket with adjusted dueDate/startDate; `isGhost: true` flag added locally (not stored)
- Ghost click → opens TicketModal for original ticket
- Ghost CSS: dashed border (`.pf-cal-chip-ghost`, `.pf-cal-block-ghost`)
- Cross-view: ↻ icon on board cards, list rows, subtask rows
- ticketNote.ts: add `recurrence:` to frontmatter
- noteSyncWatcher.ts: parse recurrence from frontmatter

### Phase 8 — Auto-schedule
- Button "Auto-schedule" in sidebar header
- `findFreeSlots(day, existingBlocks)`: 09:00–17:00 working hours, return gaps
- `suggestSchedule(unscheduled, freeSlots)`: assign by priority, duration = points*60min or 60min default
- New `AutoScheduleModal` confirms assignments
- "Schedule to calendar" button also in Backlog panel view

---

## Calendar Ticket Visibility Rule (2026-04-07)
Only **board-visible** tickets appear in the calendar's unscheduled sidebar and are eligible for auto-schedule.
- **Sprint mode** (`useSprints !== false`): ticket must have `sprintId !== null` (assigned to a sprint)
- **No-sprint mode** (`useSprints === false`): ticket must have `showOnBoard === true`
- Archived tickets are always excluded (already filtered before this check)
- Rationale: backlog and archive tickets are not active work and should not pollute the calendar scheduler

Implemented in `render()` via `boardTickets` filter in `src/views/CalendarView.ts`.

## Implementation Order
P1 → P9 → P7 → P6 → P5 → P4 → P10 → P3 → P2 → P8

## Files to Modify (summary)
| File | Phases |
|------|--------|
| src/types.ts | P2 (recurrence), P3 (color) |
| src/views/CalendarView.ts | ALL |
| src/modals/ProjectModal.ts | P3 |
| src/modals/TicketModal.ts | P2 |
| src/modals/AutoScheduleModal.ts | P8 (NEW) |
| src/main.ts | P7 (commands) |
| src/ticketNote.ts | P2 |
| src/noteSyncWatcher.ts | P2 |
| src/views/BoardPanelView.ts | P2 (↻ icon) |
| src/views/ListRowRenderer.ts | P2 (↻ icon) |
| styles/calendar.css | ALL |

## Status (last updated 2026-04-07 — ALL COMPLETE, build ✅)
- Phase 1: COMPLETE — buildOverlapLayout(), isHiddenChild(), BlockLayout interface, CSS
- Phase 2: COMPLETE — recurrence on Ticket/types, TicketModal UI, expandRecurrences(), ghost blocks, ↻ icons, ticketNote+noteSyncWatcher
- Phase 3: COMPLETE — color on Project/types, ProjectModal color picker + auto-palette, inline style on chips/blocks
- Phase 4: COMPLETE — renderMiniCalendar(), miniCalMonth state, dot indicators, click-to-navigate
- Phase 5: COMPLETE — renderDayGrid(), 'day' viewMode, day navigation, overlap support
- Phase 6: COMPLETE — openJumpToDate(), pf-cal-jump-popover, click on h2.pf-view-title
- Phase 7: COMPLETE — registerDomEvent keydown in onOpen(), main.ts calendar-prev/next/today commands
- Phase 8: COMPLETE — AutoScheduleModal, findFreeSlots(), suggestSchedule(), ⚡ Schedule button in sidebar
- Phase 9: COMPLETE — showSprints state, ◉/○ toolbar button, guards in renderSprintBars + week/day stripe
- Phase 10: COMPLETE — renderAgendaView(), overdue+upcoming grouped by date, 'agenda' viewMode
