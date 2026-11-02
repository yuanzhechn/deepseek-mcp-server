# Collaboration routing

For substantive coding tasks, inspect `get_collab_status` and `route_task` from the connected DeepSeek MCP when available. Respect the active profile. If these tools are unavailable, use Codex directly and state that MCP routing was not verified. The optional workflow is in `skills/collab-mode/SKILL.md`.

`gpt_only` prohibits DeepSeek generation. A GPT route means host execution in Codex; this MCP cannot invoke subscription GPT or reliably read its quota. Every profile keeps the GPT host active.

Delegate only authorized minimal context with a unique task ID, verifiable acceptance criteria, token/time limits and accurate data/risk classification. Treat output as a proposal; review and run relevant checks. Do not bypass budget, data or approval refusals, send credentials/private data without scope authorization, automatically execute model tool calls, or change Codex login/provider configuration.

Run `npm test` for source changes, and `npm run test:package` for packaging changes. Keep stdout MCP-only in the server. Logs go to stderr; API keys and operator state never enter Git.

Route only between GPT and DeepSeek; actual DeepSeek model selection belongs to backend configuration. Economy prioritizes DeepSeek analysis, plans, development, debugging, tests, review, refactoring and docs. Keep sufficient authorized context and identical quality/safety gates. Allow necessary repair rounds and dependency/resource/safety-based parallelism within explicit budgets. Return failures to DeepSeek for repair when appropriate; integrate validated work without reimplementation.
