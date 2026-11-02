import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-LIC-017 — licensing & compliance service.
 *
 * [S1+S2]: "رفع + مراجعة بشرية + اعتماد/رفض + تنبيه انتهاء"
 * D12: "Workflow اعتماد بمراجع بشري وحالة وتاريخ"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LicenseType =
  | 'commercial_registration'
  | 'medical_practice'
  | 'ministry_health'
  | 'municipality'
  | 'other';

export type LicensingError =
  | 'LICENSE_NOT_FOUND'
  | 'ALREADY_REVIEWED'
  | 'INVALID_DECISION'
  | 'REASON_REQUIRED';

export interface LicenseInput {
  facilityId: string;
  licenseType: LicenseType;
  licenseNumber: string;
  documentUrl: string;
  documentName: string;
  issuedDate?: string;
  expiryDate?: string;
}

export interface LicenseRow {
  id: string;
  facility_id: string;
  license_type: string;
  license_number: string;
  document_url: string;
  document_name: string;
  issued_date: string | null;
  expiry_date: string | null;
  status: string;
  reviewed_by: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
}

export interface ReviewDecision {
  licenseId: string;
  reviewerId: string;
  decision: 'approved' | 'rejected';
  notes?: string;
}

export interface ComplianceAlertRow {
  id: string;
  facility_id: string;
  license_id: string | null;
  alert_type: string;
  message_ar: string;
  message_en: string;
  is_resolved: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface LicensingService {
  uploadLicense(input: LicenseInput, actorUserId: string): Promise<Result<string, LicensingError>>;
  reviewLicense(input: ReviewDecision): Promise<Result<void, LicensingError>>;
  getLicense(licenseId: string): Promise<Result<LicenseRow, LicensingError>>;
  listLicenses(facilityId: string): Promise<LicenseRow[]>;
  checkExpiringLicenses(daysThreshold?: number): Promise<number>;
  listAlerts(facilityId: string): Promise<ComplianceAlertRow[]>;
  resolveAlert(alertId: string): Promise<Result<void, LicensingError>>;
}

export function createLicensingService(db: Queryable): LicensingService {
  return {
    async uploadLicense(input, actorUserId) {
      const res = await db.query<{ id: string }>(
        `INSERT INTO licenses
           (facility_id, license_type, license_number,
            document_url, document_name, issued_date, expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          input.facilityId, input.licenseType, input.licenseNumber,
          input.documentUrl, input.documentName,
          input.issuedDate ?? null, input.expiryDate ?? null,
        ],
      );
      const licenseId = res.rows[0]!.id;

      await record(db, {
        action: AUDIT_ACTIONS.FACILITY_SUBMITTED,
        entityType: 'license',
        entityId: licenseId,
        actorUserId,
        facilityId: input.facilityId,
        after: { licenseType: input.licenseType, licenseNumber: input.licenseNumber },
      });

      return ok(licenseId);
    },

    async reviewLicense(input) {
      const license = await this.getLicense(input.licenseId);
      if (!license.ok) return err(license.error);

      if (license.value.status === 'approved' || license.value.status === 'rejected') {
        return err('ALREADY_REVIEWED');
      }

      if (input.decision === 'rejected' && (!input.notes || input.notes.trim() === '')) {
        return err('REASON_REQUIRED');
      }

      // Update license status
      await db.query(
        `UPDATE licenses SET status = $1, reviewed_by = $2, review_notes = $3, reviewed_at = now()
         WHERE id = $4`,
        [input.decision, input.reviewerId, input.notes ?? null, input.licenseId],
      );

      // Record in verification_reviews
      await db.query(
        `INSERT INTO verification_reviews (license_id, reviewer_id, decision, notes)
         VALUES ($1, $2, $3, $4)`,
        [input.licenseId, input.reviewerId, input.decision, input.notes ?? null],
      );

      // Audit
      const auditAction = input.decision === 'approved'
        ? AUDIT_ACTIONS.FACILITY_APPROVED
        : AUDIT_ACTIONS.FACILITY_REJECTED;

      await record(db, {
        action: auditAction,
        entityType: 'license',
        entityId: input.licenseId,
        actorUserId: input.reviewerId,
        facilityId: license.value.facility_id,
        before: { status: license.value.status },
        after: { status: input.decision },
        reason: input.notes ?? null,
      });

      return ok(undefined);
    },

    async getLicense(licenseId) {
      const res = await db.query<LicenseRow>(
        `SELECT * FROM licenses WHERE id = $1`,
        [licenseId],
      );
      if (res.rows.length === 0) return err('LICENSE_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async listLicenses(facilityId) {
      const res = await db.query<LicenseRow>(
        `SELECT * FROM licenses WHERE facility_id = $1 ORDER BY created_at DESC`,
        [facilityId],
      );
      return res.rows;
    },

    async checkExpiringLicenses(daysThreshold = 30) {
      // Find approved licenses expiring within threshold
      const expiring = await db.query<{ id: string; facility_id: string; license_number: string; expiry_date: string }>(
        `SELECT id, facility_id, license_number, expiry_date::text FROM licenses
         WHERE status = 'approved'
           AND expiry_date IS NOT NULL
           AND expiry_date <= CURRENT_DATE + $1 * interval '1 day'
           AND expiry_date > CURRENT_DATE`,
        [daysThreshold],
      );

      let alertsCreated = 0;
      for (const lic of expiring.rows) {
        // Check if alert already exists
        const existing = await db.query<{ id: string }>(
          `SELECT id FROM compliance_alerts
           WHERE license_id = $1 AND alert_type = 'expiring_soon' AND is_resolved = false`,
          [lic.id],
        );
        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO compliance_alerts
               (facility_id, license_id, alert_type, message_ar, message_en)
             VALUES ($1, $2, 'expiring_soon', $3, $4)`,
            [
              lic.facility_id, lic.id,
              `الترخيص ${lic.license_number} ينتهي في ${lic.expiry_date}`,
              `License ${lic.license_number} expires on ${lic.expiry_date}`,
            ],
          );
          alertsCreated++;
        }
      }

      // Mark expired licenses
      await db.query(
        `UPDATE licenses SET status = 'expired'
         WHERE status = 'approved' AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE`,
      );

      return alertsCreated;
    },

    async listAlerts(facilityId) {
      const res = await db.query<ComplianceAlertRow>(
        `SELECT * FROM compliance_alerts WHERE facility_id = $1 ORDER BY created_at DESC`,
        [facilityId],
      );
      return res.rows;
    },

    async resolveAlert(alertId) {
      await db.query(
        `UPDATE compliance_alerts SET is_resolved = true, resolved_at = now() WHERE id = $1`,
        [alertId],
      );
      return ok(undefined);
    },
  };
}
