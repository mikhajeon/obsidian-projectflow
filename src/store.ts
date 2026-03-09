import type ProjectFlowPlugin from './main';
import type { AppData, Project, Sprint, Ticket, TicketStatus } from './types';
import { DEFAULT_DATA } from './types';

export class ProjectStore {
	private plugin: ProjectFlowPlugin;
	private data: AppData;

	constructor(plugin: ProjectFlowPlugin) {
		this.plugin = plugin;
		this.data = { ...DEFAULT_DATA };
	}

	async load(): Promise<void> {
		const saved = await this.plugin.loadData() as Partial<AppData> | null;
		this.data = {
			projects: saved?.projects ?? [],
			sprints: saved?.sprints ?? [],
			tickets: saved?.tickets ?? [],
			activeProjectId: saved?.activeProjectId ?? null,
		};
	}

	private async save(): Promise<void> {
		await this.plugin.saveData(this.data);
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}

	// ── Projects ──────────────────────────────────────────────────────────────

	getProjects(): Project[] {
		return this.data.projects;
	}

	getProject(id: string): Project | undefined {
		return this.data.projects.find(p => p.id === id);
	}

	getActiveProjectId(): string | null {
		return this.data.activeProjectId;
	}

	getActiveProject(): Project | undefined {
		if (!this.data.activeProjectId) return undefined;
		return this.getProject(this.data.activeProjectId);
	}

	async setActiveProject(id: string | null): Promise<void> {
		this.data.activeProjectId = id;
		await this.save();
	}

	async createProject(data: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
		const project: Project = { ...data, id: this.generateId(), createdAt: Date.now() };
		this.data.projects.push(project);
		if (!this.data.activeProjectId) {
			this.data.activeProjectId = project.id;
		}
		await this.save();
		return project;
	}

	async updateProject(id: string, data: Partial<Omit<Project, 'id' | 'createdAt'>>): Promise<void> {
		const idx = this.data.projects.findIndex(p => p.id === id);
		if (idx !== -1) {
			this.data.projects[idx] = { ...this.data.projects[idx], ...data };
			await this.save();
		}
	}

	async deleteProject(id: string): Promise<void> {
		this.data.projects = this.data.projects.filter(p => p.id !== id);
		this.data.sprints = this.data.sprints.filter(s => s.projectId !== id);
		this.data.tickets = this.data.tickets.filter(t => t.projectId !== id);
		if (this.data.activeProjectId === id) {
			this.data.activeProjectId = this.data.projects[0]?.id ?? null;
		}
		await this.save();
	}

	// ── Sprints ───────────────────────────────────────────────────────────────

	getSprints(projectId?: string): Sprint[] {
		return projectId
			? this.data.sprints.filter(s => s.projectId === projectId)
			: this.data.sprints;
	}

	getSprint(id: string): Sprint | undefined {
		return this.data.sprints.find(s => s.id === id);
	}

	getActiveSprint(projectId: string): Sprint | undefined {
		return this.data.sprints.find(s => s.projectId === projectId && s.status === 'active');
	}

	async createSprint(data: Omit<Sprint, 'id'>): Promise<Sprint> {
		const sprint: Sprint = { ...data, id: this.generateId() };
		this.data.sprints.push(sprint);
		await this.save();
		return sprint;
	}

	async updateSprint(id: string, data: Partial<Omit<Sprint, 'id'>>): Promise<void> {
		const idx = this.data.sprints.findIndex(s => s.id === id);
		if (idx !== -1) {
			this.data.sprints[idx] = { ...this.data.sprints[idx], ...data };
			await this.save();
		}
	}

	async deleteSprint(id: string): Promise<void> {
		this.data.sprints = this.data.sprints.filter(s => s.id !== id);
		this.data.tickets = this.data.tickets.map(t =>
			t.sprintId === id ? { ...t, sprintId: null, status: 'todo' as TicketStatus } : t
		);
		await this.save();
	}

	// ── Tickets ───────────────────────────────────────────────────────────────

	getTickets(filter?: { projectId?: string; sprintId?: string | null }): Ticket[] {
		let tickets = this.data.tickets;
		if (filter?.projectId !== undefined) {
			tickets = tickets.filter(t => t.projectId === filter.projectId);
		}
		if (filter?.sprintId !== undefined) {
			tickets = tickets.filter(t => t.sprintId === filter.sprintId);
		}
		return tickets.sort((a, b) => a.order - b.order);
	}

	getTicket(id: string): Ticket | undefined {
		return this.data.tickets.find(t => t.id === id);
	}

	async createTicket(data: Omit<Ticket, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<Ticket> {
		const existing = this.getTickets({ projectId: data.projectId, sprintId: data.sprintId });
		const maxOrder = existing.reduce((max, t) => Math.max(max, t.order), -1);
		const ticket: Ticket = {
			...data,
			id: this.generateId(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			order: maxOrder + 1,
		};
		this.data.tickets.push(ticket);
		await this.save();
		return ticket;
	}

	async updateTicket(id: string, data: Partial<Omit<Ticket, 'id' | 'createdAt'>>): Promise<void> {
		const idx = this.data.tickets.findIndex(t => t.id === id);
		if (idx !== -1) {
			this.data.tickets[idx] = { ...this.data.tickets[idx], ...data, updatedAt: Date.now() };
			await this.save();
		}
	}

	async deleteTicket(id: string): Promise<void> {
		this.data.tickets = this.data.tickets.filter(t => t.id !== id);
		await this.save();
	}

	async moveTicket(id: string, sprintId: string | null, status: TicketStatus, order: number): Promise<void> {
		await this.updateTicket(id, { sprintId, status, order });
	}

	// ── Derived ───────────────────────────────────────────────────────────────

	getSprintProgress(sprintId: string): { total: number; done: number; percent: number } {
		const tickets = this.getTickets({ sprintId });
		const total = tickets.length;
		const done = tickets.filter(t => t.status === 'done').length;
		return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
	}
}
