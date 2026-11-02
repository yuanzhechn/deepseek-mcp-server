import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "win32") throw new Error("Native desktop build requires Windows.");
execFileSync(join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./build-desktop.ps1", import.meta.url))], { stdio: "inherit" });
