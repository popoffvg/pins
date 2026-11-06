import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pin, PrStatus } from '../types'

import {
  CI_BADGES,
  PR_PATTERN,
  PR_STATE_BADGES,
  REVIEW_BADGES,
  ciLabel,
  fetchPrStatuses,
} from './pr-status'

const pins = atom({ plugin: 'pins', key: 'pins' } as const, [], {
  shape: 'pins-1',
})

const prStatuses = atom(
  { plugin: 'pins', key: 'prStatuses' } as const,
  {} as Record<string, PrStatus>,
  { shape: 'pr-statuses-3' },
)

const PIN_TOOL = 'mcp__pins__pin'
const PANE = 'pins'
const PANE_OPEN = { id: PANE, title: 'Pins', closeOnEscape: true } as const
const NO_PINS = 'No pinned links yet.'
const PR_REFRESH_MS = 120_000
const OPEN_HOTKEYS = 9

const PIN_TOOL_DESCRIPTION = [
  'Keep the links of this chat pinned, the way Slack pins items in a channel.',
  'Call the tool when a new link enters the chat: from the user, from your own answer, or from a tool result.',
  'A link is a URL, a PR, an issue, a published artifact, or a doc. Do not pin a link that is already pinned.',
  'Each call adds one link and gives the full new order of all pins, the most useful one for the current task first.',
  'The user reads the list with /pins. Returns the ranked list.',
].join('\n')

const FILE_PATTERN = /^file:\/\/(\/.+)$/

export const filePath = (url: string): string | undefined =>
  url.match(FILE_PATTERN)?.[1]

export const relativePath = (path: string, projectRoot: string): string => {
  const root = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
  if (projectRoot !== '' && path.startsWith(root)) return path.slice(root.length)
  return `…/${path.split('/').slice(-2).join('/')}`
}

const LINK_KINDS: readonly {
  pattern: RegExp
  label: (match: RegExpMatchArray, projectRoot: string) => string
}[] = [
  { pattern: PR_PATTERN, label: m => `PR #${m[2]} · ${m[1]}` },
  { pattern: /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/, label: m => `Issue #${m[2]} · ${m[1]}` },
  { pattern: /github\.com\/([^/]+\/[^/?#]+)/, label: m => `Repo · ${m[1]}` },
  { pattern: /claude\.ai\/(?:code\/)?artifact\//, label: () => 'Artifact · claude.ai' },
  { pattern: /notion\.(?:so|site)\//, label: () => 'Notion page' },
  { pattern: /docs\.google\.com\/(\w+)/, label: m => `Google ${m[1]}` },
  { pattern: FILE_PATTERN, label: (m, root) => `File · ${relativePath(m[1] ?? '', root)}` },
  { pattern: /^\w+:\/\/(?:www\.)?([^/?#]+)/, label: m => m[1] ?? '' },
]

export const linkKind = (url: string, projectRoot: string): string => {
  for (const kind of LINK_KINDS) {
    const match = url.match(kind.pattern)
    if (match) return kind.label(match, projectRoot)
  }
  return url
}

const formatPins = (list: readonly Pin[], projectRoot: string): string =>
  list.length === 0
    ? NO_PINS
    : list
        .map(
          (pin, index) =>
            `${index + 1}. ${pin.title}\n   ${linkKind(pin.url, projectRoot)}\n   ${pin.why}`,
        )
        .join('\n')

const formatPinUrls = (list: readonly Pin[]): string =>
  `Pinned URLs in rank order: ${JSON.stringify(list.map(pin => pin.url))}`

export const rankPins = (
  list: readonly Pin[],
  added: Pin,
  order: readonly string[],
): Pin[] | string => {
  const byUrl = new Map(list.map(pin => [pin.url, pin]))
  byUrl.set(added.url, added)
  const missing = [...byUrl.keys()].filter(url => !order.includes(url))
  const unknown = order.filter(url => !byUrl.has(url))
  if (missing.length > 0 || unknown.length > 0 || new Set(order).size !== order.length) {
    return `order must list every pinned URL once. Missing: ${missing.join(', ') || 'none'}. Unknown: ${unknown.join(', ') || 'none'}.`
  }

  return order.map(url => byUrl.get(url) as Pin)
}

async function refreshPrStatuses($: EngineInterface, urls: readonly string[]) {
  const { statuses: found, errors } = await fetchPrStatuses($, urls)
  await update($, prStatuses, statuses => ({ ...statuses, ...found }))
  return errors
}

async function refreshOnPress($: EngineInterface, urls: readonly string[]) {
  $.ui.toast('Refreshing PR status…')
  const errors = await refreshPrStatuses($, urls)
  $.ui.toast(errors.length === 0 ? 'PR status updated' : `PR status failed: ${errors.join('; ')}`)
}

export const openCommand = (url: string): string[] => {
  const path = filePath(url)
  return path === undefined
    ? ['open', url]
    : ['bash', '-c', 'exec "$HOME/.claude/scripts/open-file.sh" "$1"', 'open-file', path]
}

async function openPin($: EngineInterface, url: string) {
  const { exitCode, stderr } = await $.process.run(openCommand(url))
  if (exitCode !== 0) {
    $.ui.toast(`Open failed: ${stderr.trim().split('\n')[0] || `exit ${exitCode}`}`)
  }
}

export const checkedAgo = (now: number, checkedAt: number): string => {
  const minutes = Math.floor((now - checkedAt) / 60_000)
  if (minutes < 1) return 'checked just now'
  if (minutes < 60) return `checked ${minutes}m ago`
  return `checked ${Math.floor(minutes / 60)}h ago`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pins',
      description: 'Open the sidebar with the pinned links of this chat',
    })
    await $.tool.register({
      name: 'pin',
      isDeferred: false,
      description: PIN_TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The link to pin.' },
          title: { type: 'string', description: 'A short name for the link.' },
          why: { type: 'string', description: 'One line: why the link matters for this chat.' },
          order: {
            type: 'array',
            items: { type: 'string' },
            description: 'Every pinned URL, the new one included, most useful first.',
          },
        },
        required: ['url', 'title', 'why', 'order'],
      },
    })
    const refreshAll = async () =>
      refreshPrStatuses($, (await read($, pins)).map(pin => pin.url))
    void refreshAll()
    $.clock.every(PR_REFRESH_MS, () => void refreshAll())

    return next(e)
  })

  on('tool.call', { tool: PIN_TOOL }, async ($, e) => {
    const input = e as unknown as Pin & { order: string[] }
    const added: Pin = { url: input.url, title: input.title, why: input.why }
    let refusal: string | undefined
    await update($, pins, list => {
      const ranked = rankPins(list, added, input.order ?? [])
      if (typeof ranked === 'string') {
        refusal = ranked
        return list
      }
      return ranked
    })
    if (refusal !== undefined) {
      return { deny: refusal }
    }
    const list = await read($, pins)
    $.ui.toast(`Pinned: ${added.title}`)
    void refreshPrStatuses($, [added.url])

    return {
      result: `Pinned links, ranked:\n${formatPins(list, await $.session.root())}`,
      context: [formatPinUrls(list)],
    }
  })

  on('command.run', { command: 'pins' }, async $ => {
    await $.ui.open(PANE_OPEN)
    const list = await read($, pins)
    void refreshPrStatuses($, list.map(pin => pin.url))

    return { text: formatPins(list, await $.session.root()), context: [formatPinUrls(list)] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, pins)
    const prUrls = list.map(pin => pin.url).filter(url => PR_PATTERN.test(url))
    const statuses = await read($, prStatuses)
    const projectRoot = await $.session.root()
    const now = await $.clock.now()

    if (list.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
          <Text color="subtle">{NO_PINS}</Text>
          <Text color="subtle" italic>
            Links from this chat show up here, most useful first.
          </Text>
        </Box>
      )
    }

    const prBadges = (url: string, status: PrStatus | undefined) => {
      const refresh = (
        <Button
          key={`refresh:${url}`}
          label="↻ refresh"
          plain
          dimColor
          onPress={() => void refreshOnPress($, [url])}
        />
      )
      if (status === undefined) {
        return (
          <Box flexDirection="row" columnGap={2}>
            <Text color="subtle" italic>
              ◌ loading PR status…
            </Text>
            {refresh}
          </Box>
        )
      }
      const state = PR_STATE_BADGES[status.state]
      const ci = CI_BADGES[status.ci]
      const review = REVIEW_BADGES[status.review]

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Text color={state.color} bold>
              {state.icon} {state.label}
            </Text>
            <Text color={ci.color}>
              {ci.icon} {ciLabel(status)}
            </Text>
            {review && (
              <Text color={review.color}>
                {review.icon} {review.label}
              </Text>
            )}
          </Box>
          <Box flexDirection="row" columnGap={2}>
            <Text color="subtle">{checkedAgo(now, status.checkedAt)}</Text>
            {refresh}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="claude">
            ◆ {list.length} pinned
          </Text>
          {prUrls.length > 0 ? (
            <Button
              key="refresh-all"
              label="r: ↻ refresh PRs"
              hotkey="r"
              plain
              dimColor
              onPress={() => void refreshOnPress($, prUrls)}
            />
          ) : (
            <Text color="subtle">most useful first</Text>
          )}
        </Box>
        <Box marginBottom={1}>
          <Text color="subtle">{`ctrl+x tab: focus · 1-${OPEN_HOTKEYS}: open · esc: close`}</Text>
        </Box>
        {list.map((pin, index) => {
          const isTop = index === 0
          const hotkey = index < OPEN_HOTKEYS ? String(index + 1) : undefined

          return (
            <Box
              key={pin.url}
              flexDirection="row"
              gap={1}
              borderStyle="round"
              borderColor={isTop ? 'claude' : 'subtle'}
              hover={{ borderColor: 'suggestion' }}
              paddingX={1}
            >
              <Text bold color={isTop ? 'claude' : 'subtle'} tabular>
                {String(index + 1).padStart(2)}
              </Text>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text bold wrap="truncate-end">
                  {statuses[pin.url]?.title || pin.title}
                </Text>
                <Box flexDirection="row" columnGap={2}>
                  <Text color="suggestion" wrap="truncate-middle">
                    {linkKind(pin.url, projectRoot)}
                  </Text>
                  <Button
                    key={`open:${pin.url}`}
                    label="↗ open"
                    hotkey={hotkey}
                    plain
                    dimColor
                    onPress={() => void openPin($, pin.url)}
                  />
                </Box>
                {PR_PATTERN.test(pin.url) && prBadges(pin.url, statuses[pin.url])}
                <Text color="subtle" italic>
                  {pin.why}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
