# 简洁 Windows EXE

构建后双击 `dist/desktop/DeepSeekCollab.exe`。这是原生 WinForms 桌面窗口，不启动浏览器、WebView、localhost 服务或监听端口。显示当前项目、目录选择、项目/全局范围、五档按钮、当前档位职责和生效状态。四秒自动刷新配置；选择目录只读取该项目设置，只有点击档位按钮才写入。

```powershell
npm ci
npm run build:desktop
npm run test:desktop
```

要求 Windows 10/11、.NET Framework 4.8 和本项目已有的 Node.js 运行环境。构建使用 Windows 自带 Framework C# 编译器，不需安装 .NET SDK 或下载 NuGet。EXE 约 28 KB，是现有 MCP 服务的桌面伴侣；**不是可脱离 Node 和服务文件独立分发的单文件运行时**。默认保留在仓库 `dist/desktop`，会向上寻找 `build/cli/collab.js`。如果将 EXE 单独移动到桌面，首次打开会让你选择已构建的 MCP 服务安装目录。也可给 EXE 创建桌面快捷方式，原文件保留在仓库。

启动参数：`--server-dir <服务安装目录>`、`--project <要管理的项目>`、`--state-dir <共享状态目录>`。保留对 `DEEPSEEK_MCP_SERVER_DIR`、`DEEPSEEK_COLLAB_PROJECT`、`DEEPSEEK_COLLAB_STATE_DIR` 的支持，`DEEPSEEK_COLLAB_NODE` 可指定 Node 可执行文件。没有提供参数时，默认选中服务仓库；它不会读取或猜测 ChatGPT 当前聊天的工作目录，其他项目通过“选择项目”指定。MCP 也需要绑定或获准访问对应项目，才会使用其项目策略。

桌面程序用隐藏子进程调用现有 CLI，以保持同一份配置校验、跨进程锁、原子保存、修订冲突和全局 GPT 独立覆盖行为。不直接重写 JSON、不获取 API Key、不调用模型、不改变预算或 R3 审批。GPT 主控仍然在线，切档影响下一次任务，关闭窗口不会停止 MCP。

`test:desktop` 编译实际 EXE，在独立临时状态中验证中文/空格路径、项目切档、陈旧修订拒绝和全局覆盖，不修改操作员配置。Windows CI 增加同一检查。网页面板作为可选入口保留，使用 EXE 时不必启动它。未配置开机或 ChatGPT 自启动，也未创建托盘进程。

本次按均衡模式先调用了 `get_collab_status` / `route_task` 并尝试 DeepSeek UI 委派。该调用因网络失败，回执 `2a8f47e0-3d19-4a0b-83fd-47574f4b20ae`，计费未知且预占保留；没有用新任务 ID 重发。候选代码未返回，后续由 GPT 完成实现、集成和验收，没有将该失败冒充成功协作。
