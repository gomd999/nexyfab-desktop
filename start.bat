@echo off
chcp 65001 >nul
title NexyFab Dev Server

echo.
echo  [NexyFab] 개발 서버 시작 준비 중...
echo  =========================================

:: ── 1. 포트 3000 / 3001 점유 프로세스 강제 종료 (PowerShell 사용) ────────
echo  [1/4] 포트 정리 중 (3000, 3001)...

powershell -NoProfile -Command ^
  "3000,3001 | ForEach-Object { $port = $_; $pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique; foreach ($p in $pids) { if ($p -gt 0) { Write-Host \"     포트 $port 점유 PID $p 종료\"; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } } }"

:: ── 2. 잠시 대기 (포트 해제 대기) ──────────────────────────────────────
echo  [2/4] 포트 해제 대기 중...
timeout /t 2 /nobreak >nul

:: ── 3. Next.js 락 파일 삭제 ─────────────────────────────────────────────
echo  [3/4] 락 파일 정리 중...

if exist ".next\dev\lock" (
    del /f /q ".next\dev\lock" >nul 2>&1
    echo      .next\dev\lock 삭제됨
)
if exist ".next\lock" (
    del /f /q ".next\lock" >nul 2>&1
    echo      .next\lock 삭제됨
)

:: ── 4. 개발 서버 시작 (포트 3000 고정) ──────────────────────────────────
echo  [4/4] 개발 서버 시작 중...
echo  =========================================
echo  URL: http://localhost:3000
echo  종료: Ctrl+C
echo.

npm run dev -- --port 3000
