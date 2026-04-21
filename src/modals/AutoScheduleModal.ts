import { App, Modal, Notice } from 'obsidian';
import type ProjectFlowPlugin from '../main';
import type { Ticket } from '../types';
import { generateTicketNote } from '../ticketNote';

export interface ScheduleSuggestion {
	ticket: Ticket;
	suggestedStart: number;
	suggestedDue: number;
}

export class AutoScheduleModal extends Modal {
	private plugin: ProjectFlowPlugin;
	private suggestions: ScheduleSuggestion[];
	private onAccepted: () => void;
	private accepted: Set<string>;

	constructor(app: App, plugin: ProjectFlowPlugin, suggestions: ScheduleSuggestion[], onAccepted: () => void) {
		super(app);
		this.plugin = plugin;
		this.suggestions = suggestions;
		this.onAccepted = onAccepted;
		this.accepted = new Set(suggestions.map(s => s.ticket.id));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pf-modal');
		this.modalEl.style.width = 'min(560px, 92vw)';
		this.modalEl.querySelector('.modal-close-button')?.remove();

		const header = contentEl.createEl('div', { cls: 'pf-modal-header' });
		header.createEl('span', { cls: 'pf-modal-label', text: 'Auto-schedule suggestions' });
		const closeBtn = header.createEl('button', { cls: 'pf-modal-close', text: '×' });
		closeBtn.addEventListener('click', () => this.close());

		const body = contentEl.createEl('div', { cls: 'pf-modal-body' });
		body.createEl('p', { cls: 'pf-autosched-desc', text: 'These tickets will be scheduled into available time slots (09:00–17:00). Uncheck any you want to skip.' });

		if (this.suggestions.length === 0) {
			body.createEl('p', { text: 'No available time slots found for the next 7 days.', cls: 'pf-autosched-empty' });
		} else {
			const list = body.createEl('div', { cls: 'pf-autosched-list' });
			for (const s of this.suggestions) {
				const row = list.createEl('div', { cls: 'pf-autosched-row' });
				const cb = row.createEl('input', { attr: { type: 'checkbox', checked: 'true' } }) as HTMLInputElement;
				cb.checked = true;
				cb.addEventListener('change', () => {
					if (cb.checked) this.accepted.add(s.ticket.id);
					else this.accepted.delete(s.ticket.id);
				});

				const startDate = new Date(s.suggestedStart);
				const endDate = new Date(s.suggestedDue);
				const fmt = (d: Date) => `${d.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
				row.createEl('span', { cls: 'pf-autosched-title', text: s.ticket.title });
				row.createEl('span', { cls: 'pf-autosched-time', text: `${fmt(startDate)} → ${fmt(endDate)}` });
			}
		}

		const footer = contentEl.createEl('div', { cls: 'pf-modal-footer' });
		footer.createEl('button', { cls: 'pf-btn', text: 'Cancel' })
			.addEventListener('click', () => this.close());
		if (this.suggestions.length > 0) {
			footer.createEl('button', { cls: 'pf-btn pf-btn-primary', text: 'Accept selected' })
				.addEventListener('click', () => this.accept());
		}
	}

	private async accept(): Promise<void> {
		let count = 0;
		for (const s of this.suggestions) {
			if (!this.accepted.has(s.ticket.id)) continue;
			await this.plugin.store.updateTicket(s.ticket.id, {
				startDate: s.suggestedStart,
				dueDate: s.suggestedDue,
			});
			generateTicketNote(this.plugin, s.ticket.id).catch(() => { /* silent */ });
			count++;
		}
		this.close();
		this.onAccepted();
		if (count > 0) new Notice(`Scheduled ${count} ticket${count > 1 ? 's' : ''}.`);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
