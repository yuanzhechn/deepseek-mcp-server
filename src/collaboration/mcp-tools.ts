import { McpServer, CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CollaborationService, delegateTaskSchema } from "./delegation-service.js";
import { DeepSeekApiClient } from "../deepseek/client.js";
import { PROFILES, profileIdSchema } from "./profile-schema.js";
import { routeTaskSchema } from "./task-router.js";

const outputSchema = z.record(z.string(), z.unknown());
export function collaborationResult(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}
type Handler = (input: any, context: ServerContext) => Promise<CallToolResult>;
export function registerCollaborationTools(server: McpServer, service: CollaborationService, client: DeepSeekApiClient, errorResult: (error: unknown) => CallToolResult, protect: (handler: Handler) => Handler) {
  function register(name: string, description: string, inputSchema: z.ZodObject<any>, handler: (input: any, signal: AbortSignal) => Promise<Record<string, unknown>>, write = false) {
    server.registerTool(name, { description, inputSchema, outputSchema,
      annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: name === "delegate_task" || name === "get_collab_status" } },
    protect(async (input, context) => {
      try { context.mcpReq.signal.throwIfAborted(); return collaborationResult(await handler(input, context.mcpReq.signal)); }
      catch (error) { return errorResult(error); }
    }));
  }
  register("list_collab_profiles", "List five collaboration profiles. Codex/GPT remains the host in every profile.", z.object({}), async () => ({ profiles: PROFILES, default_profile: "balanced", schema_version: 1, gpt_host_active: true }));
  register("get_collab_status", "Read fresh policy and ledger. GPT subscription quota is unknown or manually reported; optional live DeepSeek balance is separate.",
    z.object({ project_path: z.string().optional(), include_balance: z.boolean().default(false) }), async (input, signal) => {
      const policy = await service.snapshot(input.project_path);
      let balance: Record<string, unknown> = { source: "not_requested", value: null };
      if (input.include_balance) {
        try { balance = { source: "live_deepseek_api", value: await client.getUserBalance(signal) }; }
        catch { balance = { source: "unavailable", value: null }; }
      }
      return { ...policy, schema_version: 1, gpt_host_active: true,
        gpt_quota: { source: policy.gpt_quota_level === "unknown" ? "unknown" : "user_reported", level: policy.gpt_quota_level, tokens_remaining: null, usd_remaining: null },
        deepseek_balance: balance, usage: service.ledger.report(policy.project), management: "local_cli_or_authenticated_mcp", pending_policy_changes: "next_call_only" };
    });
  register("set_collab_profile", "Persist a profile for the next call; requires a separate local management token. CLI works without an MCP session.",
    z.object({ profile: profileIdSchema, project_path: z.string().optional(), expected_revision: z.number().int().nonnegative().optional(), management_token: z.string().optional() }),
    async (input) => { service.authorizeManagement(input.management_token); return service.store.setProfile(input.profile, input.project_path ? service.projectFor(input.project_path) : undefined, input.expected_revision); }, true);
  register("route_task", "Deterministic risk/data/budget routing. GPT returns host_required; this tool never invokes a model.", routeTaskSchema, (input) => service.route(input));
  register("delegate_task", "Send bounded authorized context and verifiable acceptance criteria to DeepSeek; return candidate artifacts, real model/usage/trace. Never write files or run commands.", delegateTaskSchema, (input, signal) => service.delegate(input, client, signal), true);
  register("estimate_task_cost", "Estimate DeepSeek token costs using a versioned catalog, cache breakdown and UTC peak schedule. This is not a provider invoice.",
    z.object({ model: z.string(), estimated_input_tokens: z.number().int().nonnegative(), estimated_output_tokens: z.number().int().nonnegative(), estimated_cached_tokens: z.number().int().nonnegative().default(0) }),
    async (input) => ({ ...service.pricing().quote(input.model, input.estimated_input_tokens, input.estimated_output_tokens, input.estimated_cached_tokens),
      upper_bound: service.pricing().quote(input.model, input.estimated_input_tokens, input.estimated_output_tokens, 0, new Date(), true) }));
  register("get_usage_report", "Read DeepSeek usage and held reservations. Ledger includes legacy generation tools; GPT subscription usage remains unknown.",
    z.object({ scope: z.enum(["project", "global"]).default("project"), project_path: z.string().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }),
    async (input) => { const project = service.projectFor(input.project_path); return service.ledger.report(input.scope === "global" ? undefined : project, input.from, input.to); });
}
