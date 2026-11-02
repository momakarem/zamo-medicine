#!/usr/bin/env node
/**
 * ZAMO-DB-003 / DEC-014 — medical-field guard.
 *
 * Approved constraints A-48 and A-49 forbid the platform from collecting or
 * storing diagnostic or clinical data. Wording alone does not enforce that, so
 * this scanner fails the build if a migration introduces a column whose name
 * implies clinical content.
 *
 * It reads the migration SQL rather than a live database so it runs in CI
 * without a server, and so a forbidden column is rejected before it is ever
 * created.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');

/** Column-name fragments that indicate clinical rather than administrative data. */
const FORBIDDEN = [
  'diagnosis',
  'diagnostic',
  'symptom',
  'prescription',
  'medication',
  'drug',
  'dosage',
  'treatment_plan',
  'clinical',
  'medical_record',
  'medical_history',
  'allergy',
  'allergies',
  'blood_type',
  'blood_pressure',
  'lab_result',
  'test_result',
  'xray',
  'radiology',
  'pathology',
  'icd_code',
  'icd10',
  'chief_complaint',
  'anamnesis',
  'vitals',
  'chronic_condition',
  'تشخيص',
  'وصفة',
  'دواء',
  'أعراض',
];

/**
 * Administrative look-alikes that are explicitly allowed.
 * `service_*` describes a bookable, priced service — not a clinical record.
 */
const ALLOWED_EXACT = new Set(['drug_free_workplace_policy']);

let findings = [];
let files = 0;

let entries;
try {
  entries = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
} catch {
  console.log('✓ Medical-field scan: no migrations directory yet, nothing to check.');
  process.exit(0);
}

for (const file of entries) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  files++;
  const lines = sql.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Ignore comment lines: prose may legitimately mention what we forbid.
    const line = raw.replace(/--.*$/, '');
    if (line.trim() === '') continue;

    const lower = line.toLowerCase();
    for (const term of FORBIDDEN) {
      if (!lower.includes(term)) continue;
      if ([...ALLOWED_EXACT].some((a) => lower.includes(a))) continue;
      findings.push({ file, line: i + 1, term, text: raw.trim().slice(0, 90) });
    }
  }
}

if (findings.length > 0) {
  console.error(`\n✖ Medical-field scan FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  forbidden term "${f.term}"`);
    console.error(`      ${f.text}`);
  }
  console.error(
    '\nApproved constraints A-48 / A-49: the platform stores administrative\n' +
      'booking data only. Remove the field, or obtain an explicit written\n' +
      'decision from the project owner first.\n',
  );
  process.exit(1);
}

console.log(`✓ Medical-field scan passed (${files} migration file(s), 0 findings).`);
