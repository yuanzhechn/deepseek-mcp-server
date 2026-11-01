---
name: collab-mode
description: Inspect or switch the DeepSeek MCP collaboration profile and route bounded coding tasks between the GPT host and DeepSeek delegates. Use for collaboration mode or delegation requests when this MCP server is connected.
---

Read `get_collab_status` for the authorized project, then use `route_task` with task type, risk and data classification. If these tools are unavailable, say routing was not verified and perform the task in Codex.

`gpt_only` forbids DeepSeek generation. A `gpt` route means `host_required`: execute in Codex. All five profiles retain the GPT host and its subscription usage; subscription quota is unknown or manually reported, separate from DeepSeek API costs.

For a DeepSeek route, use `delegate_task` with a unique task ID, verifiable acceptance criteria, bounded non-secret context, output/total token limits and a deadline. Send only the authorized project scope; label private content accurately. Treat returned artifacts as proposals. Review and run relevant checks before applying changes or reporting completion. Do not perform recursive agent delegation or execute returned tool calls automatically.

To switch profiles, use `collab profile set <gpt_only|quality|balanced|economy|custom>` locally, or authenticated `set_collab_profile` when the operator has configured MCP management. Do not retrieve or expose a management token from local configuration to circumvent that boundary. Reuse the current revision for optimistic updates. A change affects the next call, while admitted work retains its snapshot.

On a policy, budget, data or approval refusal, report the diagnostic and keep work with the host. Do not change classification, profile, project or task IDs to evade a guard or repeat an uncertain paid request. `get_usage_report` provides trace receipts; unknown billing outcomes retain reservations. Server-side web research stays with the host because its request costs cannot currently be bounded.
