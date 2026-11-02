import type { Queryable } from '../../db/client.ts';
import { ok, err, type Result } from '../../shared/result.ts';
import { record, AUDIT_ACTIONS } from '../audit/audit.ts';

/**
 * ZAMO-DOC-013 — doctor management service.
 *
 * [S2]: "طبيب → منشأة واحدة + فروع + خدمات + جدول"
 * [S1]: "يُضاف بواسطة المنشأة مع رقم الترخيص والتخصص والخدمات والفروع والجدول"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorError =
  | 'DOCTOR_NOT_FOUND'
  | 'DUPLICATE_LICENSE'
  | 'BRANCH_NOT_IN_FACILITY'
  | 'INVALID_SCHEDULE';

export interface DoctorInput {
  facilityId: string;
  specialtyId: string;
  nameAr: string;
  nameEn: string;
  licenseNumber: string;
  bioAr?: string;
  bioEn?: string;
  photoUrl?: string;
  gender?: 'male' | 'female';
}

export interface DoctorUpdateInput {
  nameAr?: string;
  nameEn?: string;
  bioAr?: string;
  bioEn?: string;
  photoUrl?: string;
  gender?: 'male' | 'female';
  specialtyId?: string;
}

export interface ScheduleInput {
  dayOfWeek: number;
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  slotDurationMinutes?: number;
}

export interface LeaveInput {
  startDate: string;  // YYYY-MM-DD
  endDate: string;
  reason?: string;
}

export interface DoctorRow {
  id: string;
  facility_id: string;
  user_id: string | null;
  specialty_id: string;
  name_ar: string;
  name_en: string;
  license_number: string;
  bio_ar: string | null;
  bio_en: string | null;
  photo_url: string | null;
  gender: string | null;
  is_active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface DoctorManagementService {
  addDoctor(input: DoctorInput, actorUserId: string): Promise<Result<string, DoctorError>>;
  updateDoctor(doctorId: string, input: DoctorUpdateInput, actorUserId: string): Promise<Result<void, DoctorError>>;
  toggleDoctor(doctorId: string, isActive: boolean, actorUserId: string): Promise<Result<void, DoctorError>>;
  getDoctor(doctorId: string): Promise<Result<DoctorRow, DoctorError>>;
  listDoctors(facilityId: string): Promise<DoctorRow[]>;
  assignToBranch(doctorId: string, branchId: string, actorUserId: string): Promise<Result<void, DoctorError>>;
  removeFromBranch(doctorId: string, branchId: string, actorUserId: string): Promise<Result<void, DoctorError>>;
  setSchedule(doctorId: string, branchId: string, schedule: ScheduleInput[], actorUserId: string): Promise<Result<void, DoctorError>>;
  addLeave(doctorId: string, leave: LeaveInput, actorUserId: string): Promise<Result<string, DoctorError>>;
  removeLeave(leaveId: string, actorUserId: string): Promise<Result<void, DoctorError>>;
}

export function createDoctorManagementService(db: Queryable): DoctorManagementService {
  return {
    async addDoctor(input, actorUserId) {
      try {
        const res = await db.query<{ id: string }>(
          `INSERT INTO doctors
             (facility_id, specialty_id, name_ar, name_en, license_number,
              bio_ar, bio_en, photo_url, gender)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            input.facilityId, input.specialtyId,
            input.nameAr, input.nameEn, input.licenseNumber,
            input.bioAr ?? null, input.bioEn ?? null,
            input.photoUrl ?? null, input.gender ?? null,
          ],
        );
        const doctorId = res.rows[0]!.id;

        await record(db, {
          action: AUDIT_ACTIONS.ROLE_GRANTED,
          entityType: 'doctor',
          entityId: doctorId,
          actorUserId,
          facilityId: input.facilityId,
          after: { nameAr: input.nameAr, nameEn: input.nameEn, license: input.licenseNumber },
        });

        return ok(doctorId);
      } catch (e: unknown) {
        const msg = (e as Error).message ?? '';
        if (msg.includes('doctors_unique_license')) {
          return err('DUPLICATE_LICENSE');
        }
        throw e;
      }
    },

    async updateDoctor(doctorId, input, actorUserId) {
      const existing = await this.getDoctor(doctorId);
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
      addField('bio_ar', input.bioAr);
      addField('bio_en', input.bioEn);
      addField('photo_url', input.photoUrl);
      addField('gender', input.gender);
      addField('specialty_id', input.specialtyId);

      if (sets.length === 0) return ok(undefined);

      params.push(doctorId);
      await db.query(
        `UPDATE doctors SET ${sets.join(', ')} WHERE id = $${idx}`,
        params,
      );

      await record(db, {
        action: AUDIT_ACTIONS.PERMISSION_CHANGED,
        entityType: 'doctor',
        entityId: doctorId,
        actorUserId,
        facilityId: existing.value.facility_id,
        before: existing.value,
        after: input,
      });

      return ok(undefined);
    },

    async toggleDoctor(doctorId, isActive, actorUserId) {
      const existing = await this.getDoctor(doctorId);
      if (!existing.ok) return err(existing.error);

      await db.query(
        `UPDATE doctors SET is_active = $1 WHERE id = $2`,
        [isActive, doctorId],
      );

      await record(db, {
        action: isActive ? AUDIT_ACTIONS.ROLE_GRANTED : AUDIT_ACTIONS.USER_DEACTIVATED,
        entityType: 'doctor',
        entityId: doctorId,
        actorUserId,
        facilityId: existing.value.facility_id,
        before: { is_active: existing.value.is_active },
        after: { is_active: isActive },
      });

      return ok(undefined);
    },

    async getDoctor(doctorId) {
      const res = await db.query<DoctorRow>(
        `SELECT * FROM doctors WHERE id = $1`,
        [doctorId],
      );
      if (res.rows.length === 0) return err('DOCTOR_NOT_FOUND');
      return ok(res.rows[0]!);
    },

    async listDoctors(facilityId) {
      const res = await db.query<DoctorRow>(
        `SELECT * FROM doctors WHERE facility_id = $1 ORDER BY name_en`,
        [facilityId],
      );
      return res.rows;
    },

    async assignToBranch(doctorId, branchId, actorUserId) {
      const doctor = await this.getDoctor(doctorId);
      if (!doctor.ok) return err(doctor.error);

      // Verify branch belongs to the same facility
      const branch = await db.query<{ facility_id: string }>(
        `SELECT facility_id FROM branches WHERE id = $1`,
        [branchId],
      );
      if (branch.rows.length === 0 || branch.rows[0]!.facility_id !== doctor.value.facility_id) {
        return err('BRANCH_NOT_IN_FACILITY');
      }

      await db.query(
        `INSERT INTO doctor_branches (doctor_id, branch_id)
         VALUES ($1, $2)
         ON CONFLICT (doctor_id, branch_id) DO UPDATE SET is_active = true`,
        [doctorId, branchId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.ROLE_GRANTED,
        entityType: 'doctor_branch',
        entityId: doctorId,
        actorUserId,
        facilityId: doctor.value.facility_id,
        after: { branchId },
      });

      return ok(undefined);
    },

    async removeFromBranch(doctorId, branchId, actorUserId) {
      const doctor = await this.getDoctor(doctorId);
      if (!doctor.ok) return err(doctor.error);

      await db.query(
        `UPDATE doctor_branches SET is_active = false WHERE doctor_id = $1 AND branch_id = $2`,
        [doctorId, branchId],
      );

      await record(db, {
        action: AUDIT_ACTIONS.ROLE_REVOKED,
        entityType: 'doctor_branch',
        entityId: doctorId,
        actorUserId,
        facilityId: doctor.value.facility_id,
        after: { branchId, is_active: false },
      });

      return ok(undefined);
    },

    async setSchedule(doctorId, branchId, schedule, actorUserId) {
      const doctor = await this.getDoctor(doctorId);
      if (!doctor.ok) return err(doctor.error);

      for (const s of schedule) {
        if (s.dayOfWeek < 0 || s.dayOfWeek > 6) return err('INVALID_SCHEDULE');
      }

      await db.query(
        `DELETE FROM doctor_schedules WHERE doctor_id = $1 AND branch_id = $2`,
        [doctorId, branchId],
      );

      for (const s of schedule) {
        await db.query(
          `INSERT INTO doctor_schedules
             (doctor_id, branch_id, day_of_week, start_time, end_time, slot_duration_minutes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [doctorId, branchId, s.dayOfWeek, s.startTime, s.endTime, s.slotDurationMinutes ?? 30],
        );
      }

      await record(db, {
        action: AUDIT_ACTIONS.PERMISSION_CHANGED,
        entityType: 'doctor_schedule',
        entityId: doctorId,
        actorUserId,
        facilityId: doctor.value.facility_id,
        after: { branchId, schedule },
      });

      return ok(undefined);
    },

    async addLeave(doctorId, leave, _actorUserId) {
      const doctor = await this.getDoctor(doctorId);
      if (!doctor.ok) return err(doctor.error);

      const res = await db.query<{ id: string }>(
        `INSERT INTO doctor_leaves (doctor_id, start_date, end_date, reason)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [doctorId, leave.startDate, leave.endDate, leave.reason ?? null],
      );

      return ok(res.rows[0]!.id);
    },

    async removeLeave(leaveId, _actorUserId) {
      await db.query(`DELETE FROM doctor_leaves WHERE id = $1`, [leaveId]);
      return ok(undefined);
    },
  };
}
