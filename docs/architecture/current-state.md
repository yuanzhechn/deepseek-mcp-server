# Baseline (Phase 0)

Inspected 2026-11-01 at commit `7a08656b733b5e5d4a71ecd308770226170954eb`, package 1.4.1, Windows Node 22.17.0. `npm ci`, build and all 94 tests in seven files passed before changes.

Existing tools: `chat_completion`, `completion`, `create_response`, `list_models`, `get_user_balance`, `upload_file`, `list_files`, `retrieve_file`, `delete_file`, `reset_conversation`, `list_conversations`. Chat/FIM stream aggregation, stateless Responses, vision, Files, cancellation, request timeout, credential redaction, tool invocation rate limits, resources and a starter prompt already exist. Conversations use a process-local capped Map. Stdio supports modern and legacy negotiation; Streamable HTTP already protects authentication, host and origin boundaries. The HTTP factory creates a server per request and shares invocation limits by provider client.

The design's model/price assumptions were checked against the official DeepSeek pricing and Chat API pages on 2026-11-01. Local source takes precedence over design examples. Existing CI already runs pack dry-run, but did not install and start the packed artifact. Existing Node >=20 support is retained with better-sqlite3 rather than requiring experimental node:sqlite. No Codex provider/login integration is needed.

Audit baseline: 3 affected development packages (Vitest, @vitest/mocker, Vite); no production vulnerability reported. Exploit paths involve a development server/mocking interface, not the deployed MCP HTTP handler. Apply compatible patched releases and rerun audit; do not force dependency major upgrades.
