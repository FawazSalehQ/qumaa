import { describe, expect, it } from 'vitest'
import { extractSkills } from '../src/main/ingest/skills.js'

// Independent engineering and adjacent-profession snippets. These are not
// copied from the frozen pilot candidates, vacancy or relevance labels.
const drillingSkills = new Set([
  'well_planning', 'casing_design', 'well_cementing', 'drilling_fluids',
  'drilling_hydraulics', 'torque_and_drag', 'well_control',
  'directional_drilling', 'bottomhole_assembly'
])

function detectedDrillingSkills(text: string): string[] {
  return extractSkills(text).filter((skill) => drillingSkills.has(skill)).sort()
}

describe('drilling vocabulary', () => {
  it('recognizes an English well-design work sample across independent disciplines', () => {
    const text = `Updated the drilling programme following new formation data.
      Verified casing string design and primary cementing calculations before approval.
      Compared wellbore hydraulics with measured pressures and revised torque & drag estimates.
      The crew then rehearsed the well-control procedure.`
    expect(detectedDrillingSkills(text)).toEqual([
      'casing_design', 'drilling_hydraulics', 'torque_and_drag',
      'well_cementing', 'well_control', 'well_planning'
    ])
  })

  it('recognizes the equivalent disciplines in independently authored Arabic work text', () => {
    const text = `راجعت تصميم الآبار بعد تحديث البيانات الجيولوجية.
      تحققت من تصميم أنابيب التغليف وسمنتة الآبار قبل اعتماد الخطة.
      قارنت هيدروليكا الحفر بنتائج القياس، وراجعت العزم والسحب.
      شاركت في تدريب عملي على التحكم في الآبار.`
    expect(detectedDrillingSkills(text)).toEqual([
      'casing_design', 'drilling_hydraulics', 'torque_and_drag',
      'well_cementing', 'well_control', 'well_planning'
    ])
  })

  it('keeps a fluids specialization separate from integrated well-design skills', () => {
    const english = 'Laboratory specialist: assessed drilling mud samples and additives.'
    const arabic = 'اختصاصي مختبر: فحص عينات موائع الحفر وتقييم المواد المضافة.'
    expect(detectedDrillingSkills(english)).toEqual(['drilling_fluids'])
    expect(detectedDrillingSkills(arabic)).toEqual(['drilling_fluids'])
  })

  it('recognizes directional and assembly work without implying casing or cementing expertise', () => {
    expect(detectedDrillingSkills(
      'Delivered directional drilling services; revised BHA selection after vibration analysis.'
    )).toEqual(['bottomhole_assembly', 'directional_drilling'])
    expect(detectedDrillingSkills(
      'قدمت خدمات الحفر الموجه وراجعت تجميعة قاع البئر بعد تحليل الاهتزازات.'
    )).toEqual(['bottomhole_assembly', 'directional_drilling'])
  })

  it('handles common punctuation and Arabic conjunctions without duplicate skills', () => {
    expect(detectedDrillingSkills(
      'Well-planning, well design; torque/drag and torque-and-drag.'
    )).toEqual(['torque_and_drag', 'well_planning'])
    expect(detectedDrillingSkills(
      'وبتصميم الابار، وهيدروليكا الحفر؛ والسيطرة على الابار.'
    )).toEqual(['drilling_hydraulics', 'well_control', 'well_planning'])
  })

  it.each([
    'Civil engineer: scheduled foundation drilling, concrete placement and soil testing.',
    'Mechanical technician: repaired hydraulics, pump casings and machine guards.',
    'Reservoir engineer: interpreted seismic data and production decline curves.',
    'Analyst: built SQL reports showing rig costs, NPT and AFE totals from supplied records.',
    'مهندس مدني: أشرفت على حفر أساسات المباني وصب الخرسانة وخطط الطوارئ.',
    'مهندس مكامن: حللت بيانات الإنتاج واختبارات الضغط وحددت فرص تطوير الحقل.',
    'فني صيانة: أصلحت الأنظمة الهيدروليكية ومعدات الفرز والتغليف.'
  ])('does not infer drilling expertise from adjacent work: %s', (text) => {
    expect(detectedDrillingSkills(text)).toEqual([])
  })

  it('does not match domain terms embedded in longer words', () => {
    expect(detectedDrillingSkills('well designer; directional drillingly; تصميم الآباري'))
      .toEqual([])
  })
})

describe('clinical emergency terminology', () => {
  it.each([
    'راجعت خطط الطوارئ وإجراءات الإخلاء بالمصنع.',
    'أشرفت على الفرز والتعبئة في المستودع.',
    'نسقت إغلاق صمامات البئر في حالات الطوارئ.'
  ])('does not label non-clinical emergencies or sorting as care: %s', (text) => {
    expect(extractSkills(text)).not.toContain('emergency_care')
  })

  it.each([
    'ممرضة في قسم الطوارئ، مسؤولة عن فرز المرضى.',
    'خبرة في طب الطوارئ والرعاية الطارئة.',
    'ممرض طوارئ: تقييم الحالات والفرز الطبي.',
    'Emergency nursing in an emergency department; triage and trauma care.'
  ])('preserves explicit clinical emergency skills: %s', (text) => {
    expect(extractSkills(text)).toContain('emergency_care')
  })
})
