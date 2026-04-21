# Refactor Plan — Calendar + Notifications
**Date:** 2026-04-20
**Status:** DRAFT — awaiting approval

---

## Motivation

| File | Lines | Problem |
|------|-------|---------|
| `src/views/CalendarView.ts` | 2108 | Monolithic — 10+ distinct rendering concerns in one class |
| `src/notifications/NotificationManager.ts` | 420 | 10 trigger checks in one method, near-duplicate triggers, stats duplicated in panel |
| `src/views/NotificationPanelView.ts` | 233 | Re-scans all tickets for summary stats that NotificationManager already has |

---

## Phase A — Split CalendarView (High Priority)

### Target file layout

```
src/views/calendar/
  CalendarView.ts          ~400 lines  orchestration, header, toolbar, nav, filters
  CalendarWeekGrid.ts      ~600 lines  renderWeekGrid, renderDayGrid, renderTimedBlock, renderNowLine
  CalendarMonthGrid.ts     ~300 lines  renderMonthGrid, setupBarResize (month bars)
  CalendarSidebar.ts       ~200 lines  renderUnscheduledSidebar, renderMiniCalendar, openAutoSchedule
  CalendarDragDrop.ts      ~200 lines  setupDayDropZone, startAutoScroll, stopAutoScroll, setupBlockResize
  CalendarUtils.ts         ~350 lines  pure logic — no DOM, no plugin ref
```

`CalendarUtils.ts` contains every function that has zero DOM dependency:
- Date helpers: `dateOnlyMs`, `hasTime`, `getMonthWeeks`, `getWeekDays`, `getDayOfWeekIndex`, `isSameDay`, `getWeekRangeLabel`, `getVisibleRange`
- Layout engine: `buildOverlapLayout`, `isHiddenChild`, `expandRecurrences`
- Scheduler: `findFreeSlots`, `suggestSchedule`

### Coupling strategy

The rendering classes need access to shared view state (`draggedTicketId`, `_savedScrollTop`, `plugin`, `render`, etc.). Rather than threading dozens of parameters, each class takes a single `CalendarView` reference:

```ts
// CalendarWeekGrid.ts
export class CalendarWeekGrid {
  constructor(private view: CalendarView) {}

  render(container: HTMLElement, tickets: Ticket[], sprints: Sprint[]): void {
    // uses this.view.plugin, this.view.draggedTicketId, etc.
  }
}
```

This mirrors the existing pattern (`ListDragHandler`, `ListRowRenderer` both take their parent view as a constructor arg).

### Import path

The existing `import { CalendarView, CALENDAR_VIEW } from './CalendarView'` in `main.ts` still resolves to `src/views/calendar/CalendarView.ts` after moving — just update the path in main.ts and anywhere else that imports it. esbuild bundles everything so no runtime change.

### Steps

- [ ] A1. Create `src/views/calendar/` directory
- [ ] A2. Extract `CalendarUtils.ts` first (pure functions, no dependencies — easy win, no coupling issues)
- [ ] A3. Extract `CalendarDragDrop.ts` (interaction handlers; depends on view state but not on other render methods)
- [ ] A4. Extract `CalendarMonthGrid.ts` (self-contained rendering + its own bar resize)
- [ ] A5. Extract `CalendarSidebar.ts` (sidebar + mini calendar + auto-schedule bridge)
- [ ] A6. Extract `CalendarWeekGrid.ts` (largest chunk — week/day grid + timed blocks)
- [ ] A7. Slim down `CalendarView.ts` to orchestration only
- [ ] A8. Update imports in `main.ts` (CALENDAR_VIEW constant + CalendarView class)
- [ ] A9. Build clean; smoke-test all four view modes

---

## Phase B — NotificationManager DRY (Medium Priority)

### Problem 1: Repetitive trigger pattern in `checkProject`

All 10 trigger checks follow the exact same shape:

```ts
if (triggers['some_trigger']?.enabled) {
  for (const ticket of tickets.filter(someCondition)) {
    this.maybeAdd({ id: uid(), projectId, ticketId: ticket.id, type: 'some_trigger', ... });
  }
}
```

### Fix: rule registry in `NotificationRules.ts`

```ts
// src/notifications/NotificationRules.ts
export interface TriggerRule {
  type: string;
  check(ctx: ProjectCheckContext): Omit<StoredNotification, 'id' | 'createdAt' | 'dismissed' | 'read'>[];
}

export const TICKET_RULES: TriggerRule[] = [
  {
    type: 'ticket_due_today',
    check({ tickets, todayMs }) {
      return tickets
        .filter(t => t.dueDate && dayMs(t.dueDate) === todayMs)
        .map(t => ({ projectId: t.projectId, ticketId: t.id, type: 'ticket_due_today',
          title: `Due today: ${t.title}`, body: `...` }));
    },
  },
  // ... one entry per trigger type
];

export const SPRINT_RULES: TriggerRule[] = [ /* sprint_ending_soon, sprint_ends_today, etc. */ ];
export const PROJECT_RULES: TriggerRule[] = [ /* project_idle, project_overdue_tickets, etc. */ ];
```

`checkProject` becomes:

```ts
private checkProject(...): void {
  const ctx = this.buildContext(projectId, triggers);
  for (const rule of [...TICKET_RULES, ...SPRINT_RULES, ...PROJECT_RULES]) {
    if (!triggers[rule.type]?.enabled) continue;
    for (const partial of rule.check(ctx)) {
      this.maybeAdd({ id: uid(), createdAt: now, dismissed: false, read: false, ...partial });
    }
  }
}
```

This makes adding or removing trigger types a one-file change with zero risk of forgetting to wire up the enabled check.

### Problem 2: Duplicate triggers

`sprint_none_active` (line 226) and `project_no_active_sprint` (line 309) fire for the exact same condition (no active sprint on a project). They produce near-identical notifications. One should be removed — `sprint_none_active` is the better-named one and should be kept. `project_no_active_sprint` should be deleted from both the rule registry and `types.ts` trigger keys.

**Verify first:** check if settings data already stored under `project_no_active_sprint` key needs a migration shim.

### Problem 3: Summary stats duplicated in NotificationPanelView

`renderSummaryBanner()` independently iterates all projects + tickets to count overdue/dueToday/endingSoon. NotificationManager already sees this data during `checkAll()`.

### Fix: expose computed stats from NotificationManager

```ts
// NotificationManager.ts
private _lastStats: { overdue: number; dueToday: number; endingSoon: number } = { overdue: 0, dueToday: 0, endingSoon: 0 };

getSummaryStats() { return this._lastStats; }
```

Update during `checkAll()`. `renderSummaryBanner()` then calls `this.plugin.notificationManager?.getSummaryStats()` instead of re-scanning.

### Steps

- [ ] B1. Create `src/notifications/NotificationRules.ts` with rule registry
- [ ] B2. Refactor `checkProject()` to use the registry — verify output is identical before/after
- [ ] B3. Remove `project_no_active_sprint` trigger (after confirming with Mikha — this changes stored settings shape)
- [ ] B4. Add `getSummaryStats()` to NotificationManager; update `renderSummaryBanner` to use it
- [ ] B5. Build clean

---

## What NOT to refactor

- `NotificationPanelView.ts` — 233 lines, focused, leave as-is
- `AutoScheduleModal.ts` — small modal, leave as-is
- Drag/drop on month view bars (`setupBarResize`) — keep co-located with `CalendarMonthGrid` since it's tightly coupled to bar DOM elements

---

## Risk assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| CalendarView split | Medium — lots of cross-references | Extract pure utils first; build after each step |
| Rule registry refactor | Low — purely internal refactor | Compare notification output before/after in dev |
| Removing duplicate trigger | Low-Medium — settings key change | Add migration in `store/migrate.ts` if needed |
| Summary stats caching | Low | Stats computed at same time as checkAll, always fresh |
