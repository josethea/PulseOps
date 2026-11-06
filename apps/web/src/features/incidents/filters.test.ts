import { describe, expect, it } from 'vitest';

import { filtersToSearch, hasActiveFilters, parseFilters } from './filters';

describe('incident filters', () => {
  it('defaults to newest first with no filters', () => {
    const filters = parseFilters(new URLSearchParams());
    expect(filters).toEqual({
      status: undefined,
      severity: undefined,
      service: undefined,
      q: undefined,
      sort: '-createdAt',
    });
    expect(hasActiveFilters(filters)).toBe(false);
  });

  it('ignores invalid values instead of failing', () => {
    const filters = parseFilters(
      new URLSearchParams('status=BOGUS&severity=SEV9&sort=title&q=%20%20'),
    );
    expect(filters.status).toBeUndefined();
    expect(filters.severity).toBeUndefined();
    expect(filters.sort).toBe('-createdAt');
    expect(filters.q).toBeUndefined();
  });

  it('round-trips through the URL and omits defaults', () => {
    const filters = parseFilters(
      new URLSearchParams('status=OPEN&severity=SEV1&q=checkout&sort=severity'),
    );
    expect(filtersToSearch(filters)).toBe('status=OPEN&severity=SEV1&q=checkout&sort=severity');
    expect(filtersToSearch(parseFilters(new URLSearchParams()))).toBe('');
    expect(hasActiveFilters(filters)).toBe(true);
  });

  it('caps the search text length', () => {
    const filters = parseFilters(new URLSearchParams({ q: 'x'.repeat(300) }));
    expect(filters.q).toHaveLength(100);
  });
});
