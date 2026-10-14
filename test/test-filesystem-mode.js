#!/usr/bin/env node
/**
 * Unit checks for DESKTOP_COMMANDER_MODE=filesystem (no live MCP server).
 */
import assert from 'assert';
import {
  isFilesystemMode,
  parseAllowedDirectoriesFromEnv,
  assertFilesystemAllowedDirectories,
  FILESYSTEM_TOOL_NAMES,
  filterToolsForMode,
  assertToolAllowedInFilesystemMode,
  filesystemWriteLineLimit,
} from '../dist/filesystem-mode.js';

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

withEnv({ DESKTOP_COMMANDER_MODE: undefined }, () => {
  assert.strictEqual(isFilesystemMode(), false);
});
withEnv({ DESKTOP_COMMANDER_MODE: 'filesystem' }, () => {
  assert.strictEqual(isFilesystemMode(), true);
});
withEnv({ DESKTOP_COMMANDER_MODE: 'FS' }, () => {
  assert.strictEqual(isFilesystemMode(), true);
});

assert.deepStrictEqual(parseAllowedDirectoriesFromEnv('/workspace'), ['/workspace']);
assert.deepStrictEqual(parseAllowedDirectoriesFromEnv('/workspace,/tmp/jobs'), [
  '/workspace',
  '/tmp/jobs',
]);
assert.deepStrictEqual(parseAllowedDirectoriesFromEnv('/workspace:/home/claude/work'), [
  '/workspace',
  '/home/claude/work',
]);
assert.deepStrictEqual(parseAllowedDirectoriesFromEnv(''), []);
assert.deepStrictEqual(parseAllowedDirectoriesFromEnv(undefined), []);

assert.throws(() => assertFilesystemAllowedDirectories([]), /refuse/);
assert.throws(() => assertFilesystemAllowedDirectories(['/']), /refuse/);
assert.doesNotThrow(() => assertFilesystemAllowedDirectories(['/workspace']));

assert.ok(FILESYSTEM_TOOL_NAMES.has('write_file'));
assert.ok(FILESYSTEM_TOOL_NAMES.has('edit_block'));
assert.ok(!FILESYSTEM_TOOL_NAMES.has('start_process'));
assert.ok(!FILESYSTEM_TOOL_NAMES.has('set_config_value'));

const sample = [
  { name: 'write_file' },
  { name: 'start_process' },
  { name: 'get_config' },
  { name: 'edit_block' },
];
withEnv({ DESKTOP_COMMANDER_MODE: undefined }, () => {
  assert.strictEqual(filterToolsForMode(sample).length, 4);
});
withEnv({ DESKTOP_COMMANDER_MODE: 'filesystem' }, () => {
  const filtered = filterToolsForMode(sample);
  assert.deepStrictEqual(
    filtered.map((t) => t.name).sort(),
    ['edit_block', 'write_file'],
  );
  assert.doesNotThrow(() => assertToolAllowedInFilesystemMode('write_file'));
  assert.throws(() => assertToolAllowedInFilesystemMode('start_process'), /disabled/);
  assert.throws(() => assertToolAllowedInFilesystemMode('set_config_value'), /disabled/);
});

withEnv({ DESKTOP_COMMANDER_FILE_WRITE_LINE_LIMIT: undefined }, () => {
  assert.strictEqual(filesystemWriteLineLimit(), 2000);
});
withEnv({ DESKTOP_COMMANDER_FILE_WRITE_LINE_LIMIT: '500' }, () => {
  assert.strictEqual(filesystemWriteLineLimit(), 500);
});

console.log('test-filesystem-mode: ok');
