using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace DeepSeekCollab {
  internal sealed class Status {
    public string Profile;
    public string Project;
    public long Revision;
  }
  internal sealed class Backend {
    readonly string root, stateDirectory;
    public Backend(string serverRoot, string state) { root = serverRoot; stateDirectory = state; }
    // Quote one argv item according to the Windows CommandLineToArgvW convention.
    public static string Quote(string value) {
      var output = new StringBuilder("\""); int slashes = 0;
      foreach (char c in value) {
        if (c == '\\') { slashes++; continue; }
        if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); }
        else { output.Append('\\', slashes); output.Append(c); }
        slashes = 0;
      }
      output.Append('\\', slashes * 2); output.Append('"'); return output.ToString();
    }
    async Task<Dictionary<string, object>> CallAsync(params string[] arguments) {
      var args = new List<string> { Path.Combine(root, "build", "cli", "collab.js") };
      args.AddRange(arguments); args.Add("--json");
      if (!String.IsNullOrEmpty(stateDirectory)) { args.Add("--state-dir"); args.Add(stateDirectory); }
      var quoted = new List<string>(); foreach (string arg in args) quoted.Add(Quote(arg));
      var info = new ProcessStartInfo {
        FileName = Environment.GetEnvironmentVariable("DEEPSEEK_COLLAB_NODE") ?? "node.exe",
        Arguments = String.Join(" ", quoted), WorkingDirectory = root,
        UseShellExecute = false, CreateNoWindow = true,
        RedirectStandardOutput = true, RedirectStandardError = true,
        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
      };
      using (var process = new Process { StartInfo = info }) {
        if (!process.Start()) throw new Exception("无法启动本地配置服务。");
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        var exited = Task.Run(() => process.WaitForExit(15000));
        if (!await exited) { try { process.Kill(); } catch {} throw new Exception("配置操作超时，请稍后重试。"); }
        string output = await stdout; string error = await stderr;
        if (process.ExitCode != 0) throw new Exception(String.IsNullOrWhiteSpace(error) ? "配置操作失败。" : error.Trim());
        var result = new JavaScriptSerializer().DeserializeObject(output) as Dictionary<string, object>;
        if (result == null) throw new Exception("配置服务返回了无效结果。");
        return result;
      }
    }
    public async Task<Status> ReadAsync(string project) {
      var value = await CallAsync("profile", "get", "--project", project);
      return new Status { Profile = (string)value["profile"], Project = (string)value["project"], Revision = Convert.ToInt64(value["revision"]) };
    }
    public async Task SetAsync(string profile, string projectOrNull, long revision) {
      var args = new List<string> { "profile", "set", profile, "--expected-revision", revision.ToString(System.Globalization.CultureInfo.InvariantCulture) };
      if (projectOrNull != null) { args.Add("--project"); args.Add(projectOrNull); }
      await CallAsync(args.ToArray());
    }
  }
}
