# Этап 3 — строит эталонную таблицу вложений из архива StrawBerry (только чтение).
# Результат: probe\archive_reference.json — source_id → имя, MIME, размер, sha256,
# статус в архиве и наличие самих байтов в attachments\.
$ErrorActionPreference = 'Stop'
$chats = Get-ChildItem 'G:\Strawberry\chats' -Filter 'chatgpt-*.json'
$rows = @()
foreach ($c in $chats) {
    $d = Get-Content $c.FullName -Raw | ConvertFrom-Json
    $idx = -1
    foreach ($m in $d.messages) {
        $idx++
        foreach ($k in @('images', 'files')) {
            $arr = $m.$k
            if (-not $arr) { continue }
            foreach ($a in $arr) {
                if (-not $a) { continue }
                $ext = $null
                if ($a.format_hint) { $ext = $a.format_hint }
                elseif ($a.mime) { $ext = ($a.mime -split '/')[-1] }
                elseif ($a.name -and $a.name -match '\.([A-Za-z0-9]{1,6})$') { $ext = $Matches[1] }
                $bytesPath = $null
                if ($a.sha256 -and $d.id) {
                    $bytesPath = Join-Path ('G:\Strawberry\attachments\' + $d.id) ($a.sha256 + '.' + $ext)
                }
                $rows += [pscustomobject]@{
                    source_id             = $a.source_id
                    chat_id               = $d.id
                    chat_original_id      = $d.original_id
                    chat_title            = $d.title
                    chat_updated          = $d.source_updated_at
                    message_index         = $idx
                    kind                  = $k
                    name                  = $a.name
                    mime                  = $a.mime
                    declared_size         = $a.size
                    sha256                = $a.sha256
                    archive_status        = $a.status
                    bytes_present_in_archive = [bool]($bytesPath -and (Test-Path $bytesPath))
                    width                 = $a.width
                    height                = $a.height
                }
            }
        }
    }
}
$out = [ordered]@{
    generated = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    note      = 'Извлечено из G:\Strawberry\chats (только чтение). Эталон для сверки ответов ChatGPT: source_id, объявленные имя/MIME/размер, sha256 и факт наличия байтов в attachments\.'
    total     = $rows.Count
    records   = $rows
}
$json = $out | ConvertTo-Json -Depth 4
Set-Content 'C:\Users\User\Documents\Strata\Workspace\StrawberryEdition\probe\archive_reference.json' -Value $json -Encoding UTF8
Write-Host "records: $($rows.Count)"
$rows | Group-Object mime | Sort-Object Count -Descending | ForEach-Object { "  mime {0,-24} {1}" -f $_.Name, $_.Count }
$rows | Group-Object archive_status | ForEach-Object { "  status {0,-10} {1}" -f $_.Name, $_.Count }
Write-Host "уникальных source_id: $((($rows | ForEach-Object source_id) | Select-Object -Unique).Count)"
Write-Host "с байтами в архиве: $((($rows | Where-Object bytes_present_in_archive)).Count)"
$rows | Sort-Object chat_updated | Select-Object -First 4 | ForEach-Object { "  OLD {0}  {1}  {2}  {3} б  sha=$( if($_.sha256){$_.sha256.Substring(0,12)}else{'нет'} )  bytes=$($_.bytes_present_in_archive)" }
$rows | Sort-Object chat_updated -Descending | Select-Object -First 4 | ForEach-Object { "  NEW {0}  {1}  {2}  {3} б  sha=$( if($_.sha256){$_.sha256.Substring(0,12)}else{'нет'} )  bytes=$($_.bytes_present_in_archive)" }
