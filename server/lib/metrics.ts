import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const jobsTotal = new client.Counter({
  name: 'wahasender_jobs_total',
  help: 'Send jobs processed, partitioned by outcome',
  labelNames: ['outcome'],
  registers: [registry],
});

export const jobLatency = new client.Histogram({
  name: 'wahasender_job_duration_seconds',
  help: 'Duration of send-message job processing',
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const wahaErrors = new client.Counter({
  name: 'wahasender_waha_errors_total',
  help: 'WAHA API errors partitioned by classification',
  labelNames: ['kind'],
  registers: [registry],
});

export const circuitBreakerState = new client.Gauge({
  name: 'wahasender_circuit_breaker_open',
  help: '1 when a session circuit-breaker is open, 0 otherwise',
  labelNames: ['session'],
  registers: [registry],
});

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}
