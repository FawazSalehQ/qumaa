/* Capture the final packaged Arabic UI with isolated fictional data.
 * env -u ELECTRON_RUN_AS_NODE node presentations/arabic/source/capture-guide-ar.cjs
 * No real credentials, library records, or outbound API requests are used. */
const { captureGuide } = require('../../source/capture-guide.cjs')

const seedArabic = async () => {
      const people = [
        { name: 'لينا حسن', email: 'lina.hassan@example.com', phone: '+966501110001', location: 'الرياض', years: 9,
          skills: ['التدريب والتطوير', 'تهيئة الموظفين', 'سلامة الغذاء', 'القيادة', 'خدمة العملاء'],
          work: 'مديرة التدريب في مطاعم مائدة الأرز، من 2020 إلى الوقت الحاضر. قادت التدريب في ١٨ فرعًا للمطاعم في الرياض. صممت برامج تهيئة الموظفين وقاست نتائج التدريب لدى ٤٢٠ موظفًا من خلال ملاحظات المديرين وآراء الضيوف. قدمت التدريب بالعربية والإنجليزية. طورت ورش سلامة الغذاء ودربت ٣٥ مدير وردية. قلصت مدة استكمال التهيئة من ستة أسابيع إلى أربعة أسابيع.',
          salary: '١٨٬٠٠٠ ريال شهريًا', notice: '٣٠ يومًا', availability: 'متاحة من أكتوبر', tags: ['المطاعم والمقاهي', 'تدريب عدة فروع'], profileNote: 'أكدت مكالمة الفرز مسؤوليتها عن ١٨ فرعًا. يُطلب منها نموذج لخطة تهيئة الموظفين.',
          reviewNote: 'أدلة قوية على تدريب فرق المطاعم في عدة فروع. تُدعى لمكالمة فرز لتأكيد فترة الإشعار ومقاييس أثر التدريب.' },
        { name: 'عمر فارس', email: 'omar.faris@example.com', phone: '+966501110002', location: 'الرياض', years: 11,
          skills: ['التدريب والتطوير', 'القيادة', 'سلامة الغذاء', 'إدارة العمليات', 'خدمة العملاء'],
          work: 'مدرب العمليات الإقليمي في مجموعة بستان الزعفران للضيافة، من 2018 إلى الوقت الحاضر. قاد التدريب في ١٢ فرعًا للمطاعم. صمم برامج تهيئة الموظفين للمديرين الجدد وقاس نتائج التدريب باستخدام تدقيق الخدمة. قدم ورشًا بالإنجليزية ودرب المشرفين على سلامة الغذاء وخدمة العملاء. نسق خطط التدريب الفصلية وتابع الإكمال لدى ٣٠٠ موظف.',
          salary: '٢٠٬٠٠٠ ريال شهريًا', notice: '٦٠ يومًا', availability: 'متاح من نوفمبر', tags: ['المطاعم والمقاهي', 'تطوير المديرين'], profileNote: 'خبرة تشغيلية قوية. تُراجع أمثلة تقديم التدريب باللغة العربية.',
          reviewNote: 'خبرة قوية في تطوير المديرين وتدقيق الخدمة. يُؤكد تقديم التدريب باللغتين قبل المقابلة.' },
        { name: 'مايا ناصر', email: 'maya.nasser@example.com', phone: '+966501110003', location: 'جدة', years: 7,
          skills: ['التدريب والتطوير', 'تهيئة الموظفين', 'القيادة', 'خدمة العملاء'],
          work: 'أخصائية التعلم والتطوير في مجموعة المرفأ للتعلم، من 2019 إلى الوقت الحاضر. صممت برامج تهيئة الموظفين وتطوير القيادة لفرق خدمة التجزئة. قاست نتائج التدريب باختبارات قبل الدورات وبعدها. قدمت التدريب بالعربية والإنجليزية. أدارت محتوى نظام إدارة التعلم ويسرت ورشًا شهرية لعدد ١٥٠ موظفًا.',
          salary: '١٦٬٠٠٠ ريال شهريًا', notice: '٣٠ يومًا', availability: 'متاحة من أكتوبر', tags: ['ثنائية اللغة', 'تصميم التعلم'], profileNote: 'ترغب في الانتقال إلى الرياض. تُناقش خبرتها المباشرة في تدريب فرق المطاعم.',
          reviewNote: 'خبرة جيدة في تصميم التعلم. تُوضح خبرتها في المطاعم وموعد الانتقال إلى الرياض.' },
        { name: 'دانيال ريد', email: 'daniel.reed@example.com', phone: '+966501110004', location: 'الرياض', years: 8,
          skills: ['إدارة العمليات', 'سلامة الغذاء', 'خدمة العملاء', 'القيادة'],
          work: 'مدير عام مطعم في مطابخ درب الزيتون، من 2018 إلى الوقت الحاضر. أدار مطعمًا يضم ٤٥ موظفًا. درب الموظفين الجدد على سلامة الغذاء وخدمة الضيوف. قاد الجداول والمخزون ومراجعات الخدمة اليومية. طور أربعة مشرفين ودعم افتتاح فرع جديد. تتركز مسؤوليته التدريبية داخل فرع واحد.',
          salary: '١٧٬٠٠٠ ريال شهريًا', notice: '٣٠ يومًا', availability: 'متاح من أكتوبر', tags: ['تشغيل المطاعم', 'تطوير المشرفين'], profileNote: 'خبرة تشغيلية مباشرة في المطاعم. يحتاج نطاق التدريب الإقليمي إلى توضيح.',
          reviewNote: 'تُراجع قابلية الانتقال من إدارة فرع إلى قيادة برنامج تدريب لعدة فروع.' },
        { name: 'سارة منصور', email: 'sara.mansour@example.com', phone: '+966501110005', location: 'الدمام', years: 6,
          skills: ['إكسل', 'المحاسبة', 'التقارير المالية', 'إعداد الميزانيات'],
          work: 'محاسبة أولى في خدمات إمداد الأفق، من 2020 إلى الوقت الحاضر. أعدت التقارير المالية الشهرية وطابقت أرصدة الموردين وبنت الميزانيات السنوية. دربت محاسبين مبتدئين على ضوابط الإقفال الشهري. أعدت لوحات إكسل لمصروفات الأقسام وتعاونت مع المراجعين الخارجيين.',
          salary: '١٤٬٠٠٠ ريال شهريًا', notice: '٣٠ يومًا', availability: 'متاحة من أكتوبر', tags: ['المالية', 'التقارير'], profileNote: 'تتركز الخبرة في المالية والمحاسبة. تُحفظ للفرص المالية المناسبة.',
          reviewNote: 'لا يظهر نطاق كافٍ لقيادة تدريب المطاعم. يمكن مراجعة الملف لشاغر مالي لاحقًا.' },
        { name: 'نادية سالم', email: 'nadia.salem@example.com', phone: '+966501110006', location: 'الرياض', years: 5,
          skills: ['تهيئة الموظفين', 'التدريب والتطوير', 'خدمة العملاء'],
          work: 'منسقة الموارد البشرية والتدريب في مجموعة مقاهي العرعر، من 2021 إلى الوقت الحاضر. نسقت برامج تهيئة الموظفين لأربعة مقاهٍ. حافظت على سجلات التهيئة ونسقت تدريب خدمة العملاء وجمعت آراء المشاركين. دعمت إجراءات التوظيف وأعدت تقارير إكمال شهرية. قدمت جلسات تعريفية بالعربية والإنجليزية.',
          salary: '١٢٬٠٠٠ ريال شهريًا', notice: '٣٠ يومًا', availability: 'متاحة من أكتوبر', tags: ['تنسيق التدريب', 'المقاهي'], profileNote: 'خبرة في التنسيق والمتابعة. تُناقش جاهزيتها لقيادة برنامج متكامل.',
          reviewNote: 'تُراجع مسؤوليتها الفعلية عن تصميم التدريب وقياس نتائجه.' }
      ]
      const imported = []
      for (const p of people) {
        // Bilingual source headings keep extraction faithful to the same known
        // section parser used for the original English guide. CV body copy is Arabic.
        const text = `${p.name}\n${p.email}\n${p.phone}\nالموقع: ${p.location}، السعودية\n\nPROFESSIONAL SUMMARY\n${p.years} years of professional experience. خبرة مهنية في مجال العمل الموضح أدناه.\n\nWORK EXPERIENCE\n${p.work}\n\nEDUCATION\nبكالوريوس إدارة الأعمال، 2016. Bachelor of Business Administration.\n\nSKILLS\n${p.skills.join('، ')}`
        const result = await window.api.ingest.text(text, `${p.name}: السيرة الذاتية`)
        if (result.status !== 'imported') throw new Error(`Fictional import failed: ${p.name}: ${result.status}`)
        imported.push(result.resume)
      }
      const posting = {
        position: 'مدير التدريب والتطوير',
        jobDescription: 'قيادة التعلم والتطوير لمجموعة مطاعم ومقاهٍ نامية في الرياض. بناء برامج تهيئة موحدة للموظفين، وتطوير مديري المطاعم، وتحسين خدمة الضيوف في عدة فروع.',
        requirements: 'قيادة التدريب في عدة فروع للمطاعم\nتصميم برامج تهيئة الموظفين وقياس نتائج التدريب\nتقديم التدريب بالعربية والإنجليزية',
        educationAndCertifications: 'مؤهل ذو صلة أو خبرة مهنية مكافئة. تُعد شهادة تدريب المدربين ميزة إضافية.'
      }
      const criteria = [
        { id: 'multi-site', text: 'قيادة التدريب في عدة فروع للمطاعم', importance: 'required' },
        { id: 'outcomes', text: 'تصميم برامج تهيئة الموظفين وقياس نتائج التدريب', importance: 'required' },
        { id: 'languages', text: 'تقديم التدريب بالعربية والإنجليزية', importance: 'preferred' }
      ]
      const job = await window.api.recruiting.saveJob({ posting, status: 'open', criteria })
      for (const p of people) {
        const resume = imported.find(r => r.name === p.name)
        if (!resume) throw new Error(`Missing parsed Arabic name: ${p.name}`)
        await window.api.recruiting.saveProfile({ resume, name: p.name, email: p.email, phone: p.phone, location: p.location,
          yearsExperience: p.years, educationLevel: 'bachelors', skills: p.skills, expectedSalary: p.salary,
          noticePeriod: p.notice, availability: p.availability, preferredLocation: p.name === 'سارة منصور' ? 'الدمام' : 'الرياض', tags: p.tags, note: p.profileNote })
      }
      const workspace = await window.api.recruiting.searchJob(job.id)
      for (const [i, p] of people.entries()) {
        const match = workspace.response.results.find(m => m.resume.name === p.name)
        if (!match) throw new Error(`Missing candidate match: ${p.name}`)
        await window.api.recruiting.saveReview({ jobId: job.id, resume: match.resume, status: i < 2 ? 'shortlisted' : i === 4 ? 'not-proceeding' : 'maybe', order: (i + 1) * 1024,
          note: p.reviewNote,
          assessments: criteria.map((criterion, n) => ({ criterionId: criterion.id,
            status: i === 0 ? (n === 1 ? 'needs-clarification' : 'evidence-found') : (n === 2 ? 'needs-clarification' : 'evidence-found'),
            note: i === 0 && n === 0 ? 'تذكر السيرة ١٨ فرعًا للمطاعم و٤٢٠ موظفًا.' : i === 0 && n === 1 ? 'يُسأل عن طريقة قياس أثر التدريب بعد إطلاقه.' : i === 0 && n === 2 ? 'تذكر السيرة تقديم التدريب بالعربية والإنجليزية.' : i === 1 && n === 2 ? 'تُطلب أمثلة على تقديم التدريب بالعربية.' : 'تُراجع الأمثلة الواردة في السيرة أثناء مكالمة الفرز.' })) })
      }
      await window.api.settings.setTheme('light')
      await window.api.settings.setLanguage('ar')
      return { jobId: job.id, posting, criteria, names: ['لينا حسن', 'عمر فارس', 'مايا ناصر'], location: 'الرياض' }
    }

captureGuide({ language: 'ar', seed: seedArabic }).catch(error => { console.error(error); process.exitCode = 1 })
