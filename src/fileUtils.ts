import type ProjectFlowPlugin from './main';

/** Recursively ensures all segments of a folder path exist in the vault. */
export async function ensureFolder(plugin: ProjectFlowPlugin, folderPath: string): Promise<void> {
	const segments = folderPath.split('/');
	let current = '';
	for (const seg of segments) {
		current = current ? `${current}/${seg}` : seg;
		if (!(await plugin.app.vault.adapter.exists(current))) {
			await plugin.app.vault.createFolder(current);
		}
	}
}

/** Strips characters illegal in file names and truncates to maxLen. */
export function safeFileName(name: string, maxLen = 100): string {
	return name.replace(/[/\\:*?"<>|]/g, '-').slice(0, maxLen);
}
