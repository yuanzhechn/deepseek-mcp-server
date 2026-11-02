import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { request } from "node:http";
import { CollaborationService } from "../src/collaboration/delegation-service.js";
import { ProfileStore } from "../src/collaboration/profile-store.js";
import { startDashboard } from "../src/ui/dashboard.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deepseek-dashboard-"));
  const store = new ProfileStore(join(root, "state"));
  const service = new CollaborationService({ store, project: root });
  const runtime = await startDashboard(service);
  cleanup.push(async () => { await runtime.close(); service.close(); rmSync(root, { recursive: true, force: true }); });
  const headers = { Authorization: `Bearer ${new URL(runtime.url).hash.slice(1)}`, Origin: runtime.origin, "Content-Type": "application/json" };
  return { root, store, service, runtime, headers };
}
describe("localhost collaboration dashboard", () => {
  it("serves a self-contained protected page and requires a session token for state", async () => {
    const { runtime, headers, root } = await fixture();
    const page = await fetch(runtime.origin); expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await page.text(); expect(html).toContain("成本优先"); expect(html).not.toContain(new URL(runtime.url).hash.slice(1));
    expect((await fetch(`${runtime.origin}/api/status`)).status).toBe(401);
    const state = await fetch(`${runtime.origin}/api/status`, { headers }); expect(await state.json()).toMatchObject({ profile: "balanced", project_name: basename(root), revision: 0, gpt_host_active: true });
  });
  it("persists button changes for the next task, detects conflicts and respects the global kill switch", async () => {
    const { runtime, headers, service, store } = await fixture();
    const change = (body: unknown) => fetch(`${runtime.origin}/api/profile`, { method: "POST", headers, body: JSON.stringify(body) });
    expect((await change({ profile: "economy", scope: "project", expected_revision: 0 })).status).toBe(200);
    expect((await service.snapshot()).profile).toBe("economy");
    expect((await new ProfileStore(store.directory).read()).projects[service.project].profile).toBe("economy");
    expect((await change({ profile: "quality", scope: "project", expected_revision: 0 })).status).toBe(409);
    expect((await change({ profile: "gpt_only", scope: "global", expected_revision: 1 })).status).toBe(200);
    expect((await service.snapshot()).profile).toBe("gpt_only");
    expect((await change({ profile: "economy", scope: "global", expected_revision: 2 })).status).toBe(200);
    expect((await service.snapshot()).profile).toBe("economy");
  });
  it("rejects cross-origin/forged-host requests, invalid changes and oversized payloads", async () => {
    const { runtime, headers, store } = await fixture();
    const post = (body: string, extra = {}) => fetch(`${runtime.origin}/api/profile`, { method: "POST", headers: { ...headers, ...extra }, body });
    const valid = JSON.stringify({ profile: "economy", scope: "global", expected_revision: 0 });
    expect((await post(valid, { Origin: "https://evil.example" })).status).toBe(403);
    const { Origin, ...withoutOrigin } = headers;
    expect((await fetch(`${runtime.origin}/api/profile`, { method: "POST", headers: withoutOrigin, body: valid })).status).toBe(403);
    expect((await post('{')).status).toBe(400);
    expect((await post(JSON.stringify({ profile: "economy", scope: "global" }))).status).toBe(400);
    expect((await post(valid.replace('economy','unknown'))).status).toBe(400);
    expect((await post(' '.repeat(2049))).status).toBe(413);
    const hostStatus = await new Promise<number>((resolve, reject) => { const req = request(runtime.origin, { headers: { Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode!); }); req.on("error", reject); req.end(); });
    expect(hostStatus).toBe(403); expect((await store.read()).revision).toBe(0);
  });
});
