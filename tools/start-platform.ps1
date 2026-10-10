param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendPath = Join-Path $projectRoot 'frontend'
$logPath = Join-Path $projectRoot '.runtime'
$platformUrl = 'http://127.0.0.1:4173/'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$backendPath = Join-Path $projectRoot 'backend'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
function Test-AgentService {
    try {
        $result = Invoke-RestMethod 'http://127.0.0.1:8000/api/agents/health' -TimeoutSec 2
        return $result.service -eq 'fool-fish-agents'
    } catch { return $false }
}
if (-not (Test-AgentService)) {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8000 is occupied by another service. No process was stopped.' }
    $backendProcess = Start-Process -FilePath $nodePath -ArgumentList @('server.js') -WorkingDirectory $backendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'agents.stdout.log') -RedirectStandardError (Join-Path $logPath 'agents.stderr.log') -PassThru
    $backendProcess.Id | Set-Content -LiteralPath (Join-Path $logPath 'agents.pid')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-AgentService) { break }
        if ($backendProcess.HasExited) { throw 'Agent backend exited. Check agents.stderr.log.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-AgentService)) { throw 'Agent backend did not become ready.' }
}
function Test-Platform {
    try {
        $response = Invoke-WebRequest $platformUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match 'fool fish'
    } catch { return $false }
}
if (-not (Test-Platform)) {
    $listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 4173 is occupied by another service. No process was stopped.' }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $vitePath = Join-Path $frontendPath 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vitePath)) {
        Push-Location $frontendPath
        try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
        finally { Pop-Location }
    }
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    $process = Start-Process -FilePath $nodePath -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4173','--strictPort') -WorkingDirectory $frontendPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'platform.stdout.log') -RedirectStandardError (Join-Path $logPath 'platform.stderr.log') -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $logPath 'platform.pid')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-Platform) { break }
        if ($process.HasExited) { throw 'Platform exited. Check platform.stderr.log.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Platform)) { throw 'Platform did not become ready. Check logs in the project folder.' }
}
Write-Output "Platform ready: $platformUrl"
if (-not $NoBrowser) { Start-Process $platformUrl }
