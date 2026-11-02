import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-FAC-011 — facility onboarding service.
 *
 * [S2]: "طلب انضمام يتضمن السجل والترخيص وبيانات المفوض والفروع.
 *        تراجع زامو الطلب قبل التفعيل." (A-32)
 *
 * Workflow: draft → submitted → under_review → approved | rejected
 * On approval: creates a facility + user + user_role for the facility manager.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected';

export type OnboardingError =
  | 'APPLICATION_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'ALREADY_REVIEWED'
  | 'REASON_REQUIRED';

export interface ApplicationInput {
  nameAr: string;
  nameEn: string;
  commercialReg: string;
  taxNumber?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  cityAr?: string;
  cityEn?: string;
}

export interface ApplicationRow {
  id: string;
  name_ar: string;
  name_en: string;
  commercial_reg: string;
  tax_number: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  city_ar: string;
  city_en: string;
  status: ApplicationStatus;
  reviewed_by: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  facility_id: string | null;
  created_at: string;
}

export interface ReviewInput {
  applicationId: string;
  reviewerId: string;
  decision: 'approved' | 'rejected';
  notes?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface FacilityOnboardingService {
  submit(input: ApplicationInput): Promise<Result<string, OnboardingError>>;
  getApplication(id: string): Promise<Result<ApplicationRow, OnboardingError>>;
  listApplications(status?: ApplicationStatus): Promise<ApplicationRow[]>;
  startReview(applicationId: string, reviewerId: string): Promise<Result<void, OnboardingError>>;
  review(input: ReviewInput): Promise<Result<string | null, OnboardingError>>;
}

export function createFacilityOnboardingService(db: Queryable): FacilityOnboardingService {
  return {
    async submit(input) {
      const res = await db.query<{ id: string }>(
        `INSERT INTO facility_applications
           (name_ar, name_en, commercial_reg, tax_number,
            contact_name, contact_phone, contact_email,
            city_ar, city_en, status, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',now())
         RETURNING id`,
        [
          input.nameAr, input.nameEn, input.commercialReg,
          input.taxNumber ?? null,
          input.contactName, input.contactPhone, input.contactEmail,
          input.cityAr ?? 'الرياض', input.cityEn ?? 'Riyadh',
        ],
      );
      const appId = res.rows[0]!.id;

      await record(db, {
        action: AUDIT_ACTIONS.FACILITY_SUBMITTED,
        entityType: 'facility_application',
        entityId: appId,
      });

      return ok(appId);
    },

    async getApplication(id) {
      const res = await db.query<ApplicationRow>(
        `SELECT * FROM facility_applications WHERE id = $1`,
        [id],
      );
      if (res.rows.length === 0) return err('APPLICATION_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async listApplications(status) {
      if (status) {
        const res = await db.query<ApplicationRow>(
          `SELECT * FROM facility_applications WHERE status = $1 ORDER BY created_at DESC`,
          [status],
        );
        return res.rows;
      }
      const res = await db.query<ApplicationRow>(
        `SELECT * FROM facility_applications ORDER BY created_at DESC`,
      );
      return res.rows;
    },

    async startReview(applicationId, reviewerId) {
      const app = await this.getApplication(applicationId);
      if (!app.ok) return err(app.error);
      if (app.value.status !== 'submitted') return err('INVALID_STATUS_TRANSITION');

      await db.query(
        `UPDATE facility_applications SET status = 'under_review', reviewed_by = $1 WHERE id = $2`,
        [reviewerId, applicationId],
      );
      return ok(undefined);
    },

    async review(input) {
      const app = await this.getApplication(input.applicationId);
      if (!app.ok) return err(app.error);

      if (app.value.status !== 'under_review' && app.value.status !== 'submitted') {
        return err('INVALID_STATUS_TRANSITION');
      }

      if (input.decision === 'rejected' && (!input.notes || input.notes.trim() === '')) {
        return err('REASON_REQUIRED');
      }

      if (input.decision === 'rejected') {
        await db.query(
          `UPDATE facility_applications
           SET status = 'rejected', reviewed_by = $1, review_notes = $2, reviewed_at = now()
           WHERE id = $3`,
          [input.reviewerId, input.notes ?? null, input.applicationId],
        );

        await record(db, {
          action: AUDIT_ACTIONS.FACILITY_REJECTED,
          entityType: 'facility_application',
          entityId: input.applicationId,
          actorUserId: input.reviewerId,
          reason: input.notes ?? null,
        });

        return ok(null);
      }

      // ── Approve: create facility + user + role ──────────────────────
      // 1. Create the facility
      const facRes = await db.query<{ id: string }>(
        `INSERT INTO facilities (name_ar, name_en, commercial_reg, contact_email, contact_phone, status)
         VALUES ($1, $2, $3, $4, $5, 'approved')
         RETURNING id`,
        [
          app.value.name_ar, app.value.name_en,
          app.value.commercial_reg,
          app.value.contact_email, app.value.contact_phone,
        ],
      );
      const facilityId = facRes.rows[0]!.id;

      // 2. Create or find the user for the contact
      let userId: string;
      const existingUser = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE phone = $1 OR email = $2 LIMIT 1`,
        [app.value.contact_phone, app.value.contact_email],
      );
      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0]!.id;
      } else {
        const userRes = await db.query<{ id: string }>(
          `INSERT INTO users (phone, email, full_name, preferred_lang)
           VALUES ($1, $2, $3, 'ar')
           RETURNING id`,
          [app.value.contact_phone, app.value.contact_email, app.value.contact_name],
        );
        userId = userRes.rows[0]!.id;
      }

      // 3. Assign facility_manager role
      await db.query(
        `INSERT INTO user_roles (user_id, role_code, facility_id, granted_by)
         VALUES ($1, 'facility_manager', $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, facilityId, input.reviewerId],
      );

      // 4. Update the application
      await db.query(
        `UPDATE facility_applications
         SET status = 'approved', reviewed_by = $1, review_notes = $2,
             reviewed_at = now(), facility_id = $3
         WHERE id = $4`,
        [input.reviewerId, input.notes ?? null, facilityId, input.applicationId],
      );

      // 5. Audit
      await record(db, {
        action: AUDIT_ACTIONS.FACILITY_APPROVED,
        entityType: 'facility_application',
        entityId: input.applicationId,
        actorUserId: input.reviewerId,
        facilityId,
        after: { facilityId, userId },
      });

      return ok(facilityId);
    },
  };
}
