# Arabic terminology

The Arabic interface uses one term per concept and one form per pattern. These decisions come from a consistency pass over every catalog in `src/shared/locales/` on 18 October 2026, made by Claude and checked by independent agent reviewers. A native speaker has not yet reviewed them; corrections from that review take precedence and should be recorded here.

When you add or change Arabic, use the term in the middle column and never reintroduce a rejected variant. Every literal `t('…')` string needs an entry; `test/i18n-coverage.test.ts` fails when one is missing.

| Concept | Use | Not |
| --- | --- | --- |
| job / vacancy | الوظيفة (pl. الوظائف) | الوظيفة الشاغرة / وظيفة شاغرة / الوظائف الشاغرة |
| role | الدور; الدور الوظيفي when it names the role being filled | الوظيفة for 'role' in the duplicate 'Describe the role…' placeholder |
| position / job description | المسمى الوظيفي; الوصف الوظيفي | none |
| job posting | الإعلان الوظيفي; bare الإعلان only as a back-reference | إعلان الوظيفة |
| candidate / hired candidate | المرشح; hired candidate = المرشح الذي تم تعيينه | المرشح المعيّن; 'تم تعيين: {name}' as a label |
| hire / placement | تعيين for a specific hire (تم تعيينه، التعيينات، بيانات التعيين); التوظيف for hiring in general | 'تم التوظيف' for the Placed stage; التوظيف for 'placements' |
| prospect | المرشح المحتمل | bare المرشح in 'Delete prospect and history' |
| contact (Recruiter desk person record) | الشخص / الأشخاص; بيانات الشخص | جهات الاتصال in wipe and backup lists; بيانات التواصل |
| contact information (email, phone) | بيانات الاتصال; حقول الاتصال | بيانات التواصل |
| job assignment | مهمة توظيف / مهام التوظيف (possessive مهام توظيفه); participle مرتبط بالوظيفة | مهمة وظيفة; مهام الوظائف; مهام وظائفه |
| activity | النشاط / الأنشطة | التواصل / سجل التواصل for activity |
| talent pool | مجموعة المواهب (pl. مجموعات المواهب); bare المجموعة only inside the pool workspace | قاعدة المواهب; bare عضويات المجموعات outside the pool workspace |
| CV / resume | السيرة الذاتية (pl. السير الذاتية). Plural-only count keys use '{count} من السير الذاتية'; singular keys keep '{count} سيرة ذاتية' | bare السيرة where the English names a CV; singular noun in plural count keys |
| recruiter profile | الملف التوظيفي (pl. الملفات التوظيفية), never a bare الملف | ملفات المرشحين for 'recruiter profiles'; bare الملف on Edit/Save profile and Profile notes |
| review | التقييم for a recruiter's candidate review and criterion assessment; المراجعة / راجع for checking something over | المراجعات الداخلية; ملاحظات المراجعة for candidate review notes |
| passage | المقطع (pl. المقاطع); matching passages = المقاطع المطابقة | المقتطف / المقتطفات; مقاطع المطابقة |
| pipeline | مسار المرشحين for the tab and standalone, written «مسار المرشحين» when a sentence names the tab; المسار in compounds | مسار التوظيف |
| file path | مسارات الملفات / مساراتها (always tied to الملفات) | bare المسارات المحلية |
| client presentation / client pack | عرض المرشحين للعميل for titles, tab and buttons; عرض المرشحين / العرض in sentences | ملف العرض للعميل; العرض للعميل; العرض المرسل للعميل |
| client feedback | ملاحظات العميل; short الملاحظات only on the buttons next to the field | تعليقات العميل; الرد; ملاحظات حول الترشيح |
| submission | الترشيح / الترشيحات (للعميل) | سجلات تقديمهم للعملاء (تقديم) |
| screening kit | استمارة فرز (pl. استمارات الفرز); a saved screening = الفرز; screening records = سجلات الفرز | نموذج فرز / نماذج الفرز / نماذج مكالمات الفرز |
| screening information | بيانات الفرز | معلومات الفرز |
| screening answer verification | بحسب إفادة المرشح (candidate stated); تحقّق منها مسؤول التوظيف (recruiter verified) | ذكرها المرشح |
| AI model | النموذج (pl. النماذج) | none (the screening kit moves to استمارة) |
| match / matches | المطابقة (process, tab, score: مطابقة بنسبة {score}٪); المطابقات (results); حدّث المطابقات / مطابقات الوظيفة | تطابق for the score; نتائج المطابقة; singular مطابقة الوظائف for results |
| local (on-device) matching | المطابقة المحلية | المطابقة العادية; المطابقة الأساسية |
| rerank | إعادة الترتيب; with a model or brand: باستخدام X; result badge: أعاد {model} الترتيب | بواسطة Claude; passive أُعيد الترتيب باستخدام {model} |
| provider | المزوّد (with shadda); خدمة stays as a classifier before brand names | جهة |
| redaction | حجب (بعد حجب البيانات الشخصية; ما يُحجب) | تنقيح |
| data shared with the provider | البيانات / الأدلة التي ستُرسل; المشاركة / مشاركة البيانات for the setting | الأدلة المشتركة |
| exact request | المحتوى الفعلي للطلب | كاملًا for 'exact' |
| ChatGPT/OpenAI account connection | ربط: اربط; أعد ربط الحساب (reconnect); مرتبط (status); ربط ChatGPT (the connection); بيانات ربط ChatGPT (stored or saved connection); حسابات ChatGPT المرتبطة (in data lists); لهذا الحساب المرتبط; طريقة الربط بـ OpenAI. اتصال is reserved for network connectivity, the local OAuth callback and contact information | متصل; أعد الاتصال; تعذّر الاتصال بـ ChatGPT; اتصال ChatGPT; اتصالات ChatGPT; تحقّق من الاتصال (for the account); الاتصال بمفتاح API; طريقة الاتصال بـ OpenAI |
| export | التصدير; export again = أعد التصدير | الصادرات; صدّره مجددًا |
| delete vs remove | حذف for permanent deletion; إزالة for taking an item out of a list, field or selection, and for keys | حذف on the × control that removes a field entry |
| reset | إعادة ضبط | إعادة تهيئة |
| end-of-service provision / eligible wage | مخصص نهاية الخدمة; الأجر المؤهل | مخصص مكافأة نهاية الخدمة; الأجر المستحق |
| per employee / start months (hiring costs) | لكل موظف; شهر بدء العمل (employment start); شهر بداية التوقع (forecast start) | للفرد in the UI row; شهر البداية for the employment start |
| GOSI registered-wage override | أجر الاشتراك المسجل المتحقق منه (بدلًا من الأجر المحسوب) | تجاوز |
| error and status verb spelling | تعذّر / تعذّرت, تحقّق, تغيّر / تغيّرت with shadda | تعذر; تعذرت; لم يمكن; تحقق; تغيرت |
| again | مجددًا; one Arabic form per identical English sentence (أجرِ البحث مجددًا; راجع… ثم أعد التصدير) | مرة أخرى; مجدداً; أعد تشغيل البحث |
| tanween al-fath | ًا (on the letter before the alef) | اً |
| digits and percent sign in static Arabic | Arabic-Indic digits and ٪; ISO YYYY-MM bounds stay Latin | Latin digits in prose; % |
| e.g. placeholders | مثال: X, also inside parentheses: (مثال: X) | مثل: as a placeholder prefix |
| buttons vs instructions | Buttons and menu items use the verbal noun (إنشاء، حفظ). Placeholders, select prompts, instructions and call-to-action headings use the imperative (ابحث، اختر) | أنشئ on buttons; البحث on search placeholders |
| count phrasing with a runtime {count} | Short labels and badges: 'Label: {count}'. Sentences: '(العدد: {count})'. Plural-only resume keys: '{count} من السير الذاتية' | bare '{count} + plural noun' in keys shown for any count; singular noun in plural keys |
| label: value lines | Noun label + colon + value; verb + في {date} for event timestamps | 'الموعد {date}' without colon; verb phrase 'تم تعيين: {name}' |
| return here | عُد (with damma) | عد |
| returned (data from a service or file) | أرجع / يُرجع (أرجع ChatGPT …، لم يُرجع النموذج …) | أعاد, which clashes with أعد in the same sentence |
