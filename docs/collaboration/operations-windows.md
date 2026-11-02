# Windows operations

Build from this checkout (the new collaboration features are not claimed to be published on npm):

```powershell
npm ci
npm run build
node build/cli/collab.js profile list
node build/cli/collab.js profile get
node build/cli/collab.js profile set balanced
```

After installing the packed package, `collab` is the bin alias for the same CLI. It does not require an API key. Set `DEEPSEEK_API_KEY` only for the MCP server using the existing environment mechanism. Start it with `node D:/githubProject/deepseek-mcp-server/build/index.js`. An existing Codex MCP process needs a restart once to discover the seven new tools; subsequent profile switches require no session restart.

State defaults to `%LOCALAPPDATA%/DeepSeekMcpOrchestrator` on Windows, or `$XDG_STATE_HOME/deepseek-mcp-server` / `~/.local/state/deepseek-mcp-server` on other platforms. `DEEPSEEK_COLLAB_STATE_DIR` overrides it for all server processes and CLI calls. The CLI also accepts `--state-dir`. All processes meant to share budgets must point to the same directory, local disk and canonical project. Do not share a SQLite WAL database over a network filesystem. Docker users should mount `/var/lib/deepseek-mcp` to preserve policy and billing state.

Optional environment settings:

| Name | Purpose |
| --- | --- |
| `DEEPSEEK_COLLAB_PROJECT` | Default project root, existing absolute local directory; defaults to server cwd |
| `DEEPSEEK_COLLAB_ALLOWED_PROJECTS` | Additional exact authorized project roots separated by `;` |
| `DEEPSEEK_COLLAB_MANAGEMENT_TOKEN` | Separate secret for MCP profile updates; absent means local CLI only |
| `DEEPSEEK_COLLAB_PRICE_FILE` | Trusted version 1 price JSON; invalid catalogs block generation |

The supplied AGENTS/Skill files are templates in this repository. Copy them into the intended Codex project/skill location using your established installation process; this change does not install them globally. The GPT host remains active in every profile. A quota level set through `quota set low` is a manually reported hint, not a reading of the subscription balance. `get_collab_status` can request `include_balance: true` for an independent live DeepSeek API balance check; otherwise it clearly reports `not_requested`.

Default hard limits are $5/day global, $5/day/project and $1/call. Use `config apply <approved-json-file> --expected-revision <n>` to review routes, budget and approval changes as a file. This also avoids PowerShell 5 native JSON-quoting pitfalls. Reducing a cap does not cancel admitted work; it prevents later reservations. Raising budgets is a local operator action.

`get_usage_report` includes today's estimates, cache breakdown, state, per-model aggregates, receipts (latest 200) and all-days outstanding holds. `reserved` may mean an in-flight request or a process interrupted before finalization. `uncertain` means billing could not be confirmed. They remain charged against admission budgets even on later days. Do not delete/reset the ledger to repeat a task. Reconcile the trace and provider account before a local operator changes the ledger; automatic release/reconciliation is deliberately deferred. Keep backups with the service stopped, or use SQLite's backup API; copying only the main database while WAL is live is unsafe.

If `profiles.json.lock` remains after a crash, confirm that no writer/CLI is running before removing that exact empty lock directory. Do not delete the JSON or steal an active lock. Malformed/future configuration fails closed; restore a known compatible backup. Unknown pricing/usage retains a hold rather than inventing zero cost. Price/calendar updates affect the next request and retain the original source metadata in older receipts.

Verification: `npm test`, `npm run test:package`, `npm pack --dry-run`, `npm audit`. The package check creates a temporary installation, loads the native SQLite binding, starts stdio, lists tools and verifies CLI-to-running-server profile propagation without contacting DeepSeek. Native SQLite requires a supported Node binary/prebuild or local build toolchain. Windows Node 22 is tested locally; Linux Node 20/22/24 and Windows Node 22 are in CI.

Rollback: switch back to the previous Git commit, rebuild and restart the MCP process. Preserve state backups. Older pre-collaboration servers do not enforce these policies, so using an old version removes its budget guard. Do not interpret rollback as retaining the guard.


Collaboration amendment (2026-11-02): routes name only GPT or DeepSeek. The backend `DEEPSEEK_DEFAULT_MODEL` selects the actual provider model independently of profile/task type; technical pricing catalogs and audit receipts retain actual IDs for accurate accounting. Legacy model-specific route entries migrate to `deepseek`. Economy increases useful DeepSeek work, not reduces work or quality. Supply sufficient authorized context; run all necessary builds, tests and reviews. Multi-round analysis, repair and retesting are allowed within explicit budgets and permissions. Parallelism depends on dependencies, resources and safety, never on economy mode alone. Integrate verified work without reimplementing it. Failed candidates should return to DeepSeek for diagnosis/repair before GPT takeover when appropriate. Independent task/attempt bounds remain resource controls, not a cap on the overall repair workflow. No host model/account switching or DeepSeek-primary profile is added.
