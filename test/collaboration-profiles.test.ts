import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProfileStore, canonicalProject } from "../src/collaboration/profile-store.js";
import { profileConfigSchema } from "../src/collaboration/profile-schema.js";
import { PolicyEngine } from "../src/collaboration/policy-engine.js";
import { TaskRouter, routeTaskSchema } from "../src/collaboration/task-router.js";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deepseek-profiles-")); directories.push(root);
  const project = join(root, "project"); mkdirSync(project);
  const store = new ProfileStore(join(root, "state"));
  return { root, store, project: canonicalProject(project) };
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("versioned profiles and deterministic routing", () => {
  it("economy delegates more suitable work with identical quality and safety gates", async () => {
    const { store, project } = fixture(); const router = new TaskRouter();
    for (const task_type of ["requirements", "planning", "architecture", "code_review"]) {
      const input = routeTaskSchema.parse({ task_type, risk: "R2" });
      await store.setProfile("balanced"); const balanced = router.route(input, await store.effective(project));
      await store.setProfile("economy"); const economy = router.route(input, await store.effective(project));
      expect(balanced.route).toBe("gpt"); expect(economy.route).toBe("deepseek");
      expect(economy.quality_requirements).toEqual(balanced.quality_requirements);
      expect(economy.workflow).toMatchObject({ repair_preference: "deepseek_first", parallelism: "dependency_resource_and_safety_based", sufficient_authorized_context: true, verified_work: "integrate_without_reimplementation" });
    }
    expect(router.route(routeTaskSchema.parse({ task_type: "security", risk: "R3" }), await store.effective(project)).route).toBe("gpt");
  });
  it("migrates old model-specific global and project route entries without using them for dispatch", async () => {
    const { store, project } = fixture(); await store.setProfile("custom");
    writeFileSync(store.path, JSON.stringify({ schema_version: 1, active_profile: "custom", routes: [{ task_type: "implementation", executor: "deepseek-v4-pro" }], projects: { [project]: { routes: [{ task_type: "documentation", executor: "deepseek-flash" }] } } }));
    const config = await store.read(); expect(config.routes[0].executor).toBe("deepseek");
    expect(config.projects[project].routes?.[0].executor).toBe("deepseek");
  });
  it("defaults to balanced, persists on restart, and rejects stale revisions", async () => {
    const { store } = fixture();
    expect((await store.read()).active_profile).toBe("balanced");
    await store.setProfile("economy", undefined, 0);
    expect((await new ProfileStore(store.directory).read()).active_profile).toBe("economy");
    await expect(store.setProfile("quality", undefined, 0)).rejects.toMatchObject({ error_type: "revision_conflict" });
    expect((await store.read()).revision).toBe(1);
  });
  it("serializes writers and never loses revisions", async () => {
    const { store } = fixture();
    await Promise.all(Array.from({ length: 20 }, () => new ProfileStore(store.directory).setProfile("balanced")));
    expect((await store.read()).revision).toBe(20);
    const settled = await Promise.allSettled(Array.from({ length: 4 }, () => store.setProfile("quality", undefined, 20)));
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
  it("reads CLI changes without rebuilding a running service, including another process", async () => {
    const { store, project } = fixture();
    expect((await store.effective(project)).profile).toBe("balanced");
    const result = await promisify(execFile)(process.execPath, ["build/cli/collab.js", "profile", "set", "gpt_only", "--state-dir", store.directory, "--json"], { cwd: process.cwd() });
    expect(JSON.parse(result.stdout)).toMatchObject({ previous: "balanced", current: "gpt_only", revision: 1 });
    expect((await store.effective(project)).profile).toBe("gpt_only");
    const script = `import { ProfileStore } from './build/collaboration/profile-store.js'; const s=new ProfileStore(process.argv[1]); console.log((await s.read()).active_profile);`;
    expect((await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, store.directory])).stdout.trim()).toBe("gpt_only");
  });
  it("fails closed on future schema, unknown properties, malformed JSON and invalid profiles", async () => {
    const { store } = fixture(); await store.setProfile("balanced");
    for (const body of ['{"schema_version":2}', '{"active_profile":"deepseek_primary"}', '{"unexpected":true}', '{']) {
      writeFileSync(store.path, body);
      await expect(store.read()).rejects.toMatchObject({ error_type: "configuration_error" });
    }
    expect(profileConfigSchema.parse({ schema_version: 1 }).revision).toBe(0);
    expect(profileConfigSchema.safeParse({ budgets: { daily_usd: -1 } }).success).toBe(false);
  });
  it("applies project overrides without relaxing global kill switch or budget/security ceilings", async () => {
    const { store, project } = fixture();
    await store.update((c) => { c.budgets.per_call_usd = 0.1; c.projects[project] = { profile: "economy", budgets: { per_call_usd: 10 }, allow_r3: true }; });
    expect(await store.effective(project)).toMatchObject({ profile: "economy", budgets: { per_call_usd: 0.1 }, allow_r3: false });
    await store.setProfile("gpt_only");
    expect((await store.effective(project)).profile).toBe("gpt_only");
  });
  it.each([
    ["gpt_only", "implementation", "R1", "gpt"], ["quality", "implementation", "R1", "gpt"],
    ["quality", "documentation", "R0", "deepseek"], ["balanced", "implementation", "R1", "deepseek"],
    ["balanced", "complex_refactor", "R2", "deepseek"], ["economy", "complex_refactor", "R2", "deepseek"],
    ["custom", "implementation", "R1", "gpt"], ["economy", "security", "R3", "gpt"],
  ] as const)("routes %s / %s / %s to %s", async (profile, task_type, risk, expected) => {
    const { store, project } = fixture(); await store.setProfile(profile);
    const result = new TaskRouter().route(routeTaskSchema.parse({ task_type, risk }), await store.effective(project));
    expect(result.route).toBe(expected); expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.gpt_host_active).toBe(true);
    if (expected === "gpt") expect(result.execution).toBe("host_required");
  });
  it("enforces capability/risk/data gates ahead of custom mappings and reports user quota honestly", async () => {
    const { store, project } = fixture();
    await store.update((c) => { c.active_profile = "custom"; c.gpt_quota_level = "low"; c.routes = [{ task_type: "implementation", executor: "deepseek" }]; });
    const base = { task_type: "implementation", risk: "R1" };
    const route = async (extra: Record<string, unknown>) => new TaskRouter().route(routeTaskSchema.parse({ ...base, ...extra }), await store.effective(project));
    expect(await route({ needs_vision: true })).toMatchObject({ route: "deepseek", gpt_quota: { source: "user_reported", level: "low" } });
    for (const extra of [{ needs_web: true }, { risk: "R3" }, { data_classification: "secret" }, { cost_cap_usd: 0 }]) {
      expect((await route(extra)).execution).toBe("host_required");
    }
  });
  it("rejects non-local or traversing project paths", () => {
    for (const path of ["../x", "//server/share", "C:\\project\\..\\secrets"]) expect(() => canonicalProject(path)).toThrow();
  });
  it("rejects secret content, traversal, restricted files and junction escapes", async () => {
    const { store, project, root } = fixture(); const policy = await store.effective(project); const guard = new PolicyEngine();
    writeFileSync(join(project, "code.ts"), "public code");
    expect(() => guard.assertContextPath(policy, "code.ts")).not.toThrow();
    for (const path of ["../outside", ".env", "//host/share", "missing.ts", "code.ts:secret"]) expect(() => guard.assertContextPath(policy, path)).toThrow();
    const outside = join(root, "outside"); mkdirSync(outside); writeFileSync(join(outside, "private.ts"), "private");
    symlinkSync(outside, join(project, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(() => guard.assertContextPath(policy, "escape/private.ts")).toThrow();
    for (const content of ["-----BEGIN OPENSSH PRIVATE KEY-----", "sk-abcdefghijklmnop123456789", "API_KEY=realcredential12345"]) expect(() => guard.assertData(policy, content)).toThrow();
    for (const classification of ["private", "confidential", "secret"]) expect(() => guard.assertData(policy, "unmarked content", classification)).toThrow();
  });
});
