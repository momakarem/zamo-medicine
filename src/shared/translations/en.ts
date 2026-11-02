/**
 * ZAMO-I18N-025 — English translations.
 *
 * Every UI-facing string must have an entry here.
 * Keys must match exactly between ar.ts and en.ts.
 */

export const translations: Record<string, string> = {
  // ---------------------------------------------------------------------------
  // Navigation & General
  // ---------------------------------------------------------------------------
  'nav.home': 'Home',
  'nav.specialties': 'Specialties',
  'nav.search': 'Search',
  'nav.login': 'Sign In',
  'nav.register': 'Create Account',
  'nav.my_bookings': 'My Bookings',
  'nav.profile': 'Profile',
  'nav.language': 'العربية',
  'nav.about': 'About Zamo',
  'nav.contact': 'Contact Us',

  // ---------------------------------------------------------------------------
  // Homepage (SRCH-019)
  // ---------------------------------------------------------------------------
  'home.hero_title': 'Book Your Medical Appointment Easily',
  'home.hero_subtitle': 'Find the best clinics and doctors in Riyadh',
  'home.search_placeholder': 'Search for a specialty, service, or doctor...',
  'home.agent_cta': 'Chat with Smart Assistant',
  'home.search_cta': 'Search Manually',
  'home.specialties_title': 'Specialties',
  'home.specialties_subtitle': 'Choose the specialty you need',
  'home.trust_title': 'Why Zamo?',
  'home.trust_verified': 'Verified Clinics',
  'home.trust_verified_desc': 'All clinics are licensed and verified',
  'home.trust_transparent': 'Transparent Pricing',
  'home.trust_transparent_desc': 'Know the price before you book',
  'home.trust_easy': 'Easy Booking',
  'home.trust_easy_desc': 'Book your appointment in minutes',
  'home.trust_bilingual': 'Arabic & English',
  'home.trust_bilingual_desc': 'Platform available in both languages',
  'home.clinics_cta': 'Are you a clinic owner?',
  'home.clinics_cta_desc': 'Join Zamo and grow your patient base',
  'home.clinics_join': 'Join Now',

  // ---------------------------------------------------------------------------
  // Specialties & Services (SRCH-020)
  // ---------------------------------------------------------------------------
  'specialty.title': 'Specialties',
  'specialty.services': 'Services',
  'specialty.dental': 'Dental',
  'specialty.dermatology': 'Dermatology',
  'specialty.cosmetic': 'Cosmetics',
  'service.duration': 'Duration',
  'service.minutes': 'minutes',
  'service.price_from': 'Starting from',
  'service.price_fixed': 'Price',
  'service.price_range': 'Price Range',
  'service.clinics_count': 'clinics offer this service',
  'service.next_available': 'Next Available',
  'service.details': 'Service Details',
  'service.book_now': 'Book Now',
  'service.disclaimer': 'Results vary from person to person. Consult your doctor.',

  // ---------------------------------------------------------------------------
  // Search & Filters (SRCH-021)
  // ---------------------------------------------------------------------------
  'search.title': 'Search Results',
  'search.filters': 'Filters',
  'search.sort': 'Sort By',
  'search.results_count': 'results',
  'search.no_results': 'No Results',
  'search.no_results_desc': 'Try adjusting your search criteria',
  'search.filter.district': 'District',
  'search.filter.distance': 'Distance',
  'search.filter.service': 'Service',
  'search.filter.specialty': 'Specialty',
  'search.filter.doctor_name': 'Doctor Name',
  'search.filter.day': 'Day',
  'search.filter.time': 'Time',
  'search.filter.price': 'Price',
  'search.filter.insurance': 'Insurance',
  'search.filter.language': 'Language',
  'search.filter.gender': 'Doctor Gender',
  'search.filter.available_today': 'Available Today',
  'search.filter.has_offer': 'Has Offer',
  'search.sort.nearest_appointment': 'Nearest Appointment',
  'search.sort.nearest_location': 'Nearest Location',
  'search.sort.lowest_price': 'Lowest Price',
  'search.sort.default': 'Default',
  'search.clear_filters': 'Clear Filters',

  // ---------------------------------------------------------------------------
  // Search Results (SRCH-022)
  // ---------------------------------------------------------------------------
  'result.verified': 'Verified',
  'result.not_verified': 'Pending Verification',
  'result.sponsored': 'Sponsored',
  'result.book': 'Book',
  'result.view_profile': 'View Profile',

  // Recommendation reasons (B-22)
  'reason.nearest_appointment': 'Nearest available appointment',
  'reason.nearest_location': 'Closest to you',
  'reason.lowest_price': 'Lowest price',
  'reason.accepts_insurance': 'Accepts your insurance',
  'reason.speaks_language': 'Speaks your language',
  'reason.preferred_gender': 'Matches your preference',

  // ---------------------------------------------------------------------------
  // Doctor Profile (SRCH-023)
  // ---------------------------------------------------------------------------
  'doctor.profile': 'Doctor Profile',
  'doctor.specialty': 'Specialty',
  'doctor.license': 'License Number',
  'doctor.license_verified': 'License Verified',
  'doctor.bio': 'About the Doctor',
  'doctor.languages': 'Languages',
  'doctor.gender': 'Gender',
  'doctor.gender_male': 'Male',
  'doctor.gender_female': 'Female',
  'doctor.branches': 'Branches',
  'doctor.services': 'Services',
  'doctor.schedule': 'Schedule',
  'doctor.next_available': 'Next Available Appointment',
  'doctor.no_available': 'No appointments available at this time',

  // ---------------------------------------------------------------------------
  // Facility & Branch (SRCH-024)
  // ---------------------------------------------------------------------------
  'facility.profile': 'Clinic Profile',
  'facility.branches': 'Branches',
  'facility.doctors': 'Doctors',
  'facility.specialties': 'Specialties',
  'facility.verified': 'Verified Clinic',
  'facility.joined': 'Joined on',
  'facility.description': 'About the Clinic',
  'facility.insurance': 'Accepted Insurance Providers',

  'branch.profile': 'Branch Page',
  'branch.address': 'Address',
  'branch.district': 'District',
  'branch.city': 'City',
  'branch.phone': 'Phone',
  'branch.working_hours': 'Working Hours',
  'branch.doctors': 'Branch Doctors',
  'branch.services': 'Branch Services',
  'branch.insurance': 'Insurance',
  'branch.directions': 'Directions',
  'branch.map': 'Map',
  'branch.cancellation_policy': 'Cancellation Policy',
  'branch.reschedule_policy': 'Reschedule Policy',
  'branch.noshow_policy': 'No-Show Policy',
  'branch.closed': 'Closed',
  'branch.open': 'Open',

  // ---------------------------------------------------------------------------
  // Legal Pages (SRCH-026)
  // ---------------------------------------------------------------------------
  'legal.about': 'About Zamo',
  'legal.terms': 'Terms of Service',
  'legal.privacy': 'Privacy Policy',
  'legal.medical_disclaimer': 'Medical Disclaimer',
  'legal.cookies': 'Cookie Policy',
  'legal.refund': 'Refund Policy',
  'legal.contact': 'Contact Us',
  'legal.faq': 'FAQ',
  'legal.accessibility': 'Accessibility',
  'legal.complaints': 'Complaints',

  // ---------------------------------------------------------------------------
  // Common
  // ---------------------------------------------------------------------------
  'common.loading': 'Loading...',
  'common.error': 'An error occurred',
  'common.retry': 'Retry',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.previous': 'Previous',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.all': 'All',
  'common.none': 'None',
  'common.sar': 'SAR',
  'common.km': 'km',
  'common.show_more': 'Show More',
  'common.show_less': 'Show Less',

  // ---------------------------------------------------------------------------
  // Notifications (Phase 7 — NOTIF-055..061)
  // ---------------------------------------------------------------------------
  'notif.booking_submitted': 'Booking Request Submitted',
  'notif.booking_confirmed': 'Appointment Confirmed',
  'notif.booking_rejected': 'Booking Request Not Accepted',
  'notif.alternative_suggested': 'Alternative Appointment Suggested',
  'notif.booking_cancelled': 'Booking Cancelled',
  'notif.sla_warning': 'Response Delay Alert',
  'notif.booking_rescheduled': 'Booking Rescheduled',
  'notif.appointment_reminder': 'Appointment Reminder',
  'notif.no_show_recorded': 'No-Show Recorded',
  'notif.value_submitted': 'Service Value Pending Approval',
  'notif.value_approved': 'Final Value Approved',
  'notif.value_rejected': 'Submitted Value Rejected',
  'notif.sla_auto_cancel': 'Auto-Cancelled — SLA Exceeded',
  'notif.license_expiring': 'License Expiry Alert',
  'notif.stalled_bookings': 'Stalled Bookings Alert',
  'notif.consent_operational': 'Operational Notifications Consent',
  'notif.consent_marketing': 'Marketing Notifications Consent',
  'notif.consent_revoked': 'Consent Revoked',
  'notif.late_flag': 'Late',
  'notif.sla_exceeded': 'Response Time Exceeded',

  // ---------------------------------------------------------------------------
  // Footer
  // ---------------------------------------------------------------------------
  'footer.copyright': '© 2026 Zamo. All rights reserved.',
  'footer.terms': 'Terms of Service',
  'footer.privacy': 'Privacy',
  'footer.disclaimer': 'Disclaimer',
};
