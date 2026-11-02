/**
 * M8 Billing Module — Public API.
 *
 * Phase 8 — المال. Commission rules, computation, settlements,
 * invoices, payments, disputes, and patient objections.
 */

// Commission Rules (ZAMO-BILL-062)
export {
  type CommissionScope,
  type CommissionRule,
  type CommissionRuleError,
  type CreateRuleParams,
  validateCreateRule,
  createRule,
  getActiveRule,
  listRules,
} from './commission-rules.js';

// Commission Priority Engine (ZAMO-BILL-063)
export {
  type ResolvedCommission,
  resolveCommissionRule,
} from './commission-engine.js';

// Commission Computation (ZAMO-BILL-064)
export {
  type CommissionEntryResult,
  type ComputeCommissionParams,
  type ComputeError,
  ceilToHalalah,
  computeCommission,
  reverseCommission,
} from './commission-compute.js';

// Settlement & Close (ZAMO-BILL-065)
export {
  type BillingPeriod,
  type SettlementSummary,
  type SettlementError,
  getOrCreatePeriod,
  closePeriod,
} from './settlement-service.js';

// Invoice Service (ZAMO-BILL-066)
export {
  type Invoice,
  type InvoiceLineItem,
  type InvoiceStatus,
  type InvoiceError,
  generateInvoice,
  issueInvoice,
  markOverdueInvoices,
  markInvoicePaid,
  getInvoiceWithLineItems,
  listInvoices,
} from './invoice-service.js';

// Payment Service (ZAMO-BILL-067)
export {
  type Payment,
  type PaymentStatus,
  type PaymentError,
  submitPayment,
  processPayment,
  listPayments,
} from './payment-service.js';

// Dispute Service (ZAMO-DISP-068)
export {
  type Dispute,
  type DisputeType,
  type DisputeStatus,
  type DisputeError,
  type Evidence,
  openDispute,
  uploadEvidence,
  resolveDispute,
  listDisputes,
} from './dispute-service.js';

// Patient Objection Service (ZAMO-DISP-069)
export {
  type PatientObjection,
  type ObjectionType,
  type ObjectionStatus,
  type ObjectionError,
  raiseObjection,
  reviewObjection,
  listObjections,
} from './patient-objection-service.js';
