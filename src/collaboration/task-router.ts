import { z } from "zod";
import { EffectivePolicy, riskSchema } from "./profile-schema.js";
import { PolicyEngine } from "./policy-engine.js";

export const routeTaskSchema = z.object({
  task_type: z.string().min(1).max(100),
  risk: riskSchema,
  requirements: z.string().max(16000).default(""),
  project_path: z.string().optional(),
  size_hint: z.enum(["small", "medium", "large"]).default("small"),
  needs_vision: z.boolean().default(false),
  needs_web: z.boolean().default(false),
  data_classification: z.enum(["public", "private", "confidential", "secret"]).default("public"),
  cost_cap_usd: z.number().finite().nonnegative().optional(),
}).strict();
export type RouteTask = z.infer<typeof routeTaskSchema>;

export class TaskRouter {
  constructor(private readonly policy = new PolicyEngine()) {}
  route(input: RouteTask, snapshot: EffectivePolicy) {
    const reasons: string[] = [];
    let executor: "gpt" | "deepseek-flash" | "deepseek-v4-pro" = "gpt";
    if (snapshot.profile === "gpt_only") reasons.push("Global/project GPT-only generation gate.");
    else {
      try { this.policy.assertRisk(snapshot, input.risk, input.task_type); this.policy.assertData(snapshot, input.requirements, input.data_classification); }
      catch (error) { reasons.push(error instanceof Error ? error.message : "Policy blocked."); }
      if (!reasons.length) {
        const rule = snapshot.routes.find((rule) => rule.task_type === input.task_type && (!rule.risk || rule.risk === input.risk));
        if (rule) { executor = rule.executor; reasons.push("Explicit task/risk rule."); }
        else if (snapshot.profile === "custom") reasons.push("No matching custom rule; host fallback.");
        else if (input.needs_web) reasons.push("Live-source research stays with the host; delegated web tool spending is not bounded.");
        else if (/architecture|requirements|security|integration|git|deploy/.test(input.task_type)) reasons.push("Host owns architecture, integration and external actions.");
        else if (snapshot.profile === "quality") {
          if (["R0", "R1"].includes(input.risk) && /documentation|translation|unit_tests|draft/.test(input.task_type)) executor = "deepseek-flash";
          reasons.push("Quality profile delegates only bounded low-risk drafts/tests/docs.");
        } else {
          executor = snapshot.profile === "balanced" && (input.risk === "R2" || input.size_hint === "large") ? "deepseek-v4-pro" : "deepseek-flash";
          reasons.push("Cold-start deterministic risk/size heuristic; quality and latency are unmeasured estimates.");
        }
      }
    }
    if (input.needs_web && executor !== "gpt") { executor = "gpt"; reasons.push("Research requires host execution."); }
    if (input.needs_vision && executor === "deepseek-v4-pro") { executor = "deepseek-flash"; reasons.push("Pro lacks vision; select Flash."); }
    if (input.cost_cap_usd === 0 || snapshot.budgets.daily_usd === 0 || snapshot.budgets.project_daily_usd === 0 || snapshot.budgets.per_call_usd === 0) {
      executor = "gpt"; reasons.push("DeepSeek budget is zero.");
    }
    return { route: executor, execution: executor === "gpt" ? "host_required" : "delegate_available", reasons,
      profile: snapshot.profile, policy_revision: snapshot.revision, gpt_host_active: true,
      reviewer: input.risk === "R3" ? "human" : "codex_and_tests", quality_basis: "cold_start_heuristic",
      gpt_quota: { source: snapshot.gpt_quota_level === "unknown" ? "unknown" : "user_reported", level: snapshot.gpt_quota_level },
    };
  }
}
