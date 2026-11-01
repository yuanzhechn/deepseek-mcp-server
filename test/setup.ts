import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never read or mutate an operator's real profiles/ledger during regression tests.
const directory = mkdtempSync(join(tmpdir(), "deepseek-regression-"));
process.env.DEEPSEEK_COLLAB_STATE_DIR = directory;
delete process.env.DEEPSEEK_COLLAB_PRICE_FILE;
delete process.env.DEEPSEEK_COLLAB_PROJECT;
delete process.env.DEEPSEEK_COLLAB_ALLOWED_PROJECTS;
delete process.env.DEEPSEEK_COLLAB_MANAGEMENT_TOKEN;
writeFileSync(join(directory, "profiles.json"), JSON.stringify({ schema_version: 1, budgets: { daily_usd: 1000, project_daily_usd: 1000, per_call_usd: 10 } }));
