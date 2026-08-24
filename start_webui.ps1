$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
if (-not $ProjectRoot) {
    $ProjectRoot = (Get-Location).Path
}
Set-Location -LiteralPath $ProjectRoot

$HostAddress = "127.0.0.1"
$Port = 7860
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $VenvPython) {
    $Python = $VenvPython
} else {
    $Fallback = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Fallback) {
        throw "未找到 Python：请先创建 .venv 或确保 python 在 PATH 中"
    }
    $Python = $Fallback.Source
}

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

$pidFile = Join-Path $PSScriptRoot "webui\uvicorn.pid"
if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

# 启动前自动构建 React 前端，保证 /prediction 等页面使用最新源码
$Frontend = Join-Path $PSScriptRoot "webui\frontend"
if ((Test-Path -LiteralPath (Join-Path $Frontend "package.json")) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[frontend] Preparing React frontend..."
    Push-Location $Frontend
    try {
        if (-not (Test-Path -LiteralPath "node_modules")) {
            Write-Host "[frontend] Installing dependencies..."
            npm install
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE"
            }
        }
        Write-Host "[frontend] Building React frontend..."
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Warning "[frontend] npm not found or package.json missing, skip frontend build."
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