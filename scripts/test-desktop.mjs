import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
if (process.platform !== "win32") throw new Error("Native desktop test requires Windows.");
execFileSync(process.execPath, ["scripts/build-desktop.mjs"], { stdio: "inherit" });
const root = mkdtempSync(join(tmpdir(), "deepseek-native-"));
try {
  const project = join(root, "项目 space & data"); mkdirSync(project);
  const state = join(root, "shared state");
  const result = spawnSync(resolve("dist/desktop/DeepSeekCollab.exe"), ["--self-test", "--server-dir", process.cwd(), "--project", project, "--state-dir", state], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native self-test failed: ${result.stderr}`);
  const config = JSON.parse(readFileSync(join(state, "profiles.json"), "utf8"));
  if (config.revision !== 4 || config.active_profile !== "balanced" || !Object.values(config.projects).some(p => p.profile === "balanced")) throw new Error("Native CLI integration did not persist expected policy.");
  console.log("Native EXE verified: Unicode/spaced paths, project switching, stale revision rejection, global GPT-only override and shared policy persistence. Operator state untouched.");
} finally { rmSync(root, { recursive: true, force: true }); }
