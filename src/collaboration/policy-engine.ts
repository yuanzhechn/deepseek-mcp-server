import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { CollaborationError } from "./errors.js";
import { EffectivePolicy } from "./profile-schema.js";
import { isInside } from "./profile-store.js";

const secretPatterns = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/i,
  /\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/i,
  /\b(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?(?!REPLACE|example|test\b|\$\{|process\.env)[a-z0-9_+\/-]{8,}/i,
];
const secretPath = /(?:^|[\\/])(?:\.env[^\\/]*|\.ssh|\.aws|\.codex|id_rsa|id_ed25519|credentials|.*\.(?:pem|key))(?:[\\/]|$)/i;

export class PolicyEngine {
  assertGeneration(policy: EffectivePolicy): void {
    if (policy.profile === "gpt_only") throw new CollaborationError("policy_blocked", "GPT-only policy prohibits DeepSeek generation and uploads.");
  }
  assertData(policy: EffectivePolicy, payload: unknown, classification = "public"): void {
    if (classification === "secret" || (classification !== "public" && !policy.allow_private_context)) {
      throw new CollaborationError("data_policy_blocked", "Private/confidential context requires local operator authorization; secret data is prohibited.");
    }
    const text = JSON.stringify(payload);
    if (secretPatterns.some((pattern) => pattern.test(text)) || secretPath.test(text.replace(/\\\\/g, "/"))) {
      throw new CollaborationError("data_policy_blocked", "Context contains a restricted path or credential pattern. Remove it before delegation.");
    }
  }
  assertRisk(policy: EffectivePolicy, risk: string, taskType: string): void {
    if ((risk === "R3" || /security|auth|payment|permission|production_migration|cryptograph/i.test(taskType)) && !policy.allow_r3) {
      throw new CollaborationError("approval_required", "R3/security work requires explicit local operator policy approval; use the GPT host for review.");
    }
  }
  assertContextPath(policy: EffectivePolicy, path: string): void {
    if (/^(?:\\\\|\/\/)/.test(path) || path.split(/[\\/]/).includes("..") || secretPath.test(path) || /:/.test(path.replace(/^[a-z]:/i, ""))) {
      throw new CollaborationError("path_blocked", "Restricted context path.");
    }
    const absolute = isAbsolute(path) ? path : resolve(policy.project, path);
    let canonical: string;
    try { canonical = realpathSync(absolute); }
    catch { throw new CollaborationError("path_blocked", "Context manifest paths must exist inside the authorized project."); }
    if (!isInside(policy.project, canonical)) throw new CollaborationError("path_blocked", "Context path escapes the authorized project.");
  }
}
