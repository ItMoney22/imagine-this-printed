# Repairs UTF-8-decoded-as-CP1252 mojibake (emoji rendered as "dY'." garbage)
# by re-encoding suspicious runs through CP1252 and decoding back as UTF-8.
# Only touches runs of 3+ consecutive chars from the CP1252 high range, so
# healthy emoji and normal prose are never modified. Pure-ASCII script.
param([Parameter(Mandatory = $true)][string]$Path)

$cp = [Text.Encoding]::GetEncoding(1252)
$utf8Strict = New-Object Text.UTF8Encoding($false, $true)

# CP1252 high-range codepoints (as regex \u escapes, built from numbers so
# this file contains no non-ASCII bytes).
$codes = @(0x0080..0x00FF) +
         @(0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017D, 0x017E, 0x0192, 0x02C6, 0x02DC) +
         @(0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E) +
         @(0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203A, 0x20AC, 0x2122)
$cls = -join ($codes | ForEach-Object { '\u{0:X4}' -f $_ })
$pattern = "[$cls]{3,}"

$text = [IO.File]::ReadAllText($Path)
$evaluator = {
    param($m)
    try {
        $bytes = $cp.GetBytes($m.Value)
        return $utf8Strict.GetString($bytes)
    } catch {
        return $m.Value  # not valid UTF-8 when round-tripped: leave untouched
    }
}
$fixed = [Regex]::Replace($text, $pattern, $evaluator)
$runs = ([Regex]::Matches($text, $pattern)).Count

if ($fixed -ne $text) {
    [IO.File]::WriteAllText($Path, $fixed, (New-Object Text.UTF8Encoding($false)))
    Write-Output "$Path : $runs suspicious runs scanned, file repaired"
} else {
    Write-Output "$Path : $runs suspicious runs scanned, nothing repairable"
}
