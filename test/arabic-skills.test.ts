import { describe, it, expect } from 'vitest'
import { extractSkills } from '../src/main/ingest/skills.js'
describe('arabic skills', () => {
  it('detects Arabic nursing terms', () => {
    expect(extractSkills('ممرضة مسجلة في العناية المركزة، إعطاء الأدوية ومكافحة العدوى'))
      .toEqual(expect.arrayContaining(['nursing','icu','medication_administration','infection_control']))
  })
  it('detects Arabic accounting terms', () => {
    expect(extractSkills('محاسب قانوني معتمد، التقارير المالية والتدقيق الخارجي'))
      .toEqual(expect.arrayContaining(['cpa','financial_reporting','auditing']))
  })
  it('still detects Latin terms inside Arabic text', () => {
    expect(extractSkills('خبرة في Kubernetes و PostgreSQL')).toEqual(expect.arrayContaining(['kubernetes','postgresql']))
  })
  it('matches through attached conjunctions and articles', () => {
    // Arabic glues و (and) and ال (the) onto the next word.
    expect(extractSkills('ومكافحة العدوى')).toContain('infection_control')
    expect(extractSkills('والتدقيق الخارجي')).toContain('auditing')
    expect(extractSkills('بالتقارير المالية')).toContain('financial_reporting')
  })

  it('does not match an Arabic term inside a longer Arabic word', () => {
    // "تدقيق" (audit) must not fire inside "التدقيقات" with the extra suffix
    expect(extractSkills('التدقيقاتي')).not.toContain('auditing')
  })
})
