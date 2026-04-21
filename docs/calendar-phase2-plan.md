# CalendarView Phase 2 — Overlap Handling, New Views & Standard Features

> **Status: ALL PHASES COMPLETE** — Implemented 2026-04-07. Build: ✅ `npm run build` passes.

## Context

CalendarView (month + week) is already implemented with dueDate/startDate fields, drag-and-drop, multi-day spanning bars, and sprint visualization. This phase adds:

1. **Option C overlap handling** in week view (parent bubble + child badge; unrelated column split)
2. **9 standard calendar features** (recurring tickets, project colors, mini calendar, day view, jump-to-date, keyboard shortcuts, time-block suggestion, sprint overlay toggle, agenda view)
3. **Cross-view integration** — ensuring all new features connect to existing Board/Subtasks/List/Backlog/Archive views

---

## Phase 1 — Week View Overlap Handling (Option C) ✅ DONE

### What it does
- **Parent-child:** Parent block renders full width. If children overlap the same time range, a badge on the parent shows `+N subtasks`. Click expands to show children inline.
- **Unrelated overlaps:** Blocks with no parent-child relationship split the column width equally (Google Calendar style).

### What was actually implemented (vs plan)
- `buildOverlapLayout(tickets, day)` returns `Map<ticketId, BlockLayout>` where `BlockLayout = { colIndex, colCount, hiddenChildren }`
- `isHiddenChild(ticketId, layoutMap)` returns true when `colIndex === -1`
- `expandedParentIds: Set<string>` on CalendarView tracks which parents have been clicked open
- Badge click toggles expanded state and re-renders
- Column-split via `left: calc(N% + 3px); width: calc(N% - 6px)` inline style
- Applied to both week view **and** day view

### Files modified
- `src/views/CalendarView.ts` — `buildOverlapLayout()`, `isHiddenChild()`, updated `renderTimedBlock()`, updated `renderWeekGrid()`
- `styles/calendar.css` — `.pf-cal-child-badge`, `.pf-cal-block-parent`, `.pf-cal-block-child`

---

## Phase 2 — Recurring Tickets (Feature 1) ✅ DONE

### What was implemented
- `Ticket.recurrence?: { rule, interval, endDate?, customDays? }` added to `src/types.ts`
- TicketModal: recurrence section (rule dropdown None/Daily/Weekly/Monthly/Custom, interval input, end date input) below due date
- `expandRecurrences(tickets, rangeStart, rangeEnd)` generates ghost instances with `isGhost: true` and `originalId`
- Ghost chips: `.pf-cal-chip-ghost` (dashed border, 0.75 opacity); not draggable; click opens original ticket
- Ghost blocks: `.pf-cal-block-ghost` (diagonal stripe + dashed border); click opens original
- `↻` icon shown on chips (calendar), board cards (BoardPanelView), list rows (ListRowRenderer) — both occurrences
- `recurrence:`, `recurrence_interval:`, `recurrence_end:` frontmatter in ticketNote.ts
- noteSyncWatcher.ts parses these back and includes in change detection
- Ghost range is `getVisibleRange()` — month/agenda = current month + 1 extra month, week = 7 days, day = 1 day

### Deviations from plan
- Custom weekday checkboxes not added to modal (interval + end date only; `customDays` field exists in type but no UI yet)
- SubtasksPanelView and BacklogPanelView ↻ icons **not added** (only BoardPanelView + ListRowRenderer done)

### Files modified
- `src/types.ts`, `src/modals/TicketModal.ts`, `src/views/CalendarView.ts`, `src/ticketNote.ts`, `src/noteSyncWatcher.ts`, `src/views/BoardPanelView.ts`, `src/views/ListRowRenderer.ts`, `styles/calendar.css`

---

## Phase 3 — Project Color Coding (Feature 2) ✅ DONE

### What was implemented
- `Project.color?: string` added to `src/types.ts`
- ProjectModal: `Setting.addColorPicker()` with auto-palette for new projects (10-color cycle by project count)
- Calendar chips: `chip.style.borderLeftColor = project.color` (overrides priority color)
- Calendar timed blocks: `block.style.borderLeftColor = project.color`
- Color saved via `store.updateProject` and `store.createProject`

### Deviations from plan
- "All projects" mode in project switcher **not implemented** (scoped to active project only, as before)
- Board card left-border override from project color **not implemented** (only calendar chips/blocks)

### Files modified
- `src/types.ts`, `src/modals/ProjectModal.ts`, `src/views/CalendarView.ts`, `styles/calendar.css`

---

## Phase 4 — Mini Calendar (Feature 3) ✅ DONE

### What was implemented
- `renderMiniCalendar(container, scheduledTickets)` at top of unscheduled sidebar
- `miniCalMonth: Date` state — independent from main `currentDate`
- 7×6 grid, Mon–Sun, month nav arrows (`‹`/`›`)
- Dot indicator (3px circle) on days with scheduled tickets
- Click: sets `currentDate = day`; if in month view, switches to day view
- Today = accent color text + bold; selected = accent background; outside month = 35% opacity

### Files modified
- `src/views/CalendarView.ts` — `renderMiniCalendar()`, `miniCalMonth` state
- `styles/calendar.css` — `.pf-mini-cal-*` classes

---

## Phase 5 — Day View (Feature 4) ✅ DONE

### What was implemented
- `viewMode` extended: `'month' | 'week' | 'day' | 'agenda'`
- "Day" button in mode toggle toolbar
- `renderDayGrid(container, tickets, sprints)` — single column, full width, same hour grid as week
- All-day row at top; sprint stripe; hour click creates ticket; overlap handling via `buildOverlapLayout`
- Navigation: ±1 day (prev/next); title = full weekday + date
- Scrolls to 8am on open

### Deviations from plan
- Description preview / checklist progress in tall blocks **not implemented** (blocks show same content as week view)

### Files modified
- `src/views/CalendarView.ts` — `renderDayGrid()`, mode toggle, day navigation
- `styles/calendar.css` — `.pf-cal-day-view-header`, `.pf-cal-day-view-col`

---

## Phase 6 — Jump to Date Picker (Feature 5) ✅ DONE

### What was implemented
- `openJumpToDate(anchor)` called when clicking the `h2.pf-view-title` element
- Fixed-position `.pf-cal-jump-popover` with `<input type="month">` + Go button
- On Go: sets `currentDate`, switches to month view, closes popover
- Closes on outside mousedown or Escape key
- Cursor: pointer on title; title attribute "Click to jump to date"

### Files modified
- `src/views/CalendarView.ts` — `openJumpToDate()`, updated `renderHeader()`
- `styles/calendar.css` — `.pf-cal-jump-popover`, `.pf-cal-jump-trigger`

---

## Phase 7 — Keyboard Shortcuts (Feature 7) ✅ DONE

### What was implemented
| Key | Action |
|-----|--------|
| `←` / `→` | Navigate prev/next period |
| `t` | Jump to today |
| `m` | Switch to month view |
| `w` | Switch to week view |
| `d` | Switch to day view |
| `a` | Switch to agenda view |
| `n` | Open new ticket modal |
| `Escape` | Close jump-to-date popover |

- Registered via `this.registerDomEvent(document, 'keydown', ...)` in `onOpen()`
- Guard: only fires if `this.app.workspace.getActiveViewOfType(CalendarView) === this`
- Guard: skips if target is INPUT/TEXTAREA/SELECT or contenteditable
- Obsidian commands in `main.ts`: `calendar-prev`, `calendar-next`, `calendar-today`

### Deviations from plan
- No debounce (not needed — Obsidian handles this adequately)
- Commands use `(view as any).navigatePrev/Next/Today` — methods are private; acceptable for palette commands

### Files modified
- `src/views/CalendarView.ts` — keydown handler in `onOpen()`
- `src/main.ts` — 3 new commands

---

## Phase 8 — Time-Block Suggestion (Feature 8) ✅ DONE

### What was implemented
- `⚡ Schedule` button in sidebar header row (only shown when unscheduled tickets exist)
- `findFreeSlots(existingTimed)`: scans next 7 days, 09:00–17:00 working hours, returns gaps ≥15 min
- `suggestSchedule(unscheduled)`: sorts by priority (critical→high→medium→low), assigns to first fitting slot; duration = `points × 1hr` (min 1hr)
- `AutoScheduleModal` (`src/modals/AutoScheduleModal.ts`): lists suggestions with checkboxes; "Accept selected" applies via `updateTicket` + `generateTicketNote`
- `openAutoSchedule(tickets)` wires it all together

### Deviations from plan
- "Schedule to calendar" button in BacklogPanelView **not implemented**
- Working hours not configurable in settings (hardcoded 09–17)
- 15-minute minimum gap threshold (900000ms)

### Files modified / created
- `src/views/CalendarView.ts` — `openAutoSchedule()`, `findFreeSlots()`, `suggestSchedule()`, sidebar button
- `src/modals/AutoScheduleModal.ts` — **new file**
- `styles/calendar.css` — `.pf-cal-sidebar-header-row`, `.pf-cal-autosched-btn`, `.pf-autosched-*`

---

## Phase 9 — Sprint Overlay Toggle (Feature 9) ✅ DONE

### What was implemented
- `showSprints: boolean = true` state on CalendarView
- `◉ Sprints` / `○ Sprints` toolbar button (`.pf-cal-sprint-toggle`)
- Guards: `if (this.showSprints)` wraps all `renderSprintBars()` calls (month) and sprint stripe creation (week + day)
- No persistence (resets on reload — acceptable for a toggle)

### Deviations from plan
- Text button (`◉`/`○`) instead of eye icon (no lucide imports in CalendarView)
- State not persisted to `store.setFilterState` (not needed for simple toggle)

### Files modified
- `src/views/CalendarView.ts` — `showSprints` state, toolbar button, conditional rendering
- `styles/calendar.css` — `.pf-cal-sprint-toggle`

---

## Phase 10 — Agenda View (Feature 10) ✅ DONE

### What was implemented
- `viewMode = 'agenda'` — no grid, no sidebar
- `renderAgendaView(container, tickets)`: overdue section (red header) + upcoming 60 days grouped by date
- "Today" / "Tomorrow" labels for nearest dates; full weekday+date for others
- Each item: time bubble | type badge | key | title | status badge; click → TicketModal
- Priority-colored left border on each item (`.pf-priority-edge-*`)
- Ghost instances from `expandRecurrences()` included in agenda (consistent with other views)
- Navigation (prev/next) moves by 1 month in agenda mode

### Deviations from plan
- Range is 60 days (plan said 14 + "Load more") — simplified to flat 60-day window, no "Load more"
- No inline done checkbox (kept simpler — click item to open modal)

### Files modified
- `src/views/CalendarView.ts` — `renderAgendaView()`, mode toggle button
- `styles/calendar.css` — `.pf-agenda-*` classes

---

## Implementation Order (actual)

All phases implemented in a single session on 2026-04-07:

```
P1 → P9 → P7 → P6 → P5 → P4 → P10 → P3 → P2 → P8
```

Matched the planned order exactly.

---

## Cross-View Integration (actual vs plan)

| Feature | Calendar | Board | List | Subtasks | Backlog | Notes |
|---------|----------|-------|------|----------|---------|-------|
| Overlap (P1) | ✅ week+day | — | — | — | — | |
| Recurring (P2) | ✅ ghosts | ✅ ↻ icon | ✅ ↻ icon (both rows) | ❌ not done | ❌ not done | SubtasksPanelView + BacklogPanelView skipped |
| Project color (P3) | ✅ chips+blocks | ❌ not done | ❌ not done | — | — | Calendar only |
| Mini cal (P4) | ✅ sidebar | — | — | — | — | |
| Day view (P5) | ✅ | — | — | — | — | |
| Jump date (P6) | ✅ title click | — | — | — | — | |
| Shortcuts (P7) | ✅ | — | — | — | — | |
| Auto-schedule (P8) | ✅ sidebar btn | — | — | — | ❌ not done | Backlog "Schedule" button skipped |
| Sprint toggle (P9) | ✅ toolbar | — | — | — | — | |
| Agenda (P10) | ✅ | — | — | — | — | |

---

## Files Modified (actual)

| File | Phases | Notes |
|------|--------|-------|
| `src/types.ts` | P2, P3 | `recurrence` on Ticket, `color` on Project |
| `src/views/CalendarView.ts` | ALL | Main implementation file |
| `src/modals/TicketModal.ts` | P2 | Recurrence UI section |
| `src/modals/ProjectModal.ts` | P3 | Color picker + auto-palette |
| `src/modals/AutoScheduleModal.ts` | P8 | **New file** |
| `src/main.ts` | P7 | 3 calendar navigation commands |
| `src/ticketNote.ts` | P2 | Recurrence frontmatter |
| `src/noteSyncWatcher.ts` | P2 | Recurrence parse + change detection |
| `src/views/BoardPanelView.ts` | P2 | ↻ icon on cards |
| `src/views/ListRowRenderer.ts` | P2 | ↻ icon on both row types |
| `styles/calendar.css` | ALL | All new CSS |
| `docs/calendar-features.md` | — | Updated with P2 feature list |
| `docs/impl-decisions.md` | — | Updated with all decisions |

**Not modified (deviations):** `src/views/SubtasksPanelView.ts`, `src/views/BacklogPanelView.ts`, `styles/tokens.css`

---

## Verification Checklist

- [x] `npm run build` — no TS errors, 17 CSS files concatenated
- [ ] Reload Obsidian → confirm each view renders
- [ ] P1: Create parent + overlapping child ticket with same time → badge appears; click expands
- [ ] P1: Create 2 unrelated tickets same time → column split
- [ ] P2: Set recurrence on a ticket → ghost instances appear; ghost click opens original
- [ ] P2: ↻ icon visible on board cards and list rows
- [ ] P3: Set project color → chip left border changes color
- [ ] P4: Mini calendar renders in sidebar with dots; clicking day navigates
- [ ] P5: Click "Day" → single-column grid; ←/→ moves ±1 day
- [ ] P6: Click month/year title → popover with month picker
- [ ] P7: Press ← → t m w d a n keys while calendar is active
- [ ] P8: With unscheduled tickets → click ⚡ Schedule → modal shows suggestions → accept
- [ ] P9: Click ◉ Sprints → sprint bars disappear; click again → reappear
- [ ] P10: Click "Agenda" → flat list grouped by date, overdue in red
