import { describe, expect, it, vi } from 'vitest'
import {
  fingerprintSkillGazetteer,
  planSkillBackfill,
  SKILL_GAZETTEER_VERSION,
  type SkillDefinition
} from '../src/main/ingest/skills-backfill-plan.js'

describe('skill gazetteer version', () => {
  const definitions: SkillDefinition[] = [
    { id: 'python', label: 'Python', aliases: ['بايثون', 'Python 3'] },
    { id: 'sql', label: 'SQL', aliases: ['Structured Query Language'] }
  ]

  it('is stable across non-semantic ordering changes', () => {
    const reordered = [
      definitions[1],
      { ...definitions[0], aliases: [...definitions[0].aliases].reverse() }
    ]
    expect(fingerprintSkillGazetteer(reordered)).toBe(
      fingerprintSkillGazetteer(definitions)
    )
  })

  it('changes when a skill alias changes', () => {
    const changed = definitions.map((definition) =>
      definition.id === 'python'
        ? { ...definition, aliases: [...definition.aliases, 'Py'] }
        : definition
    )
    expect(fingerprintSkillGazetteer(changed)).not.toBe(
      fingerprintSkillGazetteer(definitions)
    )
  })
})

describe('skill backfill planning', () => {
  it('re-extracts stale rows and leaves current rows alone', () => {
    const extract = vi.fn((text: string) => (text.includes('Python') ? ['python'] : []))
    const updates = planSkillBackfill(
      [
        { id: 1, rawText: 'Python', skillsJson: '[]', skillsVersion: 'old' },
        {
          id: 2,
          rawText: 'SQL',
          skillsJson: '["sql"]',
          skillsVersion: SKILL_GAZETTEER_VERSION
        }
      ],
      extract
    )

    expect(updates).toEqual([
      {
        id: 1,
        skillsJson: '["python"]',
        skillsVersion: SKILL_GAZETTEER_VERSION
      }
    ])
    expect(extract).toHaveBeenCalledOnce()
  })
})
