/**
 * Jobs hard-compute "condom" mode.
 *
 * When DESKTOP_COMMANDER_MODE=filesystem:
 * - Only filesystem tools are advertised and callable (no start_process / config mutation).
 * - allowedDirectories must be set via DESKTOP_COMMANDER_ALLOWED_DIRECTORIES and must
 *   not be empty or include "/" (fail closed at boot).
 * - fileWriteLineLimit defaults higher so a full config rewrite fits one write_file.
 */

import { configManager } from './config-manager.js';

export const FILESYSTEM_MODE_ENV = 'DESKTOP_COMMANDER_MODE';
export const ALLOWED_DIRECTORIES_ENV = 'DESKTOP_COMMANDER_ALLOWED_DIRECTORIES';
export const WRITE_LINE_LIMIT_ENV = 'DESKTOP_COMMANDER_FILE_WRITE_LINE_LIMIT';

/** Tools safe for hard-compute Edit/Write escape hatch. No shell, no config mutation. */
export const FILESYSTEM_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read_file',
  'read_multiple_files',
  'write_file',
  'create_directory',
  'list_directory',
  'move_file',
  'search_files',
  'search_code',
  'get_file_info',
  'edit_block',
]);

const DEFAULT_FILESYSTEM_WRITE_LINE_LIMIT = 2000;

export function isFilesystemMode(): boolean {
  const mode = (process.env[FILESYSTEM_MODE_ENV] || '').trim().toLowerCase();
  return mode === 'filesystem' || mode === 'fs';
}

/**
 * Parse DESKTOP_COMMANDER_ALLOWED_DIRECTORIES (comma or colon separated).
 * Rejects empty entries and literal "/".
 */
export function parseAllowedDirectoriesFromEnv(
  raw: string | undefined = process.env[ALLOWED_DIRECTORIES_ENV],
): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  const parts = raw
    .split(/[,:]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts;
}

export function assertFilesystemAllowedDirectories(dirs: string[]): void {
  if (dirs.length === 0) {
    throw new Error(
      `filesystem mode requires ${ALLOWED_DIRECTORIES_ENV} with at least one path ` +
        `(empty or unset is refuse — refusing full-filesystem access)`,
    );
  }
  if (dirs.some((d) => d === '/')) {
    throw new Error(
      `filesystem mode refuses allowedDirectories containing "/" ` +
        `(refusing full-filesystem access)`,
    );
  }
}

export function filesystemWriteLineLimit(): number {
  const raw = process.env[WRITE_LINE_LIMIT_ENV];
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return DEFAULT_FILESYSTEM_WRITE_LINE_LIMIT;
}

/**
 * Apply filesystem-mode config and fail closed if the sandbox is missing.
 * Call after configManager.loadConfig() and before server.connect().
 */
export async function applyFilesystemModeOrDie(): Promise<void> {
  if (!isFilesystemMode()) {
    return;
  }

  const dirs = parseAllowedDirectoriesFromEnv();
  assertFilesystemAllowedDirectories(dirs);

  const writeLimit = filesystemWriteLineLimit();
  await configManager.updateConfig({
    allowedDirectories: dirs,
    fileWriteLineLimit: writeLimit,
  });

  console.error(
    `[desktop-commander] filesystem mode on; allowedDirectories=${JSON.stringify(dirs)}; ` +
      `fileWriteLineLimit=${writeLimit}`,
  );
}

export function assertToolAllowedInFilesystemMode(toolName: string): void {
  if (!isFilesystemMode()) {
    return;
  }
  if (!FILESYSTEM_TOOL_NAMES.has(toolName)) {
    throw new Error(
      `Tool "${toolName}" is disabled in DESKTOP_COMMANDER_MODE=filesystem ` +
        `(filesystem tools only; no process/config tools)`,
    );
  }
}

export function filterToolsForMode<T extends { name: string }>(tools: T[]): T[] {
  if (!isFilesystemMode()) {
    return tools;
  }
  return tools.filter((t) => FILESYSTEM_TOOL_NAMES.has(t.name));
}
