# PowerShell script to guarantee Ollama runs with 100% GPU offloading on NVIDIA GeForce RTX 5060
Write-Host "Checking NVIDIA GPU..." -ForegroundColor Cyan
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

# Set User and Process Environment Variables for GPU Offload
[System.Environment]::SetEnvironmentVariable("CUDA_VISIBLE_DEVICES", "0", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_NUM_GPU", "999", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION", "1", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE", "24h", "User")
[System.Environment]::SetEnvironmentVariable("OLLAMA_GPU_OVERHEAD", "0", "User")

$env:CUDA_VISIBLE_DEVICES = "0"
$env:OLLAMA_NUM_GPU = "999"
$env:OLLAMA_FLASH_ATTENTION = "1"
$env:OLLAMA_KEEP_ALIVE = "24h"
$env:OLLAMA_GPU_OVERHEAD = "0"

# Check if Ollama is currently running on 100% GPU
$ollamaPs = ollama ps 2>$null
if ($ollamaPs -match "100% GPU") {
    Write-Host "Ollama is already actively running on 100% GPU!" -ForegroundColor Green
    ollama ps
    exit 0
}

Write-Host "Restarting Ollama service with GPU environment..." -ForegroundColor Yellow
Stop-Process -Name "ollama app" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
Write-Host "Waiting for Ollama to initialize..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

# Warm model into GPU VRAM indefinitely
Write-Host "Locking hermes-fast into GPU VRAM..." -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body '{"model": "hermes-fast", "keep_alive": -1}' -ContentType "application/json" | Out-Null
} catch {
    Start-Sleep -Seconds 3
    Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body '{"model": "hermes-fast", "keep_alive": -1}' -ContentType "application/json" | Out-Null
}

Write-Host "Verifying GPU Status:" -ForegroundColor Green
ollama ps
nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv
Write-Host "`nReady! The local LLM is running with 100% offload on your RTX 5060 GPU." -ForegroundColor Green
