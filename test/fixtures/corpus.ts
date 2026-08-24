/**
 * Synthetic resumes across three deliberately distinct professions, plus a job
 * description for each. Used by ranking-sanity.test.ts to prove the retrieval
 * pipeline actually separates them.
 */

export type Profession = 'backend' | 'nurse' | 'accountant'

export interface Fixture {
  id: string
  profession: Profession
  text: string
}

export const RESUMES: Fixture[] = [
  {
    id: 'be-1',
    profession: 'backend',
    text: `Maria Chen

SUMMARY
Backend engineer with nine years building distributed services.

WORK EXPERIENCE
Stripe — Senior Backend Engineer
Jan 2019 - Present
Designed and operated payment settlement services in Go and Python.
Ran the migration of forty services onto Kubernetes across three regions.
Owned Postgres schema design and query performance for the ledger.

Shopify — Backend Engineer
Jun 2015 - Dec 2018
Built REST and gRPC APIs serving two million requests per minute.

EDUCATION
BSc Computer Science, University of Toronto, 2015

TECHNICAL SKILLS
Go, Python, Kubernetes, Docker, PostgreSQL, Kafka, AWS, Terraform`
  },
  {
    id: 'be-2',
    profession: 'backend',
    text: `Daniel Okafor

SUMMARY
Distributed systems engineer focused on reliability and scale.

WORK EXPERIENCE
Cloudflare — Staff Engineer
Mar 2017 - Present
Led the design of an edge caching layer written in Rust and Go.
Reduced p99 latency by 60% through connection pooling and better sharding.
Introduced service-level objectives and on-call runbooks for twelve services.

EDUCATION
MSc Distributed Computing, Imperial College London, 2016

TECHNICAL SKILLS
Go, Rust, Kubernetes, Redis, Kafka, Prometheus, Grafana, Linux, CI/CD`
  },
  {
    id: 'be-3',
    profession: 'backend',
    text: `Priya Raman

SUMMARY
Python backend developer building data-heavy APIs.

WORK EXPERIENCE
Monzo — Backend Engineer
Feb 2018 - Present
Built transaction categorisation services in Python with FastAPI and PostgreSQL.
Deployed and monitored containerised workloads on AWS EKS.

EDUCATION
BSc Software Engineering, 2017

TECHNICAL SKILLS
Python, FastAPI, PostgreSQL, Docker, Kubernetes, AWS, REST APIs, Git`
  },
  {
    id: 'be-4',
    profession: 'backend',
    text: `Tom Nilsson

SUMMARY
Platform engineer with a decade of infrastructure automation.

WORK EXPERIENCE
Klarna — Platform Engineer
Jan 2016 - Present
Automated cluster provisioning with Terraform and Ansible.
Maintained CI/CD pipelines running eight thousand builds per day.
Operated Kubernetes clusters and the observability stack.

EDUCATION
BSc Computer Engineering, 2015

TECHNICAL SKILLS
Terraform, Ansible, Kubernetes, Docker, Jenkins, Linux, Go, AWS`
  },

  {
    id: 'rn-1',
    profession: 'nurse',
    text: `Aisha Rahman

SUMMARY
Registered nurse with eight years in paediatric intensive care.

WORK EXPERIENCE
Great Ormond Street Hospital — Senior Staff Nurse, PICU
Jan 2018 - Present
Delivered direct patient care to critically ill children on ventilator support.
Administered medication and managed IV therapy for complex cases.
Mentored newly qualified nurses through their preceptorship year.

EDUCATION
BSc Nursing, King's College London, 2016

SKILLS
Patient assessment, intensive care, medication administration, BLS, ACLS,
infection control, care planning, electronic health records`
  },
  {
    id: 'rn-2',
    profession: 'nurse',
    text: `Grace Mbeki

SUMMARY
Emergency department nurse experienced in high-acuity triage.

WORK EXPERIENCE
St Thomas' Hospital — Emergency Department Nurse
Mar 2017 - Present
Triaged up to ninety patients per shift in a major trauma centre.
Led resuscitation efforts as part of the cardiac arrest team.
Documented clinical notes and discharge planning in the EHR system.

EDUCATION
BSc Nursing, 2016

SKILLS
Triage, trauma care, CPR, ACLS, phlebotomy, patient care, clinical documentation`
  },
  {
    id: 'rn-3',
    profession: 'nurse',
    text: `Elena Popescu

SUMMARY
Critical care nurse with a decade on adult intensive care units.

WORK EXPERIENCE
Royal Free Hospital — Charge Nurse, ICU
Jun 2014 - Present
Supervised nursing staff across a sixteen-bed intensive care unit.
Managed ventilated patients and titrated vasoactive infusions.
Led the unit's infection control and sterile technique audits.

EDUCATION
MSc Advanced Clinical Practice, 2019
BSc Nursing, 2013

SKILLS
Critical care, ventilator management, infection control, care plans,
patient assessment, BLS, staff supervision`
  },

  {
    id: 'ac-1',
    profession: 'accountant',
    text: `James Whitfield

SUMMARY
Chartered accountant specialising in financial reporting and audit.

WORK EXPERIENCE
Deloitte — Audit Manager
Jan 2017 - Present
Led external audit engagements for FTSE 250 manufacturing clients.
Reviewed consolidated financial statements under IFRS.
Managed month-end and year-end close processes for six entities.

EDUCATION
ACCA qualified, 2016
BSc Accounting and Finance, 2013

SKILLS
IFRS, external audit, financial reporting, general ledger, SAP, Excel, taxation`
  },
  {
    id: 'ac-2',
    profession: 'accountant',
    text: `Fatima Al-Harbi

SUMMARY
Financial controller with nine years in corporate finance.

WORK EXPERIENCE
Aramco — Financial Controller
Feb 2016 - Present
Owned the monthly close, budgeting and forecasting cycle for a business unit.
Built financial models supporting capital allocation decisions.
Ensured compliance with IFRS and internal control frameworks.

EDUCATION
CPA, 2018
BSc Accounting, 2014

SKILLS
Financial reporting, budgeting, forecasting, IFRS, internal audit,
SAP, Excel, financial modelling`
  },
  {
    id: 'ac-3',
    profession: 'accountant',
    text: `Robert Iwu

SUMMARY
Management accountant focused on tax compliance and reporting.

WORK EXPERIENCE
Unilever — Senior Management Accountant
Apr 2015 - Present
Prepared corporate tax computations and VAT returns across three jurisdictions.
Maintained the general ledger and reconciled accounts payable and receivable.
Produced monthly management accounts and variance analysis.

EDUCATION
CPA, 2017
BSc Economics, 2012

SKILLS
Taxation, VAT, general ledger, accounts payable, financial reporting,
QuickBooks, Excel, compliance`
  }
]

export const JOB_DESCRIPTIONS: Record<Profession, string> = {
  backend: `Senior Backend Engineer

We are hiring a senior backend engineer to join our platform team.

Requirements:
- Five or more years building production backend services
- Strong experience with Go or Python
- Deep familiarity with Kubernetes and containerised deployments
- Experience designing and operating PostgreSQL at scale
- Comfortable owning services end to end, including on-call
- Experience with AWS and infrastructure as code`,

  nurse: `Registered Nurse — Intensive Care Unit

We are recruiting a registered nurse for our adult intensive care unit.

Requirements:
- Valid nursing registration with ICU experience
- Confident managing ventilated and critically ill patients
- Skilled in patient assessment and medication administration
- Current BLS and ACLS certification
- Strong infection control and sterile technique
- Accurate clinical documentation in electronic health records`,

  accountant: `Financial Reporting Accountant

We are looking for a qualified accountant to join our finance team.

Requirements:
- CPA or ACCA qualification
- Strong knowledge of IFRS and financial reporting standards
- Experience owning month-end and year-end close
- Preparation of consolidated financial statements
- General ledger maintenance and account reconciliation
- Advanced Excel; SAP experience is a plus`
}

/**
 * Arabic counterparts. The app is Arabic-named and Arabic CVs are a real case,
 * so the multilingual model has to be exercised on them rather than assumed to
 * work. These mirror the English professions so cross-lingual retrieval can be
 * checked in both directions.
 */
export const ARABIC_RESUMES: Fixture[] = [
  {
    id: 'ar-be',
    profession: 'backend',
    text: `سارة العتيبي

نبذة
مهندسة برمجيات خلفية بخبرة تسع سنوات.

الخبرة العملية
شركة الدفع الرقمي - مهندسة برمجيات أول
يناير 2019 - ديسمبر 2023
صممت وشغّلت خدمات تسوية المدفوعات باستخدام Go و Python.
قدت ترحيل أربعين خدمة إلى Kubernetes عبر ثلاث مناطق.
مسؤولة عن تصميم قواعد بيانات PostgreSQL وأدائها.

التعليم
بكالوريوس علوم الحاسب، 2015

المهارات
Go, Python, Kubernetes, Docker, PostgreSQL, AWS, Terraform`
  },
  {
    id: 'ar-rn',
    profession: 'nurse',
    text: `نورة القحطاني

نبذة
ممرضة مسجلة بخبرة ثماني سنوات في العناية المركزة للأطفال.

الخبرة العملية
مستشفى الملك فيصل التخصصي - ممرضة أولى
يناير 2018 - ديسمبر 2023
تقديم الرعاية المباشرة للأطفال الحرجين على أجهزة التنفس الصناعي.
إعطاء الأدوية وإدارة العلاج الوريدي للحالات المعقدة.

التعليم
بكالوريوس تمريض، 2016

المهارات
العناية المركزة، إعطاء الأدوية، مكافحة العدوى`
  },
  {
    id: 'ar-ac',
    profession: 'accountant',
    text: `خالد الشهراني

نبذة
محاسب قانوني معتمد بخبرة في التقارير المالية والتدقيق.

الخبرة العملية
شركة التدقيق العربية - مدير تدقيق
يناير 2017 - ديسمبر 2023
إعداد القوائم المالية الموحدة وفق المعايير الدولية IFRS.
إدارة إقفال نهاية الشهر والسنة لعدة منشآت.

التعليم
بكالوريوس محاسبة، 2013

المهارات
IFRS, التدقيق الخارجي, التقارير المالية, SAP, Excel`
  }
]

/** Arabic postings, mirroring JOB_DESCRIPTIONS. */
export const ARABIC_JOB_DESCRIPTIONS: Record<Profession, string> = {
  backend: `مهندس برمجيات خلفية أول

المتطلبات:
- خبرة خمس سنوات أو أكثر في بناء الخدمات الخلفية
- خبرة قوية بـ Go أو Python
- معرفة عميقة بـ Kubernetes والحاويات
- خبرة في تشغيل PostgreSQL على نطاق واسع`,

  nurse: `ممرضة مسجلة - وحدة العناية المركزة

المتطلبات:
- ترخيص تمريض سارٍ مع خبرة في العناية المركزة
- القدرة على إدارة المرضى على أجهزة التنفس
- مهارة في تقييم المرضى وإعطاء الأدوية`,

  accountant: `محاسب تقارير مالية

المتطلبات:
- شهادة محاسب قانوني معتمد
- معرفة قوية بمعايير IFRS والتقارير المالية
- خبرة في إقفال نهاية الشهر والسنة`
}
