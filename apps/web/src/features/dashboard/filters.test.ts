import { describe, expect, it } from 'vitest';

import { DEFAULT_RANGE, filtersToSearch, parseFilters, rangeWindow } from './filters';

describe('dashboard filters', () => {
  it('uses defaults when the URL has no filters', () => {
    expect(parseFilters(new URLSearchParams())).toEqual({
      service: undefined,
      region: undefined,
      range: DEFAULT_RANGE,
    });
  });

  it('ignores unknown regions and ranges instead of trusting the URL', () => {
    const filters = parseFilters(new URLSearchParams('region=MARS&range=forever'));
    expect(filters.region).toBeUndefined();
    expect(filters.range).toBe(DEFAULT_RANGE);
  });

  it('round-trips valid filters and omits defaults', () => {
    const filters = { service: 'svc_checkout', region: 'LIM' as const, range: '24h' as const };
    expect(parseFilters(new URLSearchParams(filtersToSearch(filters)))).toEqual(filters);
    expect(filtersToSearch({ range: DEFAULT_RANGE })).toBe('');
  });

  it('builds a window that ends on a minute boundary', () => {
    const now = Date.parse('2026-11-04T12:34:56Z');
    const { from, to } = rangeWindow('1h', now);
    expect(to.toISOString()).toBe('2026-11-04T12:35:00.000Z');
    expect(to.getTime() - from.getTime()).toBe(60 * 60_000);
  });
});
