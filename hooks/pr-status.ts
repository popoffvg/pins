import type { EngineInterface, ThemeKey } from 'claude-code'

import type { CiState, PrState, PrStatus, ReviewState } from '../types'

export const PR_PATTERN = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/

export type Badge = { icon: string; label: string; color: ThemeKey }

export const PR_STATE_BADGES: Record<PrState, Badge> = {
  open: { icon: '●', label: 'Open', color: 'success' },
  draft: { icon: '◌', label: 'Draft', color: 'subtle' },
  merged: { icon: '⬢', label: 'Merged', color: 'merged' },
  closed: { icon: '✕', label: 'Closed', color: 'error' },
}

export const CI_BADGES: Record<CiState, Badge> = {
  passing: { icon: '✔', label: 'CI', color: 'success' },
  failing: { icon: '✕', label: 'CI', color: 'error' },
  running: { icon: '◷', label: 'CI', color: 'warning' },
  none: { icon: '·', label: 'No CI', color: 'subtle' },
}

export const REVIEW_BADGES: Record<ReviewState, Badge | undefined> = {
  approved: { icon: '✔', label: 'Approved', color: 'success' },
  changes: { icon: '✎', label: 'Changes requested', color: 'error' },
  waiting: { icon: '◷', label: 'Review required', color: 'warning' },
  none: undefined,
}

const REVIEW_DECISIONS: Record<string, ReviewState> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'waiting',
}

const PASSED_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const RUNNING_STATES = new Set(['PENDING', 'EXPECTED'])

type Check = {
  workflowName?: string
  name?: string
  context?: string
  startedAt?: string
  status?: string
  conclusion?: string
  state?: string | null
}
type CheckOutcome = 'passed' | 'failed' | 'running'

const latestRuns = (checks: readonly Check[]): Check[] => {
  const latest = new Map<string, Check>()
  for (const check of checks) {
    const key = `${check.workflowName ?? ''}|${check.name ?? check.context ?? ''}`
    const seen = latest.get(key)
    if (seen === undefined || (check.startedAt ?? '') >= (seen.startedAt ?? '')) {
      latest.set(key, check)
    }
  }
  return [...latest.values()]
}

const checkOutcome = (check: Check): CheckOutcome => {
  if (check.state != null) {
    if (check.state === 'SUCCESS') return 'passed'
    return RUNNING_STATES.has(check.state) ? 'running' : 'failed'
  }
  if (check.status !== 'COMPLETED') return 'running'
  return PASSED_CONCLUSIONS.has(check.conclusion ?? '') ? 'passed' : 'failed'
}

export const parsePrStatus = (json: string, checkedAt: number): PrStatus => {
  const view = JSON.parse(json) as {
    title?: string
    state: string
    isDraft: boolean
    reviewDecision?: string
    statusCheckRollup?: Check[]
  }
  const outcomes = latestRuns(view.statusCheckRollup ?? []).map(checkOutcome)
  const count = (outcome: CheckOutcome) => outcomes.filter(one => one === outcome).length
  const ci: CiState =
    outcomes.length === 0
      ? 'none'
      : count('failed') > 0
        ? 'failing'
        : count('running') > 0
          ? 'running'
          : 'passing'
  const state: PrState =
    view.state === 'MERGED'
      ? 'merged'
      : view.state === 'CLOSED'
        ? 'closed'
        : view.isDraft
          ? 'draft'
          : 'open'

  return {
    title: view.title ?? '',
    state,
    review: REVIEW_DECISIONS[view.reviewDecision ?? ''] ?? 'none',
    ci,
    checksPassed: count('passed'),
    checksTotal: outcomes.length,
    checkedAt,
  }
}

export const ciLabel = (status: PrStatus): string =>
  status.ci === 'none'
    ? CI_BADGES.none.label
    : `${CI_BADGES[status.ci].label} ${status.checksPassed}/${status.checksTotal}`

export async function fetchPrStatuses(
  $: EngineInterface,
  urls: readonly string[],
): Promise<{ statuses: Record<string, PrStatus>; errors: string[] }> {
  const prUrls = urls.filter(url => PR_PATTERN.test(url))
  if (prUrls.length === 0) return { statuses: {}, errors: [] }
  const checkedAt = await $.clock.now()
  const fetched = await Promise.all(
    prUrls.map(async url => {
      try {
        const { exitCode, stdout, stderr } = await $.process.run(
          ['gh', 'pr', 'view', url, '--json', 'title,state,isDraft,reviewDecision,statusCheckRollup'],
          { timeoutMs: 20_000 },
        )
        return exitCode === 0
          ? { url, status: parsePrStatus(stdout, checkedAt) }
          : { url, error: stderr.trim().split('\n')[0] || `gh exited ${exitCode}` }
      } catch (error) {
        return { url, error: String(error) }
      }
    }),
  )

  const statuses: Record<string, PrStatus> = {}
  for (const one of fetched) if ('status' in one && one.status) statuses[one.url] = one.status

  return {
    statuses,
    errors: fetched.flatMap(one => ('error' in one ? [`${one.url}: ${one.error}`] : [])),
  }
}
