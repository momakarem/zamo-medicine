/**
 * ZAMO-AGENT-050 — Nomination & Recommendation Reasons.
 *
 * Bridges the agent's search_doctors tool to the search module,
 * formatting results as "cards" for the conversation with data-driven
 * recommendation reasons.
 *
 * Key rules:
 *   B-22: Reasons from data only — nearest_appointment, nearest_location,
 *         lowest_price, accepts_insurance, speaks_language, preferred_gender.
 *   A-38: ❌ FORBIDDEN: «أفضل طبيب» without a data-backed criterion.
 *   ARCH §9.2 rule 2: Agent answers from tool results only.
 *   ARCH §9.2 rule 7: Recommendation derived from real data.
 */

import type { Locale } from '../../shared/i18n.ts';
import type { SearchFilters, SearchResult, RecommendationReasonType } from '../search/search.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A doctor "card" formatted for display inside the conversation. */
export interface DoctorCard {
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  branchName: string;
  districtName: string | null;
  facilityName: string;
  price: string | null;
  priceType: string | null;
  recommendationReason: RecommendationReasonType | null;
  recommendationLabel: string;
  photoUrl: string | null;
  branchId: string;
  facilityId: string;
}

/** Comparison between two or more doctors. */
export interface DoctorComparison {
  doctors: DoctorCard[];
  comparisonPoints: ComparisonPoint[];
}

export interface ComparisonPoint {
  labelAr: string;
  labelEn: string;
  values: string[];  // One per doctor, in same order
}

/** Result from nomination tool. */
export interface NominationResult {
  cards: DoctorCard[];
  totalFound: number;
  searchCriteria: string;  // Human-readable summary of what was searched
}

// ---------------------------------------------------------------------------
// Card formatting
// ---------------------------------------------------------------------------

/**
 * Convert search results to doctor cards.
 *
 * ❗ Only uses data from the search module — no hallucinated information.
 */
export function formatDoctorCards(
  results: SearchResult[],
  locale: Locale,
): DoctorCard[] {
  return results.map((r) => ({
    doctorId: r.doctorId,
    doctorName: locale === 'ar' ? r.doctorNameAr : r.doctorNameEn,
    specialtyName: locale === 'ar' ? r.specialtyNameAr : r.specialtyNameEn,
    branchName: locale === 'ar' ? r.branchNameAr : r.branchNameEn,
    districtName: r.districtName,
    facilityName: locale === 'ar' ? r.facilityNameAr : r.facilityNameEn,
    price: r.amount,
    priceType: r.priceType,
    recommendationReason: r.recommendationReason,
    recommendationLabel: r.recommendationReasonLabel,
    photoUrl: r.photoUrl,
    branchId: r.branchId,
    facilityId: r.facilityId,
  }));
}

/**
 * Format doctor cards as a text summary for the LLM to include in its response.
 *
 * Returns structured text that the agent can present to the patient.
 */
export function formatCardsAsText(cards: DoctorCard[], locale: Locale): string {
  if (cards.length === 0) {
    return locale === 'ar'
      ? 'لم أجد نتائج تطابق بحثك. هل تريد تعديل معايير البحث؟'
      : 'No results found matching your search. Would you like to adjust your criteria?';
  }

  const header = locale === 'ar'
    ? `وجدت ${cards.length} نتيجة:`
    : `Found ${cards.length} result(s):`;

  const cardTexts = cards.map((card, i) => {
    const lines = [
      `${i + 1}. ${card.doctorName}`,
      `   ${locale === 'ar' ? 'التخصص' : 'Specialty'}: ${card.specialtyName}`,
      `   ${locale === 'ar' ? 'الفرع' : 'Branch'}: ${card.branchName}${card.districtName ? ` — ${card.districtName}` : ''}`,
      `   ${locale === 'ar' ? 'المنشأة' : 'Facility'}: ${card.facilityName}`,
    ];

    if (card.price) {
      const priceLabel = locale === 'ar' ? 'السعر' : 'Price';
      lines.push(`   ${priceLabel}: ${card.price} ${locale === 'ar' ? 'ريال' : 'SAR'}`);
    }

    if (card.recommendationLabel) {
      const reasonLabel = locale === 'ar' ? 'سبب الترشيح' : 'Why recommended';
      lines.push(`   ✨ ${reasonLabel}: ${card.recommendationLabel}`);
    }

    return lines.join('\n');
  });

  return `${header}\n\n${cardTexts.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Build a comparison between doctors.
 *
 * ❗ Uses only factual data from search results — never opinions.
 */
export function buildComparison(
  cards: DoctorCard[],
  locale: Locale,
): DoctorComparison {
  const points: ComparisonPoint[] = [];

  // Price comparison
  if (cards.some((c) => c.price)) {
    points.push({
      labelAr: 'السعر',
      labelEn: 'Price',
      values: cards.map((c) =>
        c.price ? `${c.price} ${locale === 'ar' ? 'ريال' : 'SAR'}` : (locale === 'ar' ? 'غير محدد' : 'N/A'),
      ),
    });
  }

  // Location
  points.push({
    labelAr: 'الموقع',
    labelEn: 'Location',
    values: cards.map((c) => c.districtName ?? (locale === 'ar' ? 'غير محدد' : 'N/A')),
  });

  // Facility
  points.push({
    labelAr: 'المنشأة',
    labelEn: 'Facility',
    values: cards.map((c) => c.facilityName),
  });

  // Recommendation reason
  if (cards.some((c) => c.recommendationLabel)) {
    points.push({
      labelAr: 'سبب الترشيح',
      labelEn: 'Why recommended',
      values: cards.map((c) => c.recommendationLabel || '—'),
    });
  }

  return { doctors: cards, comparisonPoints: points };
}

/**
 * Format comparison as text.
 */
export function formatComparisonAsText(
  comparison: DoctorComparison,
  locale: Locale,
): string {
  const header = locale === 'ar'
    ? `مقارنة بين ${comparison.doctors.length} أطباء:`
    : `Comparison of ${comparison.doctors.length} doctors:`;

  const doctorNames = comparison.doctors
    .map((d, i) => `${i + 1}. ${d.doctorName}`)
    .join(' | ');

  const rows = comparison.comparisonPoints.map((point) => {
    const label = locale === 'ar' ? point.labelAr : point.labelEn;
    const values = point.values.join(' | ');
    return `${label}: ${values}`;
  });

  return `${header}\n${doctorNames}\n\n${rows.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Search criteria description
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable description of what was searched.
 */
export function describeSearchCriteria(
  filters: Partial<SearchFilters>,
  locale: Locale,
): string {
  const parts: string[] = [];

  if (filters.specialtySlug) {
    parts.push(locale === 'ar'
      ? `تخصص: ${filters.specialtySlug}`
      : `Specialty: ${filters.specialtySlug}`);
  }

  if (filters.district) {
    parts.push(locale === 'ar'
      ? `حي: ${filters.district}`
      : `District: ${filters.district}`);
  }

  if (filters.doctorName) {
    parts.push(locale === 'ar'
      ? `اسم الطبيب: ${filters.doctorName}`
      : `Doctor: ${filters.doctorName}`);
  }

  if (filters.availableToday) {
    parts.push(locale === 'ar' ? 'متاح اليوم' : 'Available today');
  }

  if (filters.maxPrice) {
    parts.push(locale === 'ar'
      ? `سعر أقصى: ${filters.maxPrice} ريال`
      : `Max price: ${filters.maxPrice} SAR`);
  }

  if (filters.doctorGender) {
    const g = locale === 'ar'
      ? (filters.doctorGender === 'male' ? 'ذكر' : 'أنثى')
      : filters.doctorGender;
    parts.push(locale === 'ar' ? `جنس الطبيب: ${g}` : `Gender: ${g}`);
  }

  if (parts.length === 0) {
    return locale === 'ar' ? 'بحث عام' : 'General search';
  }

  return parts.join(' · ');
}
