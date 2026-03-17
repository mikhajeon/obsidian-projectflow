/**
 * StatusColorPicker — a popover color picker with:
 *   - 8-color preset palette
 *   - HSL wheel (hue ring + SL square)
 *   - Hex input field
 *
 * Usage:
 *   const picker = new StatusColorPicker(anchorEl, initialHex, (hex) => { ... });
 *   picker.open();
 */

import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from '../statusConfig';

const PALETTE = [
	'#8b8b8b', '#4c9be8', '#e8a24c', '#4caf7d',
	'#a855f7', '#ec4899', '#f43f5e', '#06b6d4',
	'#10b981', '#f59e0b', '#3b82f6', '#84cc16',
];

export class StatusColorPicker {
	private anchor: HTMLElement;
	private color: string;
	private onChange: (hex: string) => void;
	private popover: HTMLElement | null = null;

	// HSL state kept in sync
	private h = 0;
	private s = 1;
	private l = 0.5;

	constructor(anchor: HTMLElement, initialColor: string, onChange: (hex: string) => void) {
		this.anchor = anchor;
		this.color = initialColor;
		this.onChange = onChange;
		const { r, g, b } = hexToRgb(initialColor);
		const hsl = rgbToHsl(r, g, b);
		this.h = hsl.h; this.s = hsl.s; this.l = hsl.l;
	}

	open(): void {
		// Close any existing
		document.querySelector('.pf-color-picker-popover')?.remove();

		const pop = document.body.createDiv('pf-color-picker-popover');
		this.popover = pop;

		const rect = this.anchor.getBoundingClientRect();
		pop.style.top = `${rect.bottom + 6}px`;
		pop.style.left = `${rect.left}px`;

		// Palette row
		const palette = pop.createDiv('pf-cp-palette');
		for (const c of PALETTE) {
			const swatch = palette.createDiv('pf-cp-swatch');
			swatch.style.background = c;
			if (c.toLowerCase() === this.color.toLowerCase()) swatch.addClass('pf-cp-swatch-active');
			swatch.addEventListener('click', () => {
				this.setColor(c);
				this.updateAll(pop, hexInput);
			});
		}

		// HSL wheel canvas
		const wheelWrap = pop.createDiv('pf-cp-wheel-wrap');
		const wheelCanvas = wheelWrap.createEl('canvas') as HTMLCanvasElement;
		wheelCanvas.width = 160;
		wheelCanvas.height = 160;
		wheelCanvas.addClass('pf-cp-wheel');
		this.drawWheel(wheelCanvas);

		// SL square canvas
		const slCanvas = wheelWrap.createEl('canvas') as HTMLCanvasElement;
		slCanvas.width = 120;
		slCanvas.height = 120;
		slCanvas.addClass('pf-cp-sl');
		this.drawSL(slCanvas);

		// Wheel interaction
		const getWheelHue = (e: MouseEvent): number => {
			const r2 = wheelCanvas.getBoundingClientRect();
			const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
			const dx = e.clientX - cx, dy = e.clientY - cy;
			let angle = Math.atan2(dy, dx) * (180 / Math.PI);
			if (angle < 0) angle += 360;
			return angle;
		};
		let wheelDragging = false;
		wheelCanvas.addEventListener('mousedown', (e) => {
			wheelDragging = true;
			this.h = getWheelHue(e);
			this.applyHsl();
			this.drawWheel(wheelCanvas);
			this.drawSL(slCanvas);
			this.updateAll(pop, hexInput);
		});
		document.addEventListener('mousemove', (e) => {
			if (!wheelDragging) return;
			this.h = getWheelHue(e);
			this.applyHsl();
			this.drawWheel(wheelCanvas);
			this.drawSL(slCanvas);
			this.updateAll(pop, hexInput);
		});
		document.addEventListener('mouseup', () => { wheelDragging = false; });

		// SL interaction
		const getSL = (e: MouseEvent): { s: number; l: number } => {
			const r2 = slCanvas.getBoundingClientRect();
			const x = Math.max(0, Math.min(1, (e.clientX - r2.left) / r2.width));
			const y = Math.max(0, Math.min(1, (e.clientY - r2.top) / r2.height));
			// x = saturation, y = 1 - lightness
			return { s: x, l: 1 - y };
		};
		let slDragging = false;
		slCanvas.addEventListener('mousedown', (e) => {
			slDragging = true;
			const sl = getSL(e);
			this.s = sl.s; this.l = sl.l;
			this.applyHsl();
			this.drawSL(slCanvas);
			this.updateAll(pop, hexInput);
		});
		document.addEventListener('mousemove', (e) => {
			if (!slDragging) return;
			const sl = getSL(e);
			this.s = sl.s; this.l = sl.l;
			this.applyHsl();
			this.drawSL(slCanvas);
			this.updateAll(pop, hexInput);
		});
		document.addEventListener('mouseup', () => { slDragging = false; });

		// Hex input
		const hexRow = pop.createDiv('pf-cp-hex-row');
		const hexInput = hexRow.createEl('input', { cls: 'pf-cp-hex-input' }) as HTMLInputElement;
		hexInput.type = 'text';
		hexInput.maxLength = 7;
		hexInput.value = this.color;
		hexInput.addEventListener('input', () => {
			const v = hexInput.value.trim();
			if (/^#[0-9a-fA-F]{6}$/.test(v)) {
				this.setColor(v);
				this.drawWheel(wheelCanvas);
				this.drawSL(slCanvas);
				this.updatePaletteActive(pop);
			}
		});
		hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pop.remove(); });

		// Preview swatch next to hex
		const preview = hexRow.createDiv('pf-cp-preview');
		preview.style.background = this.color;

		// Close on outside click
		const onOutside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node) && e.target !== this.anchor) {
				pop.remove();
				document.removeEventListener('click', onOutside, true);
			}
		};
		setTimeout(() => document.addEventListener('click', onOutside, true), 0);
	}

	private setColor(hex: string): void {
		this.color = hex;
		const { r, g, b } = hexToRgb(hex);
		const hsl = rgbToHsl(r, g, b);
		this.h = hsl.h; this.s = hsl.s; this.l = hsl.l;
		this.onChange(hex);
	}

	private applyHsl(): void {
		const { r, g, b } = hslToRgb(this.h, this.s, this.l);
		this.color = rgbToHex(r, g, b);
		this.onChange(this.color);
	}

	private updateAll(pop: HTMLElement, hexInput: HTMLInputElement): void {
		hexInput.value = this.color;
		const preview = pop.querySelector('.pf-cp-preview') as HTMLElement | null;
		if (preview) preview.style.background = this.color;
		this.updatePaletteActive(pop);
	}

	private updatePaletteActive(pop: HTMLElement): void {
		pop.querySelectorAll('.pf-cp-swatch').forEach((s, i) => {
			const el = s as HTMLElement;
			if (PALETTE[i]?.toLowerCase() === this.color.toLowerCase()) el.addClass('pf-cp-swatch-active');
			else el.removeClass('pf-cp-swatch-active');
		});
	}

	private drawWheel(canvas: HTMLCanvasElement): void {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const w = canvas.width, h = canvas.height;
		const cx = w / 2, cy = h / 2;
		const outerR = Math.min(cx, cy) - 2;
		const innerR = outerR - 18;

		ctx.clearRect(0, 0, w, h);

		// Draw hue ring
		for (let angle = 0; angle < 360; angle++) {
			const start = (angle - 1) * Math.PI / 180;
			const end = (angle + 1) * Math.PI / 180;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, outerR, start, end);
			ctx.closePath();
			ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
			ctx.fill();
		}

		// Punch inner hole
		ctx.globalCompositeOperation = 'destination-out';
		ctx.beginPath();
		ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalCompositeOperation = 'source-over';

		// Hue indicator
		const rad = (this.h * Math.PI) / 180;
		const mr = (outerR + innerR) / 2;
		const ix = cx + Math.cos(rad) * mr;
		const iy = cy + Math.sin(rad) * mr;
		ctx.beginPath();
		ctx.arc(ix, iy, 6, 0, Math.PI * 2);
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.fillStyle = `hsl(${this.h}, 100%, 50%)`;
		ctx.fill();
	}

	private drawSL(canvas: HTMLCanvasElement): void {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const w = canvas.width, h = canvas.height;

		// Base hue gradient (left = white, right = pure hue)
		const hueGrad = ctx.createLinearGradient(0, 0, w, 0);
		hueGrad.addColorStop(0, '#fff');
		hueGrad.addColorStop(1, `hsl(${this.h}, 100%, 50%)`);
		ctx.fillStyle = hueGrad;
		ctx.fillRect(0, 0, w, h);

		// Overlay black gradient (top = transparent, bottom = black)
		const darkGrad = ctx.createLinearGradient(0, 0, 0, h);
		darkGrad.addColorStop(0, 'rgba(0,0,0,0)');
		darkGrad.addColorStop(1, 'rgba(0,0,0,1)');
		ctx.fillStyle = darkGrad;
		ctx.fillRect(0, 0, w, h);

		// Indicator dot — x = saturation, y = 1 - lightness (approx)
		const ix = this.s * w;
		const iy = (1 - this.l) * h;
		ctx.beginPath();
		ctx.arc(ix, iy, 6, 0, Math.PI * 2);
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.fillStyle = this.color;
		ctx.fill();
	}
}
