using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace DeepSeekCollab {
  internal sealed class SwitcherForm : Form {
    readonly Backend backend;
    string project;
    long revision;
    bool busy;
    readonly Label projectName = new Label(), effective = new Label(), message = new Label();
    readonly TextBox path = new TextBox(), details = new TextBox();
    readonly ComboBox scope = new ComboBox();
    readonly Button choose = new Button(), refresh = new Button();
    readonly Button[] modes = new Button[5];
    readonly Timer timer = new Timer { Interval = 4000 };
    readonly string[] ids = { "gpt_only", "quality", "balanced", "economy", "custom" };
    readonly string[] names = { "GPT 独立", "质量优先", "智能均衡", "成本优先", "自定义" };
    readonly string[] responsibilities = {
      "GPT：需求分析、规划、开发、修复、测试、审查及最终验收。\r\n\r\nDeepSeek：不参与生成任务。",
      "GPT：主导需求、规划和实现，负责集成、关键决策及最终验收。\r\n\r\nDeepSeek：低风险文档、翻译、测试与实现草稿，由 GPT 审查。",
      "GPT：需求、架构、规划、整体审查、工具调用、代码集成与最终验收。\r\n\r\nDeepSeek：按任务适配度承担开发、调试、重构、测试与文档。",
      "GPT：协调调度、工具调用、集成、关键决策与最终质量把关。\r\n\r\nDeepSeek：优先承担需求分析、规划草案、开发、调试、测试、审查、重构与文档；失败后优先继续修复。",
      "GPT：处理规则指定的任务和未匹配任务，并负责集成及最终验收。\r\n\r\nDeepSeek：执行已配置规则指定的任务，不绕过安全、预算或质量门槛。"
    };
    public SwitcherForm(Backend adapter, string initialProject) {
      backend = adapter; project = initialProject;
      Text = "DeepSeek 协作切换"; ClientSize = new Size(620, 475); MinimumSize = new Size(636, 514);
      StartPosition = FormStartPosition.CenterScreen; AutoScaleMode = AutoScaleMode.Dpi;
      Font = new Font("Microsoft YaHei UI", 9F); BackColor = Color.FromArgb(245, 247, 251);
      var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 1, RowCount = 8 };
      layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
      foreach (int height in new[] { 40, 30, 40, 38, 58 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
      layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
      var heading = new Label { Text = "DeepSeek  /  协作切换", Font = new Font(Font.FontFamily, 16F, FontStyle.Bold), Dock = DockStyle.Fill, ForeColor = Color.FromArgb(26, 45, 72) };
      layout.Controls.Add(heading, 0, 0);
      projectName.Dock = DockStyle.Fill; projectName.Font = new Font(Font, FontStyle.Bold); layout.Controls.Add(projectName, 0, 1);
      var projectRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
      projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
      path.ReadOnly = true; path.TabStop = false; path.Dock = DockStyle.Fill; path.BackColor = Color.White;
      choose.Text = "选择项目…"; choose.Dock = DockStyle.Fill;
      projectRow.Controls.Add(path, 0, 0); projectRow.Controls.Add(choose, 1, 0); layout.Controls.Add(projectRow, 0, 2);
      var controls = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
      controls.Controls.Add(new Label { Text = "切换范围", AutoSize = true, Padding = new Padding(0, 6, 6, 0) });
      scope.DropDownStyle = ComboBoxStyle.DropDownList; scope.Items.AddRange(new object[] { "当前项目", "全局默认" }); scope.SelectedIndex = 0; scope.Width = 120;
      refresh.Text = "刷新"; refresh.Width = 70; controls.Controls.Add(scope); controls.Controls.Add(refresh); layout.Controls.Add(controls, 0, 3);
      var modeRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 5 };
      for (int i = 0; i < ids.Length; i++) {
        modeRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20)); int selected = i;
        var button = new Button { Text = names[i], Dock = DockStyle.Fill, FlatStyle = FlatStyle.Flat, BackColor = Color.White, AccessibleName = names[i] };
        button.FlatAppearance.BorderColor = Color.FromArgb(201, 212, 229); button.Click += async delegate { await SwitchAsync(selected); };
        modes[i] = button; modeRow.Controls.Add(button, i, 0);
      }
      layout.Controls.Add(modeRow, 0, 4);
      details.ReadOnly = true; details.TabStop = false; details.Multiline = true; details.ScrollBars = ScrollBars.Vertical; details.Dock = DockStyle.Fill;
      details.BackColor = Color.White; details.BorderStyle = BorderStyle.FixedSingle; details.AccessibleName = "当前档位职责";
      layout.Controls.Add(details, 0, 5);
      effective.Dock = DockStyle.Fill; effective.Padding = new Padding(0, 10, 0, 0); effective.ForeColor = Color.FromArgb(23, 99, 112);
      layout.Controls.Add(effective, 0, 6);
      message.Dock = DockStyle.Fill; message.AutoEllipsis = true; message.Text = "GPT 始终为主控；切档影响下一次任务。"; layout.Controls.Add(message, 0, 7);
      Controls.Add(layout);
      choose.Click += async delegate {
        if (busy) return;
        using (var picker = new FolderBrowserDialog { Description = "选择要配置协作档位的项目目录", SelectedPath = Directory.Exists(project) ? project : "", ShowNewFolderButton = false }) {
          if (picker.ShowDialog(this) == DialogResult.OK) { project = picker.SelectedPath; await RefreshAsync(); }
        }
      };
      refresh.Click += async delegate { await RefreshAsync(); };
      timer.Tick += async delegate { if (!busy) await RefreshAsync(); };
      Shown += async delegate { await RefreshAsync(); if (!IsDisposed) choose.Focus(); timer.Start(); };
      FormClosed += delegate { timer.Stop(); timer.Dispose(); };
    }
    void SetBusy(bool value) {
      busy = value; if (IsDisposed) return;
      foreach (var button in modes) button.Enabled = !value;
      choose.Enabled = refresh.Enabled = scope.Enabled = !value;
    }
    async Task LoadAsync() {
      var status = await backend.ReadAsync(project); if (IsDisposed) return;
      project = status.Project; revision = status.Revision;
      projectName.Text = "当前项目：" + new DirectoryInfo(project).Name; path.Text = project;
      int selected = Array.IndexOf(ids, status.Profile);
      details.Text = selected >= 0 ? responsibilities[selected] + "\r\n\r\n所有档位均保留必要编译、测试与审查。" : "未知档位，请检查共享配置。";
      effective.Text = "当前生效：" + (selected >= 0 ? names[selected] : status.Profile) + "    ·    修订 " + revision;
      foreach (var button in modes) { button.BackColor = Color.White; button.ForeColor = Color.FromArgb(26, 45, 72); }
      if (selected >= 0) { modes[selected].BackColor = Color.FromArgb(28, 103, 168); modes[selected].ForeColor = Color.White; }
    }
    async Task RefreshAsync() {
      if (busy) return; SetBusy(true);
      try { await LoadAsync(); }
      catch (Exception error) { if (!IsDisposed) message.Text = "读取失败：" + error.Message; }
      finally { SetBusy(false); }
    }
    async Task SwitchAsync(int selected) {
      if (busy) return; SetBusy(true);
      try {
        string failure = null;
        try {
          await backend.SetAsync(ids[selected], scope.SelectedIndex == 0 ? project : null, revision);
          await LoadAsync(); if (!IsDisposed) message.Text = "已保存。以当前生效档位为准；全局 GPT 独立会覆盖项目设置。";
        } catch (Exception error) { failure = error.Message; }
        if (failure != null) {
          try { await LoadAsync(); } catch {}
          if (!IsDisposed) message.Text = "未切换：" + failure;
        }
      } finally { SetBusy(false); }
    }
  }
}
