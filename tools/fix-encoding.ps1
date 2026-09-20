# fix-encoding.ps1
# ---------------------------------------------------------------------------
# Windows PowerShell 5.1 reads .ps1 files WITHOUT a UTF-8 BOM using the system
# ANSI codepage, which mangles Chinese text and causes parse errors.
# This helper makes sure the Chinese-containing scripts are saved as
# "UTF-8 with BOM". It is safe to run any number of times.
#
# NOTE: keep this file ASCII-only, so it never needs a BOM itself.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\fix-encoding.ps1
#   powershell -ExecutionPolicy Bypass -File tools\fix-encoding.ps1 -Files a.ps1,b.ps1
# ---------------------------------------------------------------------------

param(
    [string[]] $Files
)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Files -or $Files.Count -eq 0) {
    $Files = @((Join-Path $dir 'update-repo.ps1'))
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$utf8Bom   = New-Object System.Text.UTF8Encoding $true
$fixed = 0
$ok = 0

foreach ($f in $Files) {
    if (-not (Test-Path -LiteralPath $f)) {
        Write-Host ("skip (not found): " + $f) -ForegroundColor Yellow
        continue
    }
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)

    if ($hasBom) {
        Write-Host ("ok  (already UTF-8 BOM): " + $f) -ForegroundColor Green
        $ok++
        continue
    }

    $text = [System.IO.File]::ReadAllText($f, $utf8NoBom)
    [System.IO.File]::WriteAllText($f, $text, $utf8Bom)
    Write-Host ("fixed (added UTF-8 BOM): " + $f) -ForegroundColor Yellow
    $fixed++
}

Write-Host ("done: " + $ok + " ok, " + $fixed + " fixed")
exit 0
