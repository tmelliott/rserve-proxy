/**
 * Metrics Module
 *
 * Collects container resource usage and status history for the
 * observability dashboard (Phase 7).
 */

export { MetricsCollector } from "./metrics-collector.js";
export type { MetricsCollectorOptions } from "./metrics-collector.js";
export { parseRequestTotals, scrapeTraefikMetrics } from "./traefik-scraper.js";
export type { ServiceRequestCounts } from "./traefik-scraper.js";
