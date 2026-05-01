export type TicketStatus = string;
export type TicketPriority = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type TicketType = 'task' | 'bug' | 'story' | 'epic' | 'subtask';
export type SprintStatus = 'planning' | 'active' | 'completed';

export interface Project {
	id: string;
	name: string;
	description: string;
	cycleDays: number;
	createdAt: number;
	tag: string;          // e.g. "DBA" — used as filename prefix
	ticketCounter: number; // increments with each new ticket, never resets
	statuses?: import('./statusConfig').StatusDefinition[];
	useSprints?: boolean;       // default true
	autoCreateSprint?: boolean; // default false
	autoSpillover?: boolean;    // default false
	autoArchiveDone?: boolean;  // default false — auto-archive 'done' tickets on sprint complete
	boardPriorityEdges?: boolean; // default true — show priority-coloured border edges on board cards
	color?: string;               // hex color for project, e.g. "#4c9be8"
	archived?: boolean;           // true = hidden from project selector and all active views
	archivedAt?: number;          // unix ms timestamp, set when project is archived
	notificationSettings?: ProjectNotificationSettings;
}

export interface Sprint {
	id: string;
	projectId: string;
	name: string;
	startDate: number;
	endDate: number;
	status: SprintStatus;
	goal?: string;
	retroNotes?: string;
}

export interface ChecklistItem {
	text: string;
	done: boolean;
}

export interface Ticket {
	id: string;
	projectId: string;
	sprintId: string | null;
	title: string;
	description: string;
	status: TicketStatus;
	priority: TicketPriority;
	type: TicketType;
	createdAt: number;
	updatedAt: number;
	order: number;
	backlogOrder: number;  // independent sort order for the backlog view
	ticketNumber: number;  // project-scoped sequential number, used in filename
	points?: number;
	checklist?: ChecklistItem[];
	parentId?: string | null;
	completedAt?: number;  // unix ms timestamp, set when status transitions to 'done'
	showOnBoard?: boolean; // no-sprint mode: true = ticket appears on Board/Subtasks views
	archived?: boolean;    // true = hidden from all active views, visible only in Archive tab
	archivedAt?: number;   // unix ms timestamp, set when ticket is archived
	startDate?: number;    // unix ms timestamp, optional start date/time (enables duration block in week view)
	dueDate?: number;      // unix ms timestamp, optional due date/time for calendar display
	reminders?: TicketReminder[];
	snoozeIntervals?: SnoozeInterval[];
	recurrence?: {
		rule: 'daily' | 'weekly' | 'monthly' | 'custom';
		interval: number;        // every N days/weeks/months
		endDate?: number;        // optional end (unix ms)
		customDays?: number[];   // for 'custom': 0=Sun..6=Sat
	};
}

// ── Notification system ───────────────────────────────────────────────────────

export type NotificationTriggerType =
	| 'ticket_due_today' | 'ticket_due_approaching' | 'ticket_overdue'
	| 'ticket_stale_in_progress' | 'ticket_no_due_date' | 'ticket_no_sprint'
	| 'sprint_ending_soon' | 'sprint_ends_today' | 'sprint_overdue'
	| 'sprint_completed' | 'sprint_started' | 'sprint_none_active'
	| 'project_overdue_tickets' | 'project_idle' | 'project_no_active_sprint'
	| 'ticket_reminder';

export interface SnoozeInterval {
	label: string;    // display name e.g. "1 hour"
	minutes: number;  // 0 = special "Tomorrow" sentinel (next midnight)
}

export interface NotificationTriggerConfig {
	enabled: boolean;
	daysBeforeDue?: number;       // ticket_due_approaching
	staleThresholdDays?: number;  // ticket_stale_in_progress
	daysBeforeSprintEnd?: number; // sprint_ending_soon
	idleThresholdDays?: number;   // project_idle
}

export interface NotificationSettings {
	enabled: boolean;
	snoozeIntervals: SnoozeInterval[];
	triggers: Record<NotificationTriggerType, NotificationTriggerConfig>;
}

export interface ProjectNotificationSettings {
	useGlobal: boolean;
	triggers: Partial<Record<NotificationTriggerType, NotificationTriggerConfig>>;
}

export interface TicketReminder {
	id: string;
	anchor: 'start' | 'due';
	offsetMinutes: number;
	snoozeIntervals?: SnoozeInterval[];
}

export interface StoredNotification {
	id: string;
	projectId: string;
	ticketId?: string;
	sprintId?: string;
	reminderId?: string;
	type: NotificationTriggerType;
	title: string;
	body: string;
	createdAt: number;
	snoozedUntil?: number;
	dismissed: boolean;
	read: boolean;
}

export const DEFAULT_SNOOZE_INTERVALS: SnoozeInterval[] = [
	{ label: '1 hour', minutes: 60 },
	{ label: 'Tomorrow', minutes: 0 },
	{ label: '3 days', minutes: 4320 },
];

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
	enabled: true,
	snoozeIntervals: DEFAULT_SNOOZE_INTERVALS,
	triggers: {
		ticket_due_today:          { enabled: true },
		ticket_due_approaching:    { enabled: true, daysBeforeDue: 2 },
		ticket_overdue:            { enabled: true },
		ticket_stale_in_progress:  { enabled: true, staleThresholdDays: 5 },
		ticket_no_due_date:        { enabled: false },
		ticket_no_sprint:          { enabled: false },
		sprint_ending_soon:        { enabled: true, daysBeforeSprintEnd: 2 },
		sprint_ends_today:         { enabled: true },
		sprint_overdue:            { enabled: true },
		sprint_completed:          { enabled: true },
		sprint_started:            { enabled: true },
		sprint_none_active:        { enabled: false },
		project_overdue_tickets:   { enabled: true },
		project_idle:              { enabled: false, idleThresholdDays: 7 },
		project_no_active_sprint:  { enabled: false },
		ticket_reminder:           { enabled: true },
	},
};

export interface CalendarCardAppearance {
	typeBadge: boolean;
	priorityEdge: boolean;
	timeDisplay: boolean;
	projectDot: boolean;
	recurrenceIcon: boolean;
	ticketKey: boolean;
	statusBadge: boolean;
}

export const DEFAULT_CALENDAR_CARD_APPEARANCE: CalendarCardAppearance = {
	typeBadge: true,
	priorityEdge: true,
	timeDisplay: true,
	projectDot: true,
	recurrenceIcon: true,
	ticketKey: true,
	statusBadge: true,
};

export type CalendarViewMode = 'month' | 'week' | 'day' | 'agenda';

export type CalendarViewAppearance = Record<CalendarViewMode, CalendarCardAppearance>;

export interface BoardCardAppearance {
	typeIcon: boolean;       // type icon (◈⛋𓆣⚑⧉)
	priorityBadge: boolean;  // priority text badge
	priorityEdge: boolean;   // colored left border
	points: boolean;         // points badge
	description: boolean;    // description text
	recurrenceIcon: boolean; // ↻ on recurring tickets
	checklist: boolean;      // checklist progress
	subtaskCount: boolean;   // ⧉ N/M subtasks (board view)
	parentLabel: boolean;    // parent ticket label (subtasks-only view)
}

export const DEFAULT_BOARD_CARD_APPEARANCE: BoardCardAppearance = {
	typeIcon: true, priorityBadge: true, priorityEdge: true,
	points: true, description: true, recurrenceIcon: true,
	checklist: true, subtaskCount: true, parentLabel: true,
};

export interface AppData {
	projects: Project[];
	sprints: Sprint[];
	tickets: Ticket[];
	activeProjectId: string | null;
	baseFolder: string;
	colWidths?: Record<string, Record<string, number>>;
	tabOrder?: string[];
	sortOrders?: Record<string, string>;  // viewKey -> sort field, e.g. 'board' -> 'priority'
	boardGrouping?: string;               // 'default' | 'by-parent' | 'subtasks-only'
	filterStates?: Record<string, { type: string; priority: string; status: string; hasSubtasks?: boolean }>;
	boardColWidth?: Record<string, number>; // viewKey -> column width in px
	hiddenBoardColumns?: Record<string, string[]>; // projectId -> array of hidden status IDs
	collapsedBoardColumns?: Record<string, string[]>; // projectId -> array of collapsed status IDs
	calendarProjectIds?: string[];  // project IDs visible in Calendar Flow; null = active project only
	calendarCardAppearance?: Partial<CalendarViewAppearance>;
	boardCardAppearance?: BoardCardAppearance;
	notificationSettings?: NotificationSettings;
	notifications?: StoredNotification[];
}

export const DEFAULT_DATA: AppData = {
	projects: [],
	sprints: [],
	tickets: [],
	activeProjectId: null,
	baseFolder: 'ProjectFlow',
	colWidths: {},
};

/** Fallback label map for default statuses. Prefer plugin.settings.statuses for display. */
export const TICKET_STATUS_LABELS: Record<string, string> = {
	'backlog': 'Backlog',
	'todo': 'To Do',
	'in-progress': 'In Progress',
	'in-review': 'In Review',
	'done': 'Done',
};

export const PRIORITY_ORDER: TicketPriority[] = ['critical', 'high', 'medium', 'low', 'none'];
