/**
 * ZAMO-I18N-025 — Arabic translations.
 *
 * Every UI-facing string must have an entry here.
 * Keys must match exactly between ar.ts and en.ts.
 */

export const translations: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // Navigation & General
  // ---------------------------------------------------------------------------
  'nav.home': 'الرئيسية',
  'nav.specialties': 'التخصصات',
  'nav.search': 'البحث',
  'nav.login': 'تسجيل الدخول',
  'nav.register': 'إنشاء حساب',
  'nav.my_bookings': 'حجوزاتي',
  'nav.profile': 'الملف الشخصي',
  'nav.language': 'English',
  'nav.about': 'عن زامو',
  'nav.contact': 'تواصل معنا',

  // ---------------------------------------------------------------------------
  // Homepage (SRCH-019)
  // ---------------------------------------------------------------------------
  'home.hero_title': 'احجز موعدك الطبي بسهولة',
  'home.hero_subtitle': 'ابحث عن أفضل العيادات والأطباء في الرياض',
  'home.search_placeholder': 'ابحث عن تخصص أو خدمة أو طبيب...',
  'home.agent_cta': 'تحدث مع المساعد الذكي',
  'home.search_cta': 'ابحث يدوياً',
  'home.specialties_title': 'التخصصات',
  'home.specialties_subtitle': 'اختر التخصص الذي تبحث عنه',
  'home.trust_title': 'لماذا زامو؟',
  'home.trust_verified': 'عيادات موثقة',
  'home.trust_verified_desc': 'جميع العيادات مرخصة ومعتمدة',
  'home.trust_transparent': 'أسعار شفافة',
  'home.trust_transparent_desc': 'اعرف السعر قبل الحجز',
  'home.trust_easy': 'حجز سهل',
  'home.trust_easy_desc': 'احجز موعدك في دقائق',
  'home.trust_bilingual': 'عربي وإنجليزي',
  'home.trust_bilingual_desc': 'المنصة متاحة بالعربية والإنجليزية',
  'home.clinics_cta': 'هل أنت صاحب عيادة؟',
  'home.clinics_cta_desc': 'انضم إلى زامو وزد عدد مرضاك',
  'home.clinics_join': 'انضم الآن',

  // ---------------------------------------------------------------------------
  // Specialties & Services (SRCH-020)
  // ---------------------------------------------------------------------------
  'specialty.title': 'التخصصات',
  'specialty.services': 'الخدمات',
  'specialty.dental': 'أسنان',
  'specialty.dermatology': 'جلدية',
  'specialty.cosmetic': 'تجميل',
  'service.duration': 'المدة',
  'service.minutes': 'دقيقة',
  'service.price_from': 'يبدأ من',
  'service.price_fixed': 'السعر',
  'service.price_range': 'نطاق السعر',
  'service.clinics_count': 'عيادة تقدم هذه الخدمة',
  'service.next_available': 'أقرب موعد',
  'service.details': 'تفاصيل الخدمة',
  'service.book_now': 'احجز الآن',
  'service.disclaimer': 'النتائج تختلف من شخص لآخر. استشر طبيبك.',

  // ---------------------------------------------------------------------------
  // Search & Filters (SRCH-021)
  // ---------------------------------------------------------------------------
  'search.title': 'نتائج البحث',
  'search.filters': 'تصفية',
  'search.sort': 'ترتيب',
  'search.results_count': 'نتيجة',
  'search.no_results': 'لا توجد نتائج',
  'search.no_results_desc': 'جرّب تغيير معايير البحث',
  'search.filter.district': 'الحي',
  'search.filter.distance': 'المسافة',
  'search.filter.service': 'الخدمة',
  'search.filter.specialty': 'التخصص',
  'search.filter.doctor_name': 'اسم الطبيب',
  'search.filter.day': 'اليوم',
  'search.filter.time': 'الوقت',
  'search.filter.price': 'السعر',
  'search.filter.insurance': 'التأمين',
  'search.filter.language': 'اللغة',
  'search.filter.gender': 'جنس الطبيب',
  'search.filter.available_today': 'متاح اليوم',
  'search.filter.has_offer': 'يوجد عرض',
  'search.sort.nearest_appointment': 'أقرب موعد',
  'search.sort.nearest_location': 'الأقرب',
  'search.sort.lowest_price': 'الأقل سعراً',
  'search.sort.default': 'الافتراضي',
  'search.clear_filters': 'مسح الفلاتر',

  // ---------------------------------------------------------------------------
  // Search Results (SRCH-022)
  // ---------------------------------------------------------------------------
  'result.verified': 'موثق',
  'result.not_verified': 'قيد التحقق',
  'result.sponsored': 'إعلان',
  'result.book': 'احجز',
  'result.view_profile': 'عرض الملف',

  // Recommendation reasons (B-22)
  'reason.nearest_appointment': 'أقرب موعد متاح',
  'reason.nearest_location': 'الأقرب إليك',
  'reason.lowest_price': 'أقل سعر',
  'reason.accepts_insurance': 'يقبل تأمينك',
  'reason.speaks_language': 'يتحدث لغتك',
  'reason.preferred_gender': 'حسب تفضيلك',

  // ---------------------------------------------------------------------------
  // Doctor Profile (SRCH-023)
  // ---------------------------------------------------------------------------
  'doctor.profile': 'الملف الشخصي',
  'doctor.specialty': 'التخصص',
  'doctor.license': 'رقم الترخيص',
  'doctor.license_verified': 'ترخيص موثق',
  'doctor.bio': 'نبذة عن الطبيب',
  'doctor.languages': 'اللغات',
  'doctor.gender': 'الجنس',
  'doctor.gender_male': 'ذكر',
  'doctor.gender_female': 'أنثى',
  'doctor.branches': 'الفروع',
  'doctor.services': 'الخدمات',
  'doctor.schedule': 'جدول المواعيد',
  'doctor.next_available': 'أقرب موعد متاح',
  'doctor.no_available': 'لا مواعيد متاحة حالياً',

  // ---------------------------------------------------------------------------
  // Facility & Branch (SRCH-024)
  // ---------------------------------------------------------------------------
  'facility.profile': 'ملف العيادة',
  'facility.branches': 'الفروع',
  'facility.doctors': 'الأطباء',
  'facility.specialties': 'التخصصات',
  'facility.verified': 'عيادة معتمدة',
  'facility.joined': 'انضمت في',
  'facility.description': 'عن العيادة',
  'facility.insurance': 'شركات التأمين المقبولة',

  'branch.profile': 'صفحة الفرع',
  'branch.address': 'العنوان',
  'branch.district': 'الحي',
  'branch.city': 'المدينة',
  'branch.phone': 'الهاتف',
  'branch.working_hours': 'ساعات العمل',
  'branch.doctors': 'أطباء الفرع',
  'branch.services': 'خدمات الفرع',
  'branch.insurance': 'التأمين',
  'branch.directions': 'تعليمات الوصول',
  'branch.map': 'الخريطة',
  'branch.cancellation_policy': 'سياسة الإلغاء',
  'branch.reschedule_policy': 'سياسة إعادة الجدولة',
  'branch.noshow_policy': 'سياسة عدم الحضور',
  'branch.closed': 'مغلق',
  'branch.open': 'مفتوح',

  // ---------------------------------------------------------------------------
  // Legal Pages (SRCH-026)
  // ---------------------------------------------------------------------------
  'legal.about': 'عن زامو',
  'legal.terms': 'شروط الاستخدام',
  'legal.privacy': 'سياسة الخصوصية',
  'legal.medical_disclaimer': 'إخلاء المسؤولية الطبية',
  'legal.cookies': 'سياسة الكوكيز',
  'legal.refund': 'سياسة الاسترجاع',
  'legal.contact': 'تواصل معنا',
  'legal.faq': 'الأسئلة الشائعة',
  'legal.accessibility': 'إمكانية الوصول',
  'legal.complaints': 'الشكاوى',

  // ---------------------------------------------------------------------------
  // Common
  // ---------------------------------------------------------------------------
  'common.loading': 'جاري التحميل...',
  'common.error': 'حدث خطأ',
  'common.retry': 'إعادة المحاولة',
  'common.back': 'رجوع',
  'common.next': 'التالي',
  'common.previous': 'السابق',
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.confirm': 'تأكيد',
  'common.close': 'إغلاق',
  'common.yes': 'نعم',
  'common.no': 'لا',
  'common.all': 'الكل',
  'common.none': 'لا يوجد',
  'common.sar': 'ر.س',
  'common.km': 'كم',
  'common.show_more': 'عرض المزيد',
  'common.show_less': 'عرض أقل',

  // ---------------------------------------------------------------------------
  // Notifications (Phase 7 — NOTIF-055..061)
  // ---------------------------------------------------------------------------
  'notif.booking_submitted': 'تم إرسال طلب الحجز',
  'notif.booking_confirmed': 'تم تأكيد الموعد',
  'notif.booking_rejected': 'لم يُقبل طلب الحجز',
  'notif.alternative_suggested': 'موعد بديل مقترح',
  'notif.booking_cancelled': 'تم إلغاء الحجز',
  'notif.sla_warning': 'تنبيه تأخر في الاستجابة',
  'notif.booking_rescheduled': 'تمت إعادة جدولة الحجز',
  'notif.appointment_reminder': 'تذكير بالموعد',
  'notif.no_show_recorded': 'تسجيل عدم حضور',
  'notif.value_submitted': 'قيمة خدمة بانتظار الاعتماد',
  'notif.value_approved': 'تم اعتماد القيمة النهائية',
  'notif.value_rejected': 'تم رفض القيمة المقدمة',
  'notif.sla_auto_cancel': 'إلغاء تلقائي — تجاوز SLA',
  'notif.license_expiring': 'تنبيه انتهاء ترخيص',
  'notif.stalled_bookings': 'تنبيه حجوزات متعثرة',
  'notif.consent_operational': 'الموافقة على الإشعارات التشغيلية',
  'notif.consent_marketing': 'الموافقة على الإشعارات التسويقية',
  'notif.consent_revoked': 'تم سحب الموافقة',
  'notif.late_flag': 'متأخر',
  'notif.sla_exceeded': 'تجاوز وقت الاستجابة',

  // ---------------------------------------------------------------------------
  // Footer
  // ---------------------------------------------------------------------------
  'footer.copyright': '© 2026 زامو. جميع الحقوق محفوظة.',
  'footer.terms': 'شروط الاستخدام',
  'footer.privacy': 'الخصوصية',
  'footer.disclaimer': 'إخلاء المسؤولية',
};
