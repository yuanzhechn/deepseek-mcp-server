import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CollaborationError } from "./errors.js";
import { EffectivePolicy } from "./profile-schema.js";
import { TokenUsage } from "./pricing.js";

export function billingDay(now = Date.now()): string { return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); }
export class UsageLedger {
  private readonly db: Database.Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS ledger_meta(version INTEGER NOT NULL);
      INSERT INTO ledger_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ledger_meta);`);
    if ((this.db.prepare("SELECT version FROM ledger_meta").get() as any).version !== 1) {
      this.db.close(); throw new CollaborationError("configuration_error", "Unsupported ledger schema.");
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS calls (
      trace_id TEXT PRIMARY KEY, task_id TEXT UNIQUE, project TEXT NOT NULL, model TEXT NOT NULL,
      day TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL,
      reserved_nanos INTEGER NOT NULL, cost_nanos INTEGER, revision INTEGER NOT NULL,
      input_tokens INTEGER, cache_hit_tokens INTEGER, cache_miss_tokens INTEGER, output_tokens INTEGER,
      cache_usage_source TEXT, provider_model TEXT, provider_request_id TEXT, catalog_id TEXT NOT NULL,
      pricing_json TEXT, error_type TEXT, duration_ms INTEGER
    ); CREATE INDEX IF NOT EXISTS calls_day ON calls(day);`);
  }
  close() { this.db.close(); }
  private heldNanos(day: string, project?: string): number {
    return (this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN state IN ('reserved','uncertain') THEN reserved_nanos ELSE COALESCE(cost_nanos, 0) END),0) AS nanos
      FROM calls WHERE (day = ? OR state IN ('reserved','uncertain')) ${project ? "AND project = ?" : ""}`)
      .get(...(project ? [day, project] : [day])) as { nanos: number }).nanos;
  }
  available(policy: EffectivePolicy): number {
    const day = billingDay();
    return Math.max(0, Math.min(policy.budgets.per_call_usd,
      policy.budgets.daily_usd - this.heldNanos(day) / 1e9,
      policy.budgets.project_daily_usd - this.heldNanos(day, policy.project) / 1e9));
  }
  reserve(trace: string, taskId: string | null, model: string, nanos: number, policy: EffectivePolicy, catalogId: string) {
    if (!Number.isSafeInteger(nanos) || nanos < 0) throw new CollaborationError("invalid_usage", "Invalid reservation.");
    const day = billingDay();
    this.db.transaction(() => {
      if (taskId && this.db.prepare("SELECT trace_id FROM calls WHERE task_id = ?").get(taskId)) {
        throw new CollaborationError("duplicate_task", "Task ID already exists; inspect its receipt instead of sending a duplicate request.");
      }
      const limits = policy.budgets;
      if (nanos > Math.floor(limits.per_call_usd * 1e9) || this.heldNanos(day) + nanos > Math.floor(limits.daily_usd * 1e9) || this.heldNanos(day, policy.project) + nanos > Math.floor(limits.project_daily_usd * 1e9)) {
        throw new CollaborationError("budget_exceeded", "DeepSeek reservation would exceed the per-call, daily or project budget. No API request sent.");
      }
      this.db.prepare(`INSERT INTO calls(trace_id,task_id,project,model,day,started_at,state,reserved_nanos,revision,catalog_id) VALUES(?,?,?,?,?,?,'reserved',?,?,?)`)
        .run(trace, taskId, policy.project, model, day, new Date().toISOString(), nanos, policy.revision, catalogId);
    }).immediate();
  }
  settle(trace: string, usage: TokenUsage, costNanos: number, providerModel: string, providerId: string | null, quote: unknown, durationMs: number, state = "completed") {
    this.db.prepare(`UPDATE calls SET state=?,cost_nanos=?,input_tokens=?,cache_hit_tokens=?,cache_miss_tokens=?,output_tokens=?,cache_usage_source=?,provider_model=?,provider_request_id=?,pricing_json=?,duration_ms=?,finished_at=? WHERE trace_id=? AND state='reserved'`)
      .run(state, costNanos, usage.input_tokens, usage.cache_hit_tokens, usage.cache_miss_tokens, usage.output_tokens, usage.cache_usage_source,
        providerModel, providerId, JSON.stringify(quote), durationMs, new Date().toISOString(), trace);
  }
  fail(trace: string, errorType: string, billedUnknown: boolean, durationMs: number) {
    this.db.prepare(`UPDATE calls SET state=?,cost_nanos=?,error_type=?,duration_ms=?,finished_at=? WHERE trace_id=? AND state='reserved'`)
      .run(billedUnknown ? "uncertain" : "failed", billedUnknown ? null : 0, errorType, durationMs, new Date().toISOString(), trace);
  }
  report(project?: string, from = billingDay(), to = billingDay()) {
    const where = `day >= ? AND day <= ? ${project ? "AND project = ?" : ""}`;
    const args = project ? [from, to, project] : [from, to];
    const totals = this.db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(cost_nanos),0)/1e9 estimated_usd,
      COALESCE(SUM(CASE WHEN state IN ('reserved','uncertain') THEN reserved_nanos ELSE 0 END),0)/1e9 held_usd,
      COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(cache_hit_tokens),0) cache_hit_tokens,
      COALESCE(SUM(cache_miss_tokens),0) cache_miss_tokens, COALESCE(SUM(output_tokens),0) output_tokens,
      COALESCE(SUM(CASE WHEN state IN ('failed','uncertain','provider_failed','incomplete') THEN 1 ELSE 0 END),0) failed_or_uncertain
      FROM calls WHERE ${where}`).get(...args);
    const rows = this.db.prepare(`SELECT * FROM calls WHERE ${where} ORDER BY started_at DESC LIMIT 200`).all(...args);
    const outstanding = this.db.prepare(`SELECT COALESCE(SUM(reserved_nanos),0)/1e9 held_usd, COUNT(*) calls FROM calls WHERE state IN ('reserved','uncertain') ${project ? "AND project = ?" : ""}`)
      .get(...(project ? [project] : []));
    const byModel = this.db.prepare(`SELECT COALESCE(provider_model,model) model, COUNT(*) calls, COALESCE(SUM(cost_nanos),0)/1e9 estimated_usd FROM calls WHERE ${where} GROUP BY COALESCE(provider_model,model)`).all(...args);
    return { from, to, timezone: "Asia/Shanghai", totals, outstanding_all_days: outstanding, by_model: byModel, calls: rows, calls_limit: 200, estimate_only: true, gpt_usage: "unknown" };
  }
}
