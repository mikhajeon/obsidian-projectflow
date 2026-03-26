import { App, Modal, Notice } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import { generateSprintReport } from '../sprintReport';
import { generateTicketNote } from '../ticketNote';

export class RetroModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private sprintId: string;
	private onComplete: () => void;
	private retroNotes: string;
	private spillOver = false;
	private autoCreate = false;

	constructor(app: App, plugin: ProjectFlowPlugin, sprintId: string, onComplete: () => void) {
		super(app);
		this.plugin = plugin;
		this.sprintId = sprintId;
		this.onComplete = onComplete;
		this.retroNotes = plugin.store.getSprint(sprintId)?.retroNotes ?? '';
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');

		contentEl.createEl('h2', { text: 'Complete sprint' });
		contentEl.createEl('p', { cls: 'pf-retro-intro', text: 'Add retrospective notes before closing this sprint. These will be saved to the sprint history.' });

		const store = this.plugin.store;
		const sprint = store.getSprint(this.sprintId);
		const projectId = sprint?.projectId ?? '';

		const incompleteTickets = store.getTickets({ sprintId: this.sprintId })
			.filter(t => t.status !== 'done');
		if (incompleteTickets.length > 0) {
			contentEl.createEl('p', { cls: 'pf-retro-warning', text: `${incompleteTickets.length} ticket(s) not yet done will be moved back to the backlog.` });
		}

		// Find if there's a planning sprint to spill over to
		const nextPlanningSprint = projectId
			? store.getSprints(projectId)
				.filter(s => s.status === 'planning')
				.sort((a, b) => a.startDate - b.startDate)[0]
			: undefined;

		const autoSpillover = projectId ? store.getProjectAutoSpillover(projectId) : false;
		const autoCreateSetting = projectId ? store.getProjectAutoCreate(projectId) : false;

		// Show spillover checkbox if: auto-spillover is on OR a planning sprint exists
		const showSpillover = incompleteTickets.length > 0 && (autoSpillover || !!nextPlanningSprint);

		if (showSpillover || autoCreateSetting) {
			this.spillOver = autoSpillover;
			this.autoCreate = autoCreateSetting;

			const optionsDiv = contentEl.createEl('div', { cls: 'pf-retro-options' });

			if (showSpillover) {
				const spillRow = optionsDiv.createEl('div', { cls: 'pf-retro-option-row' });
				const spillCb = spillRow.createEl('input') as HTMLInputElement;
				spillCb.type = 'checkbox';
				spillCb.checked = this.spillOver;
				spillCb.addEventListener('change', () => {
					this.spillOver = spillCb.checked;
					// Show/hide the note about no planning sprint
					const noteEl = optionsDiv.querySelector<HTMLElement>('.pf-retro-spillover-note');
					if (noteEl) {
						noteEl.style.display = (spillCb.checked && !nextPlanningSprint) ? '' : 'none';
					}
				});
				spillRow.createEl('span', { text: 'Move incomplete tickets to next sprint' });

				// Show note if no planning sprint when checked
				const noteEl = optionsDiv.createEl('div', { cls: 'pf-retro-option-note pf-retro-spillover-note' });
				noteEl.setText('(No planning sprint found — tickets will go to backlog)');
				noteEl.style.display = (this.spillOver && !nextPlanningSprint) ? '' : 'none';
			}

			if (autoCreateSetting || projectId) {
				const createRow = optionsDiv.createEl('div', { cls: 'pf-retro-option-row' });
				const createCb = createRow.createEl('input') as HTMLInputElement;
				createCb.type = 'checkbox';
				createCb.checked = this.autoCreate;
				createCb.addEventListener('change', () => { this.autoCreate = createCb.checked; });
				createRow.createEl('span', { text: 'Create next sprint automatically' });
			}
		}

		const area = contentEl.createEl('textarea', { cls: 'pf-textarea pf-retro-notes' }) as HTMLTextAreaElement;
		area.placeholder = 'What went well? What could be improved?';
		area.value = this.retroNotes;
		area.addEventListener('input', () => { this.retroNotes = area.value; });

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });

		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());

		footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Complete sprint' })
			.addEventListener('click', () => this.complete());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async complete(): Promise<void> {
		const store = this.plugin.store;
		const sprint = store.getSprint(this.sprintId);
		const projectId = sprint?.projectId ?? '';

		// Find next planning sprint for spillover
		const nextPlanningSprint = projectId
			? store.getSprints(projectId)
				.filter(s => s.status === 'planning')
				.sort((a, b) => a.startDate - b.startDate)[0]
			: undefined;

		const incompleteTickets = store.getTickets({ sprintId: this.sprintId })
			.filter(t => t.status !== 'done');

		for (const ticket of incompleteTickets) {
			if (this.spillOver && nextPlanningSprint) {
				// Move to next planning sprint, keep status
				await store.updateTicket(ticket.id, { sprintId: nextPlanningSprint.id });
			} else {
				// Move to product backlog
				await store.updateTicket(ticket.id, { sprintId: null, status: 'todo' });
			}
			await generateTicketNote(this.plugin, ticket.id);
		}

		await store.updateSprint(this.sprintId, {
			status: 'completed',
			retroNotes: this.retroNotes.trim() || undefined,
		});
		await generateSprintReport(this.plugin, this.sprintId);

		// Auto-archive done tickets if project setting is on
		if (projectId && store.getProjectAutoArchiveDone(projectId)) {
			await store.archiveDoneTicketsInSprint(this.sprintId);
		}

		// Auto-create next sprint if requested
		if (this.autoCreate && projectId) {
			const project = store.getProject(projectId);
			const cycleDays = project?.cycleDays ?? 14;
			const sprints = store.getSprints(projectId);
			const sprintName = `Sprint ${sprints.length + 1}`;
			const startDate = sprint ? sprint.endDate + 86400000 : Date.now();
			const endDate = startDate + cycleDays * 86400000;
			await store.createSprint({
				projectId,
				name: sprintName,
				startDate,
				endDate,
				status: 'planning',
			});
		}

		new Notice('Sprint completed.');
		this.close();
		this.onComplete();
	}
}
