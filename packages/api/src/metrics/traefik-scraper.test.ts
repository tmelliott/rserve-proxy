import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRequestTotals, scrapeTraefikMetrics } from "./traefik-scraper.js";

// ---------------------------------------------------------------------------
// parseRequestTotals
// ---------------------------------------------------------------------------

describe("parseRequestTotals", () => {
  it("parses standard Prometheus counter lines", () => {
    const text = [
      '# HELP traefik_service_requests_total How many HTTP requests processed.',
      '# TYPE traefik_service_requests_total counter',
      'traefik_service_requests_total{code="200",method="GET",protocol="http",service="my-app@docker"} 42',
      'traefik_service_requests_total{code="404",method="GET",protocol="http",service="my-app@docker"} 3',
      'traefik_service_requests_total{code="200",method="POST",protocol="http",service="other@docker"} 10',
    ].join("\n");

    const counts = parseRequestTotals(text);
    expect(counts.get("my-app")).toBe(45); // 42 + 3
    expect(counts.get("other")).toBe(10);
    expect(counts.size).toBe(2);
  });

  it("handles empty input", () => {
    expect(parseRequestTotals("").size).toBe(0);
  });

  it("ignores comment and non-matching lines", () => {
    const text = [
      "# TYPE something counter",
      "some_other_metric 123",
      'traefik_config_reloads_total{} 5',
    ].join("\n");

    expect(parseRequestTotals(text).size).toBe(0);
  });

  it("handles float counter values", () => {
    const text =
      'traefik_service_requests_total{code="200",method="GET",protocol="http",service="app@docker"} 42.0';
    const counts = parseRequestTotals(text);
    expect(counts.get("app")).toBe(42);
  });

  it("handles service names with hyphens and numbers", () => {
    const text =
      'traefik_service_requests_total{code="200",method="GET",protocol="http",service="my-app-2@docker"} 7';
    const counts = parseRequestTotals(text);
    expect(counts.get("my-app-2")).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// scrapeTraefikMetrics
// ---------------------------------------------------------------------------

describe("scrapeTraefikMetrics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and parses metrics from URL", async () => {
    const body =
      'traefik_service_requests_total{code="200",method="GET",protocol="http",service="app@docker"} 100';

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const counts = await scrapeTraefikMetrics("http://traefik:8082/metrics");
    expect(counts.get("app")).toBe(100);
    expect(fetch).toHaveBeenCalledWith(
      "http://traefik:8082/metrics",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns empty map on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 500 }),
    );

    const counts = await scrapeTraefikMetrics("http://traefik:8082/metrics");
    expect(counts.size).toBe(0);
  });

  it("returns empty map on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const counts = await scrapeTraefikMetrics("http://traefik:8082/metrics");
    expect(counts.size).toBe(0);
  });
});
