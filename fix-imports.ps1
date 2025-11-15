Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $content = $content -replace '@/lib/', '../lib/'
    $content = $content -replace '@/utils/', '../utils/'
    $content = $content -replace '@/context/', '../context/'
    $content = $content -replace '@/components/', '../components/'
    $content = $content -replace '@/types', '../types'
    Set-Content $_.FullName $content
    Write-Host "Fixed: $($_.Name)"
}
