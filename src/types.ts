export type TicketStatus = string;
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
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
}

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
	'todo': 'To Do',
	'in-progress': 'In Progress',
	'in-review': 'In Review',
	'done': 'Done',
};

export const PRIORITY_ORDER: TicketPriority[] = ['critical', 'high', 'medium', 'low'];
