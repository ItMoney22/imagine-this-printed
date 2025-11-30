@echo off
REM Development script to run both backend API and AI jobs worker (Windows)
REM This ensures the AI Product Builder works properly

echo.
echo 🚀 Starting Imagine This Printed Backend (API + Worker)
echo ================================================
echo.

REM Check if environment file exists
if not exist .env (
    echo ⚠️  Warning: .env file not found!
    echo Please copy .env.example to .env and configure it.
    exit /b 1
)

echo 📡 Starting API server...
start "Imagine This Printed API" /MIN cmd /c "npm run watch"

REM Give the API a moment to start
timeout /t 2 /nobreak > nul

echo 🤖 Starting AI jobs worker...
start "Imagine This Printed Worker" /MIN cmd /c "npm run worker:dev"

echo.
echo ✅ Both services are running in separate windows:
echo    - API Server (watch mode)
echo    - AI Worker (watch mode)
echo.
echo To stop: Close both terminal windows or press Ctrl+C in each
echo.

pause
