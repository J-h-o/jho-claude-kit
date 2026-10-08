// Pins the craft badge as this plugin's status line, so plugin installs get it without a statusLine setting.
// craft.js stays the one source of the badge; the linked-files install shows it through statusLine instead.
import type { EngineInterface, Register } from 'claude-code'

// Waits for the classic hooks first, so a `/craft <level>` prompt is already applied when the badge is read.
async function refreshBadgeAfter<T>($: EngineInterface, hooksDone: Promise<T>): Promise<T> {
  const result = await hooksDone
  const { stdout } = await $.process.run(['node', `${$.plugin.root}/hooks/craft.js`, '--statusline'])
  $.ui.status(stdout || undefined)
  return result
}

export const register: Register = on => {
  on('classic.SessionStart', ($, e, next) => refreshBadgeAfter($, next(e)))
  on('classic.UserPromptSubmit', ($, e, next) => refreshBadgeAfter($, next(e)))
}
