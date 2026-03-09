export type TicketStatus = 'todo' | 'in-progress' | 'in-review' | 'done';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketType = 'task' | 'bug' | 'feature' | 'story';
export type SprintStatus = 'planning' | 'active' | 'completed';

export interface Project {
	id: string;
	name: string;
	description: string;
	cycleDays: number;
	createdAt: number;
}

export interface Sprint {
	id: string;
	projectId: string;
	name: string;
	startDate: number;
	endDate: number;
	status: SprintStatus;
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
}

export interface AppData {
	projects: Project[];
	sprints: Sprint[];
	tickets: Ticket[];
	activeProjectId: string | null;
}

export const DEFAULT_DATA: AppData = {
	projects: [],
	sprints: [],
	tickets: [],
	activeProjectId: null,
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
	'todo': 'To Do',
	'in-progress': 'In Progress',
	'in-review': 'In Review',
	'done': 'Done',
};

export const PRIORITY_ORDER: TicketPriority[] = ['critical', 'high', 'medium', 'low'];
