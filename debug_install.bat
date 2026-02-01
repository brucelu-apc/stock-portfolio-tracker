@echo off
echo STARTING DEBUG > debug_log.txt
echo CHECKING NPM VERSION >> debug_log.txt
call npm --version >> debug_log.txt 2>&1
echo INSTALLING DEPENDENCIES >> debug_log.txt
call npm install --verbose >> debug_log.txt 2>&1
echo FINISHED >> debug_log.txt
