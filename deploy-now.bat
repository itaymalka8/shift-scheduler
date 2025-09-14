@echo off
echo מעלה את השינויים ל-GitHub...
git add .
git commit -m "Add interactive welcome screen and fix deployment"
git push
echo.
echo השינויים הועלו ל-GitHub!
echo.
echo עכשיו Render יתחיל לבנות את האפליקציה החדשה...
echo.
echo הכתובת של האפליקציה: https://shift-scheduler-frontend-6erj.onrender.com
echo.
echo לחץ על כל מקש כדי לסגור...
pause > nul
