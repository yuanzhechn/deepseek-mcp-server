import { readFileSync } from "node:fs";
import { z } from "zod";
import { CollaborationError } from "./errors.js";

const ratesSchema = z.object({ input_miss: z.number().finite().nonnegative(), input_hit: z.number().finite().nonnegative(), output: z.number().finite().nonnegative() }).strict();
export const priceCatalogSchema = z.object({
  schema_version: z.literal(1), id: z.string().min(1), source_url: z.url(), verified_at: z.iso.datetime(), effective_at: z.iso.datetime(),
  peak_utc_hours: z.array(z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)])),
  chinese_holidays: z.array(z.iso.date()), holiday_calendar_complete_years: z.array(z.number().int()),
  search_per_1000_usd: z.number().finite().nonnegative(), fetch_per_1000_usd: z.number().finite().nonnegative(),
  models: z.record(z.string(), z.object({ off_peak: ratesSchema, peak: ratesSchema }).strict()),
}).strict();
export const DEFAULT_CATALOG = priceCatalogSchema.parse({
  schema_version: 1, id: "deepseek-2026-11-01", source_url: "https://api-docs.deepseek.com/quick_start/pricing/",
  verified_at: "2026-11-01T00:00:00.000Z", effective_at: "2026-11-01T00:00:00.000Z",
  peak_utc_hours: [[1, 4], [6, 10]], chinese_holidays: [], holiday_calendar_complete_years: [],
  search_per_1000_usd: 0.75, fetch_per_1000_usd: 0.75,
  models: {
    "deepseek-flash": { off_peak: { input_hit: 0.003, input_miss: 0.15, output: 0.6 }, peak: { input_hit: 0.006, input_miss: 0.3, output: 1.2 } },
    "deepseek-v4-pro": { off_peak: { input_hit: 0.022, input_miss: 0.66, output: 1.98 }, peak: { input_hit: 0.044, input_miss: 1.32, output: 3.96 } },
  },
});
export type PriceCatalog = z.infer<typeof priceCatalogSchema>;
export function loadCatalog(path = process.env.DEEPSEEK_COLLAB_PRICE_FILE): PriceCatalog {
  try { return path ? priceCatalogSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : structuredClone(DEFAULT_CATALOG); }
  catch { throw new CollaborationError("pricing_unavailable", "Invalid price catalog; refusing unpriced requests."); }
}
export function canonicalModel(model: string): string {
  return ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(model) ? "deepseek-flash" : model;
}
export type TokenUsage = { input_tokens: number; cache_hit_tokens: number; cache_miss_tokens: number; output_tokens: number; cache_usage_source: string };
export function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, any>;
  const input = u.prompt_tokens ?? u.input_tokens;
  const output = u.completion_tokens ?? u.output_tokens;
  const hit = u.prompt_cache_hit_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? (input - hit);
  if (![input, output, hit, miss].every((n) => Number.isSafeInteger(n) && n >= 0) || hit + miss !== input) return null;
  return { input_tokens: input, cache_hit_tokens: hit, cache_miss_tokens: miss, output_tokens: output,
    cache_usage_source: u.prompt_cache_hit_tokens !== undefined ? "provider" : u.input_tokens_details?.cached_tokens !== undefined ? "provider_details" : "conservative_no_cache_breakdown" };
}
export class Pricing {
  constructor(readonly catalog = loadCatalog()) {}
  quote(model: string, input: number, output: number, cached = 0, now = new Date(), worstCase = false) {
    if (![input, output, cached].every((n) => Number.isSafeInteger(n) && n >= 0) || cached > input) throw new CollaborationError("invalid_usage", "Invalid token counts.");
    if (now.getTime() < Date.parse(this.catalog.effective_at)) throw new CollaborationError("pricing_unavailable", "Catalog is not yet effective.");
    const entry = this.catalog.models[canonicalModel(model)];
    if (!entry) throw new CollaborationError("pricing_unavailable", "Model has no verified price; update the local price catalog.");
    const weekday = now.getUTCDay() >= 1 && now.getUTCDay() <= 5;
    const chinaDate = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
    const holiday = this.catalog.chinese_holidays.includes(chinaDate);
    const peak = !holiday && weekday && this.catalog.peak_utc_hours.some(([start, end]) => now.getUTCHours() >= start && now.getUTCHours() < end);
    const rates = worstCase ? {
      input_hit: Math.max(entry.peak.input_hit, entry.off_peak.input_hit),
      input_miss: Math.max(entry.peak.input_miss, entry.off_peak.input_miss),
      output: Math.max(entry.peak.output, entry.off_peak.output),
    } : peak ? entry.peak : entry.off_peak;
    const nanos = Math.ceil(((input - cached) * rates.input_miss + cached * rates.input_hit + output * rates.output) * 1000);
    if (!Number.isSafeInteger(nanos)) throw new CollaborationError("invalid_usage", "Cost exceeds ledger precision range.");
    return { estimated_usd: nanos / 1e9, cost_nanos: nanos, model: canonicalModel(model), rates_per_million_usd: rates,
      period: worstCase ? "maximum_rate_reservation" : peak ? "peak" : "off_peak", timezone: "UTC", billing_day_timezone: "Asia/Shanghai",
      price_catalog_id: this.catalog.id, source_url: this.catalog.source_url, verified_at: this.catalog.verified_at, effective_at: this.catalog.effective_at,
      holiday_calendar: this.catalog.holiday_calendar_complete_years.includes(Number(chinaDate.slice(0, 4))) ? "configured_complete" : "incomplete_weekday_peak_is_conservative",
      estimate_only: true };
  }
}
