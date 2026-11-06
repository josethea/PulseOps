import { describe, expect, it } from 'vitest';

import { sampleAt, scenarioAt, seriesSpec, toMinute } from './telemetry.js';

const series = seriesSpec('svc_checkout', 'checkout-api', 'LIM');
const START = toMinute(new Date('2026-10-01T00:00:00Z'));
const THIRTY_DAYS = 30 * 24 * 60;

describe('synthetic telemetry', () => {
  it('is deterministic for the same series and minute', () => {
    expect(sampleAt(series, START + 123)).toEqual(sampleAt(series, START + 123));
  });

  it('differs between series', () => {
    const other = seriesSpec('svc_orders', 'orders-service', 'AQP');
    expect(sampleAt(series, START)).not.toEqual(sampleAt(other, START));
  });

  it('keeps healthy error rates within 0.2-1% and availability near 100%', () => {
    for (let i = 0; i < THIRTY_DAYS; i += 7) {
      const minute = START + i;
      if (scenarioAt(series, minute) !== 'healthy') continue;
      const sample = sampleAt(series, minute);
      expect(sample.error_rate).toBeGreaterThanOrEqual(0.2);
      expect(sample.error_rate).toBeLessThanOrEqual(1);
      expect(sample.availability).toBeGreaterThan(99);
    }
  });

  it('produces degraded and outage episodes with the documented ranges', () => {
    const seen = { degraded: false, outage: false };
    for (let i = 0; i < THIRTY_DAYS; i++) {
      const minute = START + i;
      const state = scenarioAt(series, minute);
      if (state === 'healthy') continue;
      const { error_rate } = sampleAt(series, minute);
      if (state === 'degraded') {
        seen.degraded = true;
        expect(error_rate).toBeGreaterThanOrEqual(3);
        expect(error_rate).toBeLessThanOrEqual(8);
      } else {
        seen.outage = true;
        expect(error_rate).toBeGreaterThanOrEqual(20);
        expect(error_rate).toBeLessThanOrEqual(50);
      }
    }
    expect(seen.degraded).toBe(true);
    expect(seen.outage).toBe(true);
  });

  it('keeps percentile latencies ordered and counters consistent', () => {
    for (let i = 0; i < 2000; i++) {
      const s = sampleAt(series, START + i);
      expect(s.latency_p50).toBeLessThan(s.latency_p95);
      expect(s.latency_p95).toBeLessThan(s.latency_p99);
      expect(s.orders_completed + s.orders_failed).toBe(s.orders_per_minute);
    }
  });
});
