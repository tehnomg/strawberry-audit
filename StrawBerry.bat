@echo off
call C:\ProgramData\miniconda3\Scripts\activate.bat strawberry
cd /d G:\Strawberry

uvicorn history-server:app --host 127.0.0.1 --port 8088

pause