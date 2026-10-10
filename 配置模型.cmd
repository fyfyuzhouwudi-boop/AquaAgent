@echo off
if not exist "%~dp0backend\.env" copy "%~dp0backend\.env.example" "%~dp0backend\.env" >nul
notepad.exe "%~dp0backend\.env"
