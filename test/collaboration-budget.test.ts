import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { DeepSeekApiClient, DeepSeekApiError } from "../src/deepseek/client.js";
import { ConversationStore } from "../src/conversation-store.js";
import { createDeepSeekMcpServer } from "../src/mcp-server.js";
import { CollaborationService, delegateTaskSchema } from "../src/collaboration/delegation-service.js";
import { ProfileStore } from "../src/collaboration/profile-store.js";
import { Pricing, DEFAULT_CATALOG, normalizeUsage } from "../src/collaboration/pricing.js";
import { UsageLedger } from "../src/collaboration/usage-ledger.js";

const resources: { root: string; service: CollaborationService }[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deepseek-budget-"));
  const store = new ProfileStore(join(root, "state"));
  const service = new CollaborationService({ store, project: root, managementToken: "admin" });
  resources.push({ root, service });
  return { root, store, service };
}
afterEach(() => { vi.restoreAllMocks(); for (const { root, service } of resources.splice(0)) { service.close(); rmSync(root, { recursive: true, force: true }); } });
const usage = { prompt_tokens: 100, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40, completion_tokens: 10, total_tokens: 110 };
const response = () => ({ response: { id: "provider-1", model: "deepseek-flash", usage, choices: [{ finish_reason: "stop", message: { content: "candidate" } }] } });
const request = { model: "deepseek-flash", messages: [{ role: "user", content: "hi" }], max_tokens: 100 };
const task = () => delegateTaskSchema.parse({ task_id: "task-1", task_type: "implementation", risk: "R1", requirements: "Propose a pure function", acceptance_criteria: ["Returns twice its numeric input"], context: [], max_output_tokens: 100, max_total_tokens: 8000, deadline_ms: 2000 });

describe("price catalog and usage", () => {
  it.each([
    ["2026-11-02T00:59:59Z", "off_peak"], ["2026-11-02T01:00:00Z", "peak"],
    ["2026-11-02T04:00:00Z", "off_peak"], ["2026-11-02T06:00:00Z", "peak"],
    ["2026-11-02T10:00:00Z", "off_peak"], ["2026-11-01T02:00:00Z", "off_peak"],
  ])("uses UTC window boundaries %s", (date, period) => {
    expect(new Pricing().quote("deepseek-flash", 100, 100, 0, new Date(date)).period).toBe(period);
  });
  it("calculates separate cached/missed/output costs, aliases and holiday overrides", () => {
    const quote = new Pricing().quote("deepseek-flash", 1000000, 1000000, 600000, new Date("2026-11-01T02:00:00Z"));
    expect(quote.estimated_usd).toBeCloseTo(0.6618, 8);
    expect(normalizeUsage(usage)).toMatchObject({ input_tokens: 100, cache_hit_tokens: 60, cache_miss_tokens: 40, output_tokens: 10, cache_usage_source: "provider" });
    expect(normalizeUsage({ input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 70 } })).toMatchObject({ cache_hit_tokens: 70, cache_miss_tokens: 30 });
    expect(normalizeUsage({ prompt_tokens: 100, completion_tokens: 5 })).toMatchObject({ cache_hit_tokens: 0, cache_miss_tokens: 100, cache_usage_source: "conservative_no_cache_breakdown" });
    expect(normalizeUsage({ ...usage, prompt_cache_miss_tokens: 99 })).toBeNull();
    expect(new Pricing().quote("deepseek-v4-flash", 100, 100).model).toBe("deepseek-flash");
    const holiday = structuredClone(DEFAULT_CATALOG); holiday.chinese_holidays = ["2026-11-02"];
    expect(new Pricing(holiday).quote("deepseek-flash", 100, 100, 0, new Date("2026-11-02T02:00:00Z")).period).toBe("off_peak");
    expect(() => new Pricing().quote("unknown", 1, 1)).toThrow();
    expect(() => new Pricing().quote("deepseek-flash", 1, 1, 2)).toThrow();
  });
});

describe("atomic budgets and delegation", () => {
  it("uses one configured backend model independent of profile and task size", async () => {
    const { service, store, root } = fixture();
    const configured = new CollaborationService({ store, project: root, defaultModel: "deepseek-v4-pro" });
    const api = { createChatCompletion: vi.fn(async () => response()) };
    try {
      for (const [index, profile] of (["balanced", "economy"] as const).entries()) {
        await store.setProfile(profile);
        await configured.delegate({ ...task(), task_id: `configured-${index}` }, api as unknown as DeepSeekApiClient, new AbortController().signal);
      }
      for (const call of api.createChatCompletion.mock.calls as any[]) expect(call[0].model).toBe("deepseek-v4-pro");
    } finally { configured.close(); }
  });
  it("never oversells the budget across 20 independent processes", async () => {
    const { root, service } = fixture(); const snapshot = await service.snapshot();
    snapshot.budgets = { per_call_usd: 1, daily_usd: 1, project_daily_usd: 1 };
    const path = join(root, "parallel.sqlite"); const db = new UsageLedger(path); db.close();
    const script = `import { UsageLedger } from './build/collaboration/usage-ledger.js'; const [path,raw,id]=process.argv.slice(1); const db=new UsageLedger(path); try {db.reserve(id,id,'deepseek-flash',200000000,JSON.parse(raw),'test'); console.log('reserved');} catch(e){if(e.error_type!=='budget_exceeded')throw e;console.log('blocked');}finally{db.close();}`;
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, path, JSON.stringify(snapshot), String(i)], { timeout: 20000 })));
    expect(results.filter((result) => result.stdout.trim() === "reserved")).toHaveLength(5);
    const reader = new UsageLedger(path);
    try { expect(reader.report().totals).toMatchObject({ calls: 5, held_usd: 1 }); }
    finally { reader.close(); }
  }, 30000);
  it("settles usage once and rejects duplicate task IDs", async () => {
    const { service } = fixture(); const invoke = vi.fn(async () => response());
    const { receipt } = await service.runGeneration("chat", request, new AbortController().signal, invoke, { taskId: "unique" });
    expect(receipt).toMatchObject({ model: "deepseek-flash", provider_request_id: "provider-1", billing_status: "settled_estimate" });
    const report = service.ledger.report(); expect(report.totals).toMatchObject({ calls: 1, input_tokens: 100, cache_hit_tokens: 60, cache_miss_tokens: 40, output_tokens: 10, held_usd: 0 });
    service.ledger.fail(String(receipt.trace_id), "cancelled", true, 0);
    expect(service.ledger.report().totals).toEqual(report.totals);
    await expect(service.runGeneration("chat", request, new AbortController().signal, invoke, { taskId: "unique" })).rejects.toMatchObject({ error_type: "duplicate_task" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("enforces zero, per-call and task caps before invoking provider", async () => {
    const { service, store } = fixture(); const invoke = vi.fn(async () => response());
    await store.update((c) => { c.budgets.daily_usd = 0; });
    await expect(service.runGeneration("chat", request, new AbortController().signal, invoke)).rejects.toMatchObject({ error_type: "budget_exceeded" });
    await store.update((c) => { c.budgets.daily_usd = 5; c.budgets.per_call_usd = 0; });
    await expect(service.runGeneration("chat", request, new AbortController().signal, invoke)).rejects.toMatchObject({ error_type: "budget_exceeded" });
    await store.update((c) => { c.budgets.per_call_usd = 1; });
    await expect(service.runGeneration("chat", request, new AbortController().signal, invoke, { costCap: 0 })).rejects.toMatchObject({ error_type: "budget_exceeded" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reads operator price updates on the next task and refuses unapproved projects", async () => {
    const { service, root } = fixture(); const catalogPath = join(root, "prices.json");
    const first = structuredClone(DEFAULT_CATALOG); writeFileSync(catalogPath, JSON.stringify(first));
    const configured = new CollaborationService({ store: service.store, project: root, priceFile: catalogPath });
    expect(configured.pricing().catalog.id).toBe(first.id);
    first.id = "operator-update"; writeFileSync(catalogPath, JSON.stringify(first));
    expect(configured.pricing().catalog.id).toBe("operator-update");
    writeFileSync(catalogPath, '{"schema_version":999}');
    expect(() => configured.pricing()).toThrow();
    expect(() => service.projectFor(tmpdir())).toThrow();
  });
  it("returns host_required when the shared remaining budget is exhausted", async () => {
    const { service, store } = fixture();
    await store.update((c) => { c.budgets.daily_usd = 0.001; });
    const snapshot = await service.snapshot(); service.ledger.reserve("held", "held", "deepseek-flash", 1000000, snapshot, "test");
    const { routeTaskSchema } = await import("../src/collaboration/task-router.js");
    expect(await service.route(routeTaskSchema.parse({ task_type: "implementation", risk: "R1" }))).toMatchObject({ route: "gpt", execution: "host_required", available_deepseek_usd: 0 });
  });
  it("does not reserve already cancelled work and settles known usage on a late cancellation", async () => {
    const { service } = fixture(); const cancelled = new AbortController(); cancelled.abort();
    const invoke = vi.fn(async () => response());
    await expect(service.runGeneration("chat", request, cancelled.signal, invoke)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    const late = new AbortController();
    await expect(service.runGeneration("chat", request, late.signal, async () => { late.abort(); return response(); })).rejects.toMatchObject({ error_type: "cancelled", collaboration_receipt: { billing_status: "settled_estimate" } });
    expect(service.ledger.report().totals).toMatchObject({ calls: 1, input_tokens: 100, held_usd: 0 });
  });
  it.each([401, 403, 429, 500])("handles provider %s without unsafe duplicate billing", async (status) => {
    const { service } = fixture(); const invoke = vi.fn(async () => { throw new DeepSeekApiError("failure", { status }); });
    await expect(service.runGeneration("chat", request, new AbortController().signal, invoke, { attempts: 3 })).rejects.toBeInstanceOf(DeepSeekApiError);
    expect(invoke).toHaveBeenCalledTimes(status === 429 ? 3 : 1);
    const row = service.ledger.report().calls[0] as any;
    expect(row.state).toBe(status === 500 ? "uncertain" : "failed");
  });
  it("retains unknown usage, network/cancellation holds and settles once even after cancellation", async () => {
    const { service } = fixture(); const controller = new AbortController();
    const invoke = vi.fn(async () => { controller.abort(); throw new DeepSeekApiError("cancelled"); });
    await expect(service.runGeneration("chat", request, controller.signal, invoke)).rejects.toThrow();
    const unknown = { response: { model: "deepseek-flash" } };
    const result = await service.runGeneration("chat", request, new AbortController().signal, async () => unknown);
    expect(result.receipt.billing_status).toBe("uncertain_reservation_held");
    expect((service.ledger.report().totals as any).held_usd).toBeGreaterThan(0);
    expect((service.ledger.report().totals as any).calls).toBe(2);
  });
  it("keeps the policy snapshot for a request already admitted", async () => {
    const { service, store } = fixture();
    const admitted = await service.runGeneration("chat", request, new AbortController().signal, async () => { await store.setProfile("gpt_only"); return response(); });
    expect(admitted.receipt.policy_revision).toBe(0);
    await expect(service.runGeneration("chat", request, new AbortController().signal, async () => response())).rejects.toMatchObject({ error_type: "policy_blocked" });
  });
  it("delegates a real API-shaped response as a proposal and never writes project files", async () => {
    const { service } = fixture(); const api = { createChatCompletion: vi.fn(async () => response()) };
    const result = await service.delegate(task(), api as unknown as DeepSeekApiClient, new AbortController().signal);
    expect(result).toMatchObject({ status: "proposed", task_id: "task-1", model: "DeepSeek", provider_details: { model: "deepseek-flash" }, files_written: false, validation: "host_review_and_tests_required" });
    expect(api.createChatCompletion.mock.calls).toHaveLength(1);
    await expect(service.delegate(task(), api as unknown as DeepSeekApiClient, new AbortController().signal)).rejects.toMatchObject({ error_type: "duplicate_task" });
  });
  it("rejects unbounded context, R3 self-approval and unmetered web search", async () => {
    const { service } = fixture(); const api = { createChatCompletion: vi.fn(async () => response()) };
    await expect(service.delegate({ ...task(), max_total_tokens: 5 }, api as unknown as DeepSeekApiClient, new AbortController().signal)).rejects.toMatchObject({ error_type: "token_limit_exceeded" });
    await expect(service.delegate({ ...task(), risk: "R3" }, api as unknown as DeepSeekApiClient, new AbortController().signal)).rejects.toMatchObject({ error_type: "approval_required" });
    await expect(service.runGeneration("response", { ...request, tools: [{ type: "web_search" }] }, new AbortController().signal, async () => response())).rejects.toMatchObject({ error_type: "unbounded_tool_cost" });
    expect(api.createChatCompletion).not.toHaveBeenCalled();
  });
  it("cannot lower Responses reservations with alternate extra_body limits or multiple candidates", async () => {
    const { service, store } = fixture(); const invoke = vi.fn(async () => response());
    await store.update((c) => { c.budgets.per_call_usd = 0.001; });
    await expect(service.runGeneration("response", { model: "deepseek-flash", input: "hi", max_tokens: 1, max_output_tokens: 393216 }, new AbortController().signal, invoke)).rejects.toMatchObject({ error_type: "budget_exceeded" });
    await expect(service.runGeneration("chat", { ...request, n: 10 }, new AbortController().signal, invoke)).rejects.toMatchObject({ error_type: "unbounded_generation_cost" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("aborts an in-flight delegate on deadline without releasing an uncertain charge", async () => {
    const { service } = fixture();
    const api = { createChatCompletion: vi.fn((_request, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DeepSeekApiError("cancelled")), { once: true }))) };
    await expect(service.delegate({ ...task(), deadline_ms: 100 }, api as unknown as DeepSeekApiClient, new AbortController().signal)).rejects.toThrow();
    expect((service.ledger.report().calls[0] as any).state).toBe("uncertain");
  });
  it("keeps uncertain holds across midnight and ledger restart", async () => {
    const { service, root } = fixture(); const snapshot = await service.snapshot(); snapshot.budgets.daily_usd = 0.5;
    const ledgerPath = join(root, "midnight.sqlite"); const db = new UsageLedger(ledgerPath);
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-11-01T15:59:59Z").getTime());
    db.reserve("old", "old", "deepseek-flash", 500000000, snapshot, "test"); db.fail("old", "timeout", true, 1); db.close();
    clock.mockReturnValue(new Date("2026-11-01T16:00:01Z").getTime());
    const restarted = new UsageLedger(ledgerPath);
    try { expect(() => restarted.reserve("new", "new", "deepseek-flash", 1, snapshot, "test")).toThrow(); }
    finally { restarted.close(); }
  });
});

describe("legacy MCP policy enforcement", () => {
  it.each(["chat_completion", "completion", "create_response"])("meters streamed %s usage through actual API client and MCP", async (tool) => {
    const { service } = fixture();
    const payload = tool === "create_response" ? { type: "response.completed", response: { id: "sse-response", model: "deepseek-flash", status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 60 } } } }
      : { id: "sse-chat", model: "deepseek-flash", choices: [{ index: 0, delta: { content: "hi" }, text: "hi", finish_reason: "stop" }], usage };
    const fetchFn = vi.fn(async () => new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }));
    const api = new DeepSeekApiClient({ apiKey: "test", fetchFn });
    const server = createDeepSeekMcpServer({ client: api, conversations: new ConversationStore(), defaultModel: "deepseek-flash", collaboration: service });
    const client = new Client({ name: "sse-ledger", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const args = tool === "create_response" ? { input: "hi", max_output_tokens: 100 } : tool === "completion" ? { prompt: "hi", max_tokens: 100 } : { message: "hi", max_tokens: 100 };
      const result = await client.callTool({ name: tool, arguments: { ...args, stream: true } });
      expect(result.isError).toBeFalsy(); expect(result.structuredContent?.collaboration).toMatchObject({ billing_status: "settled_estimate" });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(service.ledger.report().totals).toMatchObject({ input_tokens: 100, cache_hit_tokens: 60, cache_miss_tokens: 40, output_tokens: 10, held_usd: 0 });
    } finally { await client.close(); await server.close(); }
  });
  it("blocks all generations/uploads with GPT-only while allowing read-only tools and local state", async () => {
    const { service, store } = fixture(); await store.setProfile("gpt_only");
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ object: "list", data: [] }), { headers: { "content-type": "application/json" } }));
    const api = new DeepSeekApiClient({ apiKey: "test", fetchFn });
    const server = createDeepSeekMcpServer({ client: api, conversations: new ConversationStore(), defaultModel: "deepseek-flash", collaboration: service });
    const client = new Client({ name: "policy-test", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      for (const [name, args] of [
        ["chat_completion", { message: "hi", stream: true }], ["completion", { prompt: "hi", stream: true }],
        ["create_response", { input: "hi", stream: true }], ["delegate_task", task()],
        ["upload_file", { filename: "pixel.png", file_data: "iVBORw0KGgo=" }],
      ] as const) {
        expect((await client.callTool({ name, arguments: args })).structuredContent).toMatchObject({ error_type: "policy_blocked" });
      }
      expect(fetchFn).not.toHaveBeenCalled();
      await client.callTool({ name: "list_models", arguments: {} }); expect(fetchFn).toHaveBeenCalledTimes(1);
      expect((await client.callTool({ name: "get_collab_status", arguments: {} })).structuredContent).toMatchObject({ profile: "gpt_only", gpt_host_active: true, gpt_quota: { source: "unknown", tokens_remaining: null } });
      expect((await client.callTool({ name: "set_collab_profile", arguments: { profile: "economy" } })).structuredContent).toMatchObject({ error_type: "management_unauthorized" });
      expect((await client.callTool({ name: "set_collab_profile", arguments: { profile: "economy", management_token: "admin", expected_revision: 1 } })).structuredContent).toMatchObject({ current: "economy", revision: 2 });
    } finally { await client.close(); await server.close(); }
  });
  it("checks stored history and extra_body before legacy requests and observes external budget changes", async () => {
    const { service, store } = fixture(); const invoke = vi.fn(async () => response());
    for (const data of [
      { ...request, messages: [{ role: "user", content: "sk-abcdefghijklmnopqrstuv" }, { role: "user", content: "safe latest turn" }] },
      { ...request, future_field: { credential: "-----BEGIN PRIVATE KEY-----" } },
    ]) await expect(service.runGeneration("chat", data, new AbortController().signal, invoke)).rejects.toMatchObject({ error_type: "data_policy_blocked" });
    await store.update((c) => { c.budgets.project_daily_usd = 0; });
    await expect(service.runGeneration("fim", request, new AbortController().signal, invoke)).rejects.toMatchObject({ error_type: "budget_exceeded" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
