@echo off
chcp 65001 >nul
title CHAKEN Planing v1.0 - PD Plan
cd /d "%~dp0"

echo ======================================================================
echo           Starting CHAKEN Planing v1.0 (PD Plan)
echo ======================================================================
echo Web App URL: http://localhost:5173/pirom_pdplan/
echo.
echo [NOTE] Please keep this command prompt window open while using the app.
echo.

:: Launch browser pointing to local dev app
start "" "http://localhost:5173/pirom_pdplan/"

:: Start Vite local development server
npm run dev
