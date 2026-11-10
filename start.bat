@echo off
rem Burggolf am PC starten: Doppelklick auf diese Datei.
rem Das Fenster offen lassen, solange gespielt wird.
cd /d "%~dp0"
start "" http://localhost:8770/
python -m http.server 8770
