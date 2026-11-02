import { basename } from "node:path";
import { realpathSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CollaborationService } from "../collaboration/delegation-service.js";
import { CollaborationError } from "../collaboration/errors.js";
import { profileIdSchema } from "../collaboration/profile-schema.js";
import { dashboardPage } from "./dashboard-page.js";

const changeSchema = z.object({ profile: profileIdSchema, scope: z.enum(["global", "project"]), expected_revision: z.number().int().nonnegative() }).strict();

export async function startDashboard(service: CollaborationService, port = 0) {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    const json = (status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host) { json(403, { error: "不允许的主机地址" }); return; }
    if (req.headers.origin && req.headers.origin !== origin) { json(403, { error: "不允许的页面来源" }); return; }
    if (req.headers["sec-fetch-site"] === "cross-site") { json(403, { error: "不允许跨站访问" }); return; }
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(dashboardPage(nonce)); return;
    }
    const supplied = req.headers.authorization ?? "";
    const expected = `Bearer ${token}`;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      json(401, { error: "请使用启动时生成的完整链接打开面板" }); return;
    }
    try {
      if (req.method === "GET" && req.url === "/api/status") {
        const policy = await service.snapshot();
        const config = await service.store.read();
        json(200, { ...policy, project_name: basename(realpathSync.native(policy.project)) || policy.project, global_profile: config.active_profile, project_profile: config.projects[policy.project]?.profile ?? null,
          usage: service.ledger.report(policy.project).totals, available_usd: service.ledger.available(policy), gpt_host_active: true }); return;
      }
      if (req.method === "POST" && req.url === "/api/profile") {
        if (req.headers.origin !== origin || req.headers["content-type"]?.split(";")[0] !== "application/json") {
          json(403, { error: "切档需要同源 JSON 请求" }); return;
        }
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { size += chunk.length; if (size > 2048) { json(413, { error: "请求过大" }); return; } chunks.push(Buffer.from(chunk)); }
        const input = changeSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        json(200, await service.store.setProfile(input.profile, input.scope === "project" ? service.project : undefined, input.expected_revision)); return;
      }
      json(404, { error: "未找到接口" });
    } catch (error) {
      if (error instanceof CollaborationError) json(error.error_type === "revision_conflict" ? 409 : 400, { error: error.message, error_type: error.error_type });
      else if (error instanceof SyntaxError || error instanceof z.ZodError) json(400, { error: "无效的切档请求" });
      else json(500, { error: "无法读取或保存配置，请检查本地状态目录" });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Dashboard did not bind a local port");
  origin = `http://127.0.0.1:${address.port}`;
  return { url: `${origin}/#${token}`, origin, close: () => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
