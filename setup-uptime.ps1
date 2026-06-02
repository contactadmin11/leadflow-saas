$body = @{
    api_key      = "u3544453-7ab42a582e5af5f5af0ffed1"
    format       = "json"
    type         = 1
    url          = "https://leadflow-crm-india.onrender.com/health"
    friendly_name= "LeadFlow Keep Alive"
    interval     = 300
}
$encoded = ($body.GetEnumerator() | ForEach-Object { "$($_.Key)=$([System.Uri]::EscapeDataString($_.Value.ToString()))" }) -join "&"
$response = Invoke-RestMethod -Uri "https://api.uptimerobot.com/v2/newMonitor" -Method POST -Body $encoded -ContentType "application/x-www-form-urlencoded"
Write-Host "UptimeRobot Status: $($response.stat)"
if ($response.stat -eq "ok") {
    Write-Host "Monitor ID: $($response.monitor.id)"
    Write-Host "UPTIMEROBOT_SUCCESS - Pinging every 5 minutes!"
} else {
    Write-Host "Error: $($response | ConvertTo-Json)"
}
