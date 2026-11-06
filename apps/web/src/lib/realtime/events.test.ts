import { describe, expect, it } from 'vitest';

import { affectedQueries, classify, realtimeUrl } from './events';

describe('classify', () => {
  it('applies the first event and each next sequence', () => {
    expect(classify(null, 40)).toBe('apply');
    expect(classify(10, 11)).toBe('apply');
  });

  it('ignores events already applied, including replays', () => {
    expect(classify(10, 10)).toBe('duplicate');
    expect(classify(10, 3)).toBe('duplicate');
  });

  it('reports a gap when a sequence was skipped', () => {
    expect(classify(10, 12)).toBe('gap');
  });
});

describe('affectedQueries', () => {
  it('refreshes incident lists and the dashboard on incident events', () => {
    const keys = affectedQueries({ type: 'incident.updated', payload: {} }, 'o1', 'u1');
    expect(keys).toContainEqual(['org', 'o1', 'incidents']);
    expect(keys).toContainEqual(['org', 'o1', 'dashboard']);
  });

  it('refreshes alerts and the dashboard when an alert changes state', () => {
    for (const type of ['alert.triggered', 'alert.cleared'] as const) {
      const keys = affectedQueries({ type, payload: {} }, 'o1', 'u1');
      expect(keys).toContainEqual(['org', 'o1', 'alerts']);
    }
  });

  it('refreshes the demo panel and dashboard when a simulation starts or ends', () => {
    for (const type of ['simulator.scenario.started', 'simulator.scenario.finished'] as const) {
      const keys = affectedQueries({ type, payload: {} }, 'o1', 'u1');
      expect(keys).toContainEqual(['org', 'o1', 'demo']);
      expect(keys).toContainEqual(['org', 'o1', 'dashboard']);
    }
  });

  it('invalidates everything cached for the tenant when the demo is reset', () => {
    expect(affectedQueries({ type: 'simulator.reset', payload: {} }, 'o1', 'u1')).toEqual([
      ['org', 'o1'],
    ]);
  });

  it('refetches notifications only for their recipient', () => {
    const event = { type: 'notification.created', payload: { recipientId: 'u2' } } as const;
    expect(affectedQueries(event, 'o1', 'u1')).toEqual([]);
    expect(affectedQueries(event, 'o1', 'u2')).toEqual([['org', 'o1', 'notifications']]);
  });
});

describe('realtimeUrl', () => {
  it('defaults to the API port on the current host', () => {
    expect(realtimeUrl({ protocol: 'http:', hostname: 'localhost' })).toBe('http://localhost:4000');
    expect(
      realtimeUrl({ protocol: 'http:', hostname: 'localhost' }, 'https://api.example.com'),
    ).toBe('https://api.example.com');
  });
});
