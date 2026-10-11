import { describe, it, expect } from 'vitest'
import { splitSections, sectionText } from '../src/main/ingest/sections.js'

const RESUME = `Jane Doe
jane@example.com

SUMMARY
Backend engineer with a decade of distributed systems work.

WORK EXPERIENCE
Acme Corp — Senior Engineer
Jan 2019 - Present
Built payment services in Go.

EDUCATION
BSc Computer Science, 2014

TECHNICAL SKILLS
Go, Kubernetes, PostgreSQL`

describe('splitSections', () => {
  it('labels each region by its heading', () => {
    const kinds = splitSections(RESUME).map((s) => s.kind)
    expect(kinds).toEqual(['other', 'summary', 'experience', 'education', 'skills'])
  })

  it('puts the header block before any heading into `other`', () => {
    const first = splitSections(RESUME)[0]
    expect(first.kind).toBe('other')
    expect(first.text).toContain('Jane Doe')
  })

  it('scopes section text correctly', () => {
    expect(sectionText(splitSections(RESUME), 'experience')).toContain('Acme Corp')
    expect(sectionText(splitSections(RESUME), 'experience')).not.toContain('BSc')
  })

  it('does not mistake a sentence for a heading', () => {
    const text = 'I have five years of experience building distributed systems for banks.'
    expect(splitSections(text).map((s) => s.kind)).toEqual(['other'])
  })

  it('still returns something for a resume with no headings at all', () => {
    const sections = splitSections('Just some unstructured text about a person.')
    expect(sections).toHaveLength(1)
    expect(sections[0].kind).toBe('other')
  })

  it('recognises heading variants', () => {
    for (const heading of ['EXPERIENCE', 'Professional Experience', 'Employment History']) {
      const sections = splitSections(`${heading}\nDid things at a company.`)
      expect(sections.some((s) => s.kind === 'experience')).toBe(true)
    }
  })

  it('recognises Markdown headings while retaining job subheadings as evidence', () => {
    const text = `# Candidate\n\n## Professional summary\nExperienced engineer.\n\n## Employment\n### Engineer — Example Wells | 2019–2023\nDelivered drilling projects.\n\n## Education and training\nBSc Engineering.`
    const sections = splitSections(text)
    expect(sections.map((section) => section.kind)).toEqual(['other', 'summary', 'experience', 'education'])
    expect(sectionText(sections, 'experience')).toBe('### Engineer — Example Wells | 2019–2023\nDelivered drilling projects.')
    expect(sectionText(sections, 'summary')).toBe('Experienced engineer.')
  })

  it('recognises Arabic section labels with and without Markdown', () => {
    const text = `أحمد القحطاني\n\n## الملخص المهني\nمهندس حفر.\n\nالخبرات العملية:\nأشرفت على مشاريع الحفر.\n\n**التعليم والتطوير**\nبكالوريوس هندسة.\n\n### المهارات التقنية ###\nإدارة الآبار.\n\nالمشاريع\nمشروع تطوير الحقل.`
    const sections = splitSections(text)
    expect(sections.map((section) => section.kind)).toEqual(['other', 'summary', 'experience', 'education', 'skills', 'projects'])
    expect(sectionText(sections, 'experience')).toBe('أشرفت على مشاريع الحفر.')
    expect(sectionText(sections, 'education')).toBe('بكالوريوس هندسة.')
  })

  it('handles Arabic diacritics and letter variants only in heading comparison', () => {
    const text = 'الْخِبْرَة الْعَمَلِيَّة\nخِبْرَة موثّقة.\nالمؤهلات الأكاديمية\nبكالوريوس.'
    expect(splitSections(text).map((section) => section.kind)).toEqual(['experience', 'education'])
    expect(sectionText(splitSections(text), 'experience')).toBe('خِبْرَة موثّقة.')
  })

  it('keeps short prose and inline lists that start with section words', () => {
    const lines = [
      'Experience with Python', 'Summary of achievements', 'Skills include Kubernetes',
      'Skills: Python and SQL', 'Education in engineering', 'Projects delivered successfully',
      '## Experience with well design', 'الخبرة في تشغيل الحفارات', 'المهارات المطلوبة للمشروع',
      'التعليم ساعدني في التطور', 'ملخص عن إنجازاتي'
    ]
    for (const line of lines) {
      expect(splitSections(line)).toEqual([{ kind: 'other', text: line, start: 0 }])
    }
  })

  it('supports whole-line emphasis and Setext without putting decoration in evidence', () => {
    const text = '**Summary:**\nBuilt services.\n__Work experience__:\nDelivered systems.\nEducation\n---------\nBSc Engineering.\nSkills\n======\nPython and Go.'
    const sections = splitSections(text)
    expect(sections.map((section) => section.kind)).toEqual(['summary', 'experience', 'education', 'skills'])
    expect(sectionText(sections, 'education')).toBe('BSc Engineering.')
    expect(sectionText(sections, 'skills')).toBe('Python and Go.')
  })

  it('keeps exact source offsets after heading decoration, blank lines and indentation', () => {
    const text = '  Jane Doe 👩‍💻\r\n\r\n## Summary\r\n\r\n  Built systems.\r\n\r\nالخبرة العملية\r\n-----\r\n\r\n  أدرت المشروع.  '
    const sections = splitSections(text)
    expect(sections.map((section) => section.kind)).toEqual(['other', 'summary', 'experience'])
    for (const section of sections) {
      expect(text.slice(section.start, section.start + section.text.length)).toBe(section.text)
    }
    expect(sections[2].start).toBe(text.indexOf('أدرت'))
  })
})
