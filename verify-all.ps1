$headers = @{
    "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"
    "Accept"        = "application/json"
}

Write-Host "=============================="
Write-Host "  FULL DEPLOYMENT VERIFICATION"
Write-Host "=============================="
Write-Host ""

# 1. Check deploy status
Write-Host "1. DEPLOY STATUS"
Write-Host "----------------"
$deploys = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/deploys?limit=1" -Headers $headers
$d = $deploys[0].deploy
Write-Host "   Status : $($d.status)"
Write-Host "   Commit : $($d.commit.message)"
Write-Host "   Created: $($d.createdAt)"
Write-Host ""

# 2. Health endpoint
Write-Host "2. HEALTH CHECK (/health)"
Write-Host "-------------------------"
try {
    $r = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/health" -UseBasicParsing -TimeoutSec 60
    Write-Host "   HTTP $($r.StatusCode) - $($r.Content)"
} catch {
    Write-Host "   FAILED: $($_.Exception.Message)"
}
Write-Host ""

# 3. Landing page
Write-Host "3. LANDING PAGE (/)"
Write-Host "-------------------"
try {
    $r = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/" -UseBasicParsing -TimeoutSec 60
    Write-Host "   HTTP $($r.StatusCode) - Length: $($r.Content.Length) chars"
    if ($r.Content -match "LeadFlow") { Write-Host "   Content: LeadFlow page loaded OK" }
    elseif ($r.Content -match "Not found") { Write-Host "   Content: NOT FOUND (PROBLEM!)" }
    else { Write-Host "   Content: $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))" }
} catch {
    Write-Host "   FAILED: $($_.Exception.Message)"
}
Write-Host ""

# 4. Admin panel with secret token
Write-Host "4. ADMIN PANEL (/admin?t=401284be1f58)"
Write-Host "--------------------------------------"
try {
    $r = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/admin?t=401284be1f58" -UseBasicParsing -TimeoutSec 60
    Write-Host "   HTTP $($r.StatusCode) - Length: $($r.Content.Length) chars"
    if ($r.Content -match "License Manager") { Write-Host "   Content: Admin panel loaded OK" }
    elseif ($r.Content -match "403") { Write-Host "   Content: 403 FORBIDDEN (PROBLEM!)" }
    else { Write-Host "   Content: $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))" }
} catch {
    Write-Host "   FAILED: $($_.Exception.Message)"
}
Write-Host ""

# 5. Admin panel WITHOUT token (should be blocked)
Write-Host "5. ADMIN PANEL WITHOUT TOKEN (/admin) - should be 403"
Write-Host "-----------------------------------------------------"
try {
    $r = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/admin" -UseBasicParsing -TimeoutSec 30
    Write-Host "   HTTP $($r.StatusCode) - WARNING: Should have been 403!"
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 403) {
        Write-Host "   HTTP 403 - BLOCKED correctly"
    } else {
        Write-Host "   Error: $($_.Exception.Message)"
    }
}
Write-Host ""

# 6. CRM app page
Write-Host "6. CRM APP (/app)"
Write-Host "------------------"
try {
    $r = Invoke-WebRequest -Uri "https://leadflow-crm-india.onrender.com/app" -UseBasicParsing -TimeoutSec 60
    Write-Host "   HTTP $($r.StatusCode) - Length: $($r.Content.Length) chars"
} catch {
    Write-Host "   FAILED: $($_.Exception.Message)"
}
Write-Host ""

Write-Host "=============================="
Write-Host "  VERIFICATION COMPLETE"
Write-Host "=============================="
