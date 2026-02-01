@echo off
chcp 65001 > NUL
echo ========================================
echo  Git Push Script - Stock Portfolio Tracker
echo ========================================

:: Prompt for commit message
set /p msg="Enter commit message (or press Enter for default): "

:: Use default message if empty
if "%msg%"=="" set msg=Update code changes

echo.
echo Adding all changes...
git add -A

echo.
echo Committing with message: %msg%
git commit -m "%msg%"

echo.
echo Pulling latest changes from remote...
git pull origin master --rebase

echo.
echo Pushing to GitHub...
git push origin master

echo.
echo ========================================
echo  Done!
echo ========================================
pause
