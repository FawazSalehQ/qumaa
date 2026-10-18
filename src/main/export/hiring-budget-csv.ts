import { calculateHiringCosts, HIRING_COST_RULES_VERSION } from '@shared/hiring-costs.js'
import type { SavedHiringBudget } from '@shared/hiring-budget.js'
import type { Language } from '@shared/i18n.js'
import { hiringCostAssumptionTranslations } from '@shared/locales/hiring-costs-assumptions.js'

type CsvValue = string | { numeric: string }
const labels: Record<string, [string, string]> = {
  field: ['Field', 'الحقل'], value: ['Value', 'القيمة'], unit: ['Unit', 'الوحدة'],
  plan: ['Hiring budget plan', 'خطة ميزانية التوظيف'], company: ['Company', 'الشركة'], job: ['Job', 'الوظيفة'],
  id: ['Plan ID', 'معرّف الخطة'], companyId: ['Company ID', 'معرّف الشركة'], jobId: ['Job ID', 'معرّف الوظيفة'], name: ['Plan name', 'اسم الخطة'],
  createdAt: ['Created at (UTC)', 'تاريخ الإنشاء (UTC)'], updatedAt: ['Updated at (UTC)', 'تاريخ التحديث (UTC)'],
  calculationVersion: ['Saved calculation version', 'إصدار الحساب المحفوظ'], rulesVersion: ['Calculation rules version', 'إصدار قواعد الحساب'], limitsVersion: ['Default wage limits version', 'إصدار حدود الأجر الافتراضية'],
  inputs: ['Inputs', 'المدخلات'], salary: ['Salary', 'الراتب'], eligibleSaudiPrivateSector: ['Eligible Saudi private-sector employee', 'موظف سعودي مؤهل في القطاع الخاص'],
  mode: ['Salary entry method', 'طريقة إدخال الراتب'], basicHalala: ['Basic salary', 'الراتب الأساسي'], housingHalala: ['Housing allowance', 'بدل السكن'],
  combinedHalala: ['Combined basic and housing', 'مجموع الأساسي والسكن'], basicPercentBps: ['Basic share', 'نسبة الأساسي'], housingPercentBps: ['Housing share', 'نسبة السكن'], transportHalala: ['Transport allowance', 'بدل النقل'],
  scheme: ['GOSI scheme', 'نظام التأمينات'], selectedMonth: ['Selected planning month', 'شهر التخطيط المختار'], periodStart: ['Budget period start', 'بداية فترة الميزانية'], periodEnd: ['Budget period end', 'نهاية فترة الميزانية'],
  employmentStartMonth: ['Expected employment start month', 'شهر بدء العمل المتوقع'], serviceMonthsAtStart: ['Elapsed service months at employment start', 'أشهر الخدمة المنقضية عند بدء العمل'], headcount: ['Headcount', 'عدد الموظفين'], approvedBudgetHalala: ['Approved budget for headcount and period', 'الميزانية المعتمدة لعدد الموظفين والفترة'],
  gosi: ['GOSI', 'التأمينات الاجتماعية'], minimumWageHalala: ['Minimum contribution wage', 'الحد الأدنى لأجر الاشتراك'], maximumWageHalala: ['Maximum contribution wage', 'الحد الأعلى لأجر الاشتراك'], limitNote: ['Basis for configured wage limits', 'أساس حدود أجر الاشتراك المحددة'],
  registeredWageHalala: ['Verified registered wage override', 'أجر الاشتراك المسجل المتحقق منه'], registeredWageNote: ['Basis for registered wage override', 'أساس التحقق من أجر الاشتراك المسجل'],
  eos: ['End-of-service provision', 'مخصص نهاية الخدمة'], includeBasic: ['Include basic in eligible EOS wage', 'تضمين الأساسي في أجر نهاية الخدمة'], includeHousing: ['Include housing in eligible EOS wage', 'تضمين السكن في أجر نهاية الخدمة'], includeTransport: ['Include transport in eligible EOS wage', 'تضمين النقل في أجر نهاية الخدمة'], notes: ['Notes', 'ملاحظات'],
  grossHalala: ['Gross salary', 'الراتب الإجمالي'], gosiBaseHalala: ['Basic plus housing before wage ceiling', 'الأساسي والسكن قبل سقف أجر الاشتراك'], gosiWageHalala: ['GOSI contribution wage', 'أجر الاشتراك في التأمينات'], eosWageHalala: ['Eligible EOS wage', 'الأجر المؤهل لنهاية الخدمة'], gosiWageSource: ['GOSI wage source', 'مصدر أجر الاشتراك'], gosiCeilingApplied: ['Contribution ceiling applied', 'تطبيق سقف أجر الاشتراك'],
  scenarios: ['Scenarios', 'السيناريوهات'], month: ['Month', 'الشهر'], rates: ['Contribution rates', 'نسب الاشتراك'], effectiveDate: ['Rate effective date', 'تاريخ سريان النسبة'],
  employeePensionBps: ['Employee pension rate', 'نسبة معاشات الموظف'], employeeSanedBps: ['Employee SANED rate', 'نسبة ساند للموظف'], employeeTotalBps: ['Total employee rate', 'إجمالي نسبة الموظف'], employerPensionBps: ['Employer pension rate', 'نسبة معاشات صاحب العمل'], employerSanedBps: ['Employer SANED rate', 'نسبة ساند لصاحب العمل'], occupationalHazardsBps: ['Occupational hazards rate', 'نسبة الأخطار المهنية'], employerTotalBps: ['Total employer rate', 'إجمالي نسبة صاحب العمل'],
  serviceMonths: ['Elapsed service months', 'أشهر الخدمة المنقضية'], eosDivisor: ['Monthly EOS wage divisor', 'مقسوم الأجر لمخصص نهاية الخدمة الشهري'], employeeGosiHalala: ['Employee GOSI deduction per person', 'خصم تأمينات الموظف للفرد'], takeHomeHalala: ['Estimated take-home salary per person', 'صافي الراتب التقديري للفرد'], employerGosiHalala: ['Employer GOSI cost per person', 'تكلفة تأمينات صاحب العمل للفرد'], eosProvisionHalala: ['Estimated monthly EOS provision per person', 'مخصص نهاية الخدمة الشهري التقديري للفرد'], employerCostHalala: ['Monthly employer cost per person', 'تكلفة صاحب العمل الشهرية للفرد'], headcountEmployerCostHalala: ['Monthly employer cost for headcount', 'تكلفة صاحب العمل الشهرية لجميع الموظفين'],
  annualizedEmployerCostHalala: ['Annualized per-person cost at constant month assumptions', 'التكلفة السنوية للفرد بافتراض ثبات بيانات الشهر'], annualizedHeadcountEmployerCostHalala: ['Annualized headcount cost at constant month assumptions', 'التكلفة السنوية لجميع الموظفين بافتراض ثبات بيانات الشهر'],
  forecast: ['Actual budget-period forecast', 'توقع فترة الميزانية الفعلية'], activeMonths: ['Active employment months in period', 'أشهر العمل الفعلية خلال الفترة'], months: ['Monthly forecast', 'التوقع الشهري'], perPersonTotalHalala: ['Period total per person', 'إجمالي الفترة للفرد'], totalHalala: ['Period total for headcount', 'إجمالي الفترة لجميع الموظفين'], budgetVarianceHalala: ['Remaining approved budget (negative means exceeded)', 'المتبقي من الميزانية المعتمدة (السالب يعني التجاوز)'],
  available: ['Calculation available', 'الحساب متاح'], active: ['Employment active in this month', 'العمل نشط في هذا الشهر'], reason: ['Reason unavailable', 'سبب عدم الإتاحة'], assumptions: ['Calculation assumptions', 'افتراضات الحساب'],
  existing: ['Existing scheme', 'النظام القائم'], new: ['New scheme', 'النظام الجديد'], compare: ['Compare both schemes', 'مقارنة النظامين'], components: ['Direct salary components', 'مكونات الراتب مباشرة'], combined: ['Combined basic and housing split', 'توزيع مجموع الأساسي والسكن'], registered: ['Verified registered wage', 'أجر مسجل متحقق منه'],
  'new-scheme-not-effective': ['New scheme not effective for this full planning month', 'النظام الجديد غير ساري لهذا الشهر التخطيطي الكامل'],
  yes: ['Yes', 'نعم'], no: ['No', 'لا'], notSet: ['Not set / not applicable', 'غير محدد / لا ينطبق'], SAR: ['SAR', 'ريال سعودي']
}


function csvCell(value: CsvValue): string {
  let text = typeof value === 'string' ? value : value.numeric
  if (typeof value === 'string' && (/^[\s]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** Preserve all halalas even at the upper safe-integer boundary. */
function hundredths(value: number): string {
  const integer = BigInt(value)
  const absolute = integer < 0n ? -integer : integer
  return `${integer < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/** A long-form CSV keeps the complete auditable forecast and original inputs. */
export function hiringBudgetCsv(plan: SavedHiringBudget, companyName: string, jobTitle: string, language: Language): string {
  if (plan.calculationVersion !== HIRING_COST_RULES_VERSION) throw new Error('Unsupported hiring budget calculation version.')
  const result = calculateHiringCosts(plan.inputs)
  const l = (key: string): string => labels[key]?.[language === 'ar' ? 1 : 0] ?? key
  const rows: CsvValue[][] = [[l('field'), l('value'), l('unit')]]
  const row = (path: string[], value: unknown): void => {
    const key = path.at(-1)!
    const field = path.map(l).join(' / ')
    if (value === null) rows.push([field, l('notSet'), ''])
    else if (typeof value === 'boolean') rows.push([field, l(value ? 'yes' : 'no'), ''])
    else if (typeof value === 'number') rows.push([field, { numeric: /(?:Halala|Bps)$/.test(key) ? hundredths(value) : String(value) }, key.endsWith('Halala') ? l('SAR') : key.endsWith('Bps') ? '%' : ''])
    else rows.push([field, typeof value === 'string' ? (['scheme', 'mode', 'gosiWageSource', 'reason'].includes(key) ? l(value) : value) : String(value), ''])
  }
  const walk = (path: string[], value: unknown): void => {
    if (Array.isArray(value)) value.forEach((entry, index) => walk([...path, String(index + 1)], entry))
    else if (value !== null && typeof value === 'object') for (const [key, entry] of Object.entries(value)) walk([...path, key], entry)
    else row(path, value)
  }
  walk(['plan'], { id: plan.id, companyId: plan.companyId, company: companyName, jobId: plan.jobId, job: jobTitle, name: plan.name, calculationVersion: plan.calculationVersion, createdAt: new Date(plan.createdAt).toISOString(), updatedAt: new Date(plan.updatedAt).toISOString() })
  const assumptions = language !== 'ar' ? result.assumptions : result.assumptions.map((assumption) => {
    if (hiringCostAssumptionTranslations[assumption]) return hiringCostAssumptionTranslations[assumption]
    return assumption.replace(/^Verified registered GOSI wage override: /, 'أجر الاشتراك المسجل المتحقق منه بدلًا من الأجر المحسوب: ').replace(/^Configured contribution-wage limits: /, 'حدود أجر الاشتراك المحددة: ')
  })
  walk([], { ...result, assumptions })
  return `\ufeff${rows.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`
}
