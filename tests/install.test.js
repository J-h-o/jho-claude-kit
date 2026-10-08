const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KIT = path.join(__dirname, '..');
const SCRIPT = path.join(KIT, 'install.js');
const CRAFT = path.join(KIT, 'hooks', 'craft.js');
// What plugin mode registers, with the plugin root resolved to this clone.
const PLUGIN_HOOKS = JSON.parse(
  fs.readFileSync(path.join(KIT, 'hooks', 'hooks.json'), 'utf8').replaceAll('${CLAUDE_PLUGIN_ROOT}', KIT),
).hooks;
let configDir;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-install-'));
});

function install(...args) {
  return spawnSync('node', [SCRIPT, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
}

const settingsPath = () => path.join(configDir, 'settings.json');
const readSettings = () => JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
const writeSettings = (settings) => fs.writeFileSync(settingsPath(), JSON.stringify(settings));
const kitGroups = (settings, event) =>
  (settings.hooks?.[event] ?? []).filter((group) => group.hooks?.some((h) => h.command.startsWith(`node "${KIT}/hooks/`)));

test('links every skill and agent into the config dir', () => {
  assert.equal(install().status, 0);

  for (const skill of fs.readdirSync(path.join(KIT, 'skills'))) {
    assert.equal(fs.realpathSync(path.join(configDir, 'skills', skill)), path.join(KIT, 'skills', skill));
  }
  for (const agent of fs.readdirSync(path.join(KIT, 'agents'))) {
    assert.equal(fs.realpathSync(path.join(configDir, 'agents', agent)), path.join(KIT, 'agents', agent));
  }
});

test('registers exactly the plugin hooks and the statusline, keeping existing settings', () => {
  writeSettings({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });

  assert.equal(install().status, 0);

  const settings = readSettings();
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'say done');
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['Stop', ...Object.keys(PLUGIN_HOOKS)].sort());
  for (const [event, groups] of Object.entries(PLUGIN_HOOKS)) assert.deepEqual(kitGroups(settings, event), groups);
  assert.match(settings.statusLine.command, /craft\.js" --statusline$/);
});

test('installing twice adds nothing new', () => {
  install();
  const first = readSettings();

  assert.equal(install().status, 0);
  assert.deepEqual(readSettings(), first);
});

test('keeps an existing statusline through install and uninstall', () => {
  writeSettings({ statusLine: { type: 'command', command: 'my-statusline' } });

  install();
  assert.equal(readSettings().statusLine.command, 'my-statusline');
  install('--uninstall');
  assert.equal(readSettings().statusLine.command, 'my-statusline');
});

test('the backup keeps the pre-install settings across repeated installs', () => {
  writeSettings({ model: 'opus' });

  install();
  install();

  assert.deepEqual(JSON.parse(fs.readFileSync(`${settingsPath()}.bak`, 'utf8')), { model: 'opus' });
});

test('tolerates hook groups without a hooks array', () => {
  writeSettings({ hooks: { SessionStart: [{ matcher: 'startup' }] } });

  assert.equal(install().status, 0, install().stderr);
  assert.deepEqual(readSettings().hooks.SessionStart[0], { matcher: 'startup' });
});

test('re-installing from a moved clone replaces the old hook entries', () => {
  const stale = 'node "/old/place/hooks/craft.js"';
  writeSettings({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: stale }] }] } });

  install();

  const commands = readSettings().hooks.SessionStart.flatMap((group) => group.hooks).map((h) => h.command);
  assert.deepEqual(commands, [`node "${CRAFT}"`]);
});

test('refuses to overwrite a skill or agent it does not own', () => {
  fs.mkdirSync(path.join(configDir, 'skills', 'jira-task'), { recursive: true });
  fs.mkdirSync(path.join(configDir, 'agents'));
  fs.symlinkSync('/nowhere/scout.md', path.join(configDir, 'agents', 'scout.md'));
  writeSettings({ model: 'opus' });

  const result = install();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /jira-task/);
  assert.match(result.stderr, /scout\.md/);
  assert.deepEqual(readSettings(), { model: 'opus' });
});

test('--uninstall removes exactly what install added', () => {
  writeSettings({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });
  install();

  assert.equal(install('--uninstall').status, 0);

  assert.deepEqual(readSettings(), { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } });
  assert.deepEqual(fs.readdirSync(path.join(configDir, 'skills')), []);
  assert.deepEqual(fs.readdirSync(path.join(configDir, 'agents')), []);
});

test('uninstall is idempotent and creates nothing on a clean config dir', () => {
  assert.equal(install('--uninstall').status, 0);
  assert.equal(fs.existsSync(settingsPath()), false);

  writeSettings({ model: 'opus' });
  install();
  install('--uninstall');
  assert.equal(install('--uninstall').status, 0);
  assert.deepEqual(readSettings(), { model: 'opus' });
});
