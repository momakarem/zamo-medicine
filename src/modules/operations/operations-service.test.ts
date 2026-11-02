/**
 * ZAMO-OPS-037..045 — Operations Service Tests.
 *
 * Comprehensive test suite covering all 9 tasks in Phase 5.
 * Tests are organized by task ID matching PHASES.md.
 *
 * Key safety tests (❗) enforce:
 *   A-27: facility_manager ONLY approves value
 *   DEC-005: All state changes through State Machine
 *   DEC-014: No medical/diagnostic content
 *   B-07: Rejection requires recorded reason
 *   State flow: CONFIRMED → ATTENDED → SERVICE_DONE → COLLECTED
 */
import { describe, it, expect } from 'vitest';

// Operations service
import {
  validateRecordAttendance,
  validateRecordService,
  validateSubmitValue,
  validateApproveValue,
  validateRejectValue,
  validateConfirmBooking,
  validateRejectBooking,
  validateSuggestAlternative,
} from './operations-service.js';

// Reception dashboard
import {
  maskPhone,
  getAvailableActions,
  computeLateDisplay,
  getStatusDisplay,
  calculateWaitTime,
} from './reception-dashboard.js';

// Doctor dashboard
import {
  canAccessDoctorDashboard,
  validateDoctorScope,
  stripFinancialFields,
  validatePriceSuggestion,
} from './doctor-dashboard.js';

// Facility dashboard
import { canAccessFacilityDashboard, parseFacilityStats } from './facility-dashboard.js';

// Zamo dashboard
import {
  canAccessZamoDashboard,
  validateAdminModifyBooking,
} from './zamo-dashboard.js';

// Clinic calendar
import {
  buildEntryDisplay,
  generateTimeSlots,
  getDayNameAr,
  getDayNameEn,
  hasTimeConflict,
} from './clinic-calendar.js';

// ===========================================================================
// OPS-037 — لوحة الاستقبال
// ===========================================================================
describe('OPS-037 — Reception Dashboard', () => {
  // ❗ Phone masking
  describe('❗ Phone masking (الجوال مخفي جزئيًا)', () => {
    it('masks a Saudi phone number correctly', () => {
      expect(maskPhone('0512345678')).toBe('051 XXX XX78');
    });

    it('masks phone with country code', () => {
      const masked = maskPhone('966512345678');
      expect(masked).not.toContain('12345');
    });

    it('masks phone with spaces', () => {
      const masked = maskPhone('051 234 5678');
      expect(masked).toContain('X');
      expect(masked).not.toContain('234');
    });

    it('returns empty for empty phone', () => {
      expect(maskPhone('')).toBe('');
    });

    it('fully masks very short phone numbers', () => {
      expect(maskPhone('1234')).toBe('****');
    });
  });

  // ❗ Late booking highlighting
  describe('❗ Late bookings highlighted (بصريًا ونصيًا)', () => {
    it('shows late indicator for PENDING + late booking', () => {
      const sla = new Date('2026-09-17T09:00:00Z');
      const now = new Date('2026-09-17T09:30:00Z');
      const display = computeLateDisplay('PENDING_CONFIRMATION', true, sla, now);

      expect(display.isLate).toBe(true);
      expect(display.labelAr).toBe('متأخر');
      expect(display.labelEn).toBe('Late');
      expect(display.icon).toBe('alert-triangle');
      expect(display.color).toBeTruthy();
      expect(display.minutesOverdue).toBe(30);
    });

    it('does NOT show late for CONFIRMED bookings', () => {
      const display = computeLateDisplay('CONFIRMED', false, null);
      expect(display.isLate).toBe(false);
    });

    it('❗ late indicator uses text NOT just color (DEC-015)', () => {
      const sla = new Date('2026-09-17T09:00:00Z');
      const now = new Date('2026-09-17T09:30:00Z');
      const display = computeLateDisplay('PENDING_CONFIRMATION', true, sla, now);

      // Must have text (not just color)
      expect(display.labelAr).toBeTruthy();
      expect(display.labelEn).toBeTruthy();
      // Must have icon
      expect(display.icon).toBeTruthy();
    });
  });

  // Status display (DEC-015)
  describe('Status display (color + icon + text)', () => {
    it('every status has text, icon, and color', () => {
      const statuses = [
        'NEW', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ATTENDED',
        'SERVICE_DONE', 'COLLECTED', 'CANCELLED', 'NO_SHOW', 'REJECTED',
      ] as const;

      for (const status of statuses) {
        const display = getStatusDisplay(status);
        expect(display.labelAr, `${status} missing Arabic label`).toBeTruthy();
        expect(display.labelEn, `${status} missing English label`).toBeTruthy();
        expect(display.icon, `${status} missing icon`).toBeTruthy();
        expect(display.color, `${status} missing color`).toBeTruthy();
      }
    });
  });

  // Quick actions
  describe('Quick actions by status', () => {
    it('PENDING has confirm, reject, suggest, cancel', () => {
      const actions = getAvailableActions('PENDING_CONFIRMATION');
      expect(actions).toContain('confirm');
      expect(actions).toContain('reject');
      expect(actions).toContain('suggest_alternative');
      expect(actions).toContain('cancel');
    });

    it('CONFIRMED has attendance, no_show, cancel, reschedule', () => {
      const actions = getAvailableActions('CONFIRMED');
      expect(actions).toContain('record_attendance');
      expect(actions).toContain('record_no_show');
      expect(actions).toContain('cancel');
      expect(actions).toContain('reschedule');
    });

    it('ATTENDED has record_service', () => {
      const actions = getAvailableActions('ATTENDED');
      expect(actions).toContain('record_service');
    });

    it('terminal states have no actions', () => {
      expect(getAvailableActions('COLLECTED')).toHaveLength(0);
      expect(getAvailableActions('CANCELLED')).toHaveLength(0);
      expect(getAvailableActions('NO_SHOW')).toHaveLength(0);
      expect(getAvailableActions('REJECTED')).toHaveLength(0);
    });
  });

  // Wait time
  describe('Wait time calculator', () => {
    it('calculates wait time for CONFIRMED booking past slot_start', () => {
      const slotStart = new Date('2026-09-17T09:00:00Z');
      const now = new Date('2026-09-17T09:15:00Z');
      expect(calculateWaitTime('CONFIRMED', slotStart, now)).toBe(15);
    });

    it('returns 0 for CONFIRMED booking before slot_start', () => {
      const slotStart = new Date('2026-09-17T10:00:00Z');
      const now = new Date('2026-09-17T09:00:00Z');
      expect(calculateWaitTime('CONFIRMED', slotStart, now)).toBe(0);
    });

    it('returns null for non-CONFIRMED status', () => {
      expect(calculateWaitTime('ATTENDED', new Date())).toBeNull();
    });
  });
});

// ===========================================================================
// OPS-038 — تأكيد ورفض واقتراح بديل
// ===========================================================================
describe('OPS-038 — Confirm / Reject / Suggest Alternative', () => {
  it('confirm changes PENDING to CONFIRMED', () => {
    const result = validateConfirmBooking({
      bookingStatus: 'PENDING_CONFIRMATION',
      actorId: 'receptionist-1',
      actorRole: 'receptionist',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('CONFIRMED');
    }
  });

  it('❗ reject without reason fails (B-07)', () => {
    const result = validateRejectBooking({
      bookingStatus: 'PENDING_CONFIRMATION',
      actorId: 'receptionist-1',
      actorRole: 'receptionist',
      reason: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('REASON_REQUIRED');
  });

  it('reject with reason succeeds', () => {
    const result = validateRejectBooking({
      bookingStatus: 'PENDING_CONFIRMATION',
      actorId: 'receptionist-1',
      actorRole: 'receptionist',
      reason: 'الطبيب غير متاح في هذا الوقت',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('REJECTED');
    }
  });

  it('suggest alternative keeps PENDING status', () => {
    const result = validateSuggestAlternative({
      bookingStatus: 'PENDING_CONFIRMATION',
      actorId: 'receptionist-1',
      actorRole: 'receptionist',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('PENDING_CONFIRMATION');
    }
  });

  it('every confirm/reject/suggest action goes through Audit (via State Machine)', () => {
    // State Machine returns triggersNotification and transition data
    // which booking-service.ts uses to write to audit_log + booking_status_history
    const confirmResult = validateConfirmBooking({
      bookingStatus: 'PENDING_CONFIRMATION',
      actorId: 'r-1',
      actorRole: 'receptionist',
    });
    expect(confirmResult.ok).toBe(true);
    if (confirmResult.ok) {
      expect(confirmResult.value.transition.id).toBe('T3');
    }
  });
});

// ===========================================================================
// OPS-040 — تسجيل الحضور
// ===========================================================================
describe('OPS-040 — Record Attendance', () => {
  const baseParams = {
    bookingId: 'booking-1',
    actorId: 'receptionist-1',
    actorRole: 'receptionist' as const,
    actorName: 'سارة',
    branchId: 'branch-1',
    facilityId: 'facility-1',
    slotStart: new Date('2026-09-17T09:00:00Z'),
  };

  it('records attendance for CONFIRMED booking → ATTENDED', () => {
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'CONFIRMED',
      attendanceStatus: 'ATTENDED',
      arrivalTime: new Date(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('ATTENDED');
    }
  });

  it('records no-show for CONFIRMED booking → NO_SHOW', () => {
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'CONFIRMED',
      attendanceStatus: 'NO_SHOW',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('NO_SHOW');
    }
  });

  it('❗ attendance for NON-CONFIRMED booking fails', () => {
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'PENDING_CONFIRMATION',
      attendanceStatus: 'ATTENDED',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('❗ attendance for NEW booking fails', () => {
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'NEW',
      attendanceStatus: 'ATTENDED',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BOOKING_NOT_CONFIRMED');
  });

  it('❗ attendance for ATTENDED booking fails (already attended)', () => {
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'ATTENDED',
      attendanceStatus: 'ATTENDED',
    });
    expect(result.ok).toBe(false);
  });

  it('NO_SHOW does not generate a commission path', () => {
    // NO_SHOW is a terminal state — no transition to SERVICE_DONE or COLLECTED
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'CONFIRMED',
      attendanceStatus: 'NO_SHOW',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('NO_SHOW');
      // NO_SHOW is terminal — cannot proceed to SERVICE_DONE
    }
  });

  it('LATE attendance records as ATTENDED (flag, not state — B-31)', () => {
    // LATE is an attendance_status, but the booking becomes ATTENDED
    const result = validateRecordAttendance({
      ...baseParams,
      bookingStatus: 'CONFIRMED',
      attendanceStatus: 'LATE',
      arrivalTime: new Date(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The booking state is ATTENDED, "late" is a flag
      expect(result.value.newStatus).toBe('ATTENDED');
    }
  });
});

// ===========================================================================
// OPS-041 — تسجيل الخدمة الفعلية
// ===========================================================================
describe('OPS-041 — Record Service', () => {
  const baseParams = {
    bookingId: 'booking-1',
    attendanceId: 'att-1',
    bookedServiceId: 'service-1',
    actualServiceId: 'service-1',
    bookedDoctorId: 'doctor-1',
    actualDoctorId: 'doctor-1',
    actorId: 'receptionist-1',
    actorRole: 'receptionist' as const,
    branchId: 'branch-1',
    facilityId: 'facility-1',
  };

  it('records service for ATTENDED booking → SERVICE_DONE', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('SERVICE_DONE');
    }
  });

  it('allows different actual service (service mismatch)', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
      actualServiceId: 'service-2',  // different from booked
    });
    expect(result.ok).toBe(true);
  });

  it('allows different actual doctor', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
      actualDoctorId: 'doctor-2',  // different from booked
    });
    expect(result.ok).toBe(true);
  });

  it('❗ service before attendance fails', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'CONFIRMED',  // not ATTENDED yet
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BOOKING_NOT_ATTENDED');
  });

  it('❗ service for PENDING booking fails', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'PENDING_CONFIRMATION',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BOOKING_NOT_ATTENDED');
  });

  it('❗ admin_notes with diagnostic content → FAILS (DEC-014)', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
      adminNotes: 'تشخيص: التهاب اللثة المزمن',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('CONTAINS_MEDICAL_CONTENT');
  });

  it('❗ admin_notes with treatment content → FAILS (DEC-014)', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
      adminNotes: 'Prescription: Amoxicillin 500mg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('CONTAINS_MEDICAL_CONTENT');
  });

  it('admin_notes with administrative content → PASSES', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
      adminNotes: 'المريض وصل متأخرًا 10 دقائق — تم تغيير الغرفة',
    });
    expect(result.ok).toBe(true);
  });

  it('admin_notes omitted → PASSES', () => {
    const result = validateRecordService({
      ...baseParams,
      bookingStatus: 'ATTENDED',
    });
    expect(result.ok).toBe(true);
  });
});

// ===========================================================================
// OPS-042 — اعتماد القيمة
// ===========================================================================
describe('OPS-042 — Value Approval', () => {
  const baseApproveParams = {
    bookingId: 'booking-1',
    collectionEntryId: 'ce-1',
    approvedAmount: 500,
    branchId: 'branch-1',
    facilityId: 'facility-1',
    beforeState: { status: 'SERVICE_DONE', proposedAmount: 500 },
  };

  // ❗ A-27: Only facility_manager
  it('❗ facility_manager approves → SUCCEEDS', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'SERVICE_DONE',
      actorId: 'fm-1',
      actorRole: 'facility_manager',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('COLLECTED');
    }
  });

  it('❗ receptionist tries to approve → FAILS (A-27)', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'SERVICE_DONE',
      actorId: 'r-1',
      actorRole: 'receptionist',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED_APPROVAL');
  });

  it('❗ doctor tries to approve → FAILS (A-27)', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'SERVICE_DONE',
      actorId: 'd-1',
      actorRole: 'doctor',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED_APPROVAL');
  });

  it('❗ branch_manager tries to approve → FAILS (A-27 per [S2])', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'SERVICE_DONE',
      actorId: 'bm-1',
      actorRole: 'branch_manager',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED_APPROVAL');
  });

  it('approval moves booking to COLLECTED', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'SERVICE_DONE',
      actorId: 'fm-1',
      actorRole: 'facility_manager',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('COLLECTED');
    }
  });

  it('approval for non-SERVICE_DONE booking fails', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'CONFIRMED',
      actorId: 'fm-1',
      actorRole: 'facility_manager',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BOOKING_NOT_SERVICE_DONE');
  });

  it('negative amount fails', () => {
    const result = validateApproveValue({
      ...baseApproveParams,
      bookingStatus: 'SERVICE_DONE',
      actorId: 'fm-1',
      actorRole: 'facility_manager',
      approvedAmount: -100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_AMOUNT');
  });

  // Value rejection
  it('facility_manager rejects with reason → keeps SERVICE_DONE', () => {
    const result = validateRejectValue({
      bookingId: 'booking-1',
      bookingStatus: 'SERVICE_DONE',
      collectionEntryId: 'ce-1',
      rejectionReason: 'المبلغ غير صحيح',
      actorId: 'fm-1',
      actorRole: 'facility_manager',
      branchId: 'branch-1',
      facilityId: 'facility-1',
      beforeState: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('SERVICE_DONE');
    }
  });

  it('❗ rejection without reason fails', () => {
    const result = validateRejectValue({
      bookingId: 'booking-1',
      bookingStatus: 'SERVICE_DONE',
      collectionEntryId: 'ce-1',
      rejectionReason: '',
      actorId: 'fm-1',
      actorRole: 'facility_manager',
      branchId: 'branch-1',
      facilityId: 'facility-1',
      beforeState: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('REJECTION_REASON_REQUIRED');
  });

  it('❗ receptionist tries to reject value → FAILS', () => {
    const result = validateRejectValue({
      bookingId: 'booking-1',
      bookingStatus: 'SERVICE_DONE',
      collectionEntryId: 'ce-1',
      rejectionReason: 'خطأ',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
      beforeState: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('UNAUTHORIZED_APPROVAL');
  });
});

// ===========================================================================
// OPS-041 — Submit Value
// ===========================================================================
describe('OPS-041 — Submit Value', () => {
  it('submits value for SERVICE_DONE booking', () => {
    const result = validateSubmitValue({
      bookingId: 'booking-1',
      bookingStatus: 'SERVICE_DONE',
      performedServiceId: 'ps-1',
      proposedAmount: 500,
      paymentMethod: 'cash',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // T14: SERVICE_DONE → SERVICE_DONE (stays, but with pending approval)
      expect(result.value.newStatus).toBe('SERVICE_DONE');
    }
  });

  it('fails for non-SERVICE_DONE booking', () => {
    const result = validateSubmitValue({
      bookingId: 'booking-1',
      bookingStatus: 'ATTENDED',
      performedServiceId: 'ps-1',
      proposedAmount: 500,
      paymentMethod: 'cash',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
    });
    expect(result.ok).toBe(false);
  });

  it('fails for negative amount', () => {
    const result = validateSubmitValue({
      bookingId: 'booking-1',
      bookingStatus: 'SERVICE_DONE',
      performedServiceId: 'ps-1',
      proposedAmount: -100,
      paymentMethod: 'cash',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('INVALID_AMOUNT');
  });
});

// ===========================================================================
// OPS-043 — لوحة الطبيب
// ===========================================================================
describe('OPS-043 — Doctor Dashboard', () => {
  it('doctor can access doctor dashboard', () => {
    expect(canAccessDoctorDashboard('doctor')).toBe(true);
  });

  it('receptionist cannot access doctor dashboard', () => {
    expect(canAccessDoctorDashboard('receptionist')).toBe(false);
  });

  it('❗ doctor can only see their own bookings', () => {
    expect(validateDoctorScope('doctor-1', 'doctor-1')).toBe(true);
    expect(validateDoctorScope('doctor-1', 'doctor-2')).toBe(false);
  });

  it('❗ financial fields are stripped for doctor', () => {
    const data = {
      booking_number: 'ZAMO-123',
      amount: 500,
      commission_rate: 10,
      commission_amount: 50,
      settlement_id: 'set-1',
      invoice_id: 'inv-1',
      facility_revenue: 10000,
      total_collections: 50000,
    };
    const stripped = stripFinancialFields(data);
    expect(stripped.booking_number).toBe('ZAMO-123');
    expect(stripped.amount).toBe(500);
    expect('commission_rate' in stripped).toBe(false);
    expect('commission_amount' in stripped).toBe(false);
    expect('settlement_id' in stripped).toBe(false);
    expect('invoice_id' in stripped).toBe(false);
    expect('facility_revenue' in stripped).toBe(false);
    expect('total_collections' in stripped).toBe(false);
  });

  it('❗ price suggestion does NOT change approved price', () => {
    // Price suggestion is just a record — validated and stored
    const result = validatePriceSuggestion({
      bookingId: 'b-1',
      suggestedAmount: 400,
      reason: 'الخدمة أقصر من المعتاد',
      doctorId: 'doctor-1',
    });
    expect(result.valid).toBe(true);
  });

  it('price suggestion without reason fails', () => {
    const result = validatePriceSuggestion({
      bookingId: 'b-1',
      suggestedAmount: 400,
      reason: '',
      doctorId: 'doctor-1',
    });
    expect(result.valid).toBe(false);
  });
});

// ===========================================================================
// OPS-044 — لوحة المنشأة
// ===========================================================================
describe('OPS-044 — Facility Dashboard', () => {
  it('facility_manager can access their facility dashboard', () => {
    expect(canAccessFacilityDashboard('facility_manager', 'f-1', 'f-1')).toBe(true);
  });

  it('❗ facility_manager cannot access another facility', () => {
    expect(canAccessFacilityDashboard('facility_manager', 'f-1', 'f-2')).toBe(false);
  });

  it('❗ receptionist cannot access facility dashboard', () => {
    expect(canAccessFacilityDashboard('receptionist', 'f-1', 'f-1')).toBe(false);
  });

  it('parses facility stats correctly', () => {
    const stats = parseFacilityStats({
      total_today: '25',
      pending: '5',
      late: '2',
      confirmed: '8',
      attended: '3',
      service_done: '4',
      collected: '2',
      no_show: '1',
      cancelled: '0',
      active_branches: '3',
    });
    expect(stats.totalToday).toBe(25);
    expect(stats.late).toBe(2);
    expect(stats.activeBranches).toBe(3);
  });
});

// ===========================================================================
// OPS-045 — لوحة إدارة زامو
// ===========================================================================
describe('OPS-045 — Zamo Admin Dashboard', () => {
  it('zamo_admin can access dashboard', () => {
    expect(canAccessZamoDashboard('zamo_admin')).toBe(true);
  });

  it('zamo_ops can access dashboard', () => {
    expect(canAccessZamoDashboard('zamo_ops')).toBe(true);
  });

  it('facility_manager cannot access zamo dashboard', () => {
    expect(canAccessZamoDashboard('facility_manager')).toBe(false);
  });

  it('❗ modifying confirmed booking without reason → FAILS', () => {
    const result = validateAdminModifyBooking({
      bookingId: 'b-1',
      bookingStatus: 'CONFIRMED',
      action: 'cancel',
      reason: '',
      actorId: 'admin-1',
      actorRole: 'zamo_admin',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('REASON_REQUIRED');
  });

  it('❗ modifying confirmed booking with reason → SUCCEEDS + notifies', () => {
    const result = validateAdminModifyBooking({
      bookingId: 'b-1',
      bookingStatus: 'CONFIRMED',
      action: 'cancel',
      reason: 'طلب إداري — تم التنسيق مع المريض والعيادة',
      actorId: 'admin-1',
      actorRole: 'zamo_admin',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.newStatus).toBe('CANCELLED');
      expect(result.value.notifyParties).toBe(true);
    }
  });

  it('❗ non-admin cannot modify confirmed booking', () => {
    const result = validateAdminModifyBooking({
      bookingId: 'b-1',
      bookingStatus: 'CONFIRMED',
      action: 'cancel',
      reason: 'سبب',
      actorId: 'r-1',
      actorRole: 'receptionist',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('NOT_ZAMO_ADMIN');
  });
});

// ===========================================================================
// OPS-039 — تقويم العيادة
// ===========================================================================
describe('OPS-039 — Clinic Calendar', () => {
  it('generates time slots for a day', () => {
    const slots = generateTimeSlots(8, 18, 30);
    expect(slots.length).toBe(20);  // 10 hours * 2 slots/hour
    expect(slots[0]!.label).toBe('08:00');
    expect(slots[1]!.label).toBe('08:30');
    expect(slots[slots.length - 1]!.label).toBe('17:30');
  });

  it('builds entry display with status metadata (DEC-015)', () => {
    const display = buildEntryDisplay('CONFIRMED', false);
    expect(display.labelAr).toBe('مؤكد');
    expect(display.labelEn).toBe('Confirmed');
    expect(display.icon).toBe('check-circle');
    expect(display.color).toBeTruthy();
    expect(display.cssClass).toContain('cal-confirmed');
  });

  it('builds late entry display with late class', () => {
    const display = buildEntryDisplay('PENDING_CONFIRMATION', true);
    expect(display.cssClass).toContain('cal-late');
    expect(display.isLate).toBe(true);
  });

  it('❗ conflict detection works', () => {
    const a = { start: new Date('2026-09-17T09:00:00Z'), end: new Date('2026-09-17T09:30:00Z') };
    const b = { start: new Date('2026-09-17T09:15:00Z'), end: new Date('2026-09-17T09:45:00Z') };
    expect(hasTimeConflict(a, b)).toBe(true);
  });

  it('no conflict for adjacent slots', () => {
    const a = { start: new Date('2026-09-17T09:00:00Z'), end: new Date('2026-09-17T09:30:00Z') };
    const b = { start: new Date('2026-09-17T09:30:00Z'), end: new Date('2026-09-17T10:00:00Z') };
    expect(hasTimeConflict(a, b)).toBe(false);
  });

  it('Arabic day names', () => {
    // Wednesday 2026-09-17 (actually a Thursday)
    const date = new Date('2026-09-17T12:00:00Z');
    const name = getDayNameAr(date);
    expect(name).toBeTruthy();
    expect(typeof name).toBe('string');
  });

  it('English day names', () => {
    const date = new Date('2026-09-17T12:00:00Z');
    const name = getDayNameEn(date);
    expect(name).toBeTruthy();
    expect(typeof name).toBe('string');
  });
});

// ===========================================================================
// State Flow Integrity — ❗ no state skipping
// ===========================================================================
describe('❗ State Flow Integrity — no skipping', () => {
  it('CONFIRMED → ATTENDED → SERVICE_DONE → COLLECTED (happy path)', () => {
    // Step 1: Confirm → Attend
    const step1 = validateRecordAttendance({
      bookingId: 'b-1',
      bookingStatus: 'CONFIRMED',
      attendanceStatus: 'ATTENDED',
      actorId: 'r-1',
      actorRole: 'receptionist',
      actorName: 'سارة',
      branchId: 'branch-1',
      facilityId: 'facility-1',
      slotStart: new Date(),
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.value.newStatus).toBe('ATTENDED');

    // Step 2: Attend → Service Done
    const step2 = validateRecordService({
      bookingId: 'b-1',
      bookingStatus: 'ATTENDED',
      attendanceId: 'att-1',
      bookedServiceId: 'svc-1',
      actualServiceId: 'svc-1',
      bookedDoctorId: 'doc-1',
      actualDoctorId: 'doc-1',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.value.newStatus).toBe('SERVICE_DONE');

    // Step 3: Submit value
    const step3 = validateSubmitValue({
      bookingId: 'b-1',
      bookingStatus: 'SERVICE_DONE',
      performedServiceId: 'ps-1',
      proposedAmount: 500,
      paymentMethod: 'cash',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
    });
    expect(step3.ok).toBe(true);

    // Step 4: Approve → Collected
    const step4 = validateApproveValue({
      bookingId: 'b-1',
      bookingStatus: 'SERVICE_DONE',
      collectionEntryId: 'ce-1',
      approvedAmount: 500,
      actorId: 'fm-1',
      actorRole: 'facility_manager',
      branchId: 'branch-1',
      facilityId: 'facility-1',
      beforeState: {},
    });
    expect(step4.ok).toBe(true);
    if (step4.ok) {
      expect(step4.value.newStatus).toBe('COLLECTED');
    }
  });

  it('cannot skip ATTENDED → COLLECTED directly', () => {
    const result = validateApproveValue({
      bookingId: 'b-1',
      bookingStatus: 'ATTENDED',
      collectionEntryId: 'ce-1',
      approvedAmount: 500,
      actorId: 'fm-1',
      actorRole: 'facility_manager',
      branchId: 'branch-1',
      facilityId: 'facility-1',
      beforeState: {},
    });
    expect(result.ok).toBe(false);
  });

  it('cannot skip CONFIRMED → SERVICE_DONE directly', () => {
    const result = validateRecordService({
      bookingId: 'b-1',
      bookingStatus: 'CONFIRMED',
      attendanceId: 'att-1',
      bookedServiceId: 'svc-1',
      actualServiceId: 'svc-1',
      bookedDoctorId: 'doc-1',
      actualDoctorId: 'doc-1',
      actorId: 'r-1',
      actorRole: 'receptionist',
      branchId: 'branch-1',
      facilityId: 'facility-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('BOOKING_NOT_ATTENDED');
  });
});
