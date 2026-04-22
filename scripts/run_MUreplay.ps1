#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RootDir = Split-Path $PSScriptRoot -Parent
$BackendDir = Join-Path $RootDir 'python'
$FrontendDir = Join-Path $RootDir 'frontend'

$env:MUREPLAY_HOST = if ($env:MUREPLAY_HOST) { $env:MUREPLAY_HOST } else { '0.0.0.0' }
$env:MUREPLAY_BACKEND_PORT = if ($env:MUREPLAY_BACKEND_PORT) { $env:MUREPLAY_BACKEND_PORT } else { '8000' }
$env:MUREPLAY_FRONTEND_PORT = if ($env:MUREPLAY_FRONTEND_PORT) { $env:MUREPLAY_FRONTEND_PORT } else { '8080' }
$env:MUREPLAY_OPEN_BROWSER = if ($env:MUREPLAY_OPEN_BROWSER) { $env:MUREPLAY_OPEN_BROWSER } else { '1' }
$MureplayBidsRoot = if ($args.Count -gt 0) { $args[0] } elseif ($env:MUREPLAY_BIDS_ROOT) { $env:MUREPLAY_BIDS_ROOT } else { '' }
$env:MUREPLAY_BIDS_ROOT = $MureplayBidsRoot

$hostForApi = if ($env:MUREPLAY_HOST -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $env:MUREPLAY_HOST }
$templatePath = Join-Path $FrontendDir 'runtime-config.template.js'
$runtimeConfigPath = Join-Path $FrontendDir 'runtime-config.js'
$template = Get-Content -Path $templatePath -Raw
$rendered = $template.Replace('__MUREPLAY_API_BASE__', "http://$hostForApi`:$($env:MUREPLAY_BACKEND_PORT)").Replace('__MUREPLAY_BIDS_ROOT__', $MureplayBidsRoot)
Set-Content -Path $runtimeConfigPath -Value $rendered

$BackendJob = Start-Job -ScriptBlock {
    param($dir, $host, $port, $bidsRoot)
    Set-Location $dir
    if ($bidsRoot) {
        python server.py --host $host --port $port --bids-root $bidsRoot 2>&1
    } else {
        python server.py --host $host --port $port 2>&1
    }
} -ArgumentList $BackendDir, $env:MUREPLAY_HOST, $env:MUREPLAY_BACKEND_PORT, $MureplayBidsRoot

$FrontendJob = Start-Job -ScriptBlock {
    param($dir, $port)
    Set-Location $dir
    python -m http.server $port 2>&1
} -ArgumentList $FrontendDir, $env:MUREPLAY_FRONTEND_PORT

Write-Host "Backend starting on :$($env:MUREPLAY_BACKEND_PORT)"
Write-Host "Frontend starting on :$($env:MUREPLAY_FRONTEND_PORT)"

Start-Sleep -Seconds 2
if ($BackendJob.State -ne 'Running') {
    Write-Host "ERROR: Backend failed to start:" -ForegroundColor Red
    Receive-Job $BackendJob | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    Stop-Job $FrontendJob -ErrorAction SilentlyContinue
    Remove-Job $BackendJob, $FrontendJob -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "Backend running."

if ($env:MUREPLAY_OPEN_BROWSER -eq '1') {
    $hostForBrowser = if ($env:MUREPLAY_HOST -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $env:MUREPLAY_HOST }
    try { Start-Process "http://$hostForBrowser`:$($env:MUREPLAY_FRONTEND_PORT)/" }
    catch { Write-Warning "Could not open browser automatically: $_" }
}

try {
    while ($BackendJob.State -eq 'Running' -and $FrontendJob.State -eq 'Running') {
        Receive-Job $BackendJob, $FrontendJob | ForEach-Object { Write-Host $_ }
        Start-Sleep -Milliseconds 500
    }
    if ($BackendJob.State -ne 'Running') {
        Write-Host "Backend stopped unexpectedly:" -ForegroundColor Red
        Receive-Job $BackendJob | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    }
} finally {
    Write-Host "Stopping MUreplay..."
    Stop-Job $BackendJob, $FrontendJob -ErrorAction SilentlyContinue
    Remove-Job $BackendJob, $FrontendJob -ErrorAction SilentlyContinue
}
