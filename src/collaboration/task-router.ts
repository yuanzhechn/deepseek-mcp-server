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
    let executor: "gpt" | "deepseek" = "gpt";
    if (snapshot.profile === "gpt_only") reasons.push("Global/project GPT-only generation gate.");
    else {
      try { this.policy.assertRisk(snapshot, input.risk, input.task_type); this.policy.assertData(snapshot, input.requirements, input.data_classification); }
      catch (error) { reasons.push(error instanceof Error ? error.message : "Policy blocked."); }
      if (!reasons.length) {
        const rule = snapshot.routes.find((rule) => rule.task_type === input.task_type && (!rule.risk || rule.risk === input.risk));
        if (rule) { executor = rule.executor; reasons.push("Explicit task/risk rule."); }
        else if (snapshot.profile === "custom") reasons.push("No matching custom rule; host fallback.");
        else if (input.needs_web) reasons.push("Live-source research stays with the host; delegated web tool spending is not bounded.");
        else if (/^(integration|git|deploy|final_decision|final_acceptance)$/.test(input.task_type)) reasons.push("Host owns integration, key decisions, final acceptance and external actions.");
        else if (snapshot.profile === "balanced" && /architecture|requirements|planning|code_review/.test(input.task_type)) reasons.push("Balanced profile keeps planning and broad review with the host until measured task-fit evidence is available.");
        else if (snapshot.profile === "quality") {
          if (["R0", "R1"].includes(input.risk) && /documentation|translation|unit_tests|draft/.test(input.task_type)) executor = "deepseek";
          reasons.push("Quality profile delegates only bounded low-risk drafts/tests/docs.");
        } else {
          executor = "deepseek";
          reasons.push(snapshot.profile === "economy" ? "DeepSeek-first execution; host coordinates, integrates and performs final acceptance with unchanged quality gates." : "Cold-start task-fit heuristic; quality and latency are unmeasured estimates.");
        }
      }
    }
    if (input.needs_web && executor !== "gpt") { executor = "gpt"; reasons.push("Research requires host execution."); }
    if (input.cost_cap_usd === 0 || snapshot.budgets.daily_usd === 0 || snapshot.budgets.project_daily_usd === 0 || snapshot.budgets.per_call_usd === 0) {
      executor = "gpt"; reasons.push("DeepSeek budget is zero.");
    }
    return { route: executor, execution: executor === "gpt" ? "host_required" : "delegate_available", reasons,
      executor_name: executor === "gpt" ? "GPT" : "DeepSeek",
      quality_requirements: ["build", "tests", "code_review", "repair_until_accepted"],
      workflow: { sufficient_authorized_context: true, parallelism: "dependency_resource_and_safety_based", repair_preference: snapshot.profile === "economy" ? "deepseek_first" : "task_fit_based", verified_work: "integrate_without_reimplementation", multi_round: "allowed_within_budget_and_permissions" },
      profile: snapshot.profile, policy_revision: snapshot.revision, gpt_host_active: true,
      reviewer: input.risk === "R3" ? "human" : "codex_and_tests", quality_basis: "cold_start_heuristic",
      gpt_quota: { source: snapshot.gpt_quota_level === "unknown" ? "unknown" : "user_reported", level: snapshot.gpt_quota_level },
    };
  }
}
