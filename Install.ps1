param(
    [string]$ThunderRoot = 'C:\Program Files\Thunder Network\Thunder',
    [switch]$Apply,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$taskProgram = Join-Path $ThunderRoot 'program'
$taskApp = Join-Path $taskProgram 'resources\app'
$taskPlugins = Join-Path $taskApp 'plugins'
$taskTarget = [IO.Path]::GetFullPath((Join-Path $taskPlugins 'watch-together'))
$taskConfig = Join-Path $taskPlugins 'config.json'
$taskExpectedParent = [IO.Path]::GetFullPath($taskPlugins)
if ([IO.Path]::GetDirectoryName($taskTarget) -ne $taskExpectedParent) { throw '插件目标路径校验失败' }
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskApp 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
if ($taskVersion -ne '25.1.40.1703') { throw "当前版本 $taskVersion 未适配；暂不修改" }
$taskCfg = Get-Content -LiteralPath $taskConfig -Encoding UTF8 -Raw | ConvertFrom-Json
if ($Uninstall) {
    Write-Output "将从 $taskConfig 中移除 watch-together 项；保留插件文件和备份。"
} else {
    Write-Output "将把此目录下的 index.js、lib、node_modules 复制到 $taskTarget，并在 $taskConfig 添加 watch-together。"
}
Write-Output '应用配置前必须自行退出迅雷；本脚本不会关闭或启动迅雷。'
if (!$Apply) { Write-Output '当前仅显示计划，未修改安装目录。确认后自行添加 -Apply 执行。'; return }
$taskRunning = Get-Process -Name thunder -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($taskProgram,[StringComparison]::OrdinalIgnoreCase) }
if ($taskRunning) { throw '迅雷仍在运行，请自行退出后重试' }
$taskBackup = "$taskConfig.watch-together.$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')).bak"
if (!$Uninstall) {
    if (Test-Path -LiteralPath $taskTarget) { throw '目标插件目录已存在，请先检查，不自动覆盖' }
    foreach ($taskItem in @('index.js','lib','node_modules')) {
        if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot $taskItem))) { throw "交付文件缺失：$taskItem" }
    }
    New-Item -ItemType Directory -Path $taskTarget | Out-Null
    foreach ($taskItem in @('index.js','lib','node_modules')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskItem) -Destination $taskTarget -Recurse
    }
    $taskCfg | Add-Member -NotePropertyName 'watch-together' -NotePropertyValue ([PSCustomObject]@{version='0.1.0'}) -Force
} else {
    $taskCfg.PSObject.Properties.Remove('watch-together')
}
Copy-Item -LiteralPath $taskConfig -Destination $taskBackup
$taskJson = $taskCfg | ConvertTo-Json -Depth 30
$taskTemp = "$taskConfig.watch-together.tmp"
[IO.File]::WriteAllText($taskTemp,$taskJson,[Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $taskTemp -Destination $taskConfig -Force
Write-Output "已完成。原配置备份：$taskBackup。请自行启动迅雷。"
