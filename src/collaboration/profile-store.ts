import { mkdir, open, readFile, rename, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { CollaborationError } from "./errors.js";
import { EffectivePolicy, ProfileConfig, profileConfigSchema, ProfileId } from "./profile-schema.js";

export function defaultStateDirectory(env = process.env): string {
  if (env.DEEPSEEK_COLLAB_STATE_DIR) return resolve(env.DEEPSEEK_COLLAB_STATE_DIR);
  return process.platform === "win32"
    ? join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "DeepSeekMcpOrchestrator")
    : join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "deepseek-mcp-server");
}

export function canonicalProject(path: string): string {
  if (/^(?:\\\\|\/\/)/.test(path) || !isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new CollaborationError("path_blocked", "Project must be an absolute local path without traversal.");
  }
  try {
    const canonical = realpathSync(path).replace(/\\/g, "/").replace(/\/$/, "");
    return process.platform === "win32" ? canonical.toLowerCase() : canonical;
  } catch {
    throw new CollaborationError("path_blocked", "Project path must exist and be accessible.");
  }
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..`) && !isAbsolute(rel));
}

export class ProfileStore {
  readonly path: string;
  constructor(readonly directory = defaultStateDirectory()) {
    this.path = join(directory, "profiles.json");
  }
  async read(): Promise<ProfileConfig> {
    try {
      return profileConfigSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return profileConfigSchema.parse({});
      throw new CollaborationError("configuration_error", "Invalid profiles.json or unsupported schema_version; refusing to reset policy.");
    }
  }
  async effective(project: string): Promise<EffectivePolicy> {
    const config = await this.read();
    const override = config.projects[project];
    // The global kill switch always wins, including over old project overrides.
    const profile = config.active_profile === "gpt_only" ? "gpt_only" : override?.profile ?? config.active_profile;
    return {
      profile, revision: config.revision, project,
      budgets: {
        daily_usd: config.budgets.daily_usd,
        project_daily_usd: Math.min(config.budgets.project_daily_usd, override?.budgets?.project_daily_usd ?? Infinity),
        per_call_usd: Math.min(config.budgets.per_call_usd, override?.budgets?.per_call_usd ?? Infinity),
      },
      routes: override?.routes ?? config.routes,
      allow_r3: config.allow_r3 && (override?.allow_r3 ?? true),
      allow_private_context: config.allow_private_context && (override?.allow_private_context ?? true),
      gpt_quota_level: config.gpt_quota_level,
    };
  }
  async update(mutator: (config: ProfileConfig) => void, expectedRevision?: number): Promise<ProfileConfig> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    let locked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await mkdir(lock); locked = true; break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await delay(20);
      }
    }
    if (!locked) throw new CollaborationError("configuration_busy", "Profile lock is busy; inspect stale lock after confirming no writer is running.", true);
    const temporary = join(dirname(this.path), `profiles.${randomUUID()}.tmp`);
    try {
      const config = await this.read();
      if (expectedRevision !== undefined && config.revision !== expectedRevision) {
        throw new CollaborationError("revision_conflict", "Policy changed; reread the revision before updating.");
      }
      mutator(config);
      config.revision++;
      config.updated_at = new Date().toISOString();
      const validated = profileConfigSchema.parse(config);
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(validated, null, 2) + "\n"); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.path);
      return validated;
    } finally {
      await rm(temporary, { force: true });
      await rmdir(lock);
    }
  }
  async setProfile(profile: ProfileId, project?: string, expectedRevision?: number) {
    let previous: ProfileId = "balanced";
    const config = await this.update((config) => {
      previous = project ? config.projects[project]?.profile ?? config.active_profile : config.active_profile;
      if (project) config.projects[project] = { ...config.projects[project], profile };
      else config.active_profile = profile;
    }, expectedRevision);
    return { previous, current: profile, effective_project: project ?? null, policy_version: 1, revision: config.revision, effective_at: config.updated_at };
  }
}
