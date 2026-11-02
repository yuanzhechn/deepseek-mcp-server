# 实施报告：Phase 0–2

## 2026-11-02 简洁 EXE 交付

新增 `desktop/{Program,Backend,SwitcherForm}.cs`、应用 manifest，以及 `build:desktop` / `test:desktop`。原生 WinForms EXE 约 28 KB，无浏览器/WebView/监听端口；支持项目目录选择、五档按钮、范围选择、职责和实时状态。通过现有 CLI 复用原子配置和修订冲突；依赖已有 Node/服务文件，非脱离项目的独立运行时。

验证：实际 EXE 在隔离目录完成中文/空格路径、项目档位持久化、旧修订拒绝、全局 GPT 独立覆盖；145 项回归和干净包安装通过。桌面窗口及目录选择对话框已实际打开验证，未通过测试修改操作员配置。Windows CI 已增加 native self-test。均衡模式 DeepSeek UI 委派网络失败、计费未知，未重发；GPT 接管实现与验收，详见 `desktop.md`。

## 2026-11-02 按钮交付补充

新增 Phase 3 本地 Dashboard（托盘仍未实现）：五档按钮、全局/项目范围、实际生效状态、今日费用、未知/手工 GPT 额度、修订冲突提示及状态轮询。`collab dashboard --open` / `npm run dashboard` / Windows 双击 `start-collab-dashboard.cmd` 启动。只监听本机，独立随机访问令牌、Host/Origin 校验、CSP 与请求大小限制；不使用 API Key、不调用模型，不修改预算和审批权限。

新增 `src/ui/{dashboard,dashboard-page,dashboard-cli}.ts`、`test/dashboard.test.ts` 和启动脚本；CLI、包内容及干净包检查已扩展。145 项测试全部通过，干净包安装与面板启动检查通过；浏览器实际点击已在隔离状态中验证。详见 `dashboard.md`。下文中 Phase 3 尚未实现的记录为此前阶段的历史状态。

日期：2026-11-01。目标仓库：`yuanzhechn/deepseek-mcp-server`。起点：`7a08656b733b5e5d4a71ecd308770226170954eb`，包版本 1.4.1。功能分支：`codex/collaboration-router`。本次保留包版本和上游 registry 标识，不发布 npm 包、不创建发布 tag、不合并 main；新功能以本分支源码构建为准。

两份输入文档作为设计与验收参考，未将其中“已确认”“立即执行”等文字当作额外授权。按本次项目改造请求实现 Phase 0–2，Phase 3/4 仅记录设计。没有修改 Codex 账号、登录、提供商、config.toml 或 models.json，也没有新增主模型切换功能。

## 已交付

| 阶段 | 结果 |
| --- | --- |
| Phase 0 | 基线功能清单、威胁模型、独立功能分支；原 94 测试先通过；最小兼容依赖修补；打包安装启动脚本与 CI |
| Phase 1 | 五档 ProfileStore、版本化 JSON Schema、项目覆盖、修订号、跨进程锁与原子写；PolicyEngine、确定性路由；CLI 与 Skill |
| Phase 2 | 新增 7 个 MCP 工具，原 11 工具保留；旧生成接口统一守卫；真实 API 适配委派；SQLite WAL 预算预占/结算；可更新费率表、usage 和 trace 回执 |

新增工具：`list_collab_profiles`、`get_collab_status`、`set_collab_profile`、`route_task`、`delegate_task`、`estimate_task_cost`、`get_usage_report`。GPT 路径返回 `host_required`，不伪造订阅 GPT 调用。状态始终标明 `gpt_host_active: true`，GPT 额度只显示未知或用户手工填写的等级。

主要文件：

- `src/collaboration/{profile-schema,profile-store,policy-engine,task-router}.ts`：配置、风险/数据边界及路由。
- `src/collaboration/{pricing,usage-ledger,delegation-service,mcp-tools,errors}.ts`：报价、事务账本、API 委派、新工具和错误类型。
- `src/cli/collab.ts`：`profile list|get|set`、手工 quota、budget 与审核过的 config 导入。
- `src/mcp-server.ts`、`src/index.ts`：旧工具共用守卫、HTTP/stdio 共享服务、关闭资源；生成调用增加回执，不改变旧输入 schema。
- `test/collaboration-{profiles,budget}.test.ts`、`test/setup.ts`：新增行为测试及本地状态隔离；旧测试只更新工具发现列表/数量和隔离环境。
- `scripts/{package-smoke,export-collab-schemas}.mjs`、`.github/workflows/ci.yml`、`Dockerfile`、`package*.json`：分发验证、原生依赖及 CI；Windows 原生模块测试通过子进程加载，确保能卸载后清理。
- `AGENTS.md`、`skills/collab-mode/SKILL.md`、`docs/collaboration/*`、`docs/architecture/current-state.md`、`docs/security/threat-model.md`、README 与忽略规则。

## 验证结果

本地 Windows / Node 22.17.0：

- `npm ci`：成功；标准干净安装不需要额外 peer 参数。
- `npm run build`：成功。
- `npm test`：**9 个文件、139 项通过**，包含原有 94 项回归和新增 45 项。
- `npm audit`：**0 个漏洞**；由最初 3 个受影响开发依赖修复而来。Vitest 4.1.12 与兼容 Vite 补丁锁定在 package-lock；没有使用 `--force`。
- `npm run test:package`：成功；在临时干净目录安装本地 tgz，验证原生 SQLite、stdio 启动、18 工具发现、CLI 切换被运行中 MCP 观测及正常退出。
- `npm pack --dry-run`：成功，检查无密钥、账本、本地配置或 node_modules 泄露。
- `git diff --check`、Skill frontmatter/脚手架验证：通过。

关键验收包括：5 档路由、项目覆盖/全局 kill switch、未来/错误 schema 拒绝、20 个并发配置更新、跨进程 CLI 与重启持久化、20 个**独立 Node 进程**争抢预算、单次与项目预算拒绝、唯一 task ID、取消/超时不重复结算、跨午夜保留未知预占、401/403 不重试、429 有界重试、5xx 保守保留预占、真实字段形态的缓存分项计费、三种旧工具的 SSE usage 到账本链路、敏感文本/路径、目录穿越/UNC/junction 逃逸、管理认证，以及旧 stdio/HTTP 鉴权与协议回归。

## 真实验证与模拟的边界

真实执行：本地构建/安装/原生 SQLite、跨进程并发和文件持久化、MCP SDK 协议交互、现代及旧 stdio 协商、HTTP 认证和路由、包安装和新工具发现。

模拟上游：DeepSeek 生成响应、SSE、usage、401/429/500、取消和 deadline。委派实现调用现有真实 `DeepSeekApiClient.createChatCompletion`，不是返回固定假结果；但当前终端环境没有可用 `DEEPSEEK_API_KEY`，因此**新增委派未做真实付费 API 端到端调用**。没有用 mock 成功冒充模型实测或 30 任务质量评测。

本次会话里已连接的旧 MCP 进程不能自动增加工具。新工具已由真实启动的 MCP 客户端发现；用户需重启一次 Codex 对应 MCP 连接，才能在桌面会话中发现它们。此后切档不需重连。未擅自修改用户的 MCP 配置或默认档位。

## 设计偏差与限制

1. MCP 改档增加独立管理令牌要求，防止普通任务或注入提示自行解除 `gpt_only`；无令牌时可用本地 CLI。预算/R3/私密数据授权只由本地操作员配置管理。
2. 5xx/网络超时无法证明未计费，不自动重发；只对明确 429 拒绝实施最多两次退避重试。未知账单保留预占，需人工核账；自动对账/释放工具暂未实现。
3. `create_response` 仍保留原输入契约，但服务端 `web_search` 路径会返回 `unbounded_tool_cost`。独立 Search/Fetch API 不在现有工具范围；其请求计数不可可靠观测，不能声称已完整计费。主控自行检索后提供有限摘录。
4. 费率按官方页面核对，价格表可外置更新；内置中国公共假期日历不完整并明确标注，工作日高峰估价可能偏高。报价不是供应商最终账单。输入按字节和保守开销预约，图片/文件按完整上下文窗口预约，可能拒绝实际可负担的请求。
5. 文本秘密扫描与旧接口风险推断不是完整 DLP/语义安全系统；图片和未标记的隐私仍需主控正确分类、最小授权。单状态目录面向一个可信操作员，不提供互不信任租户隔离。
6. 原有对话仍是进程内 Map；不实现会话加密、自动续跑、指标驱动路由或自动型号升级重发。模型质量、延迟与节省比例尚未建立评测证据。
7. 本地只验证 Windows Node 22；Linux Node 20/22/24 与 Windows Node 22 检查已配置在 CI，远程结果需单独观察。Docker 原生编译依赖已补充，本机未执行 Docker 构建。
8. 本次包版本仍为 1.4.1，属于未发布功能分支；正式发布前应决定 fork 的包/registry 身份、版本号和 tag，并运行同一包验收，不能把上游 npm 1.4.1 当作本次改造。

## 后续路线

先在用户提供运行时 Key 的环境中进行一次受 $0.001 左右硬上限约束的真实 API 验证，再按 `evals.md` 做授权任务评测。之后可讨论人工核账入口、完整假期数据和可观测的 Search/Fetch 计费。Phase 3 托盘/Dashboard 与 Phase 4 隔离 worktree/DAG 不在本次上线范围，需用户另行选择。


Collaboration amendment (2026-11-02): routes name only GPT or DeepSeek. The backend `DEEPSEEK_DEFAULT_MODEL` selects the actual provider model independently of profile/task type; technical pricing catalogs and audit receipts retain actual IDs for accurate accounting. Legacy model-specific route entries migrate to `deepseek`. Economy increases useful DeepSeek work, not reduces work or quality. Supply sufficient authorized context; run all necessary builds, tests and reviews. Multi-round analysis, repair and retesting are allowed within explicit budgets and permissions. Parallelism depends on dependencies, resources and safety, never on economy mode alone. Integrate verified work without reimplementing it. Failed candidates should return to DeepSeek for diagnosis/repair before GPT takeover when appropriate. Independent task/attempt bounds remain resource controls, not a cap on the overall repair workflow. No host model/account switching or DeepSeek-primary profile is added.

补充验收：2026-11-02 已通过 142 项测试。新增覆盖经济模式委派范围大于均衡模式、两档质量门槛一致、旧型号路由配置迁移，以及不同档位使用同一底层配置型号。
