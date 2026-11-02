#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProfileStore, canonicalProject } from "../collaboration/profile-store.js";
import { PROFILES, budgetsSchema, profileIdSchema, quotaSchema, profileConfigSchema, migrateLegacyExecutors } from "../collaboration/profile-schema.js";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const value = args[i + 1]; if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`); args.splice(i, 2); return value; };
  const state = flag("--state-dir");
  const projectArg = flag("--project");
  const revisionArg = flag("--expected-revision");
  const revision = revisionArg === undefined ? undefined : Number(revisionArg);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new Error("Invalid revision");
  const json = args.includes("--json");
  if (json) args.splice(args.indexOf("--json"), 1);
  const store = new ProfileStore(state ? resolve(state) : undefined);
  const project = projectArg ? canonicalProject(resolve(projectArg)) : undefined;
  const [command, action, value, ...extra] = args;
  if (extra.length) throw new Error("Unexpected arguments");
  let result: unknown;
  if (command === "profile" && action === "list" && !value) result = { profiles: PROFILES };
  else if (command === "profile" && action === "get" && !value) result = project ? await store.effective(project) : await store.read();
  else if (command === "profile" && action === "set" && value) result = await store.setProfile(profileIdSchema.parse(value), project, revision);
  else if (command === "quota" && action === "set" && value) {
    if (project) throw new Error("Quota is a global manually reported state");
    result = await store.update((config) => { config.gpt_quota_level = quotaSchema.parse(value); }, revision);
  } else if (command === "budget" && action === "set" && value) {
    const budgets = budgetsSchema.parse(JSON.parse(value));
    result = await store.update((config) => {
      if (project) config.projects[project] = { ...config.projects[project], budgets };
      else config.budgets = budgets;
    }, revision);
  } else if (command === "config" && action === "apply" && value && !project) {
    const replacement = profileConfigSchema.parse(migrateLegacyExecutors(JSON.parse(await readFile(resolve(value), "utf8"))));
    result = await store.update((config) => { const oldRevision = config.revision; Object.assign(config, replacement, { revision: oldRevision }); }, revision);
  } else {
    throw new Error("Usage: collab profile list|get|set <profile> | quota set unknown|high|medium|low|exhausted | budget set '<JSON>' | config apply <file> [--project <path>] [--state-dir <path>] [--expected-revision <n>] [--json]");
  }
  process.stdout.write(JSON.stringify(result, null, json ? 0 : 2) + "\n");
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "CLI failed"); process.exitCode = 1; });
