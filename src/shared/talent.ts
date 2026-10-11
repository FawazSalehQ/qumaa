import type { ResumeRef } from './types.js'

export interface PersonFields {
  name: string
  email: string
  phone: string
  employer: string
  title: string
  location: string
  skills: string[]
  tags: string[]
  availability: string
  availabilityConfirmedAt: number | null
  sourceUrl: string
  note: string
}

export interface Person extends PersonFields {
  id: string
  recordKeys: string[]
  origin: 'prospect' | 'library'
  createdAt: number
  updatedAt: number
}

export type SavePersonInput = PersonFields & { id?: string; expectedUpdatedAt?: number }
export interface VersionedId { id: string; expectedUpdatedAt: number }
export type ActivityKind = 'call' | 'email' | 'message' | 'meeting' | 'note' | 'follow-up'
export interface ActivityFields {
  personId: string
  jobId: string | null
  kind: ActivityKind
  occurredAt: number
  summary: string
  outcome: string
  nextAction: string
  dueAt: number | null
  completedAt: number | null
}
export interface Activity extends ActivityFields { id: string; createdAt: number; updatedAt: number }
export type SaveActivityInput = ActivityFields & { id?: string; expectedUpdatedAt?: number }

export type PipelineStage = 'sourced' | 'contacted' | 'interested' | 'screened' | 'submitted' | 'interviewing' | 'offer' | 'placed' | 'closed'
export interface StageEvent { id: string; stage: PipelineStage; at: number }
export interface ClientSubmission {
  id: string
  at: number
  companyId: string | null
  companyName: string
  recipient: string
  note: string
  feedback: string
}
export interface AssignmentFields {
  personId: string
  jobId: string
  stage: PipelineStage
  nextAction: string
  dueAt: number | null
  note: string
  clientFeedback: string
}
export interface Assignment extends AssignmentFields {
  id: string
  stageHistory: StageEvent[]
  submissions: ClientSubmission[]
  createdAt: number
  updatedAt: number
}
export type SaveAssignmentInput = AssignmentFields & { id?: string; expectedUpdatedAt?: number }

export interface ScreeningQuestion {
  id: string
  criterionId: string | null
  question: string
  answer: string
  verification: 'unverified' | 'candidate-stated' | 'verified'
  answeredAt: number | null
}
export interface Screening {
  id: string
  personId: string
  jobId: string
  title: string
  questions: ScreeningQuestion[]
  heldAt: number | null
  note: string
  createdAt: number
  updatedAt: number
}
export type SaveScreeningInput = Pick<Screening, 'id' | 'title' | 'questions' | 'heldAt' | 'note'> & { expectedUpdatedAt: number }

export interface TalentFilters {
  query: string
  location: string
  employer: string
  skill: string
  tag: string
  availability: string
  hasCv: 'any' | 'yes' | 'no'
  notContactedSince: number | null
}
export interface PoolMember { personId: string; addedAt: number }
export interface TalentPool {
  id: string
  name: string
  note: string
  mode: 'manual' | 'search'
  /** Curated membership for manual pools; last-reviewed matches for saved searches. */
  members: PoolMember[]
  filters: TalentFilters
  lastReviewedAt: number | null
  createdAt: number
  updatedAt: number
}
export type SavePoolInput = Pick<TalentPool, 'name' | 'note' | 'mode' | 'filters'> & { id?: string; expectedUpdatedAt?: number; personIds: string[] }
export interface TalentOverview {
  people: Person[]
  activities: Activity[]
  assignments: Assignment[]
  pools: TalentPool[]
  screenings: Screening[]
}
export interface MergeContactsInput {
  primaryId: string
  secondaryId: string
  expectedPrimaryUpdatedAt: number
  expectedSecondaryUpdatedAt: number
}
export interface MergePreview {
  primary: Person
  secondary: Person
  conflicts: string[]
  activities: number
  assignments: number
  screenings: number
  pools: number
}
export interface TalentApi {
  overview(): Promise<TalentOverview>
  ensurePerson(resume: ResumeRef): Promise<Person>
  savePerson(input: SavePersonInput): Promise<Person>
  deletePerson(input: VersionedId): Promise<void>
  linkCv(input: { personId: string; expectedUpdatedAt: number; resume: ResumeRef }): Promise<Person>
  previewMerge(input: { primaryId: string; secondaryId: string }): Promise<MergePreview>
  mergeContacts(input: MergeContactsInput): Promise<Person>
  saveActivity(input: SaveActivityInput): Promise<Activity>
  completeActivity(input: VersionedId & { completed: boolean }): Promise<Activity>
  saveAssignment(input: SaveAssignmentInput): Promise<Assignment>
  deleteAssignment(input: VersionedId): Promise<void>
  addSubmission(input: { assignmentId: string; expectedUpdatedAt: number; at: number; recipient: string; note: string }): Promise<Assignment>
  updateSubmission(input: { assignmentId: string; expectedUpdatedAt: number; submissionId: string; feedback: string }): Promise<Assignment>
  generateScreening(input: { personId: string; jobId: string }): Promise<Screening>
  saveScreening(input: SaveScreeningInput): Promise<Screening>
  deleteScreening(input: VersionedId): Promise<void>
  savePool(input: SavePoolInput): Promise<TalentPool>
  reviewPool(input: VersionedId): Promise<TalentPool>
  deletePool(input: VersionedId): Promise<void>
}

export const EMPTY_TALENT_FILTERS: TalentFilters = { query: '', location: '', employer: '', skill: '', tag: '', availability: '', hasCv: 'any', notContactedSince: null }
const folded = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/\p{M}/gu, '')
function matchesPersonFields(person: Person, filters: TalentFilters): boolean {
  const includes = (haystack: string, needle: string) => !needle.trim() || folded(haystack).includes(folded(needle.trim()))
  return includes([person.name, person.email, person.phone, person.employer, person.title, person.location, ...person.skills, ...person.tags].join(' '), filters.query)
    && includes(person.location, filters.location) && includes(person.employer, filters.employer)
    && includes(person.skills.join(' '), filters.skill) && includes(person.tags.join(' '), filters.tag)
    && includes(person.availability, filters.availability)
    && (filters.hasCv === 'any' || (person.recordKeys.length > 0) === (filters.hasCv === 'yes'))
}
/** Build the recent-contact index once, even for a large saved-search pool. */
export function filterTalentPeople(filters: TalentFilters, people: Person[], activities: Activity[]): Person[] {
  const contacted = new Set<string>()
  if (filters.notContactedSince !== null) {
    for (const activity of activities) {
      if (['call', 'email', 'message', 'meeting'].includes(activity.kind) && activity.occurredAt >= filters.notContactedSince) contacted.add(activity.personId)
    }
  }
  return people.filter((person) => !contacted.has(person.id) && matchesPersonFields(person, filters))
}
export function matchesTalentFilters(person: Person, filters: TalentFilters, activities: Activity[]): boolean {
  return filterTalentPeople(filters, [person], activities).length === 1
}
export function peopleInPool(pool: TalentPool, people: Person[], activities: Activity[]): Person[] {
  if (pool.mode === 'search') return filterTalentPeople(pool.filters, people, activities)
  const ids = new Set(pool.members.map((member) => member.personId))
  return people.filter((person) => ids.has(person.id))
}
export function newPoolPeople(pool: TalentPool, people: Person[]): Person[] {
  if (pool.lastReviewedAt === null) return [...people]
  // A saved search may gain an existing contact after an edit, CV link, or
  // outreach-history change. Compare with the last reviewed membership, not
  // the contact's creation date; routine edits to known matches are not new.
  if (pool.mode === 'search') {
    const reviewed = new Set(pool.members.map((member) => member.personId))
    return people.filter((person) => !reviewed.has(person.id))
  }
  const reviewedAt = pool.lastReviewedAt
  const addedAt = new Map(pool.members.map((member) => [member.personId, member.addedAt]))
  return people.filter((person) => Math.max(person.createdAt, addedAt.get(person.id) ?? 0) > reviewedAt)
}
