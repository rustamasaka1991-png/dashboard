@echo off
chcp 65001 >nul
title Uz-Grow dashboard
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo XATO: Node.js o'rnatilmagan.
  echo https://nodejs.org saytidan "LTS" versiyani yuklab o'rnating, keyin kompyuterni qayta ishga tushirib, shu faylni yana oching.
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)
if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul
set OPEN_BROWSER=1
node server.js
echo.
pause
