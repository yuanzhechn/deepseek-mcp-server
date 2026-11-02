# Profiles and local configuration

Default: `balanced`. `gpt_only` blocks chat, FIM, Responses, delegation and uploads. Read-only model/balance/file queries and local conversation operations remain available. `quality` delegates R0/R1 documentation, translation, drafts and unit tests; other work stays on the host. `balanced` allocates GPT/DeepSeek work by task fit, quality evidence and cost (cold-start heuristics until evaluated). `economy` prioritizes DeepSeek for analysis, planning drafts, development, debugging, test writing, review, refactoring and documentation; GPT coordinates, integrates, makes key decisions and performs final acceptance. `custom` matches ordered task/risk rules and falls back to the host. Architecture, integration, external actions, risk/data constraints and capability checks take priority. These are deterministic cold-start heuristics, not measured success rates or promised task percentages.

The global GPT-only switch wins over project overrides. Project profiles use canonical real paths. Project budget/security overrides may tighten global limits; they cannot raise global ceilings or grant globally denied permissions. Config is read at each invocation. The configuration snapshot and price catalog remain fixed during admitted work.

`profiles.schema.v1.json` is generated from the runtime Zod schema; unknown fields/versions fail closed. `schema_version: 1` supports omitted fields with documented defaults. Unsupported future versions need an explicit migration. `revision` increments on every successful local update. Profile writes use an exclusive cross-process lock directory, fsync of a temporary JSON file and same-directory atomic rename. Concurrent stale `expected_revision` writes fail. A crashed writer's lock is not auto-stolen; see operations.

Local CLI examples (from source):

```powershell
node build/cli/collab.js profile list
node build/cli/collab.js profile get --json
node build/cli/collab.js profile set economy --expected-revision 0
node build/cli/collab.js profile set balanced --project D:/githubProject/my-app
node build/cli/collab.js quota set low
node build/cli/collab.js budget set '{"daily_usd":2,"project_daily_usd":1,"per_call_usd":0.25}'
node build/cli/collab.js config apply ./approved-config.json --expected-revision 4
```

All commands accept `--state-dir <directory>` and `--json`. Windows PowerShell 5 may alter JSON quoting for native executables; `config apply <file>` avoids that issue and allows custom routing/security settings to be reviewed first. `quota set` is user-reported status only and does not fabricate remaining tokens or influence safety gates. Local operator config may explicitly authorize R3/private context; secret patterns and restricted paths remain blocked. No MCP tool raises budgets or grants R3/private-data permissions.

Example custom configuration (only explicitly authorized public snippets should be sent):

```json
{
  "schema_version": 1,
  "active_profile": "custom",
  "routes": [
    {"task_type":"implementation","risk":"R1","executor":"deepseek"},
    {"task_type":"complex_refactor","risk":"R2","executor":"deepseek"}
  ],
  "budgets":{"daily_usd":2,"project_daily_usd":1,"per_call_usd":0.25}
}
```


Collaboration amendment (2026-11-02): routes name only GPT or DeepSeek. The backend `DEEPSEEK_DEFAULT_MODEL` selects the actual provider model independently of profile/task type; technical pricing catalogs and audit receipts retain actual IDs for accurate accounting. Legacy model-specific route entries migrate to `deepseek`. Economy increases useful DeepSeek work, not reduces work or quality. Supply sufficient authorized context; run all necessary builds, tests and reviews. Multi-round analysis, repair and retesting are allowed within explicit budgets and permissions. Parallelism depends on dependencies, resources and safety, never on economy mode alone. Integrate verified work without reimplementing it. Failed candidates should return to DeepSeek for diagnosis/repair before GPT takeover when appropriate. Independent task/attempt bounds remain resource controls, not a cap on the overall repair workflow. No host model/account switching or DeepSeek-primary profile is added.
