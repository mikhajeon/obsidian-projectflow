# Notification Redesign + Calendar Multi-Day Bar Repositioning

**Date:** 2026-04-16
**Status:** Complete (all parts already implemented as of 2026-04-19 verification)

---

## Part 1: Notification Panel

### 1A. Remove digest notification types

**`src/types.ts`**
- Remove `'startup_digest' | 'daily_digest'` from `NotificationTriggerType` union (line 83)
- Remove `dailyDigestTime` from `NotificationTriggerConfig` (line 96)
- Remove `startup_digest` and `daily_digest` entries from `DEFAULT_NOTIFICATION_SETTINGS.triggers` (lines 157-158)

**`src/notifications/NotificationManager.ts`**
- Delete fields: `lastDailyDigestDate` (line 29), `startupDigestFired` (line 30)
- Delete methods: `fireStartupDigest()` (lines 369-399), `checkDailyDigest()` (lines 401-411)
- Remove startup/daily digest calls from `checkAll()` (lines 116-123)

**`src/settings.ts`**
- Remove the `'Digests'` trigger group (rows for `startup_digest`, `daily_digest`) around lines 273-277

**`src/modals/ProjectNotificationModal.ts`**
- Remove digest rows (lines 48-49)

---

### 1B. Add summary banner to NotificationPanelView

**`src/views/NotificationPanelView.ts`**

Add `renderSummaryBanner()` method. Call it from `render()` between the header and body divs.

Computes live counts across all projects:
- **Overdue**: non-archived, non-done tickets with `dueDate < now`
- **Due today**: tickets with dueDate within today's start/end bounds
- **Sprints ending soon**: active sprints with `endDate - now <= 2 * 86400000`

Renders a horizontal bar with three pills:
- `alert-circle` + overdue count → red when > 0
- `clock` + due-today count → accent when > 0
- `zap` + sprints-ending count → orange when > 0
- All pills dimmed/muted when count is 0
- If all zero: single "All clear" line with check icon

**`styles/notifications.css`**

New classes to add:
- `.pf-notif-summary` — flex row, padding `6px 12px`, `border-bottom: 1px solid var(--background-modifier-border)`, `gap: 8px`, `flex-shrink: 0`
- `.pf-notif-summary-pill` — `display: inline-flex`, `align-items: center`, `gap: 4px`, `font-size: var(--font-ui-smaller)`, `color: var(--text-muted)`
- `.pf-notif-summary-pill--overdue` — `color: var(--text-error)`
- `.pf-notif-summary-pill--today` — `color: var(--color-accent)`
- `.pf-notif-summary-pill--sprint` — `color: var(--color-orange)`
- `.pf-notif-summary-clear` — muted, small, centered, `color: var(--text-faint)`

---

### 1C. OS notification branding

**`src/notifications/NotificationManager.ts`** — `fireOS()` method (line 435)

```ts
// Before
new window.Notification(notification.title, { body: notification.body, silent: false });

// After
new window.Notification(`ProjectFlow: ${notification.title}`, { body: notification.body, silent: false, tag: 'projectflow' });
```

---

## Part 2: Calendar — Move Multi-Day Bars Below Day Numbers

### Context

Currently in month view:
- Multi-day bars are `position: absolute` on `pf-cal-week-cells`
- Positioned via `bar.style.top = lanes[i] * 20 + 2` (CalendarView.ts line 605)
- Day cells get `paddingTop = numLanes * 20 + 6` (line 524) to clear space for bars
- Result: bars sit **above** the day number; single-day chips sit **below** the day number

Goal: both multi-day bars and single-day chips sit **below** the day number.

### Changes

**`src/views/CalendarView.ts`** — `renderMonthGrid()` (lines 476-627)

1. **Remove** `barPaddingTop` calculation (line 524) and `cell.style.paddingTop` assignment (line 540)

2. **Build a per-cell bars map before rendering cells.** For each multi-day ticket in `overlapping`, determine its `colStart` for this week. Map `colStart → [{ticket, lane}]`.

3. **In the day cell loop**, after rendering `pf-cal-day-num`, create a `div.pf-cal-day-bars` container. Append bars for tickets whose `colStart` matches this cell's column index. Bars go into this container in lane order.

4. **Bar sizing**: bars still use `width: calc(spanCols/7 * 100% - 4px)` but now relative to `pf-cal-week-cells` width (7 columns). Since the bar is inside a cell that is `1/7` of the row, the width calc needs adjustment: `width: calc(${spanCols * 100}% - 4px)` relative to the cell width (cell = 1/7, so spanning N cols = N * cell width).

5. **Keep lane assignment** — lane order determines DOM insertion order within `.pf-cal-day-bars`, so bars in the same starting cell stack in the right order without needing absolute `top`.

**Updated cell DOM structure:**
```
.pf-cal-day
  span.pf-cal-day-num
  div.pf-cal-day-bars
    div.pf-cal-multiday-bar   ← bars whose start col = this cell
  div.pf-cal-day-tickets
    div.pf-cal-chip           ← single-day tickets
```

**`styles/calendar.css`**

```css
/* Remove from .pf-cal-multiday-bar */
position: absolute;   /* DELETE */

/* Add to .pf-cal-multiday-bar */
position: relative;
z-index: 3;

/* Add new */
.pf-cal-day-bars {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: visible;
}

/* Update .pf-cal-day */
overflow: visible;   /* was: overflow: hidden */
```

> **Note on z-index / overflow**: Setting `overflow: visible` on `.pf-cal-day` allows bars to visually extend into sibling cells. Neighbouring cells render on top by default so check that `z-index: 3` on bars is enough to stay visible. May need `overflow: visible` on `.pf-cal-week-cells` too.

---

## Verification Checklist

- [ ] `npm run build` — no TypeScript errors
- [ ] Reload Obsidian
- [ ] Notification Flow panel shows summary banner with correct counts
- [ ] No `startup_digest` / `daily_digest` cards appear
- [ ] Settings → Notifications → "Digests" section is gone
- [ ] OS notification title reads "ProjectFlow: ..."
- [ ] Month calendar: multi-day bars render below day numbers
- [ ] Single-day and multi-day tickets are both below the day number
- [ ] Overlapping multi-day bars don't collide
- [ ] Bars visually span correct columns
- [ ] Drag-and-drop works on bars
- [ ] Clicking a bar opens the ticket modal
