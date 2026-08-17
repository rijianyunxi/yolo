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
    Write-Host "[端口检查] 端口 $Port 已被进程占用：$($oldPids -join ', ')，将先停止旧服务再启动新服务。"
    foreach ($processId in $oldPids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 600
} else {
    Write-Host "[端口检查] 端口 $Port 空闲，直接启动。"
}

$pidFile = Join-Path (Get-Location) "webui\uvicorn.pid"
if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

$server = Start-Process -FilePath $Python -ArgumentList "-m", "uvicorn", "webui.app:app", "--host", $HostAddress, "--port", $Port -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
$server.Id | Set-Content -Path $pidFile -Encoding utf8
Write-Host "YOLO 训练台已启动：http://$HostAddress`:$Port  (PID $($server.Id))"

try {
    Wait-Process -Id $server.Id
    Write-Host "[服务退出] uvicorn 已停止，清理 PID 文件。"
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} catch {
    Write-Warning "服务进程已结束或无法等待。"
}
