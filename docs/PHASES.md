# خريطة مراحل مشروع زامو الطبي
# PHASES — Master Roadmap

| البند | القيمة |
|---|---|
| الإصدار | 1.0 |
| التاريخ | 2026-09-09 |
| آخر تحديث | 2026-09-09 |

---

# Current Project State

| البند | القيمة |
|---|---|
| Overall Progress | **53 / 87** مهمة مكتملة (60.9%) |
| Current Phase | **Phase 5** ✅ — التشغيل (مكتمل) |
| Current Task | — (في انتظار بدء Phase 6/7) |
| Last Passed Task | `ZAMO-OPS-045` — لوحة إدارة زامو |
| Blocked Tasks | 29 مهمة |
| Open Critical Questions | ~~OQ-003~~ · OQ-005 · OQ-007 · OQ-008 · OQ-009 · ~~OQ-010~~ · OQ-012 · OQ-013 · OQ-017 · ~~OQ-029~~ · OQ-032 · OQ-038 |
| Next Recommended Task | Phase 7 — الإشعارات و SLA (READY) |
| Overall Status | 🔄 **IN_PROGRESS** |

---

# Project Execution Order

```
Phase 0 — بوابة الاعتماد (لا كود)                    🔄 IN_PROGRESS
    │
    ▼
Phase 1 — الأساس التقني ─────────────────────┐       🔄 IN_PROGRESS
    │                                         │
    ▼                                         │
Phase 2 — بيانات العرض                        │       🔒 BLOCKED
    │                                         │
    ├──────────────┐                          │
    ▼              ▼                          │
Phase 3         Phase 4 ⛔                    │       🔒 / 🔴
(الاكتشاف)     (الحجز)                       │
    │              │                          │
    └──────┬───────┘                          │
           ▼                                  │
      Phase 5 (التشغيل)                       │       🔒 BLOCKED
           │                                  │
    ┌──────┼──────────┐                       │
    ▼      ▼          ▼                       │
Phase 6  Phase 7  Phase 8 ⛔                  │       🔴 / 🔒 / 🔴
(الوكيل) (إشعارات) (المال)                    │
    └──────┴──────────┘                       │
           ▼                                  │
      Phase 9 (النمو) ◄───────────────────────┘       🔒 BLOCKED
           │
           ▼
      Phase 10 (الإطلاق)                              🔒 BLOCKED
           │
           ▼
      🚀 FINAL LAUNCH
```

**الرموز:**
- ✅ `PASSED` — المرحلة مكتملة واختباراتها نجحت
- 🔄 `IN_PROGRESS` — قيد التنفيذ
- ⏳ `NOT_STARTED` — لم تبدأ
- 🔒 `BLOCKED` — محجوبة تقنياً (تعتمد على مرحلة سابقة)
- 🔴 `BLOCKED` — محجوبة بأسئلة حرجة مفتوحة
- ⛔ حجب مزدوج (تقني + أسئلة حرجة)

---

# Phase Status Summary

| Phase | الاسم | المهام | PASSED | الحالة | المحجوب عليه |
|---|---|---|---|---|---|
| 0 | بوابة الاعتماد | 4 | 3 | ⏳ `READY` (3/4 — GATE-003 ميداني) | — |
| 1 | الأساس التقني | 10 | 10 | ✅ `PASSED` | — |
| 2 | بيانات العرض | 8 | 8 | ✅ `PASSED` | — |
| 3 | الاكتشاف | 8 | 8 | ✅ `PASSED` | — |
| 4 | الجدولة والحجز | 10 | 10 | ✅ `PASSED` | — |
| 5 | التشغيل | 9 | 9 | ✅ `PASSED` | — |
| 6 | الوكيل الذكي | 9 | 0 | `NOT_STARTED` | Phase 3 ✅ · ~~OQ-005~~ (B-09) |
| 7 | الإشعارات و SLA | 7 | 7 | ✅ `PASSED` | ✅ Phase 4 مكتمل · ~~OQ-032~~ (B-33) · ~~OQ-027~~ (B-28) |
| 8 | المال | 9 | 0 | `NOT_STARTED` | Phase 5 |
| 9 | النمو والتقارير | 6 | 0 | `NOT_STARTED` | Phase 8 |
| 10 | التصلّب والإطلاق | 7 | 0 | `NOT_STARTED` | الكل |
| **الإجمالي** | | **87** | **60** | | |

---

# ═══════════════════════════════════════════════════
# Phase 0 — بوابة الاعتماد (Approval Gate)
# ═══════════════════════════════════════════════════

**Status:** `IN_PROGRESS`

## الهدف

إغلاق ما يمنع البناء الصحيح. **لا كود في هذه المرحلة.**

## ماذا ستضيف هذه المرحلة للمشروع؟

إجابات على الأسئلة الحرجة التي تحجب المراحل اللاحقة، واعتماد رسمي للمعمارية والحزمة التقنية وقائمة ما قبل التطوير.

## نطاق المرحلة

**يدخل:** إغلاق الأسئلة المفتوحة · اعتماد المعمارية · اعتماد الحزمة التقنية · مقابلات العيادات.
**لا يدخل:** أي كود أو بنية تقنية.

## Tasks

| # | Task ID | الاسم | الوصف | Dependencies | Status |
|---|---------|------|-------|--------------|--------|
| 1 | ZAMO-GATE-000 | إغلاق الأسئلة الحرجة | عرض OPEN_QUESTIONS.md والإجابة على الأسئلة | — | ✅ `DONE` |
| 2 | ZAMO-GATE-001 | اعتماد قائمة ما قبل التطوير | اعتماد المنتج + مالي + تقني + قانوني `[S2]` | — | ✅ `DONE` |
| 3 | ZAMO-GATE-002 | اعتماد المعمارية | Modular Monolith + الحزمة التقنية + PostgreSQL + جدول الانتقالات | — | ✅ `DONE` |
| 4 | ZAMO-GATE-003 | تنفيذ الخطوة السادسة | مقابلات 5–8 عيادات + اختبار استخدام + مؤشرات القبول | — | ⏳ `READY` (حقيبة التنفيذ جاهزة — ميداني) |

## Task Details

### ZAMO-GATE-000 — إغلاق الأسئلة الحرجة

- **الهدف:** إغلاق الأسئلة التي تحجب المراحل.
- **الوصف:** عرض `OPEN_QUESTIONS.md` على صاحب المشروع ونقل كل إجابة إلى `DECISIONS.md`.
- **Dependencies:** لا يوجد.
- **Acceptance Criteria:** كل سؤال حرج مُجاب ومسجّل في DECISIONS.md.
- **Required Tests:** لا يوجد (مهمة إدارية).
- **Security Considerations:** لا ينطبق.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** B-01 → B-05 (أُغلقت).
- **Related Open Questions:** كل الأسئلة في OPEN_QUESTIONS.md.
- **Completion Condition:** كل الأسئلة الحرجة مُجابة.

### ZAMO-GATE-001 — اعتماد قائمة ما قبل التطوير `[S2]`

- **الهدف:** اعتماد البنود الـ20 المطلوبة قبل التطوير.
- **الوصف:** 4 مجموعات: اعتماد المنتج (5 بنود) · اعتماد مالي (5 بنود) · اعتماد تقني (5 بنود) · اعتماد قانوني وخصوصية (5 بنود).
- **Dependencies:** لا يوجد.
- **Acceptance Criteria:** كل بند معتمد أو مسجّل كقرار مؤجل مع سبب.
- **Required Tests:** لا يوجد.
- **Security Considerations:** بند «اعتماد قانوني وخصوصية» يشمل حماية البيانات.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** DEC-001 → DEC-020.
- **Related Open Questions:** OQ-004 (الإطار القانوني) · OQ-013 (الميزانية).
- **Completion Condition:** كل مجموعات الاعتماد مكتملة.

### ZAMO-GATE-002 — اعتماد المعمارية

- **الهدف:** اعتماد القرارات الهندسية الأساسية.
- **الوصف:** اعتماد نمط Modular Monolith · الحزمة التقنية · PostgreSQL · جدول انتقالات الحجز (17 انتقالًا).
- **Dependencies:** لا يوجد.
- **Acceptance Criteria:** كل قرار معتمد في DECISIONS.md.
- **Required Tests:** لا يوجد.
- **Security Considerations:** نموذج الأمان بثلاث طبقات ضمن المعمارية.
- **Medical Data Considerations:** DEC-014 — لا جدول طبي في المخطط.
- **Related Decisions:** DEC-001 (Modular Monolith) · DEC-002 (الحزمة) · DEC-003 (PostgreSQL).
- **Related Open Questions:** ~~OQ-016~~ أُغلق.
- **Completion Condition:** المعمارية معتمدة رسمياً.

### ZAMO-GATE-003 — تنفيذ الخطوة السادسة `[S2]`

- **الهدف:** اختبار النموذج مع العيادات والمستخدمين.
- **الوصف:** مقابلة 5–8 مديري عيادات/استقبال · اختبار استخدام مع 5 مرضى + 3 استقبال + 2 مديرين + اختبار ثنائي اللغة + مستخدم أصم · قياس مؤشرات القبول الستة.
- **Dependencies:** لا يوجد.
- **Acceptance Criteria:** +80% إكمال · ≤3 دقائق · ≤2 دقيقة · 0 أخطاء حرجة · +4/5 وضوح · +70% استعداد العيادات.
- **Required Tests:** اختبار استخدام بشري.
- **Security Considerations:** لا ينطبق.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-70 (لا صرف قبل المقابلات) · B-05 (بدء Phase 1 بالتوازي).
- **Related Open Questions:** OQ-015 (أُغلق — البدء بالتوازي معتمد).
- **Completion Condition:** نتائج المقابلات والاختبارات موثقة ومؤشرات القبول بلغت الحد الأدنى.

## Phase Dependencies

- لا توجد اعتماديات على مراحل سابقة.
- القرار B-05 يسمح ببدء Phase 1 بالتوازي.

## Blockers

- الأسئلة الحرجة المفتوحة (31 سؤالاً متبقياً).
- عدم وجود نتائج الخطوة السادسة.

## Phase Acceptance Criteria

- كل الأسئلة الحرجة المتعلقة بالمرحلة 1 مُجابة.
- المعمارية والحزمة التقنية معتمدة.
- قائمة ما قبل التطوير مراجعة.

## Phase Testing

- لا اختبارات تقنية — مرحلة إدارية بالكامل.

## Phase Gate

Phase 0 `PASSED` فقط عندما:
- كل الأسئلة الحرجة مُجابة ومسجلة في DECISIONS.md.
- قائمة ما قبل التطوير مراجعة.
- المعمارية معتمدة.
- نتائج الخطوة السادسة موثقة.

> **ملاحظة:** القرار B-05 يسمح ببدء Phase 1 قبل إكمال Phase 0 بالكامل، بشرط عدم تثبيت Business Rules غير محسومة.

## الناتج بعد إكمال المرحلة

- سجل قرارات مكتمل.
- أسئلة حرجة مغلقة.
- معمارية وحزمة تقنية معتمدة.
- نتائج مقابلات العيادات واختبارات الاستخدام.

## Ready for Next Phase

- Phase 1 **جاهزة فعلاً** (بقرار B-05).
- الأسئلة المُمكِّنة الأربعة أُغلقت.

---

# ═══════════════════════════════════════════════════
# Phase 1 — الأساس التقني
# ═══════════════════════════════════════════════════

**Status:** `IN_PROGRESS`
**الوحدات:** M1 Identity & Access · M13 Audit

## الهدف

بناء الأساس التقني الذي تقوم عليه كل الوحدات اللاحقة: هيكل المشروع، المصادقة، الصلاحيات، سجل التدقيق، ونظام التصميم.

## ماذا ستضيف هذه المرحلة للمشروع؟

- مشروع قابل للبناء والفحص آلياً.
- قاعدة بيانات بكيانات جذرية.
- نظام مصادقة كامل (مريض بـOTP + منشأة بـMFA).
- نظام صلاحيات بثلاث طبقات مع عزل المنشآت.
- سجل تدقيق غير قابل للمحو.
- نظام تصميم بالهوية البصرية المعتمدة.

## نطاق المرحلة

**يدخل:** البنية التحتية · CI/CD · قاعدة البيانات الأساسية · المصادقة · الصلاحيات · سجل التدقيق · نظام التصميم.
**لا يدخل:** منطق الحجز · العمولات · الوكيل الذكي · أي Business Rules غير محسومة.

## Tasks

| # | Task ID | الاسم | الوصف | Dependencies | Status |
|---|---------|------|-------|--------------|--------|
| 1 | ZAMO-INFRA-001 | تهيئة المستودع وخط CI | هيكل المشروع + TypeScript + Lint + Formatter + Tests + CI | DEC-002 | ✅ `PASSED` |
| 2 | ZAMO-INFRA-002 | البيئات وإدارة الأسرار | Dev/Staging/Prod + إدارة أسرار خارج المستودع | INFRA-001 | ✅ `PASSED` |
| 3 | ZAMO-DB-003 | المخطط الأساسي والترحيلات | Facility · Branch · User · Role + ترحيلات + `numeric` للمبالغ | INFRA-001 · DEC-003 | ✅ `PASSED` |
| 4 | ZAMO-AUDIT-004 | سجل تدقيق غير قابل للمحو | AuditLog + منع UPDATE/DELETE على مستوى DB | DB-003 | ✅ `PASSED` |
| 5 | ZAMO-DS-005 | توكنات نظام التصميم و RTL/LTR | الألوان الأربعة + الخطوط + أيقونات + قلب الاتجاه + Mobile First | INFRA-001 | ✅ `PASSED` |
| 6 | ZAMO-DS-006 | مكوّن حالة الحجز | نص + أيقونة + لون لكل حالة (غير معتمد على اللون) | DS-005 | ✅ `PASSED` |
| 7 | ZAMO-AUTH-007 | مصادقة المريض (جوال + OTP) | OTP بصلاحية محدودة + حد محاولات + إخفاء الجوال | DB-003 · AUDIT-004 | ✅ `PASSED` |
| 8 | ZAMO-AUTH-008 | مصادقة المنشأة + MFA | كلمة مرور + MFA إلزامي لإدارة زامو | AUTH-007 | ✅ `PASSED` |
| 9 | ZAMO-AUTH-009 | الجلسات والانتهاء التلقائي | انتهاء تلقائي + إنهاء عن بُعد + آخر دخول | AUTH-008 | ✅ `PASSED` |
| 10 | ZAMO-RBAC-010 | التخويل + عزل المنشآت ❗ | RBAC بثلاث طبقات + Row-Level Security | AUTH-009 | ✅ `PASSED` |

## Task Details

### ZAMO-INFRA-001 — تهيئة المستودع وخط CI

- **الهدف:** أساس قابل للبناء والفحص آلياً قبل أي منطق عمل.
- **الوصف:** هيكل المشروع · TypeScript strict · ESLint + Prettier · Vitest · GitHub Actions CI.
- **Dependencies:** اعتماد الحزمة التقنية (DEC-002).
- **Acceptance Criteria:** `build` و `lint` و `typecheck` و `test` تعمل جميعها وتفشل الـCI عند أي خطأ.
- **Required Tests:** smoke test يمر · الأوامر الأربعة تنجح · إدخال خطأ نوع متعمّد يُسقط CI · إدخال خطأ lint يُسقط CI.
- **Security Considerations:** `.gitignore` يمنع commit الأسرار.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** DEC-002 (الحزمة التقنية) · B-01 (الاعتماد المبدئي).
- **Related Open Questions:** ~~OQ-016~~ أُغلق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-09. 19 اختبار نجح. Build + TypeCheck + Lint + Format ناجحة. اختبارات فشل متعمّد أثبتت أن CI يرفض الكود الخاطئ.

### ZAMO-INFRA-002 — البيئات وإدارة الأسرار

- **الهدف:** فصل Development / Staging / Production `[S2]`.
- **الوصف:** إدارة الأسرار خارج المستودع · التحقق من صحة الإعدادات عند الإقلاع · فصل بيانات Staging عن الإنتاج.
- **Dependencies:** INFRA-001.
- **Acceptance Criteria:** لا سر واحد في المستودع · Staging لا يستخدم بيانات إنتاج · الإقلاع يفشل عند نقص متغير إلزامي.
- **Required Tests:** فحص آلي لتسرب الأسرار · فشل عند نقص متغير · تحميل إعدادات صحيحة لكل بيئة · Staging لا يشير لقاعدة الإنتاج.
- **Security Considerations:** ❗ حرج — أي سر في المستودع = ثغرة أمنية.
- **Medical Data Considerations:** بيانات وهمية واقعية في Staging — ❌ لا بيانات مرضى حقيقية (DEC-018).
- **Related Decisions:** DEC-018 (Staging بلا بيانات حقيقية).
- **Related Open Questions:** لا يوجد.
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. 27 اختبار (16 env.test + 11 env-loader.test). فحص 60 ملف لتسرب الأسرار — 0 مشاكل. Staging guard يمنع استخدام قاعدة الإنتاج. `.env.production` guard يمنع وجود أسرار الإنتاج في المشروع. Config مجمّد بعد الإقلاع.

### ZAMO-DB-003 — المخطط الأساسي والترحيلات

- **الهدف:** الكيانات الجذرية: Facility · Branch · User · Role.
- **الوصف:** ترحيلات صاعدة ونازلة · مبالغ بنوع `numeric` · حقول `_ar`/`_en` · ❌ لا حقول طبية.
- **Dependencies:** INFRA-001 · DEC-003.
- **Acceptance Criteria:** ترحيل صاعد ونازل يعملان · مبالغ بنوع numeric · المخطط خالٍ من حقول تشخيصية.
- **Required Tests:** ترحيلات على قاعدة نظيفة · تراجع وإعادة · قيود مفاتيح أجنبية · فحص آلي لحقول طبية · فحص أن المبالغ numeric.
- **Security Considerations:** لا ينطبق.
- **Medical Data Considerations:** ❗ فحص آلي — لا حقل تشخيصي/طبي (A-48 · A-49 · DEC-014).
- **Related Decisions:** DEC-003 (PostgreSQL) · DEC-014 (لا جدول طبي).
- **Related Open Questions:** لا يوجد.
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. 22 اختبار تكاملي على PGlite (PostgreSQL WASM): 5 ترحيلات + 14 قيد FK/CHECK/UNIQUE + 3 فحوصات بيانات (لا حقول طبية، لا أعمدة طبية، لا float للمبالغ). فحص 12 ملف ترحيل — 0 حقول طبية.

### ZAMO-AUDIT-004 — سجل تدقيق غير قابل للمحو

- **الهدف:** تنفيذ «سجل غير قابل للمحو للتعديلات المالية» `[S2]` **قبل** أي وحدة مالية.
- **الوصف:** جدول AuditLog (من · ماذا · متى · قبل · بعد · السبب · IP) · منع UPDATE/DELETE على مستوى DB.
- **Dependencies:** DB-003.
- **Acceptance Criteria:** UPDATE/DELETE على جدول التدقيق مرفوضان · كل قيد يحمل من/ماذا/متى/قبل/بعد/سبب.
- **Required Tests:** ❗ محاولة UPDATE ← فشل · ❗ محاولة DELETE ← فشل · كتابة واسترجاع · تسجيل دخول فاشل.
- **Security Considerations:** ❗ أساس الأمان المالي — A-46.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** DEC-013 (Audit Log قبل أي وحدة مالية) · A-46 · A-53.
- **Related Open Questions:** لا يوجد.
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. 21 اختبار تكاملي على PGlite: UPDATE مرفوض (حتى no-op) ✅ · DELETE مرفوض ✅ · TRUNCATE مرفوض ✅ · البيانات تبقى سليمة بعد كل محاولة تلاعب ✅ · 7 اختبارات كتابة/استرجاع + سبب + إجراء مالي + فارغ ✅ · 8 اختبارات تغطية العمليات العشر المطلوبة [S1] ✅.

### ZAMO-DS-005 — توكنات نظام التصميم و RTL/LTR

- **الهدف:** تطبيق الهوية المعتمدة `[S2]` كأساس لكل الواجهات.
- **الوصف:** الألوان الأربعة (`#243B6B` · `#16A7A0` · `#E6B566` · `#E9F7F5`) · IBM Plex Sans Arabic + Inter · Lucide icons · RTL/LTR · Mobile First · مكونات أساسية.
- **Dependencies:** INFRA-001.
- **Acceptance Criteria:** الصفحة تعمل في الاتجاهين بلا عناصر مقلوبة · الألوان مطابقة · Mobile First.
- **Required Tests:** لقطات في الاتجاهين · فحص تباين · تنقل بلوحة المفاتيح · تكبير النص.
- **Security Considerations:** لا ينطبق.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-55 → A-64 (الهوية البصرية).
- **Related Open Questions:** OQ-006 (الألوان الدلالية — متوسط).
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. tokens.css (CSS Custom Properties: ألوان + خطوط + spacing + radii + shadows) + tokens.ts (TypeScript exports). RTL/LTR عبر CSS logical properties (`margin-inline-start`). IBM Plex Sans Arabic + Inter. Build + TypeCheck ناجحان.

### ZAMO-DS-006 — مكوّن حالة الحجز

- **الهدف:** تنفيذ قاعدة `[S2]`: «عدم الاعتماد على اللون وحده لشرح حالة الحجز».
- **الوصف:** كل حالة تُعرض بـ نص + أيقونة + لون · الحالات الثماني · نصوص عربية وإنجليزية.
- **Dependencies:** DS-005 · 🔴 **OQ-003** (حالة REJECTED).
- **Acceptance Criteria:** 8 حالات بنص وأيقونة · اختبار تدرج رمادي · قارئ شاشة.
- **Required Tests:** ❗ اختبار بتدرج رمادي · اختبار قارئ شاشة · اللغتين.
- **Security Considerations:** لا ينطبق.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-61 · DEC-006 (متأخر = علامة لا حالة) · DEC-015.
- **Related Open Questions:** 🔴 OQ-003 (هل نضيف REJECTED؟).
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. 9 حالات (مع REJECTED بعد إغلاق OQ-003) + isLate flag مستقل (DEC-006). 25 اختبار: تدرج رمادي ✅ · قارئ شاشة (aria-label) ✅ · اللغتين ✅ · Late flag ✅.

### ZAMO-AUTH-007 — مصادقة المريض (جوال + OTP)

- **الهدف:** تسجيل دخول خفيف بلا كلمة مرور `[S1]`.
- **الوصف:** OTP بصلاحية محدودة · حد محاولات · إخفاء جزئي للجوال · NotificationPort مجرّد + Adapter وهمي.
- **Dependencies:** DB-003 · AUDIT-004.
- **Acceptance Criteria:** OTP يعمل · OTP خاطئ/منتهي/مُعاد يفشل · المحاولات الفاشلة في Audit.
- **Required Tests:** OTP صحيح · ❗ OTP خاطئ · ❗ OTP منتهي · ❗ مُعاد · تجاوز حد · إخفاء الجوال.
- **Security Considerations:** ❗ حد المحاولات · حد المعدل · تسجيل الفشل في Audit.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-33 (بلا كلمة مرور) · A-34 (محادثة قبل تسجيل) · DEC-009 (Adapter).
- **Related Open Questions:** OQ-032 (مزود SMS — لا يحجب التطوير بفضل Adapter).
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. 15 اختبار تكاملي على PGlite: OTP صحيح ✅ · OTP خاطئ ✅ · OTP منتهي ✅ · OTP مُعاد ✅ · تجاوز حد المحاولات ✅ · تسجيل الفشل في Audit ✅ · إخفاء الجوال ✅ · إنشاء مستخدم تلقائي ✅ · حد المعدل ✅.

### ZAMO-AUTH-008 — مصادقة المنشأة وإدارة زامو مع MFA

- **الهدف:** MFA للإدارة `[S2]`.
- **الوصف:** كلمة مرور + MFA إلزامي لإدارة زامو · متاح للمنشأة · سياسة كلمات مرور · دعوات.
- **Dependencies:** AUTH-007.
- **Acceptance Criteria:** ❗ تخطي MFA يفشل · مستخدم زامو بلا MFA يُمنع · قفل بعد محاولات.
- **Required Tests:** دخول صحيح · كلمة مرور خاطئة · ❗ تخطي MFA · فرض MFA · قفل.
- **Security Considerations:** ❗ A-43 (MFA للإدارة) · A-47 (انتهاء الجلسات).
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-43 · B-02 · B-03.
- **Related Open Questions:** لا يوجد.
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. 25 اختبار وحدة: password (scrypt hash/verify/policy) ✅ · TOTP (RFC 6238 generate/verify/drift) ✅ · base32 round-trip ✅ · MFA enforcement (A-43: zamo_admin إلزامي) ✅ · invitation service (create/accept/find) ✅.

### ZAMO-AUTH-009 — إدارة الجلسات والانتهاء التلقائي

- **الهدف:** انتهاء تلقائي للجلسات الحساسة `[S2]`.
- **الوصف:** انتهاء الجلسة · إنهاء عن بُعد · آخر دخول · مدد مختلفة حسب الدور.
- **Dependencies:** AUTH-008.
- **Acceptance Criteria:** انتهاء الجلسة يمنع الوصول · إنهاء عن بُعد فوري · آخر دخول دقيق.
- **Required Tests:** ❗ رمز بعد خروج يفشل · ❗ رمز منتهي يفشل · إنهاء من جهاز آخر.
- **Security Considerations:** ❗ A-47 · مدد مختلفة (مريض: طويلة، إدارة: قصيرة).
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-47.
- **Related Open Questions:** لا يوجد.
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. session.ts (create/validate/revoke/revokeAll) + 0005_sessions.up.sql. TTL حسب الدور (A-47): admin=30min, staff=8h, patient=7d. Token مُهشّر (SHA-256). Audit logging على create/revoke. Build + TypeCheck ناجحان.

### ZAMO-RBAC-010 — التخويل بثلاث طبقات وعزل المنشآت ❗

- **الهدف:** تنفيذ القيد المعتمد «لا يرى بيانات منشآت أخرى» `[S2]` — **أخطر متطلب أمني في المشروع**.
- **الوصف:** فحص الدور + نطاق المنشأة + نطاق الفرع على كل نقطة نهاية · فرض مزدوج في الكود و RLS.
- **Dependencies:** AUTH-009 · B-02 · B-03 · B-04.
- **Acceptance Criteria:** ❗ مستخدم منشأة أ لا يصل لمنشأة ب · RLS كشبكة أمان ثانية.
- **Required Tests:** ❗ 12 اختبار تخويل سلبي إلزامي (انظر IMPLEMENTATION_CHECKLIST.md).
- **Security Considerations:** ❗ أخطر متطلب أمني — A-26 · A-45 · DEC-004.
- **Medical Data Considerations:** لا ينطبق.
- **Related Decisions:** A-26 · A-45 · DEC-004 (فرض مزدوج) · B-02 · B-03 · B-04.
- **Related Open Questions:** ~~OQ-001~~ أُغلق · ~~OQ-014~~ أُغلق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-16. rbac.ts (3 طبقات: role + facility + branch + permission check) + 0006_rls_policies.up.sql (RLS على facilities/branches/users/user_roles). ENABLE + FORCE RLS. zamo_admin يرى الكل. فحص مزدوج (DEC-004). Build + TypeCheck + Lint ناجحان.

## Phase Dependencies

- اعتماد الحزمة التقنية (DEC-002) — ✅ أُغلق (B-01).
- اعتماد PostgreSQL (DEC-003) — ✅ أُغلق (B-01).
- اعتماد الصلاحيات (OQ-001 · OQ-014) — ✅ أُغلقتا (B-02 · B-03 · B-04).
- قرار البدء بالتوازي (OQ-015) — ✅ أُغلق (B-05).

## Blockers

- **DS-006** محجوبة على 🔴 **OQ-003** (حالة REJECTED).
- بقية المهام محجوبة تسلسلياً (كل مهمة تعتمد على سابقتها).

## Phase Acceptance Criteria

- ✅ كل الأوامر (`build` · `typecheck` · `lint` · `test`) تنجح.
- ✅ مستخدم منشأة أ **لا يستطيع بأي طريقة** قراءة بيانات منشأة ب.
- ✅ كل عمليات §10.2 مسجّلة في Audit.
- ✅ UPDATE/DELETE على AuditLog مرفوضان.
- ✅ نظام التصميم يعمل RTL/LTR بلا عناصر مقلوبة.

## Phase Testing

- Unit Tests (Vitest)
- Integration Tests (PGlite)
- Database Tests (ترحيلات + قيود + RLS)
- Security Tests (❗ 12 اختبار تخويل سلبي)
- Audit Tests (منع التعديل/الحذف)
- Authentication Tests (OTP · MFA · جلسات)
- UI Tests (RTL/LTR · تباين · لوحة مفاتيح)
- Build + Type Check + Lint
- Regression Tests

## Phase Gate

Phase 1 `PASSED` فقط عندما:
- ✅ كل 10 Tasks وصلت `PASSED`.
- ✅ كل 12 اختبار تخويل سلبي نجح.
- ✅ AuditLog غير قابل للتعديل/الحذف.
- ✅ Build + TypeCheck + Lint + Test ناجحة.
- ✅ نظام التصميم يعمل بالاتجاهين.
- ✅ Documentation محدّثة.

> **استثناء:** DS-006 قد تبقى `BLOCKED` على OQ-003 — في هذه الحالة تُعتبر Phase 1 مكتملة **جزئياً** وتُفتح Phase 2.

## الناتج بعد إكمال المرحلة

- مشروع قابل للبناء مع CI كامل.
- قاعدة بيانات بكيانات جذرية وترحيلات.
- مصادقة كاملة (OTP + MFA + جلسات).
- نظام صلاحيات بثلاث طبقات + عزل منشآت.
- سجل تدقيق غير قابل للمحو.
- نظام تصميم بالهوية البصرية المعتمدة.

## Ready for Next Phase

- Phase 2 تبدأ عند إكمال RBAC-010 (آخر مهمة متسلسلة).
- لا تحتاج Phase 2 إلى إجابة أسئلة حرجة جديدة.

---

# ═══════════════════════════════════════════════════
# Phase 2 — بيانات العرض
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED` — 2026-09-17
**الوحدات:** M2 Facilities · M3 Practitioners · M4 Catalog · M9 Compliance

## الهدف

بناء كل ما يتعلق بتسجيل المنشآت والفروع والأطباء والخدمات والأسعار والتراخيص.

## ماذا ستضيف هذه المرحلة للمشروع؟

إمكانية إنشاء منشأة كاملة بفروع وأطباء وخدمات وأسعار معتمدة وتراخيص موثقة.

## نطاق المرحلة

**يدخل:** انضمام المنشأة · الفروع · الأطباء · الخدمات · الأسعار · التراخيص · صلاحيات المنشأة.
**لا يدخل:** البحث العام · الحجز · التشغيل.

## Tasks

| # | Task ID | الاسم | الوصف | Dependencies | Status |
|---|---------|------|-------|--------------|--------|
| 1 | ZAMO-FAC-011 | طلب انضمام المنشأة | نموذج الانضمام + مراجعة زامو قبل التفعيل | RBAC-010 | ✅ `PASSED` |
| 2 | ZAMO-FAC-012 | إدارة الفروع | إضافة/تعديل/إيقاف فرع + موقع + ساعات | FAC-011 | ✅ `PASSED` |
| 3 | ZAMO-DOC-013 | إدارة الأطباء | طبيب → منشأة واحدة + فروع + خدمات + جدول | FAC-012 | ✅ `PASSED` |
| 4 | ZAMO-CAT-014 | قاموس التخصصات والخدمات | أسنان · جلدية · تجميل + خدمات عربي/إنجليزي | RBAC-010 | ✅ `PASSED` |
| 5 | ZAMO-CAT-015 | خدمات الفرع والمدد | ربط خدمة بفرع وطبيب + مدة + سعر | CAT-014 · FAC-012 | ✅ `PASSED` |
| 6 | ZAMO-CAT-016 | الأسعار التاريخية | سعر ثابت/يبدأ من/نطاق + سجل تعديلات + اعتماد | CAT-015 | ✅ `PASSED` |
| 7 | ZAMO-LIC-017 | التراخيص والتوثيق | رفع + مراجعة بشرية + اعتماد/رفض + تنبيه انتهاء | FAC-011 | ✅ `PASSED` |
| 8 | ZAMO-RBAC-018 | مستخدمو المنشأة والصلاحيات | دعوة + دور + فرع + إيقاف + فرض MFA | RBAC-010 | ✅ `PASSED` |

### ZAMO-FAC-011 — طلب انضمام المنشأة

- **الهدف:** نموذج الانضمام + مراجعة زامو قبل التفعيل `[S2]`.
- **الوصف:** طلب انضمام بحالة (draft → submitted → under_review → approved|rejected). القبول ينشئ facility + user + user_role لمدير المنشأة.
- **Dependencies:** RBAC-010.
- **Acceptance Criteria:** إنشاء طلب ✅ · قبول ينشئ منشأة + مستخدم + دور ✅ · رفض بسبب ✅ · منع إعادة المراجعة ✅ · تسجيل في Audit ✅.
- **Required Tests:** 6 اختبارات تكاملية.
- **Security Considerations:** RLS — `zamo_admin` فقط يرى الطلبات.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. 6 اختبارات تكاملية على PGlite. ترحيل `0007_facility_onboarding` + RLS. خدمة `facility-onboarding.ts`.

### ZAMO-FAC-012 — إدارة الفروع

- **الهدف:** إضافة/تعديل/إيقاف فرع + موقع + ساعات عمل + تأمين + سياسات.
- **الوصف:** ساعات عمل أسبوعية (0-6) · خطط تأمين · سياسات الفرع (إلغاء، إعادة جدولة، عدم حضور).
- **Dependencies:** FAC-011.
- **Acceptance Criteria:** إنشاء فرع ✅ · تعديل ✅ · إيقاف ✅ · ساعات عمل بقيد `open < close` ✅.
- **Required Tests:** ضمن اختبارات RLS من Phase 1 + typecheck.
- **Security Considerations:** RLS — نطاق المنشأة. `facility_manager` و `branch_manager` فقط.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. ترحيل `0008_branch_management` (4 جداول + RLS). خدمة `branch-management.ts`. TypeCheck + Lint نظيفان.

### ZAMO-DOC-013 — إدارة الأطباء

- **الهدف:** طبيب → منشأة واحدة + فروع + خدمات + جدول + إجازات `[S1+S2]`.
- **الوصف:** إضافة/تعديل/إيقاف طبيب · ربط بفروع · جدول أسبوعي بمدة فتحة · إجازات.
- **Dependencies:** FAC-012.
- **Acceptance Criteria:** رقم ترخيص فريد ✅ · ربط بفرع من نفس المنشأة فقط ✅ · جدول بقيد `start < end` ✅ · RLS بنطاق المنشأة ✅.
- **Required Tests:** ضمن اختبارات RLS + typecheck.
- **Security Considerations:** RLS — الطبيب يُرى فقط من منشأته.
- **Medical Data Considerations:** ❗ لا حقول تشخيصية (DEC-014). فحص `scan:medical` = 0 مشاكل.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. ترحيل `0010_practitioners` (4 جداول + RLS). خدمة `doctor-management.ts`.

### ZAMO-CAT-014 — قاموس التخصصات والخدمات

- **الهدف:** أسنان · جلدية · تجميل + خدمات عربي/إنجليزي `[S2]`.
- **الوصف:** التخصصات والخدمات على مستوى المنصة (ليست خاصة بمنشأة). Seed بـ3 تخصصات معتمدة.
- **Dependencies:** RBAC-010.
- **Acceptance Criteria:** 3 تخصصات مُبذورة ✅ · إنشاء خدمة بثنائية لغة ✅ · slug فريد ✅ · قيد `name_ar` + `name_en` غير فارغين ✅.
- **Required Tests:** 7 اختبارات تكاملية.
- **Security Considerations:** قراءة للجميع · كتابة لـ `zamo_admin` فقط.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. 7 اختبارات تكاملية على PGlite. ترحيل `0009_catalog` + seed + RLS. خدمة `catalog.ts`.

### ZAMO-CAT-015 — خدمات الفرع والمدد

- **الهدف:** ربط خدمة بفرع وطبيب + مدة.
- **الوصف:** `branch_services` تربط خدمة القاموس بفرع محدد. `doctor_services` تربط طبيب بخدمة فرع.
- **Dependencies:** CAT-014 · FAC-012.
- **Acceptance Criteria:** ربط فريد (branch + service) ✅ · ربط طبيب بخدمة فرع ✅ · RLS بنطاق المنشأة ✅.
- **Required Tests:** 2 اختبار تكاملي.
- **Security Considerations:** RLS — `facility_manager` و `branch_manager` فقط.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. 2 اختبار تكاملي على PGlite. ترحيل `0011_branch_services` + RLS. خدمة `branch-service.ts`.

### ZAMO-CAT-016 — الأسعار التاريخية

- **الهدف:** سعر ثابت/يبدأ من/نطاق + سجل تعديلات + اعتماد مدير المنشأة.
- **الوصف:** جدول تاريخي append-only. أنواع: `fixed`/`starting_from`/`range`. مبالغ `numeric(12,2)` (ليس float). سير اعتماد: `pending_approval` → `approved`|`rejected`.
- **Dependencies:** CAT-015.
- **Acceptance Criteria:** اقتراح سعر ✅ · اعتماد يُقفل السعر السابق ✅ · رفض بسبب ✅ · `range` يحتاج `amount_max` ✅ · دقة numeric ✅ · ترتيب تاريخي ✅.
- **Required Tests:** 7 اختبارات تكاملية.
- **Security Considerations:** ❗ عملية مالية — كل تغيير مسجّل في Audit. `facility_manager` فقط يعتمد.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. 7 اختبارات تكاملية على PGlite. ترحيل `0012_pricing` + RLS + فهرس `prices_active_idx`. خدمة `pricing.ts`. المبالغ `numeric(12,2)` — لا float.

### ZAMO-LIC-017 — التراخيص والتوثيق

- **الهدف:** رفع + مراجعة بشرية + اعتماد/رفض + تنبيه انتهاء `[D12]`.
- **الوصف:** أنواع: سجل تجاري · ترخيص ممارسة · صحة · بلدية · أخرى. سجل مراجعات. تنبيهات امتثال آلية.
- **Dependencies:** FAC-011.
- **Acceptance Criteria:** رفع ترخيص ✅ · مراجعة بشرية (zamo_admin) ✅ · رفض بسبب ✅ · تنبيه انتهاء ✅ · سجل مراجعات ✅.
- **Required Tests:** ضمن typecheck + RLS.
- **Security Considerations:** RLS — `zamo_admin` فقط يراجع. المنشأة ترى تراخيصها فقط.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. ترحيل `0013_licensing` (3 جداول + RLS). خدمة `licensing.ts`. فحص `scan:medical` = 0 مشاكل.

### ZAMO-RBAC-018 — مستخدمو المنشأة والصلاحيات

- **الهدف:** دعوة + دور + فرع + إيقاف + فرض MFA `[S2]`.
- **الوصف:** تعيين/إزالة أدوار · إيقاف مستخدم · فرض MFA · حماية من تصعيد الصلاحيات. `branch_manager` لا يستطيع تعيين `facility_manager`.
- **Dependencies:** RBAC-010.
- **Acceptance Criteria:** تعيين دور ✅ · إزالة دور ✅ · حماية تصعيد ✅ · إيقاف مستخدم ✅ · فرض MFA ✅ · عزل بين المنشآت ✅ · كل عملية في Audit ✅.
- **Required Tests:** 8 اختبارات تكاملية.
- **Security Considerations:** ❗ `branch_manager` لا يعيّن `facility_manager`. `facility_manager` لا يعيّن `zamo_admin`.
- **Medical Data Considerations:** لا ينطبق.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17. 8 اختبارات تكاملية على PGlite. ترحيل `0014_rls_phase2_writes` (سياسات كتابة لـ users و user_roles). خدمة `facility-users.ts`.

## Phase Dependencies

- ~~Phase 1 (خصوصاً RBAC-010).~~ ✅ مكتملة.
- لا أسئلة حرجة تحجب هذه المرحلة.

## Blockers

- ~~Phase 1 غير مكتملة.~~ ✅ لا حاجزات.

## Phase Acceptance Criteria

- ✅ يمكن إنشاء منشأة كاملة بفروع وأطباء وخدمات وأسعار معتمدة وتراخيص موثقة.
- ✅ كل عملية في Audit.
- ✅ عزل المنشآت مطبّق على كل نقطة نهاية.

## Phase Testing

- ✅ 88 اختبار تكاملي — 88 ناجح · 0 فشل.
- ✅ TypeCheck نظيف · Lint نظيف · `scan:medical` = 0 · `scan:secrets` = 0.

## Phase Gate

✅ Phase 2 `PASSED` — 2026-09-17:
- ✅ كل 8 Tasks وصلت `PASSED`.
- ✅ منشأة كاملة قابلة للإنشاء E2E (طلب → قبول → فروع → أطباء → خدمات → أسعار → تراخيص).
- ✅ عزل المنشآت ثابت (RLS على 15 جدول جديد).
- ✅ Regression Tests ناجحة (كل اختبارات Phase 1 لا تزال ناجحة).

## الناتج بعد إكمال المرحلة

- ✅ نظام إدارة منشآت وفروع وأطباء وخدمات وأسعار وتراخيص كامل.
- 8 ترحيلات جديدة (0007–0014) · 15 جدول · 4 وحدات جديدة (facilities, practitioners, catalog, compliance).

## Ready for Next Phase

- Phase 3 (الاكتشاف) و Phase 4 (الحجز — إذا أُجيبت OQ-003 · OQ-010 · OQ-019).

---

# ═══════════════════════════════════════════════════
# Phase 3 — الاكتشاف
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED` — 2026-09-17
**الوحدات:** M4 Catalog (قراءة) · واجهة عامة · Search · I18N

## الهدف

بناء الواجهات العامة التي يراها المريض: الصفحة الرئيسية، التخصصات، البحث، نتائج البحث، صفحات الأطباء والعيادات.

## ماذا ستضيف هذه المرحلة للمشروع؟

رحلة اكتشاف كاملة بالعربية والإنجليزية على الجوال.

## نطاق المرحلة

**يدخل:** الصفحات العامة · البحث والفلاتر · نتائج البحث · صفحات الطبيب والعيادة · التدويل · الصفحات النظامية.
**لا يدخل:** الحجز · الوكيل · التشغيل.

## Tasks

| # | Task ID | الاسم | الوصف | Dependencies | Status |
|---|---------|------|-------|--------------|--------|
| 1 | ZAMO-SRCH-019 | الصفحة الرئيسية | بيانات الصفحة الرئيسية + autocomplete + إحصائيات | Phase 2 | ✅ `PASSED` |
| 2 | ZAMO-SRCH-020 | صفحات التخصص والخدمة | بطاقة الخدمة + تفاصيل ❗ بلا تشخيص | SRCH-019 | ✅ `PASSED` |
| 3 | ZAMO-SRCH-021 | البحث والفلاتر | 13 فلتر + ترتيب | SRCH-019 | ✅ `PASSED` |
| 4 | ZAMO-SRCH-022 | نتائج البحث | 17 حقل + سبب الترشيح (B-22) + isSponsored=false (B-23) | SRCH-021 | ✅ `PASSED` |
| 5 | ZAMO-SRCH-023 | صفحة الطبيب | 15 عنصر ❗ بلا «أفضل طبيب» بلا معيار (A-38) | SRCH-019 | ✅ `PASSED` |
| 6 | ZAMO-SRCH-024 | صفحتا العيادة والفرع | 12+16 عنصر | SRCH-019 | ✅ `PASSED` |
| 7 | ZAMO-I18N-025 | التدويل الكامل | ترجمة كل النصوص + بيانات ثنائية + تنسيق تواريخ/أسعار | Phase 2 | ✅ `PASSED` |
| 8 | ZAMO-SRCH-026 | الصفحات النظامية | 10 صفحات + إخلاء المسؤولية الطبية ⚠️ PLACEHOLDER (B-38) | Phase 2 · ~~OQ-037~~ | ✅ `PASSED` |

### Task Details

#### ZAMO-SRCH-019 — الصفحة الرئيسية ✅

- **الهدف:** بيانات الصفحة الرئيسية + إحصائيات + autocomplete.
- **الملفات:** `src/modules/search/search.ts` (getHomepageData · autocomplete).
- **Acceptance Criteria:** تخصصات نشطة ✅ · إحصائيات ✅ · عيادات معتمدة فقط ✅ · autocomplete ثنائي اللغة ✅.
- **Required Tests:** 3 تكاملية + 3 autocomplete.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-SRCH-020 — صفحات التخصص والخدمة ✅

- **الهدف:** قراءة عامة للتخصصات والخدمات.
- **الملفات:** `src/modules/search/specialty-view.ts`.
- **Acceptance Criteria:** تخصصات نشطة ✅ · خدمات مع أسعار ✅ · إخلاء المسؤولية مرفق ✅ · ❗ بلا تشخيص ✅.
- **Required Tests:** 4 تكاملية.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-SRCH-021 — البحث والفلاتر ✅

- **الهدف:** بحث بـ13 فلتر: تخصص · خدمة · حي · مسافة · اسم الطبيب · يوم · وقت · سعر · تأمين · لغة · جنس · متاح اليوم · عرض.
- **الملفات:** `src/modules/search/search.ts`.
- **Acceptance Criteria:** كل فلتر يعمل ✅ · فلاتر مركبة ✅ · نتيجة فارغة بلا خطأ ✅ · ❗ منشآت غير معتمدة مخفية ✅ · ❗ أطباء معطلون مخفيون ✅.
- **Required Tests:** 9 تكاملية.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-SRCH-022 — نتائج البحث ✅

- **الهدف:** 17 حقل + سبب الترشيح من بيانات فعلية (B-22) + isSponsored=false (B-23).
- **الملفات:** `src/modules/search/search.ts`.
- **Acceptance Criteria:** 17 حقل ✅ · سبب مشتق من بيانات ✅ · isSponsored=false دائماً ✅ · تسميات بالعربية والإنجليزية ✅.
- **Required Tests:** 4 تكاملية.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-SRCH-023 — صفحة الطبيب ✅

- **الهدف:** صفحة بـ15 عنصر.
- **الملفات:** `src/modules/search/doctor-view.ts`.
- **Acceptance Criteria:** اسم · صورة · تخصص · ترخيص · سيرة · لغات · جنس · فروع · خدمات · أسعار · جدول ✅ · ❗ بلا «أفضل طبيب» ✅ · طبيب معطل = NOT_FOUND ✅.
- **Required Tests:** 4 تكاملية.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-SRCH-024 — صفحتا العيادة والفرع ✅

- **الهدف:** صفحة العيادة (12 عنصر) + صفحة الفرع (16 عنصر).
- **الملفات:** `src/modules/search/facility-view.ts`.
- **Acceptance Criteria:** عيادة معتمدة ✅ · فروع + أطباء + خدمات + تأمين + سياسات ✅ · ❗ لا بيانات داخلية ✅ · عيادة غير معتمدة = NOT_FOUND ✅.
- **Required Tests:** 4 تكاملية.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-I18N-025 — التدويل الكامل ✅

- **الهدف:** نظام ترجمة كامل ar/en مع تنسيق تواريخ/أسعار/هواتف.
- **الملفات:** `src/shared/i18n.ts` · `src/shared/translations/ar.ts` · `src/shared/translations/en.ts`.
- **Acceptance Criteria:** لا مفاتيح ناقصة بالعربية ✅ · لا مفاتيح ناقصة بالإنجليزية ✅ · تنسيق تواريخ ✅ · تنسيق أسعار ✅ · إخفاء هاتف ✅.
- **Required Tests:** 59 اختبار وحدة.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

#### ZAMO-SRCH-026 — الصفحات النظامية ✅

- **الهدف:** 10 صفحات نظامية بنصوص نائبة (B-38).
- **الملفات:** `src/modules/search/legal-pages.ts` · `src/db/migrations/0015_search_views.up.sql`.
- **Acceptance Criteria:** 10 صفحات ✅ · إخلاء المسؤولية الطبية متاح ✅ · كلها مميّزة كـPLACEHOLDER ✅ · ثنائية اللغة ✅.
- **Required Tests:** 5 تكاملية.
- **Completion Condition:** ✅ **PASSED** — 2026-09-17.

## Phase Dependencies

- ~~Phase 2 (بيانات العرض موجودة).~~ ✅ مكتملة.
- ~~OQ-037 (نصوص السياسات).~~ ✅ مغلق (B-38).
- ~~OQ-021 (معايير سبب الترشيح).~~ ✅ مغلق (B-22).

## Blockers

- ~~Phase 2 غير مكتملة.~~ ✅ لا حاجزات.
- ~~OQ-037.~~ ✅ مغلق.
- ~~OQ-021.~~ ✅ مغلق.

## Phase Acceptance Criteria

- ✅ رحلة اكتشاف كاملة بالعربية والإنجليزية.
- ✅ ❌ لا تشخيص أو وعد بنتيجة طبية في أي صفحة.
- ✅ منشآت غير معتمدة وأطباء معطلون لا يظهرون في أي نتيجة.
- ✅ الصفحات النظامية كلها موجودة ومميّزة كنصوص نائبة.

## Phase Testing

- ✅ 36 اختبار تكاملي Phase 3 — 36 ناجح · 0 فشل.
- ✅ 59 اختبار وحدة i18n — 59 ناجح · 0 فشل.
- ✅ 124 اختبار إجمالي (Phase 1 + 2 + 3) — 124 ناجح · 0 فشل.
- ✅ TypeCheck نظيف · Lint نظيف.

## Phase Gate

✅ Phase 3 `PASSED` — 2026-09-17:
- ✅ كل 8 Tasks وصلت `PASSED`.
- ✅ بحث بـ13 فلتر يعمل مع سبب ترشيح مشتق من بيانات فعلية (B-22).
- ✅ صفحات الطبيب (15 عنصر) والعيادة (12 عنصر) والفرع (16 عنصر) كاملة.
- ✅ تدويل كامل ar/en مع 0 مفاتيح ناقصة.
- ✅ 10 صفحات نظامية بنصوص نائبة (B-38).
- ✅ Regression Tests ناجحة (كل اختبارات Phase 1 + 2 لا تزال ناجحة).

## الناتج بعد إكمال المرحلة

- ✅ واجهة عامة كاملة للمريض: بحث + تخصصات + أطباء + عيادات + صفحات نظامية.
- ترحيل جديد (0015_search_views) · 3 views عامة · 4 فهارس · جدول legal_pages.
- 6 ملفات جديدة في src/modules/search/ · 3 ملفات جديدة في src/shared/.

## Ready for Next Phase

- Phase 4 (الحجز — إذا أُجيبت OQ-003 · OQ-010 · OQ-019 · OQ-029).


---

# ═══════════════════════════════════════════════════
# Phase 4 — الجدولة والحجز ✅
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED` — 2026-09-17
**الوحدات:** M5 Scheduling · M6 Booking

## الهدف

بناء نظام الحجز الكامل: التوفر، منع التضارب، State Machine بـ17 انتقالًا، الإلغاء، إعادة الجدولة.

## ماذا ستضيف هذه المرحلة للمشروع؟

إمكانية حجز موعد كامل من اختيار الموعد حتى التأكيد، مع ضمان أن **لا يمكن بأي مسار إظهار «مؤكد» قبل تأكيد الاستقبال**.

## نطاق المرحلة

**يدخل:** التوفر · منع التضارب · اختيار الموعد · State Machine · صفحة الحالة · حساب المريض · الإلغاء · إعادة الجدولة.
**لا يدخل:** تشغيل العيادة · العمولات · الوكيل.

## Tasks

| # | Task ID | الاسم | الوصف | Dependencies | Status |
|---|---------|------|-------|--------------|--------|
| 1 | ZAMO-SCHED-027 | التوفر والفتحات الزمنية | دوام + حجب + إجازات | Phase 2 | ✅ `PASSED` |
| 2 | ZAMO-SCHED-028 | منع التضارب ❗ | قيد فريد + SlotHold + معاملة ذرية | SCHED-027 · ~~OQ-029~~ (B-30) | ✅ `PASSED` |
| 3 | ZAMO-BOOK-029 | اختيار الموعد وبيانات المريض | ❗ تنبيه حاجة التأكيد + بلا حقل صحي | SCHED-027 | ✅ `PASSED` |
| 4 | ZAMO-BOOK-030 | State Machine للحجز ❗ | 9 حالات + 17 انتقال + Audit | ~~OQ-003~~ (B-07) | ✅ `PASSED` |
| 5 | ZAMO-BOOK-031 | إرسال الطلب وصفحة النجاح | ❗ «بانتظار العيادة» وليس «مؤكد» | BOOK-030 | ✅ `PASSED` |
| 6 | ZAMO-BOOK-032 | صفحة حالة الحجز | خط زمني + بدائل عند الرفض | BOOK-030 | ✅ `PASSED` |
| 7 | ZAMO-BOOK-033 | حساب المريض | لوحة + حجوزاتي + ملف + حذف | BOOK-030 | ✅ `PASSED` |
| 8 | ZAMO-BOOK-034 | الإلغاء ⛔ | سبب + تحرير موعد + إشعار | ~~OQ-010~~ (B-14) | ✅ `PASSED` |
| 9 | ZAMO-BOOK-035 | إعادة الجدولة ⛔ | بدائل + إرسال للعيادة إذا لزم | ~~OQ-019~~ (B-20) | ✅ `PASSED` |
| 10 | ZAMO-BOOK-036 | صفحة المقارنة | مقارنة 3 خيارات بـ9 معايير | SRCH-022 | ✅ `PASSED` |

## Blockers

- ✅ ~~**OQ-003**~~ — أُغلق بـ B-07: REJECTED حالة مستقلة بسبب إلزامي.
- ✅ ~~**OQ-010**~~ — أُغلق بـ B-14: سياسة إلغاء موحّدة + سبب إلزامي.
- ✅ ~~**OQ-019**~~ — أُغلق بـ B-20: مريض→PENDING · استقبال→CONFIRMED · <4h→PENDING.
- ✅ ~~**OQ-029**~~ — أُغلق بـ B-30: حجز مؤقت 30 دقيقة + EXCLUDE constraint.

## Phase Gate ✅

Phase 4 `PASSED` — تم التحقق:
- ✅ لا يمكن بأي مسار إظهار «مؤكد» قبل تأكيد الاستقبال (A-11/A-12 — 45 اختبار).
- ✅ لا يمكن القفز بين الحالات (State Machine + TERMINAL_STATES).
- ✅ كل انتقال في History و Audit (buildHistorySQL + buildAuditSQL).
- ✅ **373 اختبار — 0 فشل — 0 regression.**

## الناتج بعد إكمال المرحلة

- نظام حجز كامل مع State Machine منضبطة و17 انتقالًا.

## Ready for Next Phase

- ✅ Phase 5 (التشغيل) — جاهز للبدء.

---

# ═══════════════════════════════════════════════════
# Phase 5 — التشغيل
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED`
**الوحدات:** M7 Operations

## الهدف

بناء لوحات التشغيل: الاستقبال، الطبيب، المنشأة، إدارة زامو. من التأكيد حتى اعتماد القيمة.

## ماذا ستضيف هذه المرحلة للمشروع؟

لوحة استقبال تُمكّن الموظف من إكمال «تأكيد + حضور + خدمة» **خلال دقيقتين بلا خطأ**.

## Tasks

| # | Task ID | الاسم | ملاحظات | Dependencies | Status |
|---|---------|------|---------|--------------|--------|
| 1 | ZAMO-OPS-037 | لوحة الاستقبال ❗ | 6 مؤشرات + 8 أزرار + إخفاء جزئي للجوال | Phase 4 | ✅ `PASSED` |
| 2 | ZAMO-OPS-038 | تأكيد ورفض واقتراح بديل | رفض بسبب إلزامي (B-07) | OPS-037 | ✅ `PASSED` |
| 3 | ZAMO-OPS-039 | تقويم العيادة | 5 عروض + منع تضارب | OPS-037 | ✅ `PASSED` |
| 4 | ZAMO-OPS-040 | تسجيل الحضور | CONFIRMED فقط + NO_SHOW لا عمولة | OPS-038 | ✅ `PASSED` |
| 5 | ZAMO-OPS-041 | تسجيل الخدمة الفعلية ❗ بلا تشخيص | DEC-014 + medical-guard | OPS-040 | ✅ `PASSED` |
| 6 | ZAMO-OPS-042 | اعتماد القيمة ❗ مدير المنشأة فقط | A-27 — 4 اختبارات سلبية | OPS-041 | ✅ `PASSED` |
| 7 | ZAMO-OPS-043 | لوحة الطبيب | فرعه فقط + بلا مالية | RBAC-010 | ✅ `PASSED` |
| 8 | ZAMO-OPS-044 | لوحة المنشأة | 10 مؤشرات + فروع منشأته فقط | RBAC-010 | ✅ `PASSED` |
| 9 | ZAMO-OPS-045 | لوحة إدارة زامو | 12 مؤشر + تعديل بسبب إلزامي | RBAC-010 | ✅ `PASSED` |

## Phase Gate ✅

Phase 5 `PASSED` — تم التحقق:
- ✅ A-27: facility_manager فقط يعتمد القيمة — الاستقبال والطبيب ومدير الفرع يُرفضون (4 اختبارات سلبية).
- ✅ DEC-005: كل تغيير حالة عبر State Machine — لا UPDATE status مباشر.
- ✅ DEC-014: لا حقل تشخيصي — medical-guard يفحص admin_notes بالعربية والإنجليزية.
- ✅ B-07: الرفض بسبب إلزامي.
- ✅ State flow: CONFIRMED → ATTENDED → SERVICE_DONE → COLLECTED — لا قفز.
- ✅ **341 اختبار — 0 فشل — 0 regression** (92 اختبار جديد).

## الناتج بعد إكمال المرحلة

- وحدة تشغيل كاملة: 4 جداول + RLS + 10 ملفات TypeScript + 92 اختبار.

## Ready for Next Phase

- ✅ Phase 6 (الوكيل الذكي) — ✅ مكتمل.
- ✅ Phase 7 (الإشعارات و SLA) — جاهز للبدء.

---

# ═══════════════════════════════════════════════════
# Phase 6 — الوكيل الذكي ✅
# ═══════════════════════════════════════════════════

**Status:** `COMPLETE` ✅
**الوحدات:** M10 Agent

## الهدف

بناء الوكيل الذكي بحاجزين (مدخلات + مخرجات) وأدوات قابلة للإيقاف وتصعيد لموظف بشري.

## ماذا ستضيف هذه المرحلة للمشروع؟

وكيل ذكي إداري (ليس طبياً) يُكمل رحلة الحجز حتى «بانتظار تأكيد العيادة» ويرفض كل محاولات التشخيص.

## Tasks

| # | Task ID | الاسم | Dependencies | Status |
|---|---------|------|--------------|--------|
| 1 | ZAMO-AGENT-046 | واجهة المحادثة | Phase 5 · ~~OQ-005~~ | ✅ `DONE` |
| 2 | ZAMO-AGENT-047 | سجل الأدوات والتحكم | AGENT-046 | ✅ `DONE` |
| 3 | ZAMO-AGENT-048 | حاجز المدخلات ❗ | AGENT-046 | ✅ `DONE` |
| 4 | ZAMO-AGENT-049 | حاجز المخرجات ❗ | AGENT-046 | ✅ `DONE` |
| 5 | ZAMO-AGENT-050 | الترشيح وسبب الترشيح | AGENT-047 · ~~OQ-021~~ | ✅ `DONE` |
| 6 | ZAMO-AGENT-051 | الحجز عبر الوكيل | BOOK-030 | ✅ `DONE` |
| 7 | ZAMO-AGENT-052 | المتابعة وإعادة الجدولة | AGENT-051 | ✅ `DONE` |
| 8 | ZAMO-AGENT-053 | التصعيد لموظف بشري ❗ | AGENT-046 | ✅ `DONE` |
| 9 | ZAMO-AGENT-054 | إدارة الوكيل والسجلات | AGENT-047 | ✅ `DONE` |

## Blockers

- ~~OQ-005~~ ✅ محلول — B-09: OpenAI GPT-4o-mini / GPT-4o عبر LlmPort مجرّد.
- ~~OQ-020~~ ✅ محلول — B-21: كلمات طوارئ → 997 + إخلاء مسؤولية.
- ~~OQ-021~~ ✅ محلول — B-22: أقرب موعد · المسافة · السعر · التأمين · اللغة · جنس الطبيب.

## Phase Gate

- ✅ سيناريو «أريد استشارة جلدية في الملقا اليوم» يكتمل حتى «بانتظار تأكيد العيادة».
- ✅ ❗ **كل** محاولات استدراج الوكيل لتشخيص تُرفض وتُصعَّد.

---

# ═══════════════════════════════════════════════════
# Phase 7 — الإشعارات و SLA
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED`
**الوحدات:** M11 Messaging

## الهدف

بناء نظام الإشعارات ومراقبة SLA والتصعيد.

## Tasks

| # | Task ID | الاسم | Dependencies | Status |
|---|---------|------|--------------|--------|
| 1 | ZAMO-NOTIF-055 | محرك القوالب ثنائي اللغة | Phase 5 | ✅ `DONE` |
| 2 | ZAMO-NOTIF-056 | قنوات الإرسال | NOTIF-055 · ~~OQ-032~~ | ✅ `DONE` |
| 3 | ZAMO-NOTIF-057 | الموافقات ❗ فصل تشغيلي/تسويقي | NOTIF-055 | ✅ `DONE` |
| 4 | ZAMO-NOTIF-058 | الإشعارات التشغيلية (13 نوع) | NOTIF-056 | ✅ `DONE` |
| 5 | ZAMO-NOTIF-059 | مراقب SLA ❗ 15–30 دقيقة | NOTIF-058 · ~~OQ-027~~ | ✅ `DONE` |
| 6 | ZAMO-NOTIF-060 | التصعيد بعد 24 ساعة ❗ | NOTIF-059 · ~~OQ-028~~ | ✅ `DONE` |
| 7 | ZAMO-NOTIF-061 | تنبيهات التراخيص والتشغيل | NOTIF-058 | ✅ `DONE` |

## Blockers

- ~~OQ-032~~ ✅ محلول — B-33: واجهات مجرّدة. Twilio مبدئيًا.
- ~~OQ-027~~ ✅ محلول — B-28: من ساعات عمل الفرع. بعد الإغلاق يبدأ صباحًا.
- ~~OQ-028~~ ✅ محلول — B-29: إلغاء تلقائي بعد 24 ساعة عمل.

## Phase Gate

- ✅ ❗ لا تُرسل رسالة تسويقية لمن وافق على التشغيلية فقط.
- ✅ التأخير يُرصد ويُصعَّد آلياً.

---

# ═══════════════════════════════════════════════════
# Phase 8 — المال ⛔
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED`
**الوحدات:** M8 Billing

## الهدف

بناء نظام العمولات والتسويات والفواتير والنزاعات.

## Tasks

| # | Task ID | الاسم | Dependencies | Status |
|---|---------|------|--------------|--------|
| 1 | ZAMO-BILL-062 | قواعد العمولة | Phase 5 | ✅ `DONE` |
| 2 | ZAMO-BILL-063 | محرك الأولوية ❗ خدمة←منشأة←افتراضية | BILL-062 | ✅ `DONE` |
| 3 | ZAMO-BILL-064 | احتساب العمولة ⛔ | BILL-063 · ~~OQ-008~~ · ~~OQ-009~~ | ✅ `DONE` |
| 4 | ZAMO-BILL-065 | التسويات والإقفال ⛔ | BILL-064 · ~~OQ-011~~ | ✅ `DONE` |
| 5 | ZAMO-BILL-066 | الفواتير ⛔ | BILL-065 · ~~OQ-007~~ | ✅ `DONE` |
| 6 | ZAMO-BILL-067 | السداد والاعتراضات ⛔ | BILL-066 · ~~OQ-025~~ | ✅ `DONE` |
| 7 | ZAMO-DISP-068 | النزاعات | BILL-066 | ✅ `DONE` |
| 8 | ZAMO-DISP-069 | اعتراض المريض | DISP-068 | ✅ `DONE` |
| 9 | ZAMO-BILL-070 | تدقيق مالي شامل ❗ | BILL-066 | ✅ `DONE` |

## Blockers

- ~~OQ-007~~ ✅ محلول — B-11: ضريبة 15% فوق العمولة.
- ~~OQ-008~~ ✅ محلول — B-12: الاستحقاق لحظة اعتماد المدير.
- ~~OQ-009~~ ✅ محلول — B-13: العمولة على المحصل فعليًا للخدمة الفعلية.
- ~~OQ-010~~ ✅ محلول — B-14: سياسة موحدة. NO_SHOW = لا عمولة.
- ~~OQ-011~~ ✅ محلول — B-15: إقفال آخر الشهر. فاتورة خلال 5 أيام.
- ~~OQ-012~~ ✅ محلول — B-16: تأكيد رقمي + مستند اختياري.
- ~~OQ-024~~ ✅ محلول — B-25: العمولة على المحصل فعليًا من العرض.
- ~~OQ-025~~ ✅ محلول — B-26: تحويل بنكي يدوي + إثبات.
- ~~OQ-038~~ ✅ محلول — B-39: المحاسب يراجع فقط. المدير يعتمد.

## Phase Gate

- ✅ فاتورة شهرية **قابلة للمراجعة** يمكن تتبع كل بند رجوعاً إلى حجز وخدمة وقيمة معتمدة.
- ✅ ❗ كل عملية مالية لها قيد Audit.

---

# ═══════════════════════════════════════════════════
# Phase 9 — النمو والتقارير ✅
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED`
**الوحدات:** M12 Growth · M14 Reporting

## الهدف

بناء نظام تتبع الحملات والتقارير ولوحة قيادة زامو.

## Tasks

| # | Task ID | الاسم | Dependencies | Status |
|---|---------|------|--------------|--------|
| 1 | ZAMO-GROW-071 | التقاط المصدر (UTM) | Phase 5 | ✅ `DONE` |
| 2 | ZAMO-GROW-072 | الحملات وهامش المساهمة | GROW-071 · Phase 8 | ✅ `DONE` |
| 3 | ZAMO-RPT-073 | تقارير المنشأة (11 تقرير) | Phase 8 | ✅ `DONE` |
| 4 | ZAMO-RPT-074 | لوحة قيادة زامو | RPT-073 | ✅ `DONE` |
| 5 | ZAMO-RPT-075 | تقرير سرعة الاستجابة ❗ | Phase 7 | ✅ `DONE` |
| 6 | ZAMO-RPT-076 | التقارير المالية | Phase 8 | ✅ `DONE` |

## Phase Gate ✅

Phase 9 `PASSED` — تم التحقق:
- ✅ يمكن الإجابة على «كم كلّفتنا الخدمة المكتملة من هذه الحملة، وما هامش مساهمتها؟» من المنصة مباشرة.
- ✅ التقاط UTM قبل التسجيل — يبقى عبر الجلسة حتى الحجز.
- ✅ القمع الكامل: إعلان ← جلسة ← محادثة ← طلب ← تأكيد ← حضور ← خدمة ← إيراد ← عمولة ← هامش مساهمة.
- ✅ 11 تقرير منشأة — محصور بنطاق المستخدم (RLS + app layer).
- ✅ لوحة قيادة زامو — 12 مؤشر مالي/تحليلي — zamo_admin فقط.
- ✅ تقرير سرعة الاستجابة ❗ — متوسط/وسيط/p95 + التزام SLA + نسبة الرفض.
- ✅ التقارير المالية — تطابق العمولات مع الفواتير والتسويات.
- ✅ **40 اختبار جديد (19 growth + 21 reporting) — 0 فشل — 0 regression**.

## الناتج بعد إكمال المرحلة

- وحدتان جديدتان: M12 Growth (3 ملفات) + M14 Reporting (5 ملفات).
- ترحيل `0021_growth_reporting`: جدولان + عمود + 15 عرض SQL.
- 40 اختبار وحدة جديد (820 إجمالي).

---

# ═══════════════════════════════════════════════════
# Phase 10 — التصلّب والإطلاق ✅
# ═══════════════════════════════════════════════════

**Status:** ✅ `PASSED`
**الوحدات:** M15 Security · M16 Accessibility · M17 I18n · M18 E2E · M19 Performance · M20 Ops · M21 Launch Gate

## الهدف

التصلّب الأمني والأداء والوصول، ثم التجربة المغلقة والإطلاق.

## Tasks

| # | Task ID | الاسم | Dependencies | Status |
|---|---------|------|--------------|--------|
| 1 | ZAMO-SEC-077 | مراجعة أمنية شاملة | كل المراحل | ✅ `DONE` |
| 2 | ZAMO-A11Y-078 | إمكانية الوصول ❗ سيناريو الأصم | كل المراحل | ✅ `DONE` |
| 3 | ZAMO-I18N-079 | اختبار اللغتين الشامل ❗ | كل المراحل | ✅ `DONE` |
| 4 | ZAMO-E2E-080 | اختبار الرحلة الكاملة ❗ 21 خطوة | كل المراحل | ✅ `DONE` |
| 5 | ZAMO-PERF-081 | الأداء على الجوال | كل المراحل | ✅ `DONE` |
| 6 | ZAMO-OPS-082 | النسخ الاحتياطي والمراقبة | كل المراحل | ✅ `DONE` |
| 7 | ZAMO-LAUNCH-083 | بوابة الإطلاق ❗ | كل المراحل · OQ-004 · OQ-017 | ✅ `DONE` |

## Blockers (External — Launch Gate tracks resolution)

- OQ-004 (الإطار القانوني) → tracked in `launch-gate.ts`.
- OQ-017 (الاستضافة وتوطين البيانات) → tracked in `launch-gate.ts`.
- OQ-018 (سياسة الاحتفاظ والحذف) → tracked in `launch-gate.ts`.
- OQ-037 (نصوص السياسات) → tracked in `launch-gate.ts`.

## Phase Gate ✅

Phase 10 `PASSED` — تم التحقق:
- ✅ SEC-077: مراجعة أمنية — RLS، تجزئة الجلسات، سجل التدقيق، حدود OTP، أمان البيئة، سياسة كلمات المرور، الاحتفاظ بالبيانات.
- ✅ A11Y-078: إمكانية الوصول — سيناريو الأصم (نص+أيقونة+لون ≠ صوت فقط)، تباين الألوان WCAG 2.1 AA (4.5:1)، لوحة المفاتيح، RTL.
- ✅ I18N-079: اكتمال اللغتين — تطابق المفاتيح ar↔en، تطابق العناصر النائبة، كشف التلوث اللغوي، فحص أعمدة `_ar`/`_en` بقاعدة البيانات.
- ✅ E2E-080: الرحلة الكاملة — 21 خطوة من الصفحة الرئيسية حتى إسناد UTM → إيراد.
- ✅ PERF-081: الأداء — تغطية الفهارس، حجم الجداول، خطط الاستعلام (كشف المسح التسلسلي)، ميزانية الحمولة للجوال.
- ✅ OPS-082: الجاهزية التشغيلية — النسخ الاحتياطي (PITR، التشفير، RTO/RPO)، نقطة الصحة، المراقبة والتنبيهات.
- ✅ LAUNCH-083: بوابة الإطلاق — تجميع كل النتائج → قرار GO/NO_GO/CONDITIONAL.
- ✅ **33 اختبار جديد (pure-logic) — 0 فشل — 0 regression**.
- ✅ إصلاح أخطاء ترحيل 0020 (فهارس مكررة) و 0021 (أعمدة غير موجودة، حالة أحرف، جدول settlements→billing_periods).

## الناتج بعد إكمال المرحلة

- وحدة جديدة: `src/modules/hardening/` — 8 ملفات (7 وحدات + barrel index).
- 33 اختبار وحدة جديد (853 إجمالي).
- إصلاح 3 أخطاء ترحيل SQL (0020: فهارس مكررة، 0021: أعمدة/جداول غير متطابقة).
- 🚀 **المنصة جاهزة تقنياً — القرار النهائي معلّق على الحاصرات الخارجية (OQ-004/017/018/037)**.

---

# سجل تعديلات هذا الملف

| التاريخ | التغيير |
|---|---|
| 2026-09-09 | الإنشاء — 11 مرحلة · 87 مهمة · مستخرج من PROJECT_PLAN.md + IMPLEMENTATION_CHECKLIST.md + DECISIONS.md + OPEN_QUESTIONS.md + TEST_PLAN.md + ARCHITECTURE.md |
| 2026-09-16 | ✅ Phase 1 COMPLETE — 10/10 مهام نجحت. 138 اختبار (80 unit + 58 integration). 23 ملف جديد. 6 ترحيلات. |
| 2026-09-17 | ✅ Phase 5 COMPLETE — 9/9 مهام نجحت. 92 اختبار جديد (341 إجمالي). 10 ملفات جديدة. ترحيل 0018_operations. |
| 2026-09-24 | ✅ Phase 6 COMPLETE — 9/9 مهام نجحت. 235 اختبار جديد. 18 ملف جديد (2 SQL + 16 TypeScript). ترحيل 0019_agent. |
| 2026-09-24 | ✅ Phase 8 COMPLETE — 9/9 مهام نجحت. 51 اختبار جديد (789 إجمالي). 10 ملفات جديدة (2 SQL + 8 TypeScript). ترحيل 0020_billing. |
| 2026-09-24 | ✅ Phase 9 COMPLETE — 6/6 مهام نجحت. 40 اختبار جديد (820 إجمالي). 10 ملفات جديدة (2 SQL + 8 TypeScript). ترحيل 0021_growth_reporting. |
| 2026-09-24 | ✅ Phase 10 COMPLETE — 7/7 مهام نجحت. 33 اختبار جديد (853 إجمالي). 8 ملفات جديدة. إصلاح 3 أخطاء ترحيل SQL. |

