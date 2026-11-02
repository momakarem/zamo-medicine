#!/usr/bin/env node
/**
 * ZAMO-INFRA-002 — secret leak scanner.
 *
 * Fails the build if a committed file looks like it carries a real secret,
 * or if a real .env file is present in the tree. Runs in CI as a blocking gate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '.npm-cache-zamo']);

// Files that are allowed to contain secret-shaped placeholder text.
const ALLOWLIST = new Set(['.env.example', 'scan-secrets.mjs']);

const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.docx',
  '.ico',
  '.woff',
  '.woff2',
]);

const RULES = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Bearer JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'Generic assigned secret',
    re: /\b(password|passwd|secret|api[_-]?key|token|pepper)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  },
  {
    name: 'Postgres URL with password',
    re: /postgres(ql)?:\/\/[^:\s]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)/i,
  },
];

// Obvious placeholders that must not trip the scanner.
//
// This is tested against the MATCHED SECRET TEXT only, never the whole line:
// a line-wide test let `AKIA...EXAMPLE` through simply because the word
// "example" appeared somewhere on the line. Caught by the INFRA-002
// negative test; see docs/TEST_PLAN.md.
const PLACEHOLDER =
  /(replace[-_ ]?me|your[-_ ]?|changeme|xxx+|\$\{|<[a-z_]+>|placeholder|dummy|^example$|test[-_]?only)/i;

let findings = [];
let scanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full);
      continue;
    }
    const rel = relative(ROOT, full).replaceAll('\\', '/');

    // A real .env file must never exist in the tree.
    if (/^\.env($|\.)/.test(entry) && entry !== '.env.example') {
      findings.push({ file: rel, rule: 'Committed .env file', line: 0 });
      continue;
    }

    if (ALLOWLIST.has(basename(full))) continue;
    if (SKIP_EXT.has(extname(full).toLowerCase())) continue;
    if (st.size > 2_000_000) continue;

    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    scanned++;

    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = rule.re.exec(line);
        if (m === null) continue;
        // Judge the matched secret itself, not the surrounding prose.
        if (PLACEHOLDER.test(m[0])) continue;
        findings.push({ file: rel, rule: rule.name, line: i + 1 });
      }
    }
  }
}

walk(ROOT);

if (findings.length > 0) {
  console.error(`\n✖ Secret scan FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  }
  console.error('\nRemove the secret and rotate it. Never commit credentials.\n');
  process.exit(1);
}

console.log(`✓ Secret scan passed (${scanned} files scanned, 0 findings).`);
