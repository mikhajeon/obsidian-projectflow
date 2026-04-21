# CalendarView — Feature List & Decisions

This document is the single source of truth for what the CalendarView does and every design decision made. Use it to verify correctness after refactors or bug fixes.

---

## Architectural Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Standalone `ItemView`, NOT a tab in BoardView | User requirement: "different button, different screen" — must be independent of the 5-tab Board UI |
| D2 | Own ribbon icon (`calendar-days`) | Distinct from Board's `layout-dashboard` and Sprint's `calendar-range` icons |
| D3 | Own command (`open-calendar` / "Open calendar") | Accessible via command palette independently |
| D4 | New `dueDate?: number` field on `Ticket` | Tickets had no date field suitable for calendar placement; `createdAt`/`updatedAt`/`completedAt` are system-managed |
| D5 | `dueDate` is optional, defaults to `undefined` | No data migration needed; tickets without a due date show in "Unscheduled" sidebar |
| D6 | `dueDate` stored as unix ms with optional time component | Non-midnight = timed block in week/day view; midnight = all-day chip |
| D7 | `due: YYYY-MM-DD` (or `YYYY-MM-DD HH:mm`) in note frontmatter | Human-readable; parsed back to unix ms on sync via noteSyncWatcher |
| D8 | Month, Week, Day, Agenda views | Expanded from original Month+Week plan; Day and Agenda added in Phase 2 |
| D9 | Sprint ranges shown as 3px colored bars per day cell | Simpler than spanning bars across week boundaries; stacks when multiple sprints overlap |
| D10 | Max 3 ticket chips per day cell, then "+N more" | Prevents day cells from blowing out the fixed-height grid |
| D11 | Unscheduled sidebar (210px, right side) | Gives visibility to tickets without due dates; drop target to clear dates; mini calendar + done section |
| D12 | Project switcher in header (same as BoardView) | Calendar is project-scoped; reuses same dropdown pattern |
| D13 | Filters reuse existing type/priority/status pattern | Consistency with Board/Backlog filter UX |
| D14 | Only board-visible tickets appear in sidebar/scheduler | Backlog-only and archived tickets excluded: sprint mode = `sprintId !== null`; no-sprint mode = `showOnBoard === true` |

---

## Feature List — Phase 1 (original calendar, implemented before 2026-04-07)

### F1 — View Registration & Access
- [x] CalendarView registered as `projectflow-calendar` ItemView
- [x] Ribbon icon: `calendar-days` with tooltip "ProjectFlow calendar"
- [x] Command: `open-calendar` / "Open calendar"
- [x] Included in `refreshAllViews()` — updates when tickets change from other views
- [x] Detached in `onunload()`

### F2 — dueDate Field
- [x] `Ticket.dueDate?: number` (unix ms) added to interface
- [x] `Ticket.startDate?: number` (unix ms) also added — enables duration blocks in week/day view
- [x] TicketModal: date + time inputs for both start and due date, with clear buttons
- [x] TicketModal: `NewTicketContext.dueDate?: number` for pre-filling from calendar click
- [x] TicketModal: `dueDate` / `startDate` passed through on both create and update
- [x] ticketNote.ts: `due:` and `start:` frontmatter lines (only when set; includes time if non-midnight)
- [x] noteSyncWatcher.ts: parses `fm.due` and `fm.start` back to unix ms, includes in change detection

### F3 — Month View
- [x] 7-column CSS grid (Mon–Sun)
- [x] Weekday header row (Mon | Tue | Wed | Thu | Fri | Sat | Sun), sticky
- [x] 5–6 week rows covering the full month plus overflow days
- [x] Overflow days (outside current month) shown with reduced opacity
- [x] Today's cell highlighted with accent background + inset border
- [x] Day number displayed in each cell
- [x] Ticket chips placed on their `dueDate` day; sorted by time
- [x] "+N more" overflow when >3 chips on a single day; click expands
- [x] Multi-day tickets (startDate on different day than dueDate) rendered as spanning bars across week rows
- [x] Ticket tag (e.g. "DBA-42") hidden in month view chips to save space

### F4 — Week View
- [x] Time grid with 24-hour rows (64px per hour)
- [x] Sticky header row with day labels + dates (e.g. "Mon 7")
- [x] All-day row for tickets with no time component
- [x] Timed blocks positioned by startDate/dueDate with pixel-accurate top + height
- [x] Multi-day block segments (start/middle/end) for tickets spanning multiple days
- [x] Overlap handling: parent-child → parent full-width + `+N` badge; unrelated → column split
- [x] Click on hour slot → creates ticket with that time pre-filled
- [x] Scrolls to 8am on open

### F5 — Navigation
- [x] Previous (`‹`) / Today / Next (`›`) buttons
- [x] Month mode: ±1 month; Week mode: ±7 days; Day mode: ±1 day; Agenda mode: ±1 month
- [x] Title shows: month/year (month), week range (week), full weekday+date (day), month/year (agenda)
- [x] Title is clickable → opens jump-to-date month picker popover

### F6 — Ticket Chips
- [x] Type badge initial (T/B/S/E/Sub)
- [x] Ticket key hidden in month view; shown in week/day all-day row and sidebar
- [x] Title (truncated with ellipsis)
- [x] Time shown if due time is non-midnight
- [x] Priority-colored left border (overridden by project color if set)
- [x] `↻` icon for recurring tickets
- [x] Click opens TicketModal in edit mode
- [x] Draggable; visual feedback (opacity) while dragging
- [x] Ghost chip style (dashed border, striped) for recurrence instances

### F7 — Drag & Drop
- [x] Drag chip/block to different day cell → updates `dueDate` (preserves existing time); shifts `startDate` by same delta
- [x] Drag to unscheduled sidebar → clears both `dueDate` and `startDate`
- [x] Drag from unscheduled sidebar to day cell → assigns `dueDate`
- [x] Drop target highlight (accent background + inset border) on dragover
- [x] Calls `plugin.refreshAllViews()` after drop
- [x] Ghost/recurrence instances are not draggable

### F8 — Click to Create
- [x] Click empty area of month day cell → TicketModal with `dueDate` pre-filled (midnight)
- [x] Click hour slot in week/day grid → TicketModal with `dueDate` pre-filled to that hour
- [x] Click all-day column → TicketModal with midnight dueDate
- [x] Does not trigger when clicking on a chip/bar (propagation stopped)
- [x] Requires an active project to be selected

### F9 — Sprint Visualization
- [x] 3px colored bar at top of each day cell within a sprint's date range
- [x] Color by sprint status: planning=blue, active=green, completed=gray
- [x] Sprint name shown as tooltip
- [x] Multiple overlapping sprints stack
- [x] Sprint stripe also shown at top of week/day columns
- [x] Sprint overlay can be toggled off via `◉ Sprints` toolbar button

### F10 — Unscheduled Sidebar
- [x] 210px wide, right side, with border-left
- [x] Mini calendar at top (compact month grid with dot indicators)
- [x] "Unscheduled" section header with `⚡ Schedule` button (auto-schedule)
- [x] Active tickets listed (board-visible only: sprint-assigned or showOnBoard)
- [x] Done tickets in separate collapsible "Done (N)" section, collapsed by default, 60% opacity
- [x] Chips are draggable to day cells; sidebar acts as drop target to clear dates
- [x] Scrollable when list is long

### F11 — Filters
- [x] Type filter: All / Task / Bug / Story / Epic / Subtask
- [x] Priority filter: All / Critical / High / Medium / Low
- [x] Status filter: All / (project-specific statuses)
- [x] Filters apply to calendar grid and unscheduled sidebar

### F12 — Project Switcher
- [x] Dropdown in header showing all projects
- [x] Switching project re-renders calendar with that project's tickets/sprints
- [x] Edit project button (✎) beside dropdown

### F13 — Styling
- [x] All classes prefixed with `pf-cal-` or `pf-mini-cal-` or `pf-agenda-`
- [x] File: `styles/calendar.css` (concatenated into `styles.css` via `_index.txt`)
- [x] CSS tokens: `--pf-cal-today-bg`, `--pf-cal-outside-opacity`, `--pf-cal-drop-bg`, `--pf-cal-sprint-*`
- [x] Light and dark theme support via Obsidian CSS variables

---

## Feature List — Phase 2 (implemented 2026-04-07)

### P1 — Week View Overlap Handling ✅
- [x] `buildOverlapLayout()` — builds `Map<ticketId, BlockLayout>` per day column
- [x] Parent-child: parent renders full-width + `+N` badge; children hidden; click badge to expand/collapse
- [x] Unrelated overlapping: column-split (`100%/N` width each)
- [x] Applied to both week view and day view

### P2 — Recurring Tickets ✅
- [x] `Ticket.recurrence?: { rule, interval, endDate?, customDays? }` in types
- [x] TicketModal: recurrence section (rule dropdown, interval input, end date)
- [x] `expandRecurrences()` generates ghost instances within visible range
- [x] Ghost chips: dashed border, 75% opacity, not draggable, click opens original
- [x] Ghost blocks: diagonal stripe + dashed, click opens original
- [x] `↻` icon on chips, board cards, list rows
- [x] `recurrence:` frontmatter in ticketNote.ts; parsed in noteSyncWatcher.ts
- [ ] Custom weekday checkboxes in modal (field exists in type, no UI yet)
- [ ] ↻ icon in SubtasksPanelView and BacklogPanelView (not done)

### P3 — Project Color Coding ✅
- [x] `Project.color?: string` in types
- [x] ProjectModal: color picker + auto-palette (10-color cycle) for new projects
- [x] Chips and timed blocks use `border-left-color = project.color`
- [ ] "All projects" mode in project switcher (not done)
- [ ] Board card color border from project color (not done)

### P4 — Mini Calendar ✅
- [x] `renderMiniCalendar()` at top of sidebar
- [x] Independent `miniCalMonth` state; own prev/next navigation
- [x] Dot indicators on days with scheduled tickets
- [x] Click navigates to day (switches month view → day view)

### P5 — Day View ✅
- [x] `viewMode` = `'month' | 'week' | 'day' | 'agenda'`
- [x] `renderDayGrid()` — single-column, full-width time grid
- [x] "Day" button in toolbar; ±1 day navigation
- [x] Sprint stripe + overlap handling same as week view
- [ ] Description preview / checklist progress in tall blocks (not done)

### P6 — Jump to Date Picker ✅
- [x] Click `h2.pf-view-title` → `openJumpToDate()` → fixed popover
- [x] `<input type="month">` + Go button; navigates to chosen month
- [x] Closes on outside click or Escape

### P7 — Keyboard Shortcuts ✅
- [x] `←`/`→` prev/next, `t` today, `m`/`w`/`d`/`a` mode switch, `n` new ticket, `Esc` close popover
- [x] Guard: only fires when CalendarView is active leaf and focus not in input/textarea
- [x] Obsidian commands: `calendar-prev`, `calendar-next`, `calendar-today`

### P8 — Auto-schedule ✅
- [x] `⚡ Schedule` button in sidebar (when unscheduled tickets exist)
- [x] `findFreeSlots()`: next 7 days, 09:00–17:00, gaps ≥15 min
- [x] `suggestSchedule()`: priority order, duration = points × 1hr (min 1hr)
- [x] `AutoScheduleModal`: checkboxes per suggestion; accept applies `updateTicket` + regenerates note
- [ ] "Schedule to calendar" button in BacklogPanelView (not done)
- [ ] Configurable working hours (hardcoded 09–17)

### P9 — Sprint Overlay Toggle ✅
- [x] `◉ Sprints` / `○ Sprints` toolbar button
- [x] `showSprints` state guards all sprint rendering in month, week, and day views

### P10 — Agenda View ✅
- [x] `renderAgendaView()`: overdue (red header) + upcoming 60 days grouped by date
- [x] "Today" / "Tomorrow" labels; full weekday+date for others
- [x] Each item: time | type badge | key | title | status badge; click → TicketModal
- [x] Priority-colored left border per item
- [x] Respects same filters as other views
- [ ] Inline done checkbox (not done — use TicketModal instead)
- [ ] "Load more" button (simplified to flat 60-day window)

### Post-Phase-2 Additions ✅
- [x] Unscheduled sidebar: Done tickets in collapsible "Done (N)" section (60% opacity, collapsed by default)
- [x] Only board-visible tickets in sidebar: sprint mode = `sprintId !== null`; no-sprint = `showOnBoard === true`
- [x] Month view chip: ticket tag hidden (CSS `.pf-cal-week-cells .pf-cal-chip-key { display: none }`)

### Week/Day View — Drag-to-Reschedule & Edge Resize ✅ (2026-04-07)
- [x] Dropping a timed block on a week/day column sets time from mouse Y position (snapped to 15-min grid)
- [x] Drag time-snap indicator line shown in target column during dragover (with HH:MM label)
- [x] Month view and all-day row drops still use date-only logic (no time inference from Y)
- [x] Resize handles (top + bottom) on single-day timed blocks
- [x] Drag top handle up/down → adjusts `startDate`; drag bottom handle → adjusts `dueDate`
- [x] Live visual feedback: block re-shapes as handle is dragged; tooltip shows snapped time
- [x] 15-minute snap grid for resize; minimum 15-min block height enforced
- [x] Ghost/recurrence blocks: no resize handles, not resizable
- [x] Multi-day segments (start/middle/end): no resize handles (only `single` segment)
- [x] `pf-resizing` class on block during resize (opacity + z-index boost)

### Week/Day View — UX Improvements ✅ (2026-04-07)
- [x] **Ghost drag preview**: dragging a timed block shows a semi-transparent ghost block at the target position (matching ticket info + priority border) instead of a thin line indicator
- [x] **Drag guard**: click events on timed blocks suppressed for 300ms after any drag or resize ends — prevents accidental modal opens from click-drags
- [x] **Scroll preservation**: `_savedScrollTop` saved before `render()` on drop/resize; restored in `requestAnimationFrame` instead of defaulting to 8am
- [x] **Auto-scroll**: dragging near top/bottom 60px edge of `.pf-cal-timebody` auto-scrolls at 8px/frame (~60fps); works for both block drags and edge resize
- [x] **Subtask inset rendering**: child tickets whose dates overlap their parent render inset (offset 12px from left) on top of the parent block; no `+N` badge needed; parent-child pairs no longer split into separate columns
- [x] **Priority bar**: removed project color override on `border-left` — priority classes (critical/high/medium/low) always color the left border

---

## Known Gaps (not yet implemented)
- Custom weekday checkboxes for recurrence (type field exists, no modal UI)
- ↻ icon in SubtasksPanelView and BacklogPanelView
- Project color on board cards
- "All projects" mode in project switcher
- Auto-schedule button in BacklogPanelView
- Configurable working hours for auto-schedule
- Inline done checkbox in agenda view
