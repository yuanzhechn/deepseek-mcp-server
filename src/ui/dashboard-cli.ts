import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { CollaborationService } from "../collaboration/delegation-service.js";
import { ProfileStore } from "../collaboration/profile-store.js";
import { startDashboard } from "./dashboard.js";

export async function runDashboard(args: string[]) {
  const take = (flag: string) => { const i = args.indexOf(flag); if (i < 0) return undefined; const value = args[i + 1]; if (!value || value.startsWith("--")) throw new Error(`Missing ${flag} value`); args.splice(i, 2); return value; };
  const directory = take("--state-dir"); const project = take("--project"); const portText = take("--port");
  const open = args.includes("--open"); if (open) args.splice(args.indexOf("--open"), 1);
  if (args.length) throw new Error("Usage: collab dashboard [--open] [--port <port>] [--project <path>] [--state-dir <path>]");
  const port = portText === undefined ? 0 : Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const service = new CollaborationService({ store: new ProfileStore(directory ? resolve(directory) : undefined), project: project ? resolve(project) : undefined });
  const runtime = await startDashboard(service, port);
  console.error(`DeepSeek 协作控制面板：${runtime.url}\n关闭此进程即可退出面板，MCP 不受影响。`);
  if (open) {
    const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(command, [runtime.url], { windowsHide: true, stdio: "ignore" });
    child.on("error", () => console.error("无法自动打开浏览器，请复制上面的完整链接。")); child.unref();
  }
  let stopping = false;
  const close = async () => { if (stopping) return; stopping = true; await runtime.close(); service.close(); };
  process.once("SIGINT", () => { void close(); }); process.once("SIGTERM", () => { void close(); });
}
