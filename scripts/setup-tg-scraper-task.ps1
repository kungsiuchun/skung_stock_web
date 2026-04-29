# setup-tg-scraper-task.ps1
# 設定 Windows Task Scheduler 匹配 cron: */15 14-19 * * 2-6
# 即: 每 15 分鐘, UTC 14:00-19:59 (PDT 07:00-12:59), 週二至週六
# 用法: 以系統管理員身份執行 .\scripts\setup-tg-scraper-task.ps1

$TaskName = "SPX-TG-GEX-Scraper"
$ScriptPath = "C:\Users\kungs\Desktop\skung_stock_web\scripts\tg-gex-scraper.cjs"
$NodePath = (Get-Command node).Source
$WorkDir = "C:\Users\kungs\Desktop\skung_stock_web"

# 移除舊 task
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction `
  -Execute $NodePath `
  -Argument $ScriptPath `
  -WorkingDirectory $WorkDir

# cron "*/15 14-19 * * 2-6"
# UTC 14:00 = PDT 07:00 | 持續 6 小時至 UTC 20:00 (PDT 13:00)
# Day 2-6 = Tue, Wed, Thu, Fri, Sat
$StartTimeUTC = "07:00"   # PDT (UTC-7) 等價 UTC 14:00
$DurationHours = 6        # 涵蓋 UTC 14:00 - 20:00

# 為週二至週六各建一個 Weekly Trigger（Task Scheduler 不支援直接 cron 語法）
$Days = @("Tuesday","Wednesday","Thursday","Friday","Saturday")
$Triggers = @()
foreach ($Day in $Days) {
  $t = New-ScheduledTaskTrigger `
    -Weekly `
    -DaysOfWeek $Day `
    -At $StartTimeUTC `
    -WeeksInterval 1
  # 加入每 15 分鐘重複，持續 6 小時
  $t.Repetition.Interval = "PT15M"
  $t.Repetition.Duration = "PT${DurationHours}H"
  $Triggers += $t
}

$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 3) `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Triggers `
  -Settings $Settings `
  -RunLevel Limited `
  -Force | Out-Null

Write-Host ""
Write-Host "✅ Task '$TaskName' 已設定" -ForegroundColor Green
Write-Host "   📅 週期: 每 15 分鐘 | UTC 14:00-20:00 | 週二至週六" -ForegroundColor Cyan
Write-Host "   🕐 本地時間 (PDT UTC-7): 07:00-13:00, Tue-Sat" -ForegroundColor Cyan
Write-Host ""

# 顯示下次執行時間
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "   ⏭️  下次執行: $($info.NextRunTime)" -ForegroundColor Yellow
Write-Host ""
Write-Host "   手動測試: node $ScriptPath" -ForegroundColor Gray

