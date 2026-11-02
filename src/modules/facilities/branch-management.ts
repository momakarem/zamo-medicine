import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-FAC-012 — branch management service.
 *
 * [S1]: "إضافة/تعديل/إيقاف فرع + موقع + ساعات"
 * Every mutation is RBAC-checked by the caller and recorded in Audit.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BranchError =
  | 'BRANCH_NOT_FOUND'
  | 'DUPLICATE_BRANCH_NAME'
  | 'INVALID_WORKING_HOURS';

export interface BranchInput {
  facilityId: string;
  nameAr: string;
  nameEn: string;
  cityAr?: string;
  cityEn?: string;
  districtAr?: string;
  districtEn?: string;
  addressLine?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
}

export interface BranchUpdateInput {
  nameAr?: string;
  nameEn?: string;
  cityAr?: string;
  cityEn?: string;
  districtAr?: string;
  districtEn?: string;
  addressLine?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
}

export interface WorkingHoursInput {
  dayOfWeek: number;  // 0=Sun … 6=Sat
  openTime: string;   // HH:MM
  closeTime: string;  // HH:MM
  isClosed: boolean;
}

export interface BranchRow {
  id: string;
  facility_id: string;
  name_ar: string;
  name_en: string;
  city_ar: string;
  city_en: string;
  district_ar: string | null;
  district_en: string | null;
  address_line: string | null;
  phone: string | null;
  latitude: string | null;
  longitude: string | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BranchManagementService {
  createBranch(input: BranchInput, actorUserId: string): Promise<Result<string, BranchError>>;
  updateBranch(branchId: string, input: BranchUpdateInput, actorUserId: string): Promise<Result<void, BranchError>>;
  toggleBranch(branchId: string, isActive: boolean, actorUserId: string): Promise<Result<void, BranchError>>;
  getBranch(branchId: string): Promise<Result<BranchRow, BranchError>>;
  listBranches(facilityId: string): Promise<BranchRow[]>;
  setWorkingHours(branchId: string, hours: WorkingHoursInput[], actorUserId: string): Promise<Result<void, BranchError>>;
}

export function createBranchManagementService(db: Queryable): BranchManagementService {
  return {
    async createBranch(input, actorUserId) {
      try {
        const res = await db.query<{ id: string }>(
          `INSERT INTO branches (facility_id, name_ar, name_en, city_ar, city_en,
             district_ar, district_en, address_line, phone, latitude, longitude)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [
            input.facilityId, input.nameAr, input.nameEn,
            input.cityAr ?? 'الرياض', input.cityEn ?? 'Riyadh',
            input.districtAr ?? null, input.districtEn ?? null,
            input.addressLine ?? null, input.phone ?? null,
            input.latitude ?? null, input.longitude ?? null,
          ],
        );
        const branchId = res.rows[0]!.id;

        await record(db, {
          action: AUDIT_ACTIONS.FACILITY_SUBMITTED,
          entityType: 'branch',
          entityId: branchId,
          actorUserId,
          facilityId: input.facilityId,
          after: { nameAr: input.nameAr, nameEn: input.nameEn },
        });

        return ok(branchId);
      } catch (e: unknown) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('branches_unique_name_per_facility')) {
          return err('DUPLICATE_BRANCH_NAME');
        }
        throw e;
      }
    },

    async updateBranch(branchId, input, actorUserId) {
      const existing = await this.getBranch(branchId);
      if (!existing.ok) return err(existing.error);

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      const addField = (col: string, val: unknown): void => {
        if (val !== undefined) {
          sets.push(`${col} = $${idx++}`);
          params.push(val);
        }
      };

      addField('name_ar', input.nameAr);
      addField('name_en', input.nameEn);
      addField('city_ar', input.cityAr);
      addField('city_en', input.cityEn);
      addField('district_ar', input.districtAr);
      addField('district_en', input.districtEn);
      addField('address_line', input.addressLine);
      addField('phone', input.phone);
      addField('latitude', input.latitude);
      addField('longitude', input.longitude);

      if (sets.length === 0) return ok(undefined);

      params.push(branchId);
      await db.query(
        `UPDATE branches SET ${sets.join(', ')} WHERE id = $${idx}`,
        params,
      );

      await record(db, {
        action: AUDIT_ACTIONS.FACILITY_SUBMITTED,
        entityType: 'branch',
        entityId: branchId,
        actorUserId,
        facilityId: existing.value.facility_id,
        before: existing.value,
        after: input,
      });

      return ok(undefined);
    },

    async toggleBranch(branchId, isActive, actorUserId) {
      const existing = await this.getBranch(branchId);
      if (!existing.ok) return err(existing.error);

      await db.query(
        `UPDATE branches SET is_active = $1 WHERE id = $2`,
        [isActive, branchId],
      );

      await record(db, {
        action: isActive ? AUDIT_ACTIONS.FACILITY_APPROVED : AUDIT_ACTIONS.FACILITY_SUSPENDED,
        entityType: 'branch',
        entityId: branchId,
        actorUserId,
        facilityId: existing.value.facility_id,
        before: { is_active: existing.value.is_active },
        after: { is_active: isActive },
      });

      return ok(undefined);
    },

    async getBranch(branchId) {
      const res = await db.query<BranchRow>(
        `SELECT * FROM branches WHERE id = $1`,
        [branchId],
      );
      if (res.rows.length === 0) return err('BRANCH_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async listBranches(facilityId) {
      const res = await db.query<BranchRow>(
        `SELECT * FROM branches WHERE facility_id = $1 ORDER BY name_en`,
        [facilityId],
      );
      return res.rows;
    },

    async setWorkingHours(branchId, hours, actorUserId) {
      const existing = await this.getBranch(branchId);
      if (!existing.ok) return err(existing.error);

      // Validate: day_of_week in 0..6
      for (const h of hours) {
        if (h.dayOfWeek < 0 || h.dayOfWeek > 6) return err('INVALID_WORKING_HOURS');
      }

      // Delete existing and re-insert (upsert pattern)
      await db.query(`DELETE FROM working_hours WHERE branch_id = $1`, [branchId]);

      for (const h of hours) {
        await db.query(
          `INSERT INTO working_hours (branch_id, day_of_week, open_time, close_time, is_closed)
           VALUES ($1, $2, $3, $4, $5)`,
          [branchId, h.dayOfWeek, h.openTime, h.closeTime, h.isClosed],
        );
      }

      await record(db, {
        action: AUDIT_ACTIONS.FACILITY_SUBMITTED,
        entityType: 'working_hours',
        entityId: branchId,
        actorUserId,
        facilityId: existing.value.facility_id,
        after: hours,
      });

      return ok(undefined);
    },
  };
}
