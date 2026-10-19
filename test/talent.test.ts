import { describe, expect, it } from 'vitest'
import { EMPTY_TALENT_FILTERS, filterTalentPeople, matchesTalentFilters, newPoolPeople, peopleInPool, type Activity, type Assignment, type Person, type TalentOverview, type TalentPool } from '../src/shared/talent.js'
import { activityRecordSchema, assignmentRecordSchema, personRecordSchema, screeningQuestionSchema, talentSchemas } from '../src/main/recruiting/talent-schema.js'
import { assertTalentReferences, contactConflicts, mergeAssignments, mergePeople, planScreeningQuestions } from '../src/main/recruiting/talent-planning.js'

const id = (value: number) => `a30da3dc-59a5-4d41-bd24-${value.toString().padStart(12, '0')}`
const key = (value: number) => value.toString(16).padStart(64, '0')
const person = (value: number): Person => ({
  id: id(value), name: `Person ${value}`, email: '', phone: '', employer: '', title: '', location: '', skills: [], tags: [], availability: '', availabilityConfirmedAt: null,
  sourceUrl: '', note: '', recordKeys: [], origin: 'prospect', createdAt: 1, updatedAt: 2
})
const activity = (value: number): Activity => ({ id: id(value), personId: id(1), jobId: null, kind: 'call', occurredAt: 10, summary: 'Discussed role', outcome: '', nextAction: 'Call back', dueAt: 20, completedAt: null, createdAt: 1, updatedAt: 10 })
const assignment = (value: number): Assignment => ({ id: id(value), personId: id(value), jobId: id(30), stage: 'sourced', nextAction: '', dueAt: null, note: '', clientFeedback: '', stageHistory: [{ id: id(value + 100), stage: 'sourced', at: 1 }], submissions: [], createdAt: 1, updatedAt: 2 })
const pool = (): TalentPool => ({ id: id(50), name: 'Engineers', note: '', mode: 'manual', filters: { ...EMPTY_TALENT_FILTERS }, members: [{ personId: id(1), addedAt: 5 }], lastReviewedAt: 4, createdAt: 1, updatedAt: 5 })
const overview = (): TalentOverview => ({ people: [person(1), person(2)], activities: [], assignments: [], screenings: [], pools: [] })

describe('bounded local talent records', () => {
  it('requires edit versions and rejects forged CV ownership, timestamps and origin on contact edits', () => {
    const { id: _id, createdAt: _created, updatedAt: _updated, origin: _origin, recordKeys: _keys, ...fields } = person(1)
    expect(talentSchemas.savePerson.safeParse(fields).success).toBe(true)
    expect(talentSchemas.savePerson.safeParse({ ...fields, id: id(1), expectedUpdatedAt: 2 }).success).toBe(true)
    for (const extra of [{ id: id(1) }, { expectedUpdatedAt: 2 }, { recordKeys: [key(1)] }, { origin: 'library' }, { updatedAt: 9 }]) {
      expect(talentSchemas.savePerson.safeParse({ ...fields, ...extra }).success).toBe(false)
    }
  })

  it('bounds notes and labels, forbids duplicate CVs and requires a CV for library-only contacts', () => {
    expect(personRecordSchema.safeParse(person(1)).success).toBe(true)
    for (const extra of [{ note: 'x'.repeat(20_001) }, { name: 'a\0b' }, { sourceUrl: 'x'.repeat(2_049) }, { origin: 'library' }, { recordKeys: [key(1), key(1)] }, { tags: ['same', 'same'] }]) {
      expect(personRecordSchema.safeParse({ ...person(1), ...extra }).success).toBe(false)
    }
    expect(personRecordSchema.safeParse({ ...person(1), origin: 'library', recordKeys: [key(1)] }).success).toBe(true)
  })

  it('supports job-linked activities but forbids stale and oversized task inputs', () => {
    expect(activityRecordSchema.safeParse({ ...activity(3), jobId: id(30) }).success).toBe(true)
    expect(activityRecordSchema.safeParse({ ...activity(3), summary: 'x'.repeat(2_001) }).success).toBe(false)
    expect(activityRecordSchema.safeParse({ ...activity(3), dueAt: Infinity }).success).toBe(false)
    expect(talentSchemas.completeActivity.safeParse({ id: id(3), completed: true }).success).toBe(false)
    expect(talentSchemas.completeActivity.safeParse({ id: id(3), expectedUpdatedAt: 10, completed: true }).success).toBe(true)
  })

  it('rejects imported timestamps outside the JavaScript Date range', () => {
    expect(activityRecordSchema.safeParse({ ...activity(3), dueAt: 8_640_000_000_000_000 }).success).toBe(true)
    expect(activityRecordSchema.safeParse({ ...activity(3), dueAt: 8_640_000_000_000_001 }).success).toBe(false)
    expect(personRecordSchema.safeParse({ ...person(1), availabilityConfirmedAt: Number.MAX_SAFE_INTEGER }).success).toBe(false)
    expect(talentSchemas.versionedId.safeParse({ id: id(1), expectedUpdatedAt: Number.MAX_SAFE_INTEGER }).success).toBe(false)
  })

  it('requires ordered stage history matching current state and unique immutable submission identities', () => {
    expect(assignmentRecordSchema.safeParse(assignment(1)).success).toBe(true)
    expect(assignmentRecordSchema.safeParse({ ...assignment(1), stage: 'placed' }).success).toBe(false)
    expect(assignmentRecordSchema.safeParse({ ...assignment(1), stageHistory: [{ id: id(80), stage: 'sourced', at: 3 }] }).success).toBe(false)
    expect(assignmentRecordSchema.safeParse({ ...assignment(1), stageHistory: [...assignment(1).stageHistory, ...assignment(1).stageHistory] }).success).toBe(false)
    expect(talentSchemas.addSubmission.safeParse({ assignmentId: id(1), expectedUpdatedAt: 2, at: 2, recipient: 'Client', note: '', companyName: 'Forged snapshot' }).success).toBe(false)
  })

  it('separates unanswered questions, candidate statements and verified evidence', () => {
    const question = { id: id(80), criterionId: null, question: 'Tell me about your work.', answer: '', verification: 'unverified', answeredAt: null }
    expect(screeningQuestionSchema.safeParse(question).success).toBe(true)
    expect(screeningQuestionSchema.safeParse({ ...question, verification: 'verified' }).success).toBe(false)
    expect(screeningQuestionSchema.safeParse({ ...question, answeredAt: 2 }).success).toBe(false)
    expect(screeningQuestionSchema.safeParse({ ...question, answer: 'Managed a team of ten.', verification: 'candidate-stated', answeredAt: 2 }).success).toBe(true)
    expect(screeningQuestionSchema.safeParse({ ...question, answer: 'Reference checked.', verification: 'verified', answeredAt: 3 }).success).toBe(true)
  })
})

describe('contact identity and history preservation', () => {
  it('preserves conflicting source fields in notes while retaining the primary identity and manual values', () => {
    const primary = { ...person(1), email: 'new@example.com', note: 'Primary note', recordKeys: [key(1)], tags: ['referral'] }
    const secondary = { ...person(2), email: 'old@example.com', phone: '+96655555555', origin: 'library' as const, note: 'Original source note', recordKeys: [key(2)], skills: ['Python'], tags: ['referral', 'senior'] }
    expect(contactConflicts(primary, secondary)).toEqual(['name', 'email'])
    const merged = mergePeople(primary, secondary, 3)
    expect(merged).toMatchObject({ id: primary.id, email: primary.email, phone: secondary.phone, origin: 'prospect', recordKeys: [key(1), key(2)], tags: ['referral', 'senior'], skills: ['Python'], updatedAt: 3 })
    expect(merged.note).toContain('Primary note')
    expect(merged.note).toContain('Original source note')
    expect(merged.note).toContain('email: old@example.com')
    expect(primary.recordKeys).toEqual([key(1)])
    expect(personRecordSchema.safeParse(merged).success).toBe(true)
  })

  it('preserves both assignment histories, feedback and submissions when duplicate contacts share a job', () => {
    const primary = { ...assignment(1), note: 'Interview scheduled', nextAction: 'Meet panel', dueAt: 12 }
    const secondary: Assignment = { ...assignment(2), stage: 'contacted', note: 'Referred by manager', nextAction: 'Call source', dueAt: 10, clientFeedback: 'Interested',
      stageHistory: [...assignment(2).stageHistory, { id: id(150), stage: 'contacted', at: 2 }],
      submissions: [{ id: id(160), at: 1, companyId: id(40), companyName: 'Original client name', recipient: 'Client', note: 'Presented', feedback: 'Reviewing' }] }
    const merged = mergeAssignments(primary, secondary, 3, id(170))
    expect(merged.stageHistory).toHaveLength(4)
    expect(merged.stageHistory.at(-1)).toEqual({ id: id(170), stage: 'sourced', at: 3 })
    expect(merged.submissions).toEqual(secondary.submissions)
    expect(merged.note).toContain(secondary.note)
    expect(merged.note).toContain('Call source')
    expect(merged.clientFeedback).toBe('Interested')
    expect(merged.nextAction).toBe('Meet panel')
    expect(assignmentRecordSchema.safeParse(merged).success).toBe(true)
  })

  it('rejects ambiguous history identities instead of dropping either source', () => {
    const primary = assignment(1)
    const secondary = { ...assignment(2), stageHistory: [{ ...primary.stageHistory[0], at: 2 }] }
    expect(() => mergeAssignments(primary, secondary, 3, id(170))).toThrow('histories conflict')
  })

  it('retains conflicting due dates even for identical or empty next-action text', () => {
    const primary = { ...assignment(1), nextAction: 'Call', dueAt: 200 }
    const secondary = { ...assignment(2), nextAction: 'Call', dueAt: 100 }
    const sameAction = mergeAssignments(primary, secondary, 3, id(170))
    expect(sameAction.dueAt).toBe(200)
    expect(sameAction.note).toContain(`Merged follow-up due: ${new Date(100).toISOString()}`)
    const withoutText = mergeAssignments({ ...primary, nextAction: '' }, { ...secondary, nextAction: '' }, 3, id(170))
    expect(withoutText.dueAt).toBe(200)
    expect(withoutText.note).toContain(new Date(100).toISOString())
    const dateOnlyPrimary = mergeAssignments({ ...primary, nextAction: '' }, { ...secondary, dueAt: null }, 3, id(170))
    expect(dateOnlyPrimary.dueAt).toBe(200)
    expect(dateOnlyPrimary.note).toContain('Merged next action: Call')
    const emptyPrimary = mergeAssignments(assignment(1), secondary, 3, id(170))
    expect(emptyPrimary).toMatchObject({ nextAction: 'Call', dueAt: 100 })
  })

  it('requires both exact contact versions before committing an explicit merge', () => {
    expect(talentSchemas.mergeContacts.safeParse({ primaryId: id(1), secondaryId: id(2), expectedPrimaryUpdatedAt: 2, expectedSecondaryUpdatedAt: 2 }).success).toBe(true)
    expect(talentSchemas.mergeContacts.safeParse({ primaryId: id(1), secondaryId: id(2), expectedPrimaryUpdatedAt: 2 }).success).toBe(false)
    expect(talentSchemas.previewMerge.safeParse({ primaryId: id(1), secondaryId: id(1) }).success).toBe(false)
  })
})

describe('screening plans and reusable talent searches', () => {
  it('generates unanswered prompts only for criteria still needing evidence or clarification', () => {
    const criteria = [1, 2, 3, 4].map((value) => ({ id: `criterion-${value}`, text: `Skill ${value}`, importance: 'required' as const }))
    const assessments = [{ criterionId: 'criterion-1', status: 'confirmed' as const, note: 'Checked' }, { criterionId: 'criterion-2', status: 'evidence-found' as const, note: '' }, { criterionId: 'criterion-3', status: 'needs-clarification' as const, note: '' }]
    let next = 200
    const questions = planScreeningQuestions(criteria, assessments, () => id(next++))
    expect(questions.map((question) => question.criterionId)).toEqual(['criterion-3', 'criterion-4'])
    expect(questions.every((question) => question.answer === '' && question.verification === 'unverified' && question.answeredAt === null)).toBe(true)
    expect(planScreeningQuestions(criteria, [], () => id(next++), 'ar')[0].question).toBe('صف خبرتك في: Skill 1')
    expect(planScreeningQuestions([], [], () => id(next++), 'ar')).toHaveLength(3)
  })

  it('combines bilingual text, CV availability and genuine contact history filters', () => {
    const candidate = { ...person(1), name: 'أحمد', employer: 'شركة الطاقة', location: 'الدمام', skills: ['Python', 'Kubernetes'], tags: ['Senior'], availability: 'Available in October', recordKeys: [key(1)] }
    const filters = { ...EMPTY_TALENT_FILTERS, query: 'أحمد', location: 'دمام', employer: 'الطاقة', skill: 'python', tag: 'senior', hasCv: 'yes' as const, notContactedSince: 5 }
    expect(matchesTalentFilters(candidate, filters, [])).toBe(true)
    expect(matchesTalentFilters(candidate, filters, [activity(3)])).toBe(false)
    expect(matchesTalentFilters(candidate, filters, [{ ...activity(3), kind: 'note' }])).toBe(true)
    expect(matchesTalentFilters(candidate, { ...filters, hasCv: 'no' }, [])).toBe(false)
  })

  it('preserves manual memberships and highlights newly added members after review', () => {
    const manual = pool()
    expect(peopleInPool(manual, [person(1), person(2)], [])).toEqual([person(1)])
    expect(newPoolPeople(manual, [person(1)])).toHaveLength(1)
    expect(newPoolPeople({ ...manual, lastReviewedAt: 5 }, [person(1)])).toHaveLength(0)
    expect(peopleInPool({ ...manual, mode: 'search', filters: { ...EMPTY_TALENT_FILTERS, query: 'Person 2' } }, [person(1), person(2)], [])).toEqual([person(2)])
    expect(newPoolPeople(manual, [person(1), person(2)])).toEqual([person(1)])
    expect(newPoolPeople({ ...manual, lastReviewedAt: null }, [person(1), person(2)])).toEqual([person(1), person(2)])
  })

  it('filters whole pools using the contact cutoff and excludes reminders from outreach history', () => {
    const people = [person(1), person(2), person(3)]
    const activities = [activity(10), { ...activity(11), personId: id(2), occurredAt: 4 }, { ...activity(12), personId: id(3), kind: 'follow-up' as const }]
    expect(filterTalentPeople({ ...EMPTY_TALENT_FILTERS, notContactedSince: 5 }, people, activities)).toEqual([person(2), person(3)])
    expect(filterTalentPeople(EMPTY_TALENT_FILTERS, people, activities)).toEqual(people)
  })
})

describe('portable CRM reference checks', () => {
  it('rejects dangling contact/job/CV/company references and duplicate job assignments', () => {
    const data = overview()
    data.people[0].recordKeys = [key(1)]
    data.activities = [activity(3)]
    data.assignments = [assignment(1)]
    data.pools = [pool()]
    const check = (value: TalentOverview) => assertTalentReferences(value, new Set([id(30)]), new Set([id(40)]), new Set([key(1)]))
    expect(() => check(data)).not.toThrow()
    expect(() => check({ ...data, people: [person(2)] })).toThrow('unknown contact')
    expect(() => check({ ...data, people: [{ ...person(1), recordKeys: [key(99)] }, person(2)] })).toThrow('unknown CV')
    expect(() => check({ ...data, activities: [{ ...activity(3), jobId: id(99) }] })).toThrow('unknown contact or job')
    expect(() => check({ ...data, assignments: [assignment(1), { ...assignment(1), id: id(9) }] })).toThrow('same job twice')
    const submitted = { ...assignment(1), submissions: [{ id: id(160), at: 1, companyId: id(99), companyName: 'Missing', recipient: '', note: '', feedback: '' }] }
    expect(() => check({ ...data, assignments: [submitted] })).toThrow('unknown company')
    expect(() => check({ ...data, pools: [{ ...pool(), members: [{ personId: id(99), addedAt: 1 }] }] })).toThrow('unknown contact')
  })

  it('never allows the same CV identity to create competing contacts', () => {
    const data = overview()
    data.people = [{ ...person(1), recordKeys: [key(1)] }, { ...person(2), recordKeys: [key(1)] }]
    expect(() => assertTalentReferences(data, new Set(), new Set(), new Set([key(1)]))).toThrow('more than one contact')
  })
})

describe('saved-search review membership', () => {
  const prospect = (value: number, fields: Partial<Person>): Person => ({ ...person(value), ...fields })
  const savedSearch: TalentPool = { id: id(90), name: 'Platform engineers', note: '', mode: 'search', filters: { ...EMPTY_TALENT_FILTERS, skill: 'TypeScript' }, members: [{ personId: id(1), addedAt: 20 }], lastReviewedAt: 20, createdAt: 1, updatedAt: 20 }

  it('flags an existing prospect who newly matches after an edit, without flagging routine edits to a reviewed match', () => {
    const reviewed = prospect(1, { skills: ['TypeScript'], note: 'Updated recruiter note', updatedAt: 30 })
    const changed = prospect(2, { skills: ['TypeScript'], updatedAt: 30 })
    const noMatch = prospect(3, { updatedAt: 30 })
    const matches = peopleInPool(savedSearch, [reviewed, changed, noMatch], [])
    expect(matches).toEqual([reviewed, changed])
    expect(newPoolPeople(savedSearch, matches)).toEqual([changed])
  })

  it('flags an older prospect who becomes eligible after linking a CV', () => {
    const pool = { ...savedSearch, filters: { ...EMPTY_TALENT_FILTERS, hasCv: 'yes' as const }, members: [] }
    const before = prospect(4, {})
    expect(peopleInPool(pool, [before], [])).toEqual([])
    const after = { ...before, recordKeys: [key(1)], updatedAt: 30 }
    expect(newPoolPeople(pool, peopleInPool(pool, [after], []))).toEqual([after])
  })

  it('clears new matches once the search is reviewed', () => {
    const candidate = prospect(2, { skills: ['TypeScript'] })
    expect(newPoolPeople({ ...savedSearch, members: [...savedSearch.members, { personId: candidate.id, addedAt: 30 }], lastReviewedAt: 30 }, [candidate])).toEqual([])
  })
})
