# Notification System — Implementation Plan
**Status:** Pending approval
**Date:** 2026-04-14

---

## Overview

A full notification system for ProjectFlow with:
- OS-level notifications (Electron)
- Dedicated sidebar notification panel (leaf view)
- Ribbon icon with badge count
- Global settings in plugin Settings tab
- Per-project settings modal (bell icon next to edit button)
- Per-trigger-type toggles + configurable thresholds
- Actions: Open Ticket, Go to Board, Open Sprint, Snooze, Dismiss

---

## Trigger Types

| ID | Name | Configurable threshold |
|----|------|----------------------|
| `ticket_due_today` | Ticket due today | — |
| `ticket_due_approaching` | Ticket due date approaching | Days before (default: 2) |
| `ticket_overdue` | Ticket overdue | — |
| `ticket_stale_in_progress` | Ticket stale in progress | Days threshold (default: 5) |
| `ticket_no_due_date` | Ticket has no due date | — |
| `ticket_no_sprint` | Ticket has no sprint assigned | — |
| `sprint_ending_soon` | Sprint ending soon | Days before (default: 2) |
| `sprint_ends_today` | Sprint ends today | — |
| `sprint_overdue` | Sprint overdue | — |
| `sprint_completed` | Sprint completed | — |
| `sprint_started` | New sprint started | — |
| `sprint_none_active` | No active sprint for project | — |
| `project_overdue_tickets` | Project has overdue tickets (digest) | — |
| `project_idle` | Project idle | Days threshold (default: 7) |
| `project_no_active_sprint` | Project has no active sprint | — |
| `startup_digest` | Summary on Obsidian load | — |
| `daily_digest` | Daily summary while Obsidian is open | Time (default: 09:00) |
| `ticket_reminder` | Per-ticket reminder before start or due time | Offset defined per ticket |

---

## Data Model Changes

### `src/types.ts`

```typescript
type NotificationTriggerType =
  | 'ticket_due_today' | 'ticket_due_approaching' | 'ticket_overdue'
  | 'ticket_stale_in_progress' | 'ticket_no_due_date' | 'ticket_no_sprint'
  | 'sprint_ending_soon' | 'sprint_ends_today' | 'sprint_overdue'
  | 'sprint_completed' | 'sprint_started' | 'sprint_none_active'
  | 'project_overdue_tickets' | 'project_idle' | 'project_no_active_sprint'
  | 'startup_digest' | 'daily_digest';

interface NotificationTriggerConfig {
  enabled: boolean;
  daysBeforeDue?: number;       // ticket_due_approaching
  staleThresholdDays?: number;  // ticket_stale_in_progress
  daysBeforeSprintEnd?: number; // sprint_ending_soon
  idleThresholdDays?: number;   // project_idle
  dailyDigestTime?: string;     // HH:MM — daily_digest
}

interface SnoozeInterval {
  label: string;  // display name, e.g. "1 hour"
  minutes: number; // duration in minutes
}

interface NotificationSettings {
  enabled: boolean; // global master toggle
  snoozeIntervals: SnoozeInterval[]; // user-configurable, default: [{label:'1 hour',minutes:60},{label:'Tomorrow',minutes:0},{label:'3 days',minutes:4320}]
  triggers: Record<NotificationTriggerType, NotificationTriggerConfig>;
}

interface ProjectNotificationSettings {
  useGlobal: boolean; // if true, ignore triggers below and use global
  triggers: Partial<Record<NotificationTriggerType, NotificationTriggerConfig>>;
}

interface TicketReminder {
  id: string;
  anchor: 'start' | 'due'; // relative to startDate or dueDate
  offsetMinutes: number;    // how many minutes before the anchor to fire
  snoozeIntervals?: SnoozeInterval[]; // per-reminder override; falls back to ticket-level, then global
}
// Added to Ticket:
//   reminders?: TicketReminder[]
//   snoozeIntervals?: SnoozeInterval[]  — ticket-level default for all reminders on this ticket

interface StoredNotification {
  id: string;
  projectId: string;
  ticketId?: string;
  sprintId?: string;
  type: NotificationTriggerType;
  title: string;
  body: string;
  createdAt: number;
  snoozedUntil?: number;
  dismissed: boolean;
  read: boolean;
}
```

**Add to `AppData`:**
- `notificationSettings: NotificationSettings`
- `notifications: StoredNotification[]`

**Add to `Project`:**
- `notificationSettings?: ProjectNotificationSettings`

**Add to `Ticket`:**
- `reminders?: TicketReminder[]`
- `snoozeIntervals?: SnoozeInterval[]` — ticket-level snooze defaults, overrides global for all reminders on this ticket

---

## New Files

### `src/notifications/NotificationManager.ts`
Core engine. Responsibilities:
- On plugin load: run startup digest
- Interval check every 5 minutes (while Obsidian is open)
- For each active project, resolve effective settings (project override vs global)
- Run evaluator per enabled trigger type
- Deduplicate: skip if same `projectId + ticketId/sprintId + type` notification exists within 24h and is not dismissed
- Save new `StoredNotification` to store
- Fire OS notification via `new window.Notification(title, { body })`
- Call `updateBadge()` after each check cycle

**Key methods:**
```
checkAll()               — full pass across all projects + ticket reminders
checkProject(project)    — evaluates all triggers for one project
checkTicketReminders()   — evaluates all tickets with reminders[] across all projects
fireOS(notification)     — sends Electron Notification
updateBadge()            — counts unread, updates ribbon badge
snooze(id, until)        — sets snoozedUntil
dismiss(id)              — sets dismissed: true
markRead(id)             — sets read: true
```

**Ticket reminder evaluation logic:**
- For each ticket with `reminders[]`:
  - Skip if ticket is archived or done
  - For each reminder: compute `fireAt = anchor timestamp - offsetMinutes * 60000`
  - If `now >= fireAt` and no existing non-dismissed notification for `ticketId + reminderId`: fire
  - Dedup key: `ticket_reminder + ticketId + reminder.id`

### `src/modals/ProjectNotificationModal.ts`
Per-project notification settings modal.

Layout:
- Header: "Notifications — [Project Name]"
- Toggle: "Use global settings" (default: on). When off, reveals per-type settings.
- Sections (Ticket / Sprint / Project / Digest), each with trigger rows
- Each row: toggle + inline threshold input where applicable
- Footer: Cancel / Save

### `src/views/NotificationPanelView.ts`
Sidebar leaf view (`VIEW_TYPE = 'pf-notifications'`).

Layout:
- Header: "Notifications" + "Mark all read" button + "Clear dismissed" button
- Notifications grouped: **Today** / **Earlier**
- Per notification card:
  - Icon for trigger type
  - Title (bold) + body text
  - Project tag chip (colored dot)
  - Timestamp (relative: "2h ago")
  - Action buttons: **Open Ticket** | **Go to Board** | **Open Sprint** | **Snooze ▾** | **Dismiss**
  - Snooze dropdown: 1 hour / Tomorrow / In 3 days
- Empty state when no active notifications

### `styles/notifications.css`
All styles for the panel and notification cards.

---

## Modified Files

| File | Change |
|------|--------|
| `src/types.ts` | Add all new types above |
| `src/store.ts` | Add `getNotifications()`, `addNotification()`, `updateNotification()`, `clearDismissed()`, `getNotificationSettings()`, `saveNotificationSettings()`, `getProjectNotificationSettings()`, `saveProjectNotificationSettings()` |
| `src/main.ts` | Instantiate `NotificationManager`, register `NotificationPanelView` leaf, add ribbon bell icon with badge, request OS notification permission on load |
| `src/settings.ts` | Add global notification settings section with master toggle + per-trigger-group settings |
| `src/views/BoardPanelView.ts` | Add bell icon button next to the edit (pencil) button; clicking opens `ProjectNotificationModal` |
| `src/modals/TicketModal.ts` | Add "Reminders" section: per-ticket snooze intervals (add/edit/remove rows) + per-reminder rows with anchor (start/due), offset, and optional snooze override |
| `styles/_index.txt` | Add `notifications.css` |

---

## Settings UI Layout

### Global (plugin Settings tab)
```
── Notifications ──────────────────────────────────
  Enable notifications          [toggle]

  Ticket notifications
    Due today                   [toggle]
    Due date approaching        [toggle]  Days before: [2]
    Overdue                     [toggle]
    Stale in progress           [toggle]  Days: [5]
    No due date set             [toggle]
    No sprint assigned          [toggle]

  Sprint notifications
    Ending soon                 [toggle]  Days before: [2]
    Ends today                  [toggle]
    Overdue                     [toggle]
    Completed                   [toggle]
    Started                     [toggle]
    None active                 [toggle]

  Project notifications
    Has overdue tickets         [toggle]
    Idle project                [toggle]  Days: [7]
    No active sprint            [toggle]

  Digests
    Startup digest              [toggle]
    Daily digest                [toggle]  Time: [09:00]
```

### Per-project (ProjectNotificationModal)
```
  Use global settings           [toggle ON]

  ── when off, same layout as above but project-scoped ──
```

---

## Ribbon Badge

- Bell icon added to ribbon via `this.addRibbonIcon('bell', 'ProjectFlow notifications', ...)`
- Badge: small red circle with unread count overlaid on icon via CSS
- Badge hidden when count = 0
- Clicking opens/focuses the notification panel leaf

---

## Deduplication Rules

A notification is skipped if a non-dismissed notification of the same `type + projectId + ticketId/sprintId` already exists and was created within the last **24 hours**. This prevents the 5-min interval from spamming repeated notifications.

Exception: `startup_digest` and `daily_digest` fire at most once per calendar day.

---

## OS Notification Permission

On plugin load, call:
```typescript
if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission();
}
```
OS notifications are skipped silently if permission is `'denied'`.

---

## Snooze Behaviour

Snooze intervals are fully configurable in global settings. Each interval has a **label** and a **duration in minutes**.

**Special case:** `minutes: 0` is reserved for "Tomorrow" — resolved at runtime to the start of the next calendar day (00:00) rather than a fixed offset.

**Defaults:**
| Label | Minutes |
|-------|---------|
| 1 hour | 60 |
| Tomorrow | 0 (special) |
| 3 days | 4320 |

Users can add, remove, or edit any interval. Minimum 1 interval must remain. **Snooze interval resolution order (per notification):**
1. `reminder.snoozeIntervals` (per-reminder) — if set, use this
2. `ticket.snoozeIntervals` (per-ticket) — if set, use this
3. `notificationSettings.snoozeIntervals` (global) — fallback

The snooze dropdown in the notification card is dynamically built from the resolved intervals for that specific notification.

**Settings UI (global settings tab):**
```
Snooze intervals
  [1 hour]  [60 min]  [✕]
  [Tomorrow] [0]      [✕]
  [3 days]  [4320 min][✕]
  [+ Add interval]
```
Each row: label text input + minutes number input + remove button. "Tomorrow" (minutes=0) displays as "next midnight" in the UI.

Snoozed notifications are hidden from the panel and suppressed from OS notifications until `snoozedUntil` has passed. They then re-surface as unread.

---

## Implementation Order

1. `src/types.ts` — all new types + AppData/Project fields
2. `src/store.ts` — notification CRUD + settings helpers
3. `src/notifications/NotificationManager.ts` — core engine + evaluators
4. `src/views/NotificationPanelView.ts` — sidebar leaf
5. `styles/notifications.css` — panel styles
6. `src/modals/ProjectNotificationModal.ts` — per-project settings modal
7. `src/main.ts` — wire everything up, ribbon badge
8. `src/settings.ts` — global settings section
9. `src/views/BoardPanelView.ts` — bell button next to edit
10. `src/modals/TicketModal.ts` — Reminders section (add/remove per-ticket reminders)
11. `styles/_index.txt` — register new css file
12. Build + test
