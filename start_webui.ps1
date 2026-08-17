$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "D:\work\yolo"

$HostAddress = "127.0.0.1"
$Port = 7860
$Python = "D:\work\yolo\.venv\Scripts\python.exe"

function Get-PortOwnerPids {
    param([int]$TargetPort)
    $pids = @()
    try {
        $listeners = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
        foreach ($item in $listeners) {
            if ($item.OwningProcess) { $pids += [int]$item.OwningProcess }
        }
    } catch { }
    return @($pids | Sort-Object -Unique)
}

$oldPids = Get-PortOwnerPids -TargetPort $Port
if ($oldPids.Count -gt 0) {
    Write-Host "[port-check] Port $Port is in use by PID(s): $($oldPids -join ', '). Stopping old service first."
    foreach ($processId in $oldPids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 600
} else {
    Write-Host "[port-check] Port $Port is free, starting service."
}

$pidFile = Join-Path (Get-Location) "webui\uvicorn.pid"
if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

$server = Start-Process -FilePath $Python -ArgumentList "-m", "uvicorn", "webui.app:app", "--host", $HostAddress, "--port", $Port -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
$server.Id | Set-Content -Path $pidFile -Encoding utf8
Write-Host "YOLO training station started: http://$HostAddress`:$Port  (PID $($server.Id))"

try {
    Wait-Process -Id $server.Id
    Write-Host "[service-exit] uvicorn stopped, removing PID file."
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} catch {
    Write-Warning "Service process finished or could not be waited on."
}
