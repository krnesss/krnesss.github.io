<#
.SYNOPSIS
    一键把改枪数据更新到 GitHub 仓库：构建 → 自检 → 提交 → 推送。

.DESCRIPTION
    流程（任何一步失败都会立刻停下并说明原因）：
      1. 环境检查：git / node 是否可用、有没有卡在半途的 rebase 或 merge
      2. 仓库准备：没有 .git 就 git init；没有 origin 就自动添加远程地址
      3. 构建数据：node tools/build-data.mjs（扫描 save/ 生成 data/）
      4. 自检：node tools/smoke-test.mjs（页面与数据断言）
      5. 预览改动：列出这次会提交哪些文件（含非 ASCII 路径提醒）
      6. 提交：git add -A + git commit（提交信息不写就自动生成）
      7. 推送：git push（首次自动带 -u origin <分支>）
    第一次运行会自动把远程地址配好；如果仓库还不存在，推送那一步会失败并给出提示。

.PARAMETER Message
    自定义提交信息。不填会根据改动内容自动生成，例如「更新改枪数据：M4A1、AK-12（3 个文件）」。

.PARAMETER Remote
    首次运行时使用的远程仓库地址，默认是 https://github.com/krnesss/krnesss.github.io.git

.PARAMETER Branch
    分支名，默认 main（仅在仓库还没有任何提交时用于确定分支）。

.PARAMETER SkipBuild
    跳过第 3 步的数据构建（如果你已经手动构建过）。

.PARAMETER SkipTest
    跳过第 4 步的自检（想快点推送时用，不推荐）。

.PARAMETER Pull
    提交前先执行 git pull --rebase，适合在多台电脑上改同一份数据的情况。

.PARAMETER NoPush
    只提交到本地，不推送。

.PARAMETER DryRun
    只预览：构建 + 自检照常跑，但不提交、不推送，也不修改仓库配置。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\update-repo.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\update-repo.ps1 -Message "新增 M4A1 方案 3" -SkipTest

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\update-repo.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [string] $Message = '',
    [string] $Remote  = 'https://github.com/krnesss/krnesss.github.io.git',
    [string] $Branch  = 'main',
    [switch] $SkipBuild,
    [switch] $SkipTest,
    [switch] $Pull,
    [switch] $NoPush,
    [switch] $DryRun
)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
Set-Location -LiteralPath $Root

$script:StepNo = 0
$script:Changed = 0
$script:RemoteUrl = $Remote

function Write-Step([string]$Text) {
    $script:StepNo++
    Write-Host ''
    Write-Host ('[{0}] {1}' -f $script:StepNo, $Text) -ForegroundColor Cyan
}
function Write-Ok([string]$Text)   { Write-Host ('    √ ' + $Text) -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host ('      ' + $Text) -ForegroundColor DarkGray }
function Write-Note([string]$Text) { Write-Host ('    ! ' + $Text) -ForegroundColor Yellow }
function Fail([string]$Text) {
    Write-Host ''
    Write-Host ('× ' + $Text) -ForegroundColor Red
    exit 1
}

# 调用 git 并拿到输出；stderr 也一起收进变量，避免 PowerShell 把原生命令的
# stderr 当成终止错误（$ErrorActionPreference = 'Stop' 时的经典坑）
function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [switch] $AllowFailure,
        [switch] $Echo
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & git -C $Root @Arguments 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev

    $lines = @()
    if ($out) { $lines = @($out | ForEach-Object { [string]$_ }) }

    if ($Echo -and $lines.Count) {
        foreach ($l in $lines) { Write-Info $l }
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        Write-Host ''
        foreach ($l in $lines) { Write-Host ('  ' + $l) -ForegroundColor DarkGray }
        Fail ('git ' + ($Arguments -join ' ') + ' 执行失败（退出码 ' + $code + '）')
    }
    return ,$lines
}

function Invoke-Node {
    param([string] $ScriptPath, [string] $Label)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & node $ScriptPath
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) {
        Fail ($Label + ' 失败（退出码 ' + $code + '）')
    }
}

# 只关心「成功还是失败」的 git 调用。
# 注意：不能靠「输出是否为空」判断——git 失败时会把错误写进 stderr，
# 合并到输出流之后看起来像是有内容，会被误判成成功。
function Test-Git {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $null = & git -C $Root @Arguments 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    return ($code -eq 0)
}

# 从 git status --porcelain 的一行里取出路径
function Get-StatusPath([string]$Line) {
    if ($Line.Length -le 3) { return '' }
    $p = $Line.Substring(3).Trim()
    if ($p -match '^"(.*)"$') { $p = $Matches[1] }
    if ($p -match ' -> ') { $p = ($p -split ' -> ')[-1] }
    if ($p -match '^"(.*)"$') { $p = $Matches[1] }
    return $p
}

function New-CommitMessage([string[]]$Paths) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $allSave = $true
    $guns = New-Object System.Collections.Generic.List[string]
    foreach ($p in $Paths) {
        if ($p -notlike 'save/*') { $allSave = $false; continue }
        if ($p -match '^save/[^/]+/([^/]+)/') {
            if (-not $guns.Contains($Matches[1])) { $guns.Add($Matches[1]) }
        }
    }
    if ($allSave -and $guns.Count -gt 0) {
        $shown = @($guns | Select-Object -First 4)
        $tail = ''
        if ($guns.Count -gt $shown.Count) { $tail = ' 等 ' + $guns.Count + ' 把枪' }
        return ('更新改枪数据：' + ($shown -join '、') + $tail + '（' + $Paths.Count + ' 个文件）')
    }
    if ($allSave) {
        return ('更新改枪数据（' + $Paths.Count + ' 个文件，' + $stamp + '）')
    }
    return ('更新站点与数据（' + $Paths.Count + ' 个文件，' + $stamp + '）')
}

Write-Host ''
Write-Host '三角洲行动 · 改枪码站 —— 更新并推送到 GitHub' -ForegroundColor White
Write-Host ('仓库目录：' + $Root) -ForegroundColor DarkGray
if ($DryRun) { Write-Host '模式：仅预览（DryRun，不会提交或推送）' -ForegroundColor Yellow }

# ---------------------------------------------------------------- 1 环境

Write-Step '检查环境'

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
# 注意：这里不要给原生命令接管道（比如 | Select-Object -First 1）。
# PowerShell 5.1 下管道会提前结束进程，$LASTEXITCODE 可能变成 -1 导致误判。
$gitOut = @(& git --version 2>&1)
$gitOk = ($LASTEXITCODE -eq 0)
$gitVersion = ''
if ($gitOut.Count -gt 0) { $gitVersion = [string]($gitOut[0]) }

$nodeOut = @(& node --version 2>&1)
$nodeOk = ($LASTEXITCODE -eq 0)
$nodeVersion = ''
if ($nodeOut.Count -gt 0) { $nodeVersion = [string]($nodeOut[0]) }
$ErrorActionPreference = $prev

if (-not $gitOk) { Fail '没有找到 git，请先安装 Git for Windows，然后重开一个终端。' }
Write-Ok $gitVersion
if (-not $nodeOk) { Fail '没有找到 node，请先安装 Node.js（18 以上），然后重开一个终端。' }
Write-Ok $nodeVersion

if (-not (Test-Path -LiteralPath (Join-Path $Root 'tools\build-data.mjs'))) {
    Fail ('这里看起来不是站点根目录（找不到 tools\build-data.mjs）：' + $Root)
}

foreach ($mark in @('.git\rebase-merge', '.git\rebase-apply', '.git\MERGE_HEAD', '.git\CHERRY_PICK_HEAD')) {
    if (Test-Path -LiteralPath (Join-Path $Root $mark)) {
        Fail ('仓库里有一个没做完的操作（' + $mark + '），请先解决冲突：git status 看看情况，或 git rebase --abort / git merge --abort。')
    }
}
Write-Ok '没有卡在半途的 rebase / merge'

# ------------------------------------------------------------ 2 仓库准备

Write-Step '准备仓库'

if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    if ($DryRun) {
        Write-Note ('当前还不是 git 仓库，正式运行时会执行：git init -b ' + $Branch)
    } else {
        Invoke-Git @('init', '-b', $Branch) | Out-Null
        Write-Ok ('已初始化 git 仓库（分支 ' + $Branch + '）')
    }
} else {
    Write-Ok '已经是 git 仓库'
}

$branchNow = ''
$branchLines = Invoke-Git @('symbolic-ref', '--short', 'HEAD') -AllowFailure
if ($branchLines.Count -and $branchLines[0]) { $branchNow = $branchLines[0].Trim() }
if (-not $branchNow) { $branchNow = $Branch }
$headExists = Test-Git @('rev-parse', '--verify', 'HEAD')

if ($headExists) {
    Write-Ok ('当前分支：' + $branchNow)
} else {
    Write-Info ('仓库还没有任何提交，首次推送会创建分支 ' + $branchNow)
}

$hasRemote = Test-Git @('remote', 'get-url', 'origin')
if ($hasRemote) {
    $remoteUrlNow = (Invoke-Git @('remote', 'get-url', 'origin'))[0].Trim()
    $script:RemoteUrl = $remoteUrlNow
    Write-Ok ('远程 origin：' + $remoteUrlNow)
} else {
    if ($DryRun) {
        Write-Note ('还没有配置远程仓库，正式运行时会执行：git remote add origin ' + $Remote)
    } else {
        Invoke-Git @('remote', 'add', 'origin', $Remote) | Out-Null
        Write-Ok ('已添加远程 origin：' + $Remote)
    }
}

if ($Pull -and $hasRemote -and $headExists) {
    Write-Info ('先拉取远端最新代码：git pull --rebase origin ' + $branchNow)
    if (-not $DryRun) {
        Invoke-Git @('pull', '--rebase', 'origin', $branchNow) -Echo | Out-Null
        Write-Ok '拉取完成'
    }
}

# ---------------------------------------------------------------- 3 构建

if ($SkipBuild) {
    Write-Step '构建数据（已跳过）'
    Write-Note '跳过了 node tools/build-data.mjs，确认 data/ 已经是最新的'
} else {
    Write-Step '构建数据（扫描 save/ 生成 data/）'
    Invoke-Node (Join-Path $Root 'tools\build-data.mjs') '数据构建'
    Write-Ok 'data/guns.js 与 data/guns.json 已更新'
}

# ---------------------------------------------------------------- 4 自检

if ($SkipTest) {
    Write-Step '自检（已跳过）'
    Write-Note '跳过了冒烟测试，建议重要改动不要跳'
} else {
    Write-Step '自检（页面与数据断言）'
    Invoke-Node (Join-Path $Root 'tools\smoke-test.mjs') '自检'
    Write-Ok '自检通过'
}

# ------------------------------------------------------------ 5 变更预览

Write-Step '查看这次有哪些改动'

$statusLines = Invoke-Git @('status', '--porcelain')
$paths = @()
foreach ($line in $statusLines) {
    if (-not $line) { continue }
    $p = Get-StatusPath $line
    if ($p) { $paths += $p }
}
$script:Changed = $paths.Count

$aheadCount = 0
if ($hasRemote -and $headExists -and (Test-Git @('rev-parse', '--verify', '--quiet', ('origin/' + $branchNow)))) {
    $aheadLines = Invoke-Git @('rev-list', '--count', ('origin/' + $branchNow + '..HEAD')) -AllowFailure
    if ($aheadLines.Count -and ($aheadLines[0] -match '^\d+$')) { $aheadCount = [int]$aheadLines[0] }
}

if ($script:Changed -eq 0) {
    Write-Ok '工作区是干净的，没有需要提交的改动'
    if ($aheadCount -gt 0) {
        Write-Note ('不过本地有 ' + $aheadCount + ' 个提交还没推送，下面直接推送')
    } else {
        Write-Host ''
        Write-Host '一切都已经是最新的，不需要做任何事。' -ForegroundColor Green
        if ($hasRemote) { Write-Info ('远程仓库：' + $script:RemoteUrl) }
        exit 0
    }
} else {
    $shown = @($paths | Select-Object -First 15)
    foreach ($p in $shown) { Write-Info $p }
    if ($paths.Count -gt $shown.Count) { Write-Info ('…还有 ' + ($paths.Count - $shown.Count) + ' 个') }
    Write-Ok ('共 ' + $paths.Count + ' 个文件有改动')
    if ($aheadCount -gt 0) { Write-Note ('另外本地还有 ' + $aheadCount + ' 个提交没推送，会一起推上去') }

    $badPaths = @($paths | Where-Object { $_ -match '[^\x20-\x7E]' })
    if ($badPaths.Count) {
        Write-Note ('有 ' + $badPaths.Count + ' 个路径含非 ASCII 字符（枪名/分类名会显示在页面上，建议改成英文）：')
        foreach ($p in @($badPaths | Select-Object -First 5)) { Write-Info $p }
    }
}

if ($DryRun) {
    Write-Step '预览结束'
    Write-Info 'DryRun 模式：没有提交、没有推送、也没有修改仓库配置'
    Write-Info '去掉 -DryRun 再运行一次就会真正提交并推送'
    exit 0
}

# ---------------------------------------------------------------- 6 提交

if ($script:Changed -eq 0) {
    Write-Step '提交（没有新改动，跳过）'
} else {
    Write-Step '提交'

    if (-not $Message) { $Message = New-CommitMessage $paths }
    Write-Info ('提交信息：' + $Message)

    Invoke-Git @('add', '-A') | Out-Null

    $nameLines = Invoke-Git @('config', '--get', 'user.name') -AllowFailure
    $mailLines = Invoke-Git @('config', '--get', 'user.email') -AllowFailure
    if (-not ($nameLines.Count -and $nameLines[0]) -or -not ($mailLines.Count -and $mailLines[0])) {
        Fail @'
git 还没有配置提交者身份。先执行下面两条（把名字和邮箱换成你的）：
    git config --global user.name "krnesss"
    git config --global user.email "你的邮箱"
'@
    }

    Invoke-Git @('commit', '-m', $Message) -Echo | Out-Null
    $shortHash = (Invoke-Git @('rev-parse', '--short', 'HEAD'))[0].Trim()
    Write-Ok ('已提交：' + $shortHash)
}

# ---------------------------------------------------------------- 7 推送

if ($NoPush) {
    Write-Step '推送（已跳过 -NoPush）'
    Write-Note '改动只提交到了本地，回头运行不带 -NoPush 的脚本即可推送'
    exit 0
}

if (-not $hasRemote) {
    Write-Step '推送（跳过：还没有配置远程仓库）'
    Write-Note ('先执行：git remote add origin ' + $Remote + '，再重新运行本脚本')
    exit 1
}

Write-Step '推送到 GitHub'

$upstreamLines = Invoke-Git @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -AllowFailure
$hasUpstream = Test-Git @('rev-parse', '--verify', '--quiet', '@{u}')

$pushArgs = @('push')
if (-not $hasUpstream) { $pushArgs = @('push', '-u', 'origin', $branchNow) }

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$pushOut = & git -C $Root @pushArgs 2>&1
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $prev

foreach ($l in @($pushOut)) { Write-Info ([string]$l) }

if ($pushCode -ne 0) {
    Write-Host ''
    Write-Host '× 推送失败。改动已经提交在本地了，排除下面几种情况后重新运行脚本即可：' -ForegroundColor Red
    Write-Info ('1. GitHub 上还没建仓库？去 https://github.com/new 建一个公开仓库，名字填 krnesss.github.io')
    Write-Info '2. 没登录 / 没权限？在浏览器登录 GitHub 后，用 Git Credential Manager 重新认证一次'
    Write-Info '3. 远端有新提交（报 non-fast-forward）？加上 -Pull 参数再运行：-Pull'
    Write-Info '4. 网络问题？代理 / VPN 打开后重试'
    Write-Info ('本地最新提交：' + (Invoke-Git @('rev-parse', '--short', 'HEAD') -AllowFailure)[0])
    exit 1
}

# ---------------------------------------------------------------- 8 结果

Write-Step '完成'
$finalHash = (Invoke-Git @('rev-parse', '--short', 'HEAD'))[0].Trim()
$finalMsg  = (Invoke-Git @('log', '-1', '--pretty=%s'))[0].Trim()
Write-Ok ('已推送 ' + $branchNow + ' 分支：' + $finalHash + ' ' + $finalMsg)

$webUrl = 'https://krnesss.github.io/'
if ($hasRemote -and $script:RemoteUrl -match 'github\.com[:/]([^/]+)/([^/.]+)') {
    $owner = $Matches[1]
    $repo  = $Matches[2]
    if ($repo -ieq ($owner + '.github.io')) { $webUrl = 'https://' + $owner + '.github.io/' }
    else { $webUrl = 'https://' + $owner + '.github.io/' + $repo + '/' }
}
Write-Host ''
Write-Host ('站点地址：' + $webUrl) -ForegroundColor Green
Write-Info 'GitHub Actions 构建大约需要 1-2 分钟，之后刷新页面即可看到最新数据'
Write-Host ''
