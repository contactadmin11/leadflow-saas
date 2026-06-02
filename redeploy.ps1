$headers = @{
    "Authorization" = "Bearer rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"
    "Accept"        = "application/json"
    "Content-Type"  = "application/json"
}
$result = Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d8ek2v4m0tmc73eubh3g/deploys" -Headers $headers -Method POST -Body "{}"
Write-Host "Deploy triggered!"
Write-Host "Deploy ID: $($result.deploy.id)"
Write-Host "Status   : $($result.deploy.status)"
Write-Host ""
Write-Host "Render is now rebuilding your app with the fix."
Write-Host "This takes 3-5 minutes."
Write-Host "Visit: https://leadflow-crm-india.onrender.com"
