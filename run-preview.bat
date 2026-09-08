@echo off
cd /d "%~dp0"
node web-preview\preview-server.js
if %errorlevel% neq 0 (
    python web-preview\preview_server.py
)
if %errorlevel% neq 0 (
    start "" "web-preview\index.html"
)
pause
