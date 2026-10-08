#!/usr/bin/env node
// Links this kit into ~/.claude without the plugin system, for machines whose
// policy only allows plugins from approved marketplaces.
//
//   node install.js              link skills + agents, register hooks + statusline
//   node install.js --uninstall  remove exactly what install added
//
// Skills and agents are symlinks, so `git pull` in this repo updates them in place.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KIT = __dirname;
const STATUSLINE_COMMAND = `node "${path.join(KIT, 'hooks', 'craft.js')}" --statusline`;
// The plugin's own hooks.json with its root resolved to this clone, so both install methods stay identical.
const PLUGIN_HOOKS = JSON.parse(
  fs.readFileSync(path.join(KIT, 'hooks', 'hooks.json'), 'utf8').replaceAll('${CLAUDE_PLUGIN_ROOT}', KIT),
).hooks;
const KIT_SCRIPTS = [...new Set(Object.values(PLUGIN_HOOKS).flat()
  .flatMap((group) => group.hooks.map((hook) => hook.command.match(/\/hooks\/([\w-]+\.js)"$/)[1])))];
// Matches this kit's hooks from any clone location, so a moved clone replaces its old entries.
const isKitHook = (command) => KIT_SCRIPTS.some((script) => command?.endsWith(`/hooks/${script}"`));
const isCraftStatusline = (command) => /\/hooks\/craft\.js" --statusline$/.test(command ?? '');

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(configDir, 'settings.json');

function links() {
  return ['skills', 'agents'].flatMap((kind) =>
    fs.readdirSync(path.join(KIT, kind)).map((name) => ({
      source: path.join(KIT, kind, name),
      target: path.join(configDir, kind, name),
    })));
}

function isOurLink({ source, target }) {
  try {
    return fs.readlinkSync(target) === source;
  } catch {
    return false;
  }
}

function occupied(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot parse ${settingsPath}: ${error.message}`);
  }
}

// Writes only real changes, so the .bak keeps the last settings that differed.
function saveSettings(before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, `${settingsPath}.bak`);
  fs.writeFileSync(settingsPath, `${JSON.stringify(after, null, 2)}\n`);
}

function withoutKitHooks(hooks = {}) {
  const result = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((group) => Array.isArray(group.hooks)
        ? { ...group, hooks: group.hooks.filter((hook) => !isKitHook(hook.command)) }
        : group)
      .filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0);
    if (kept.length > 0) result[event] = kept;
  }
  return result;
}

function install() {
  const conflicts = links().filter((link) => occupied(link.target) && !isOurLink(link));
  if (conflicts.length > 0) {
    throw new Error(`Not overwriting files this kit does not own:\n${conflicts.map((c) => `  ${c.target}`).join('\n')}\n`
      + 'Move or delete them, then run the installer again.');
  }

  const before = readSettings();
  const hooks = withoutKitHooks(before.hooks);
  for (const [event, groups] of Object.entries(PLUGIN_HOOKS)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  const after = { ...before, hooks };

  const statusline = before.statusLine?.command;
  if (!statusline || isCraftStatusline(statusline)) {
    after.statusLine = { type: 'command', command: STATUSLINE_COMMAND };
  } else {
    console.log(`Kept your statusline. For the craft badge, use: ${STATUSLINE_COMMAND}`);
  }

  for (const link of links()) {
    fs.mkdirSync(path.dirname(link.target), { recursive: true });
    if (!isOurLink(link)) fs.symlinkSync(link.source, link.target);
  }
  saveSettings(before, after);
  console.log(`Installed into ${configDir}. Start a new session to load it.`);
}

function uninstall() {
  for (const link of links()) {
    if (isOurLink(link)) fs.unlinkSync(link.target);
  }

  const before = readSettings();
  const after = { ...before, hooks: withoutKitHooks(before.hooks) };
  if (Object.keys(after.hooks).length === 0) delete after.hooks;
  if (isCraftStatusline(after.statusLine?.command)) delete after.statusLine;
  saveSettings(before, after);
  console.log(`Uninstalled from ${configDir}.`);
}

try {
  if (process.argv.includes('--uninstall')) uninstall();
  else install();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
