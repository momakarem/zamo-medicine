import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-CAT-015 — branch service assignments.
 *
 * Links platform-level services to specific branches and doctors.
 * [S1]: "ربط خدمة بفرع وطبيب + مدة + سعر"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BranchServiceError =
  | 'BRANCH_SERVICE_NOT_FOUND'
  | 'DUPLICATE_ASSIGNMENT'
  | 'SERVICE_NOT_FOUND';

export interface BranchServiceInput {
  branchId: string;
  serviceId: string;
  durationMinutes?: number;
}

export interface BranchServiceRow {
  id: string;
  branch_id: string;
  service_id: string;
  duration_minutes: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BranchServiceService {
  addServiceToBranch(input: BranchServiceInput, actorUserId: string, facilityId: string): Promise<Result<string, BranchServiceError>>;
  updateBranchService(branchServiceId: string, durationMinutes: number, actorUserId: string, facilityId: string): Promise<Result<void, BranchServiceError>>;
  toggleBranchService(branchServiceId: string, isActive: boolean, actorUserId: string, facilityId: string): Promise<Result<void, BranchServiceError>>;
  listBranchServices(branchId: string): Promise<BranchServiceRow[]>;
  getBranchService(branchServiceId: string): Promise<Result<BranchServiceRow, BranchServiceError>>;
  assignDoctorToService(doctorId: string, branchServiceId: string, actorUserId: string, facilityId: string): Promise<Result<void, BranchServiceError>>;
  removeDoctorFromService(doctorId: string, branchServiceId: string, actorUserId: string, facilityId: string): Promise<Result<void, BranchServiceError>>;
}

export function createBranchServiceService(db: Queryable): BranchServiceService {
  return {
    async addServiceToBranch(input, actorUserId, facilityId) {
      try {
        const res = await db.query<{ id: string }>(
          `INSERT INTO branch_services (branch_id, service_id, duration_minutes)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [input.branchId, input.serviceId, input.durationMinutes ?? 30],
        );
        const id = res.rows[0]!.id;

        await record(db, {
          action: AUDIT_ACTIONS.PERMISSION_CHANGED,
          entityType: 'branch_service',
          entityId: id,
          actorUserId,
          facilityId,
          after: input,
        });

        return ok(id);
      } catch (e: unknown) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('branch_service_unique')) {
          return err('DUPLICATE_ASSIGNMENT');
        }
        throw e;
      }
    },

    async updateBranchService(branchServiceId, durationMinutes, actorUserId, facilityId) {
      const existing = await this.getBranchService(branchServiceId);
      if (!existing.ok) return err(existing.error);

      await db.query(
        `UPDATE branch_services SET duration_minutes = $1 WHERE id = $2`,
        [durationMinutes, branchServiceId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.PERMISSION_CHANGED,
        entityType: 'branch_service',
        entityId: branchServiceId,
        actorUserId,
        facilityId,
        before: { duration_minutes: existing.value.duration_minutes },
        after: { duration_minutes: durationMinutes },
      });

      return ok(undefined);
    },

    async toggleBranchService(branchServiceId, isActive, _actorUserId, _facilityId) {
      const existing = await this.getBranchService(branchServiceId);
      if (!existing.ok) return err(existing.error);

      await db.query(
        `UPDATE branch_services SET is_active = $1 WHERE id = $2`,
        [isActive, branchServiceId],
      );

      return ok(undefined);
    },

    async listBranchServices(branchId) {
      const res = await db.query<BranchServiceRow>(
        `SELECT * FROM branch_services WHERE branch_id = $1 ORDER BY created_at`,
        [branchId],
      );
      return res.rows;
    },

    async getBranchService(branchServiceId) {
      const res = await db.query<BranchServiceRow>(
        `SELECT * FROM branch_services WHERE id = $1`,
        [branchServiceId],
      );
      if (res.rows.length === 0) return err('BRANCH_SERVICE_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async assignDoctorToService(doctorId, branchServiceId, actorUserId, facilityId) {
      await db.query(
        `INSERT INTO doctor_services (doctor_id, branch_service_id)
           VALUES ($1, $2)
           ON CONFLICT (doctor_id, branch_service_id) DO UPDATE SET is_active = true`,
        [doctorId, branchServiceId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.ROLE_GRANTED,
        entityType: 'doctor_service',
        entityId: doctorId,
        actorUserId,
        facilityId,
        after: { branchServiceId },
      });

      return ok(undefined);
    },

    async removeDoctorFromService(doctorId, branchServiceId, actorUserId, facilityId) {
      await db.query(
        `UPDATE doctor_services SET is_active = false WHERE doctor_id = $1 AND branch_service_id = $2`,
        [doctorId, branchServiceId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.ROLE_REVOKED,
        entityType: 'doctor_service',
        entityId: doctorId,
        actorUserId,
        facilityId,
        after: { branchServiceId, is_active: false },
      });

      return ok(undefined);
    },
  };
}
