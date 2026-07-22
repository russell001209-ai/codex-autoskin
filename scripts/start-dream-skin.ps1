[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$RestartExisting,
  [string]$ProfilePath,
  [switch]$ForegroundInjector
)

$ErrorActionPreference = 'Stop'
$SkillRoot = Split-Path -Parent $PSScriptRoot
$Injector = Join-Path $PSScriptRoot 'injector.mjs'
$Restore = Join-Path $PSScriptRoot 'restore-dream-skin.ps1'
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$StatePath = Join-Path $StateRoot 'state.json'
$WatcherStatePath = Join-Path $StateRoot 'watcher-state.json'
$StdoutPath = Join-Path $StateRoot 'injector.log'
$StderrPath = Join-Path $StateRoot 'injector-error.log'
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null

function Test-CodexDebugPort([int]$CandidatePort) {
  # Chromium may bind DevTools to either loopback stack depending on boot state;
  # accept whichever answers.
  foreach ($loopback in @('127.0.0.1', '[::1]')) {
    try {
      $targets = Invoke-RestMethod "http://$($loopback):$($CandidatePort)/json/list" -TimeoutSec 1
      if ($targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'app://*' }) { return $true }
    } catch {}
  }
  return $false
}

function Test-IsNoProcessFoundError([object]$ErrorRecord) {
  if ($null -eq $ErrorRecord) { return $false }
  $errorId = [string]$ErrorRecord.FullyQualifiedErrorId
  return ($errorId -eq 'NoProcessFoundForGivenName' -or
    $errorId.StartsWith('NoProcessFoundForGivenName,', [StringComparison]::Ordinal))
}

function Get-NamedProcessesFailClosed([string[]]$Names) {
  $rows = @()
  foreach ($name in $Names) {
    try {
      $rows += @(Get-Process -Name $name -ErrorAction Stop)
    } catch {
      if (Test-IsNoProcessFoundError $_) { continue }
      throw "Could not enumerate process name '$name'; a safe cold start cannot be proven: $($_.Exception.Message)"
    }
  }
  return @($rows)
}

function Get-CodexPackageProcesses([string]$PackageInstallLocation) {
  $installRoot = [IO.Path]::GetFullPath($PackageInstallLocation).TrimEnd('\')
  $installBoundary = $installRoot + '\'
  $rows = @()
  foreach ($process in @(Get-NamedProcessesFailClosed @('ChatGPT', 'codex'))) {
    try {
      $candidatePath = [IO.Path]::GetFullPath($process.Path)
      if ($candidatePath.StartsWith($installBoundary, [StringComparison]::OrdinalIgnoreCase)) {
        $rows += [pscustomobject]@{ Pid=[int]$process.Id; Path=$candidatePath; Disposition='exact-package' }
      }
    } catch {
      $rows += [pscustomobject]@{ Pid=[int]$process.Id; Path=$null; Disposition='indeterminate-live' }
    }
  }
  return @($rows)
}

$node = (Get-Command node -ErrorAction Stop).Source
$debugReady = Test-CodexDebugPort $Port
$installedPackage = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $installedPackage) { throw 'The OpenAI.Codex Store package is not installed.' }
$packageProcesses = @(Get-CodexPackageProcesses $installedPackage.InstallLocation)

if (-not $debugReady -and $packageProcesses.Count -gt 0) {
  if ($RestartExisting) {
    throw "Safety guard: -RestartExisting no longer closes Codex. Keep the current tasks running, then use File > Exit before launching Dream Skin."
  }
  throw "Codex package processes are already running without dream-skin debugging on port $Port. It was left untouched. Use File > Exit, then launch Dream Skin."
}

function Start-CodexWithDebugPort {
  $package = Get-AppxPackage OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $package) { throw 'The OpenAI.Codex Store package is not installed.' }
  $existingAtActivation = @(Get-CodexPackageProcesses $package.InstallLocation)
  if ($existingAtActivation.Count -gt 0) {
    throw "Codex package state changed before themed activation; no launch was attempted: $($existingAtActivation.Pid -join ',')."
  }
  $appUserModelId = "$($package.PackageFamilyName)!App"
  $arguments = @("--remote-debugging-port=$Port")
  if ($ProfilePath) {
    if ($ProfilePath.Contains('"')) { throw 'ProfilePath cannot contain a double quote.' }
    New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null
    $arguments += "--user-data-dir=`"$ProfilePath`""
  }

  if (-not ('CodexDreamSkin.PackagedApp' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace CodexDreamSkin {
  [Flags]
  public enum ActivateOptions {
    None = 0x0,
    DesignMode = 0x1,
    NoErrorUI = 0x2,
    NoSplashScreen = 0x4
  }

  [ComImport]
  [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IApplicationActivationManager {
    [PreserveSig]
    int ActivateApplication(
      [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
      [MarshalAs(UnmanagedType.LPWStr)] string arguments,
      ActivateOptions options,
      out uint processId);
  }

  [ComImport]
  [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  class ApplicationActivationManager {}

  public static class PackagedApp {
    public static uint Activate(string appUserModelId, string arguments) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint processId;
      int result = manager.ActivateApplication(appUserModelId, arguments, ActivateOptions.NoErrorUI, out processId);
      if (result < 0) Marshal.ThrowExceptionForHR(result);
      return processId;
    }
  }
}
'@
  }

  [void][CodexDreamSkin.PackagedApp]::Activate($appUserModelId, ($arguments -join ' '))
}

function Wait-CodexDebugPort([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while (-not (Test-CodexDebugPort $Port)) {
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Milliseconds 400
  }
  return $true
}

$attempt = 0
while (-not (Test-CodexDebugPort $Port)) {
  if ($attempt -ge 1) {
    throw "Codex did not expose CDP on 127.0.0.1/[::1]:$Port after $attempt launch attempt(s)."
  }
  $attempt++
  Start-CodexWithDebugPort
  if (Wait-CodexDebugPort 30) { break }
}

if ((Test-Path -LiteralPath $StatePath) -or (Test-Path -LiteralPath $WatcherStatePath)) {
  if (-not (Test-Path -LiteralPath $Restore -PathType Leaf)) { throw "Verified cleanup script is missing: $Restore" }
  & $Restore -Port $Port
}

if ($ForegroundInjector) {
  & $node $Injector --watch --port $Port
  exit $LASTEXITCODE
}

$injectorArgs = @("`"$Injector`"", '--watch', '--port', "$Port")
$daemon = Start-Process -FilePath $node -ArgumentList $injectorArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
@{
  port = $Port
  injectorPid = $daemon.Id
  startedAt = (Get-Date).ToString('o')
  skillRoot = $SkillRoot
  profilePath = $ProfilePath
} | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding utf8

$verified = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
  Start-Sleep -Milliseconds 700
  & $node $Injector --verify --port $Port *> $null
  if ($LASTEXITCODE -eq 0) { $verified = $true; break }
}
if (-not $verified) { throw 'Dream skin launched but verification failed. See injector logs.' }
Write-Host "Codex Dream Skin is active on port $Port."
