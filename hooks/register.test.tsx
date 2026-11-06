import { expect, test } from 'claude-code/testing'
import type { CommandRunInput } from 'claude-code'

import { parsePrStatus } from './pr-status'
import { checkedAgo, linkKind } from './register'

const SHOW_PINS = { command: 'pins', args: '' } as unknown as CommandRunInput

const pin = (url: string, order: string[]) => ({
  tool: 'mcp__pins__pin' as const,
  url,
  title: `title ${url}`,
  why: `why ${url}`,
  order,
})

test('each pin re-ranks the list, and /pins shows the new order', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.root', () => ({ value: '/Users/me/project' }))
  const file = 'file:///Users/me/project/hooks/register.ts'
  await $.tool.call(pin('https://a', ['https://a']))
  const ranked = await $.tool.call(pin(file, [file, 'https://a']))
  expect(String(ranked.result)).toContain(`1. title ${file}\n   File · hooks/register.ts`)
  expect(ranked.context).toEqual([`Pinned URLs in rank order: ["${file}","https://a"]`])

  const shown = await $.command.run(SHOW_PINS)
  expect(shown.text).toBe(
    `1. title ${file}\n   File · hooks/register.ts\n   why ${file}\n2. title https://a\n   a\n   why https://a`,
  )
})

test('an order that drops a pinned URL is refused and keeps the list', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.root', () => ({ value: '/Users/me/project' }))
  await $.tool.call(pin('https://a', ['https://a']))
  const refused = await $.tool.call(pin('https://b', ['https://b']))
  expect(refused.deny).toContain('Missing: https://a')

  const shown = await $.command.run(SHOW_PINS)
  expect(shown.text).toBe('1. title https://a\n   a\n   why https://a')
})

const PANE = {
  plugin: 'pins',
  component: 'Pane',
  requestId: 'pins',
  props: {
    title: 'Pins',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the sidebar shows the pins in rank order, on every surface', async ($, on) => {
  on('session.root', () => ({ value: '/Users/me/project' }))
  on('clock.now', () => ({ value: 0 }))
  await $.tool.call(pin('https://a', ['https://a']))
  await $.tool.call(pin('https://b', ['https://b', 'https://a']))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const first = await ui.find({ type: 'Text', text: /^title / })
    expect(first?.text).toContain('title https://b')
    await ui.unmount()
  }
})

test('each link shows its kind', () => {
  const cases: [string, string][] = [
    ['https://github.com/acme/app/pull/12', 'PR #12 · acme/app'],
    ['https://github.com/acme/app/issues/7', 'Issue #7 · acme/app'],
    ['https://github.com/acme/app', 'Repo · acme/app'],
    ['https://claude.ai/code/artifact/abc', 'Artifact · claude.ai'],
    ['https://www.notion.so/acme/Plan-123', 'Notion page'],
    ['https://docs.google.com/document/d/abc', 'Google document'],
    ['file:///Users/me/project/hooks/register.ts', 'File · hooks/register.ts'],
    ['file:///Users/me/other/register.ts', 'File · …/other/register.ts'],
    ['file:///opt/tool/run.sh', 'File · …/tool/run.sh'],
    ['https://www.example.com/a?b', 'example.com'],
    ['not a url', 'not a url'],
  ]
  for (const [url, kind] of cases) expect(linkKind(url, '/Users/me/project')).toBe(kind)
})

test('gh output turns into the PR state, the review, and the CI count', () => {
  const status = parsePrStatus(
    JSON.stringify({
      title: 'Fix the upload retry',
      state: 'OPEN',
      isDraft: false,
      reviewDecision: 'APPROVED',
      statusCheckRollup: [
        { workflowName: 'ci', name: 'lint', startedAt: '2026-11-06T10:00:00Z', status: 'COMPLETED', conclusion: 'CANCELLED', state: null },
        { workflowName: 'ci', name: 'lint', startedAt: '2026-11-06T10:05:00Z', status: 'COMPLETED', conclusion: 'SUCCESS', state: null },
        { workflowName: 'ci', name: 'test', startedAt: '2026-11-06T10:05:00Z', status: 'IN_PROGRESS', conclusion: '', state: null },
        { context: 'deploy', startedAt: '2026-11-06T10:05:00Z', state: 'SUCCESS' },
      ],
    }),
    1000,
  )
  expect(status).toEqual({
    title: 'Fix the upload retry',
    state: 'open',
    review: 'approved',
    ci: 'running',
    checksPassed: 2,
    checksTotal: 3,
    checkedAt: 1000,
  })
  const failed = parsePrStatus(
    JSON.stringify({
      state: 'OPEN',
      isDraft: true,
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }],
    }),
    0,
  )
  expect(failed.state).toBe('draft')
  expect(failed.ci).toBe('failing')
  expect(parsePrStatus(JSON.stringify({ state: 'MERGED', isDraft: false }), 0).ci).toBe('none')
})

test('a PR card shows the PR status and the CI status from gh', async ($, on) => {
  on('session.root', () => ({ value: '/Users/me/project' }))
  on('clock.now', () => ({ value: 0 }))
  const prUrl = 'https://github.com/acme/app/pull/12'
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify({
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'CHANGES_REQUESTED',
        title: 'Fix the upload retry',
        statusCheckRollup: [
          { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
      }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await $.tool.call(pin(prUrl, [prUrl]))
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const isLoading = (await ui.find({ type: 'Text', text: /loading/ })) !== undefined
    await ui.unmount()
    if (!isLoading) break
  }

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Open/ }))?.text).toBe('● Open')
    expect((await ui.find({ type: 'Text', text: /upload/ }))?.text).toBe('Fix the upload retry')
    expect((await ui.find({ type: 'Text', text: /CI/ }))?.text).toBe('✕ CI 1/2')
    expect((await ui.find({ type: 'Text', text: /Changes/ }))?.text).toBe('✎ Changes requested')
    await ui.unmount()
  }
})

test('the check time reads as an age', () => {
  expect(checkedAgo(100_000, 90_000)).toBe('checked just now')
  expect(checkedAgo(10 * 60_000, 0)).toBe('checked 10m ago')
  expect(checkedAgo(3 * 3_600_000, 0)).toBe('checked 3h ago')
})

test('the refresh button asks gh again, and the open button opens the file', async ($, on) => {
  on('session.root', () => ({ value: '/Users/me/project' }))
  on('clock.now', () => ({ value: 0 }))
  const prUrl = 'https://github.com/acme/app/pull/12'
  const fileUrl = 'file:///Users/me/project/hooks/register.ts'
  const runs: string[][] = []
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ state: 'OPEN', isDraft: false, statusCheckRollup: [] }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  await $.tool.call(pin(fileUrl, [fileUrl]))
  await $.tool.call(pin(prUrl, [fileUrl, prUrl]))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const ghRunsBefore = runs.filter(argv => argv[0] === 'gh').length
  await ui.press({ key: `refresh:${prUrl}` })
  expect(runs.filter(argv => argv[0] === 'gh').length).toBe(ghRunsBefore + 1)

  await ui.press({ key: `open:${fileUrl}` })
  expect(runs.at(-1)?.at(-1)).toBe('/Users/me/project/hooks/register.ts')
  await ui.unmount()
})
