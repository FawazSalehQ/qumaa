import { describe, it, expect } from 'vitest'
import { extractSkills, skillLabel } from '../src/main/ingest/skills.js'

describe('extractSkills', () => {
  it('matches canonical labels case-insensitively', () => {
    expect(extractSkills('experienced with PYTHON and postgresql')).toEqual(
      expect.arrayContaining(['python', 'postgresql'])
    )
  })

  it('resolves aliases to one canonical id', () => {
    expect(extractSkills('k8s')).toContain('kubernetes')
    expect(extractSkills('Kubernetes')).toContain('kubernetes')
    expect(extractSkills('golang')).toContain('go')
  })

  it('does not report the same skill twice for multiple aliases', () => {
    const found = extractSkills('k8s and Kubernetes and EKS')
    expect(found.filter((s) => s === 'kubernetes')).toHaveLength(1)
  })

  it('handles punctuation-bearing terms that \\b cannot', () => {
    expect(extractSkills('Built services in C++')).toContain('cpp')
    expect(extractSkills('C# and .NET')).toContain('csharp')
    expect(extractSkills('CI/CD pipelines')).toContain('cicd')
  })

  it('distinguishes C from C++', () => {
    expect(extractSkills('Wrote firmware in C.')).toContain('c')
    // The lookahead stops bare "C" from also firing on "C++".
    expect(extractSkills('C++ only')).not.toContain('c')
  })

  it('does not match a skill inside a longer word', () => {
    expect(extractSkills('scarcity')).not.toContain('c')
    expect(extractSkills('gopher')).not.toContain('go')
    expect(extractSkills('rusty pipes')).not.toContain('rust')
  })

  it('requires canonical capitalisation for one- and two-letter terms', () => {
    // Otherwise every resume containing the word "r" or "go" matches.
    expect(extractSkills('Proficient in R and Python')).toContain('r')
    expect(extractSkills('please go to the office')).not.toContain('go')
  })

  it('covers non-technical domains', () => {
    expect(extractSkills('Registered Nurse in the ICU')).toEqual(
      expect.arrayContaining(['nursing', 'icu'])
    )
    expect(extractSkills('CPA with IFRS reporting experience')).toEqual(
      expect.arrayContaining(['cpa', 'ifrs'])
    )
  })

  it('returns an empty list for text with no skills', () => {
    expect(extractSkills('the quick brown fox jumped')).toEqual([])
  })
})

describe('skillLabel', () => {
  it('maps ids to display names', () => {
    expect(skillLabel('kubernetes')).toBe('Kubernetes')
    expect(skillLabel('cicd')).toBe('CI/CD')
  })

  it('falls back to the id for anything unknown', () => {
    expect(skillLabel('not_a_real_skill')).toBe('not_a_real_skill')
  })
})
