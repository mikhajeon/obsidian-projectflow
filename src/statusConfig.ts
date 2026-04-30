export interface StatusDefinition {
	id: string;          // stable slug — used as ticket.status value and CSS key
	label: string;       // display name (user-editable)
	color: string;       // hex e.g. "#4c9be8"
	isDefault: boolean;  // true = rename-only, never deletable
	universalId: string; // maps to one of the 5 default ids for broad classification
}

export interface ProjectFlowSettings {
	statuses: StatusDefinition[];
}

export const DEFAULT_STATUSES: StatusDefinition[] = [
	{ id: 'backlog',     label: 'Backlog',     color: '#6b7280', isDefault: true, universalId: 'backlog' },
	{ id: 'todo',        label: 'To Do',       color: '#8b8b8b', isDefault: true, universalId: 'todo' },
	{ id: 'in-progress', label: 'In Progress', color: '#4c9be8', isDefault: true, universalId: 'in-progress' },
	{ id: 'in-review',   label: 'In Review',   color: '#e8a24c', isDefault: true, universalId: 'in-review' },
	{ id: 'done',        label: 'Done',        color: '#4caf7d', isDefault: true, universalId: 'done' },
];

export const DEFAULT_SETTINGS: ProjectFlowSettings = {
	statuses: DEFAULT_STATUSES.map(s => ({ ...s })),
};

/** Auto-assign palette for new custom statuses (cycles if all used). */
const STATUS_COLOR_PALETTE = [
	'#a855f7', '#ec4899', '#f43f5e', '#06b6d4',
	'#10b981', '#f59e0b', '#3b82f6', '#84cc16',
];

export function nextPaletteColor(existingColors: string[]): string {
	const used = new Set(existingColors.map(c => c.toLowerCase()));
	for (const c of STATUS_COLOR_PALETTE) {
		if (!used.has(c.toLowerCase())) return c;
	}
	return STATUS_COLOR_PALETTE[existingColors.length % STATUS_COLOR_PALETTE.length];
}

export function slugify(label: string): string {
	return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Inject each status color as --pf-status-{id} on document.body. */
export function injectStatusColors(statuses: StatusDefinition[]): void {
	for (const s of statuses) {
		document.body.style.setProperty(`--pf-status-${s.id}`, s.color);
	}
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const clean = hex.replace('#', '');
	const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
	const n = parseInt(full, 16) || 0;
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
	return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	const rn = r / 255, gn = g / 255, bn = b / 255;
	const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
	else if (max === gn) h = ((bn - rn) / d + 2) / 6;
	else h = ((rn - gn) / d + 4) / 6;
	return { h: h * 360, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h / 60) % 2 - 1));
	const m = l - c / 2;
	let r = 0, g = 0, b = 0;
	if      (h < 60)  { r = c; g = x; b = 0; }
	else if (h < 120) { r = x; g = c; b = 0; }
	else if (h < 180) { r = 0; g = c; b = x; }
	else if (h < 240) { r = 0; g = x; b = c; }
	else if (h < 300) { r = x; g = 0; b = c; }
	else              { r = c; g = 0; b = x; }
	return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
