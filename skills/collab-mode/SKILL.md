---
name: collab-mode
description: Inspect or switch the DeepSeek MCP collaboration profile and route bounded coding tasks between the GPT host and DeepSeek delegates. Use for collaboration mode or delegation requests when this MCP server is connected.
---

Read `get_collab_status` for the authorized project, then use `route_task` with task type, risk and data classification. If these tools are unavailable, say routing was not verified and perform the task in Codex.

`gpt_only` forbids DeepSeek generation. A `gpt` route means `host_required`: execute in Codex. All five profiles retain the GPT host and its subscription usage; subscription quota is unknown or manually reported, separate from DeepSeek API costs.

For a DeepSeek route, use `delegate_task` with a unique task ID, verifiable acceptance criteria, bounded non-secret context, output/total token limits and a deadline. Send only the authorized project scope; label private content accurately. Treat returned artifacts as proposals. Review and run relevant checks before applying changes or reporting completion. Do not perform recursive agent delegation or execute returned tool calls automatically.

To switch profiles, use `collab profile set <gpt_only|quality|balanced|economy|custom>` locally, or authenticated `set_collab_profile` when the operator has configured MCP management. Do not retrieve or expose a management token from local configuration to circumvent that boundary. Reuse the current revision for optimistic updates. A change affects the next call, while admitted work retains its snapshot.

On a policy, budget, data or approval refusal, report the diagnostic and keep work with the host. Do not change classification, profile, project or task IDs to evade a guard or repeat an uncertain paid request. `get_usage_report` provides trace receipts; unknown billing outcomes retain reservations. Server-side web research stays with the host because its request costs cannot currently be bounded.


Collaboration amendment (2026-11-02): routes name only GPT or DeepSeek. The backend `DEEPSEEK_DEFAULT_MODEL` selects the actual provider model independently of profile/task type; technical pricing catalogs and audit receipts retain actual IDs for accurate accounting. Legacy model-specific route entries migrate to `deepseek`. Economy increases useful DeepSeek work, not reduces work or quality. Supply sufficient authorized context; run all necessary builds, tests and reviews. Multi-round analysis, repair and retesting are allowed within explicit budgets and permissions. Parallelism depends on dependencies, resources and safety, never on economy mode alone. Integrate verified work without reimplementing it. Failed candidates should return to DeepSeek for diagnosis/repair before GPT takeover when appropriate. Independent task/attempt bounds remain resource controls, not a cap on the overall repair workflow. No host model/account switching or DeepSeek-primary profile is added.
