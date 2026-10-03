@echo off
cd /d "%~dp0"
node scripts\start-demo.mjs
if errorlevel 1 pause
