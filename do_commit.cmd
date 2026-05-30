@echo off
cd /d C:\Users\toiph\Downloads\Luna-Proxy-main\Luna-Proxy-main
git add -A
git commit -m "feat: support both bun:sqlite and node:sqlite with auto-detection"
git push origin master