const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'craft.js');
let configDir;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-'));
});

function run(input, args = []) {
  const result = spawnSync('node', [SCRIPT, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function contextOf(stdout) {
  return JSON.parse(stdout).hookSpecificOutput.additionalContext;
}

const modeFile = () => path.join(configDir, '.craft-mode');
const prompt = (text) => ({ hook_event_name: 'UserPromptSubmit', prompt: text });

test('session start injects the rules at the default level', () => {
  const out = JSON.parse(run({ hook_event_name: 'SessionStart' }));

  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /level: full/);
  assert.match(out.hookSpecificOutput.additionalContext, /# Craft rules/);
});

test('subagents receive the rules too', () => {
  const out = JSON.parse(run({ hook_event_name: 'SubagentStart' }));

  assert.equal(out.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(out.hookSpecificOutput.additionalContext, /# Craft rules/);
});

test('/craft <level> persists the level and re-injects the rules', () => {
  const context = contextOf(run(prompt('/craft strict')));

  assert.equal(fs.readFileSync(modeFile(), 'utf8'), 'strict');
  assert.match(context, /level: strict/);
  assert.match(context, /# Craft rules/);
  assert.match(contextOf(run({ hook_event_name: 'SessionStart' })), /level: strict/);
});

test('only the active level is described', () => {
  const context = contextOf(run(prompt('/craft strict')));

  assert.match(context, /^- strict:/m);
  assert.doesNotMatch(context, /^- (lite|full)\b/m);
});

test('the plugin-namespaced command works and is case-insensitive', () => {
  run(prompt('/jho-claude-kit:craft LITE'));

  assert.equal(fs.readFileSync(modeFile(), 'utf8'), 'lite');
});

test('/craft off silences injection until turned back on', () => {
  assert.match(contextOf(run(prompt('/craft off'))), /off/);

  assert.equal(run({ hook_event_name: 'SessionStart' }), '');
  assert.equal(run({ hook_event_name: 'SubagentStart' }), '');
});

test('prompts that are not a level switch change nothing', () => {
  for (const text of ['fix the login bug', '/craft', '/craft banana', 'use /craft strict later']) {
    assert.equal(run(prompt(text)), '');
  }
  assert.equal(fs.existsSync(modeFile()), false);
});

test('an unreadable mode file falls back to the default level', () => {
  fs.writeFileSync(modeFile(), 'garbage');

  assert.match(contextOf(run({ hook_event_name: 'SessionStart' })), /level: full/);
});

test('malformed input never blocks the user', () => {
  assert.equal(run('not json'), '');
  assert.equal(run({ hook_event_name: 'Stop' }), '');
});

test('--statusline shows the active level, and nothing when off', () => {
  assert.equal(run('', ['--statusline']), '[CRAFT:FULL]');

  fs.writeFileSync(modeFile(), 'off');
  assert.equal(run('', ['--statusline']), '');
});

test('--statusline shows the lite badge when lite is active', () => {
  fs.writeFileSync(modeFile(), 'lite');

  assert.equal(run('', ['--statusline']), '[CRAFT:LITE]');
});
