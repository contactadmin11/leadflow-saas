try {
    $r = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/health" -UseBasicParsing -TimeoutSec 40
    Write-Host "HTTP Status : $($r.StatusCode)"
    Write-Host "Response    : $($r.Content)"
    Write-Host "APP_IS_LIVE"
} catch {
    $err = $_.Exception.Message
    Write-Host "Error: $err"

    # Try root URL
    try {
        $r2 = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/" -UseBasicParsing -TimeoutSec 40
        Write-Host "Root HTTP Status: $($r2.StatusCode)"
        Write-Host "Root Content (first 500 chars): $($r2.Content.Substring(0, [Math]::Min(500, $r2.Content.Length)))"
    } catch {
        Write-Host "Root also failed: $($_.Exception.Message)"
    }
}
