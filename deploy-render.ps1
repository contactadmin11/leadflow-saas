$RENDER_KEY = "rnd_9rWxZDaRhcY0uG07mnMsSae7LXcB"
$headers = @{ "Authorization" = "Bearer $RENDER_KEY"; "Accept" = "application/json"; "Content-Type" = "application/json" }

Write-Host "Step 1: Getting your Render account..."
$owners = Invoke-RestMethod -Uri "https://api.render.com/v1/owners?limit=1" -Headers $headers -Method GET
$ownerId = $owners[0].owner.id
$ownerName = $owners[0].owner.name
Write-Host "Account: $ownerName (ID: $ownerId)"

Write-Host ""
Write-Host "Step 2: Creating LeadFlow web service..."
$serviceBody = @{
    type = "web_service"
    name = "leadflow-crm-india"
    ownerId = $ownerId
    repo = "https://github.com/contactadmin11/leadflow-saas"
    branch = "master"
    autoDeploy = "yes"
    serviceDetails = @{
        env = "docker"
        region = "oregon"
        plan = "free"
        numInstances = 1
        pullRequestPreviewsEnabled = "no"
        healthCheckPath = "/health"
    }
} | ConvertTo-Json -Depth 5

$service = Invoke-RestMethod -Uri "https://api.render.com/v1/services" -Headers $headers -Method POST -Body $serviceBody
$serviceId = $service.service.id
$serviceUrl = $service.service.serviceDetails.url
Write-Host "Service created! ID: $serviceId"
Write-Host "URL: $serviceUrl"

Write-Host ""
Write-Host "Step 3: Setting all environment variables..."
$envVars = @(
    @{ key = "NODE_ENV";             value = "production" },
    @{ key = "PORT";                 value = "3001" },
    @{ key = "MONGODB_URI";          value = "mongodb+srv://Lead_flow_2027:Lead%40flow%402027SRc@cluster0.sgtmesf.mongodb.net/leadflow?retryWrites=true&w=majority&appName=Cluster0" },
    @{ key = "JWT_ACCESS_SECRET";    value = "15ae31355b593a0a92383f8b6c0d1b7bd467e56cf770c050644360e6ca450ebe3b84bddfaf1d83b71b1c5d8e6aa608ef5483d4d4720e831c7b46051a110852bb" },
    @{ key = "JWT_REFRESH_SECRET";   value = "d091dbf2b84c4720e0d8a9cfd35b59a1966f22ff5a0cb25e0d70ec7e476db58c52deec07d83d9caeb6657e51a2e5a90e5782f57d0e3f79cbe06f4ff0bdbc7c00" },
    @{ key = "JWT_ACCESS_EXPIRES";   value = "15m" },
    @{ key = "JWT_REFRESH_EXPIRES";  value = "30d" },
    @{ key = "ENCRYPTION_KEY";       value = "1db8edd2195f58a870a518dc321507b1" },
    @{ key = "ADMIN_PASSWORD";       value = "Lead@flow@2027SRcadm" },
    @{ key = "ADMIN_JWT_SECRET";     value = "401284be1f5836dd356382cbb2cb53ad6ffecd712e4567efb1ff1c2b0f40a2568fc6b871054a335bbb05a1b4485bdc8b130be5be51d2a442b061e63cb987b0e5" },
    @{ key = "APP_SECRET";           value = "a7401c422c2a42fb368e7c0c47c26211" },
    @{ key = "TRIAL_DAYS";           value = "14" },
    @{ key = "RATE_LIMIT_MAX";       value = "200" },
    @{ key = "AUTH_RATE_LIMIT_MAX";  value = "10" },
    @{ key = "ALLOWED_ORIGINS";      value = "https://leadflow-crm-india.onrender.com" },
    @{ key = "CLIENT_URL";           value = "https://leadflow-crm-india.onrender.com" }
) | ConvertTo-Json -Depth 3

Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars" -Headers $headers -Method PUT -Body $envVars | Out-Null
Write-Host "All 16 environment variables set!"

Write-Host ""
Write-Host "Step 4: Triggering first deployment..."
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys" -Headers $headers -Method POST -Body "{}" | Out-Null
Write-Host "Deployment triggered!"

Write-Host ""
Write-Host "============================================"
Write-Host "SERVICE_ID=$serviceId"
Write-Host "SERVICE_URL=$serviceUrl"
Write-Host "============================================"
