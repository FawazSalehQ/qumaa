import type { TalentOverview } from '@shared/talent.js'

export type DeskAction = <T>(work: () => Promise<T>, apply: (result: T) => void, changed?: boolean) => Promise<boolean>
export type UpdateOverview = (update: (current: TalentOverview) => TalentOverview) => void

export const ACTIVITY_LABELS = { call: 'Call', email: 'Email', message: 'Message', meeting: 'Meeting', note: 'Note', 'follow-up': 'Follow-up' } as const
export const STAGE_LABELS = { sourced: 'Sourced', contacted: 'Contacted', interested: 'Interested', screened: 'Screened', submitted: 'Submitted', interviewing: 'Interviewing', offer: 'Offer', placed: 'Placed', closed: 'Closed' } as const
