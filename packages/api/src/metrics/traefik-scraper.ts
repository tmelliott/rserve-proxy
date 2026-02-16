/**
 * Traefik Prometheus metrics scraper.
 *
 * Fetches the `/metrics` endpoint from Traefik and parses
 * `traefik_service_requests_total` counters to compute per-service
 * request counts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw counter totals keyed by Traefik service name (slug, without @docker) */
export type ServiceRequestCounts = Map<string, number>;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Regex to match lines like:
 * traefik_service_requests_total{code="200",method="GET",protocol="http",service="my-slug@docker"} 42
 *
 * Captures: [1] = service slug (before @docker), [2] = count
 */
const REQUEST_TOTAL_RE =
  /^traefik_service_requests_total\{[^}]*service="([^"]+)@docker"[^}]*\}\s+(\d+(?:\.\d+)?)/;

/**
 * Parse Prometheus text format and extract per-service total request counts.
 * Multiple lines for the same service (different codes/methods) are summed.
 */
export function parseRequestTotals(text: string): ServiceRequestCounts {
  const counts: ServiceRequestCounts = new Map();

  for (const line of text.split("\n")) {
    if (!line.startsWith("traefik_service_requests_total")) continue;
    const match = REQUEST_TOTAL_RE.exec(line);
    if (!match) continue;

    const service = match[1];
    const count = parseFloat(match[2]);
    counts.set(service, (counts.get(service) ?? 0) + count);
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

/**
 * Fetch Traefik's Prometheus metrics endpoint and return per-service
 * request totals.
 *
 * Returns an empty map if the fetch fails (Traefik not available).
 */
export async function scrapeTraefikMetrics(
  metricsUrl: string,
): Promise<ServiceRequestCounts> {
  try {
    const res = await fetch(metricsUrl, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return new Map();
    const text = await res.text();
    return parseRequestTotals(text);
  } catch {
    // Traefik not reachable — gracefully return empty
    return new Map();
  }
}
