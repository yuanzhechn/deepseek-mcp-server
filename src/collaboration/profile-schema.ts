import { z } from "zod";

export const profileIdSchema = z.enum(["gpt_only", "quality", "balanced", "economy", "custom"]);
export const riskSchema = z.enum(["R0", "R1", "R2", "R3"]);
export const executorSchema = z.enum(["gpt", "deepseek-flash", "deepseek-v4-pro"]);
export const quotaSchema = z.enum(["unknown", "high", "medium", "low", "exhausted"]);
export const budgetsSchema = z.object({
  daily_usd: z.number().finite().nonnegative().max(1000000).default(5),
  project_daily_usd: z.number().finite().nonnegative().max(1000000).default(5),
  per_call_usd: z.number().finite().nonnegative().max(1000000).default(1),
}).strict();
export const routeRuleSchema = z.object({
  task_type: z.string().min(1).max(100),
  risk: riskSchema.optional(),
  executor: executorSchema,
}).strict();
const policyShape = {
  profile: profileIdSchema.optional(),
  budgets: budgetsSchema.partial().optional(),
  routes: z.array(routeRuleSchema).max(100).optional(),
  allow_r3: z.boolean().optional(),
  allow_private_context: z.boolean().optional(),
};
export const profileConfigSchema = z.object({
  schema_version: z.literal(1).default(1),
  revision: z.number().int().nonnegative().default(0),
  updated_at: z.string().datetime().default("1970-01-01T00:00:00.000Z"),
  active_profile: profileIdSchema.default("balanced"),
  budgets: budgetsSchema.default({ daily_usd: 5, project_daily_usd: 5, per_call_usd: 1 }),
  routes: z.array(routeRuleSchema).max(100).default([]),
  allow_r3: z.boolean().default(false),
  allow_private_context: z.boolean().default(false),
  gpt_quota_level: quotaSchema.default("unknown"),
  projects: z.record(z.string(), z.object(policyShape).strict()).default({}),
}).strict();
export type ProfileId = z.infer<typeof profileIdSchema>;
export type ProfileConfig = z.infer<typeof profileConfigSchema>;
export type EffectivePolicy = {
  profile: ProfileId;
  revision: number;
  project: string;
  budgets: z.infer<typeof budgetsSchema>;
  routes: z.infer<typeof routeRuleSchema>[];
  allow_r3: boolean;
  allow_private_context: boolean;
  gpt_quota_level: z.infer<typeof quotaSchema>;
};
export const PROFILES = [
  { id: "gpt_only", name: "GPT 独立", description: "Block every DeepSeek generation and upload; GPT host executes." },
  { id: "quality", name: "质量优先", description: "Delegate low-risk documentation, drafts and tests; host handles other work." },
  { id: "balanced", name: "智能均衡", description: "Flash for bounded work, Pro for R2 debugging/refactors, host for architecture/security." },
  { id: "economy", name: "成本优先", description: "Prefer Flash for R0–R2; host still integrates and reviews." },
  { id: "custom", name: "自定义", description: "Use explicit task/risk rules; unmatched work stays with host." },
] as const;
