export type Pin = { url: string; title: string; why: string }

export type PrState = 'open' | 'draft' | 'merged' | 'closed'
export type CiState = 'passing' | 'failing' | 'running' | 'none'
export type ReviewState = 'approved' | 'changes' | 'waiting' | 'none'

export type PrStatus = {
  title: string
  state: PrState
  review: ReviewState
  ci: CiState
  checksPassed: number
  checksTotal: number
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    pins: { pins: Shaped<Pin[]>; prStatuses: Shaped<Record<string, PrStatus>> }
  }
}
