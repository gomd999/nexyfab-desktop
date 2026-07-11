@echo off
chcp 65001 >nul
rem ============================================================
rem  NexyFab 로컬 미리보기 — 배포 전 랜딩/페이지 확인용
rem  더블클릭하면 dev 서버가 뜨고, 준비되면 브라우저가 자동으로 열립니다.
rem  코드 수정하면 저장 즉시 브라우저에 반영(핫리로드)됩니다.
rem  종료: 이 창에서 Ctrl+C
rem ============================================================
cd /d "%~dp0"
echo.
echo  NexyFab 로컬 미리보기를 시작합니다...
echo  잠시 후 브라우저에 http://localhost:3000/kr 이 열립니다.
echo  (첫 화면 컴파일에 10~30초 걸릴 수 있음 — 흰 화면이면 새로고침)
echo.
start "" cmd /c "timeout /t 12 /nobreak >nul & start http://localhost:3000/kr"
npm run dev
