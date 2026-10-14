const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Set before loading the installer, so nothing here can reach the real ~/.claude.
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'install-paths-'));
const { resolvePluginHooks, statuslineCommand, isKitHook, isCraftStatusline } = require('../install');

const KIT = path.join(__dirname, '..');
const WINDOWS_ROOT = 'C:\\Users\\kyriakos\\claude-plugins\\claude-kit';
const pluginHooksJson = () => fs.readFileSync(path.join(KIT, 'hooks', 'hooks.json'), 'utf8');

test('loading the installer runs nothing', () => {
  assert.deepEqual(fs.readdirSync(process.env.CLAUDE_CONFIG_DIR), []);
});

test('resolves the plugin hooks for a Windows clone path', () => {
  const hooks = resolvePluginHooks(pluginHooksJson(), WINDOWS_ROOT);
  const command = hooks.SessionStart[0].hooks[0].command;

  assert.equal(command, `node "${WINDOWS_ROOT}/hooks/craft.js"`);
  assert.equal(isKitHook(command), true);
});

test('recognizes its statusline from a Windows clone, in either separator style', () => {
  assert.equal(isCraftStatusline(statuslineCommand(WINDOWS_ROOT)), true);
  assert.equal(isCraftStatusline(`node "${WINDOWS_ROOT}\\hooks\\craft.js" --statusline`), true);
  assert.equal(isKitHook(`node "${WINDOWS_ROOT}\\hooks\\jira-guard.js"`), true);
});
