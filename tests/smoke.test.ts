import { describe, it, expect } from 'vitest';
import { ok, err, unwrap } from '../src/shared/result.ts';

describe('ZAMO-INFRA-001 :: smoke', () => {
  it('the toolchain runs a test', () => {
    expect(1 + 1).toBe(2);
  });

  it('Result.ok carries a value', () => {
    expect(unwrap(ok('zamo'))).toBe('zamo');
  });

  it('Result.err is not ok', () => {
    const r = err('denied');
    expect(r.ok).toBe(false);
  });
});
