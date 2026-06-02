$headers = @{
    "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"
    "Accept"        = "application/json"
}

Write-Host "=== ENVIRONMENT VARIABLES ON RENDER ==="
$envVars = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/env-vars" -Headers $headers
foreach ($ev in $envVars) {
    $v = $ev.envVar
    $val = $v.value
    # Mask sensitive values but show first 10 chars
    if ($v.key -match "SECRET|PASSWORD|KEY|URI") {
        $val = $val.Substring(0, [Math]::Min(10, $val.Length)) + "***"
    }
    Write-Host "$($v.key) = $val"
}

Write-Host ""
Write-Host "=== LATEST DEPLOY STATUS ==="
$deploys = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/deploys?limit=3" -Headers $headers
foreach ($item in $deploys) {
    $d = $item.deploy
    Write-Host "ID: $($d.id) | Status: $($d.status) | Commit: $($d.commit.message) | Created: $($d.createdAt)"
}
