param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  if (-not $SkipBuild) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' } }
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler not found.' }
  $outputDirectory = Join-Path $projectRoot 'dist\desktop'
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  $executable = Join-Path $outputDirectory 'DeepSeekCollab.exe'
  & $compiler /nologo /target:winexe /optimize+ /platform:anycpu /utf8output /codepage:65001 "/out:$executable" "/win32manifest:$projectRoot\desktop\app.manifest" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Core.dll "$projectRoot\desktop\Program.cs" "$projectRoot\desktop\Backend.cs" "$projectRoot\desktop\SwitcherForm.cs"
  if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
  Write-Output $executable
} finally { Pop-Location }
