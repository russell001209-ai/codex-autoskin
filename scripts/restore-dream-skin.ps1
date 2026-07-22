[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$Uninstall,
  [switch]$RestoreBaseTheme
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction Stop).Source
$injector = Join-Path $PSScriptRoot 'injector.mjs'
$watcher = Join-Path $PSScriptRoot 'watch-dream-skin.ps1'
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$StatePath = Join-Path $StateRoot 'state.json'
$WatcherStatePath = Join-Path $StateRoot 'watcher-state.json'

function Test-ExactPath([string]$Actual, [string]$Expected) {
  if ([string]::IsNullOrWhiteSpace($Actual) -or [string]::IsNullOrWhiteSpace($Expected)) { return $false }
  return [string]::Equals([IO.Path]::GetFullPath($Actual).TrimEnd('\'), [IO.Path]::GetFullPath($Expected).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

function Stop-VerifiedSkinProcess([int]$ProcessId, [string]$ExpectedExecutable, [string]$ExpectedScript, [string]$Label) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return }
  if (-not (Test-ExactPath $process.Path $ExpectedExecutable)) {
    throw "$Label PID $ProcessId executable mismatch; refusing to stop it."
  }
  $row = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
  if (-not $row -or [string]::IsNullOrWhiteSpace([string]$row.CommandLine) -or
      $row.CommandLine.IndexOf($ExpectedScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "$Label PID $ProcessId command line does not identify the isolated AutoSkin script; refusing to stop it."
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction Stop
}

if (Test-Path -LiteralPath $WatcherStatePath) {
  $watcherState = Get-Content -LiteralPath $WatcherStatePath -Raw | ConvertFrom-Json
  if (-not (Test-ExactPath $watcherState.scriptPath $watcher) -or [int]$watcherState.port -ne $Port) {
    throw 'Watcher state does not belong to this isolated repo/port; refusing to trust its PID.'
  }
  if ($watcherState.watcherPid) {
    Stop-VerifiedSkinProcess ([int]$watcherState.watcherPid) (Join-Path $PSHOME 'powershell.exe') $watcher 'Watcher'
  }
  Remove-Item -LiteralPath $WatcherStatePath -Force
}

if (Test-Path -LiteralPath $StatePath) {
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  if (-not (Test-ExactPath $state.skillRoot $repoRoot) -or [int]$state.port -ne $Port) {
    throw 'Injector state does not belong to this isolated repo/port; refusing to trust its PID.'
  }
  if ($state.injectorPid) {
    Stop-VerifiedSkinProcess ([int]$state.injectorPid) $node $injector 'Injector'
  }
  Remove-Item -LiteralPath $StatePath -Force
}
Start-Sleep -Milliseconds 250
try { & $node $injector --remove --port $Port --timeout-ms 3000 } catch {}

if ($Uninstall) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  @(
    (Join-Path $desktop 'Codex Dream Skin.lnk'),
    (Join-Path $desktop 'Codex Dream Skin - Restore.lnk'),
    (Join-Path $startMenu 'Codex Dream Skin.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Startup')) 'Codex Dream Skin Watcher.lnk')
  ) | ForEach-Object { Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue }
}

if ($RestoreBaseTheme) {
  $backup = Join-Path $StateRoot 'config.before-dream-skin.toml'
  $config = Join-Path $HOME '.codex\config.toml'
  if (-not (Test-Path -LiteralPath $backup)) { throw 'No pre-install config backup is available.' }
  $backupContent = Get-Content -LiteralPath $backup -Raw
  $currentContent = Get-Content -LiteralPath $config -Raw
  foreach ($key in @('appearanceTheme', 'appearanceLightCodeThemeId', 'appearanceLightChromeTheme')) {
    $pattern = "(?m)^$([regex]::Escape($key))\s*=.*(?:\r?\n)?"
    $saved = [regex]::Match($backupContent, $pattern)
    if ([regex]::IsMatch($currentContent, $pattern)) {
      $replacement = if ($saved.Success) { $saved.Value.TrimEnd("`r", "`n") + "`r`n" } else { '' }
      $currentContent = [regex]::Replace($currentContent, $pattern, $replacement, 1)
    } elseif ($saved.Success) {
      $desktop = [regex]::Match($currentContent, '(?ms)^\[desktop\]\s*\r?\n(?<body>.*?)(?=^\[|\z)')
      if (-not $desktop.Success) {
        $currentContent = $currentContent.TrimEnd() + "`r`n`r`n[desktop]`r`n"
        $desktop = [regex]::Match($currentContent, '(?ms)^\[desktop\]\s*\r?\n(?<body>.*?)(?=^\[|\z)')
      }
      $body = $desktop.Groups['body'].Value.TrimEnd() + "`r`n" + $saved.Value.TrimEnd("`r", "`n") + "`r`n"
      $currentContent = $currentContent.Substring(0, $desktop.Groups['body'].Index) + $body +
        $currentContent.Substring($desktop.Groups['body'].Index + $desktop.Groups['body'].Length)
    }
  }
  Set-Content -LiteralPath $config -Value $currentContent -Encoding utf8
}

Write-Host 'The live Dream Skin was removed.'
