import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

const root = mkdtempSync(join(tmpdir(), "deepseek-package-"));
// Invoke npm's JS entrypoint directly: no shell interpolation of temporary paths.
const npm = process.env.npm_execpath;
assert.ok(npm, "Run through npm run test:package");
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
let client;
try {
  const packed = JSON.parse(runNpm(["pack", "--json", "--pack-destination", root], process.cwd()));
  const artifact = join(root, packed[0].filename);
  const clean = join(root, "clean");
  mkdirSync(clean);
  runNpm(["init", "--yes"], clean);
  runNpm(["install", "--omit=dev", "--no-audit", "--no-fund", artifact], clean);
  const entry = join(clean, "node_modules", "deepseek-mcp-server", "build", "index.js");
  // Load native addons in a child so Windows can unload them before cleanup.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(process.argv[1]);
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[2]);
    assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1);
    db.close();
  `, entry, join(root, "native-check.sqlite")], { timeout: 15000 });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: clean, env: {
    ...getDefaultEnvironment(), DEEPSEEK_API_KEY: "package-smoke-not-real", MCP_TRANSPORT: "stdio",
    DEEPSEEK_COLLAB_STATE_DIR: join(root, "state"),
  }, stderr: "pipe" });
  client = new Client({ name: "packed-artifact-test", version: "1" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "chat_completion"));
  assert.ok(tools.some((tool) => tool.name === "list_models"));
  const metadata = JSON.parse(readFileSync(join(clean, "node_modules", "deepseek-mcp-server", "package.json"), "utf8"));
  assert.equal(metadata.version, JSON.parse(readFileSync(resolve("package.json"), "utf8")).version);
  if (metadata.bin.collab) {
    const cli = join(clean, "node_modules", "deepseek-mcp-server", metadata.bin.collab);
    const result = JSON.parse(execFileSync(process.execPath, [cli, "profile", "set", "gpt_only", "--state-dir", join(root, "state"), "--json"], { encoding: "utf8" }));
    assert.equal(result.current, "gpt_only");
    assert.equal((await client.callTool({ name: "get_collab_status", arguments: {} })).structuredContent.profile, "gpt_only");
  }
  console.log(`Packed ${metadata.version}: clean install, native SQLite, stdio startup and ${tools.length} tools verified; no provider call.`);
} finally {
  await client?.close();
  // root is the exact directory returned by mkdtemp, never a caller-controlled path.
  assert.ok(root.startsWith(join(tmpdir(), "deepseek-package-")));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
