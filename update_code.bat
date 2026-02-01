@echo off
echo STARTING GIT PULL > update.log
git pull >> update.log 2>&1
echo FINISHED GIT PULL >> update.log
type update.log
