import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'

// The test runner provides it; the hook typings leave it out because hooks wait through $.clock.
declare function setTimeout(callback: () => void, ms: number): unknown

// Stands in for the engine: `craft.js --statusline` prints the current badge, a prompt's craft hook switches it
// to `promptBadge`, and every status the plugin pins is recorded.
function engine(on: On, badge: string, promptBadge = badge) {
  const statuses: (string | undefined)[] = []
  const runs: (readonly string[])[] = []
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: badge, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('classic.SessionStart', () => ({}))
  // Settles a moment later, as the real craft.js process does.
  on('classic.UserPromptSubmit', async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    badge = promptBadge
    return {}
  })
  return { statuses, runs }
}

test('session start pins the craft badge from craft.js', async ($, on) => {
  const { statuses, runs } = engine(on, '[CRAFT:FULL]')

  await $.classic.SessionStart({ source: 'startup' })

  expect(statuses).toEqual(['[CRAFT:FULL]'])
  expect(runs).toEqual([['node', expect.stringMatching(/\/hooks\/craft\.js$/), '--statusline']])
})

test('a prompt refreshes the badge after the craft hook ran', async ($, on) => {
  const { statuses } = engine(on, '[CRAFT:FULL]', '[CRAFT:STRICT]')

  await $.classic.UserPromptSubmit({ prompt: '/craft strict' })

  expect(statuses).toEqual(['[CRAFT:STRICT]'])
})

test('craft off clears the status', async ($, on) => {
  const { statuses } = engine(on, '')

  await $.classic.SessionStart({ source: 'startup' })

  expect(statuses).toEqual([undefined])
})

test('a badge that cannot be read never blocks the prompt or reruns its hooks', async ($, on) => {
  let craftHookRuns = 0
  on('process.run', () => ({ deny: 'node is not installed' }))
  on('classic.UserPromptSubmit', () => {
    craftHookRuns += 1
    return { block: 'from the craft hook' }
  })

  expect(await $.classic.UserPromptSubmit({ prompt: '/jira-task PROJ-1' })).toEqual({ block: 'from the craft hook' })
  expect(craftHookRuns).toBe(1)
})
