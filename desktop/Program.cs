using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace DeepSeekCollab {
  internal static class Program {
    static string Get(string[] args, string key) {
      int i = Array.IndexOf(args, key);
      if (i < 0) return null;
      if (i + 1 >= args.Length || args[i + 1].StartsWith("--")) throw new Exception("缺少参数：" + key);
      return args[i + 1];
    }
    static bool IsRoot(string root) { return root != null && File.Exists(Path.Combine(root, "build", "cli", "collab.js")); }
    static string FindRoot(string requested) {
      if (requested != null) { if (!IsRoot(requested)) throw new Exception("所选服务目录缺少 build/cli/collab.js，请先构建项目。"); return Path.GetFullPath(requested); }
      string configured = Environment.GetEnvironmentVariable("DEEPSEEK_MCP_SERVER_DIR");
      if (IsRoot(configured)) return configured;
      var current = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
      while (current != null) { if (IsRoot(current.FullName)) return current.FullName; current = current.Parent; }
      if (IsRoot(Environment.CurrentDirectory)) return Environment.CurrentDirectory;
      using (var picker = new FolderBrowserDialog { Description = "请选择已构建的 deepseek-mcp-server 安装目录", ShowNewFolderButton = false }) {
        if (picker.ShowDialog() != DialogResult.OK) return null;
        if (!IsRoot(picker.SelectedPath)) throw new Exception("此目录不是已构建的 MCP 服务目录。");
        return picker.SelectedPath;
      }
    }
    [STAThread]
    static int Main(string[] args) {
      Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      try {
        string root = FindRoot(Get(args, "--server-dir")); if (root == null) return 0;
        string project = Get(args, "--project") ?? Environment.GetEnvironmentVariable("DEEPSEEK_COLLAB_PROJECT") ?? root;
        string state = Get(args, "--state-dir");
        var backend = new Backend(root, state);
        if (Array.IndexOf(args, "--self-test") >= 0) {
          if (state == null || Get(args, "--project") == null) throw new Exception("自检只允许显式隔离状态目录和测试项目。");
          SelfTest(backend, project).GetAwaiter().GetResult(); return 0;
        }
        Application.Run(new SwitcherForm(backend, project)); return 0;
      } catch (Exception error) {
        if (Array.IndexOf(args, "--self-test") < 0) MessageBox.Show(error.Message, "DeepSeek 协作", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Console.Error.WriteLine(error.Message); return 1;
      }
    }
    static async Task SelfTest(Backend backend, string project) {
      var first = await backend.ReadAsync(project);
      await backend.SetAsync("economy", project, first.Revision);
      var second = await backend.ReadAsync(project);
      if (second.Profile != "economy" || second.Revision != first.Revision + 1) throw new Exception("切档持久化失败。");
      bool conflict = false; try { await backend.SetAsync("quality", project, first.Revision); } catch { conflict = true; }
      if (!conflict) throw new Exception("旧修订号未被拒绝。");
      await backend.SetAsync("gpt_only", null, second.Revision);
      var third = await backend.ReadAsync(project);
      if (third.Profile != "gpt_only") throw new Exception("全局 GPT 独立未覆盖项目设置。");
      await backend.SetAsync("balanced", null, third.Revision);
      var fourth = await backend.ReadAsync(project);
      if (fourth.Profile != "economy") throw new Exception("项目设置未保留。");
      await backend.SetAsync("balanced", project, fourth.Revision);
    }
  }
}
