$headers = @{ "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"; "Accept" = "application/json" }
$deploys = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/deploys?limit=1" -Headers $headers
$d = $deploys[0].deploy
Write-Host "Deploy Status : $($d.status)"
Write-Host "Started At    : $($d.createdAt)"
Write-Host "Updated At    : $($d.updatedAt)"
Write-Host ""
$svc = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g" -Headers $headers
Write-Host "Service Status: $($svc.service.suspended)"
Write-Host "Live URL      : https://leadflow-crm-india.onrender.com"
