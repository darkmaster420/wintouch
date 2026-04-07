@echo off
REM Build the gesture helper exe using MSVC (cl.exe)
REM Run from a Visual Studio Developer Command Prompt, or after running vcvarsall.bat

pushd %~dp0

cl.exe /O2 /DNDEBUG /W4 /EHsc ^
  /Fe:gesture.exe gesture.cpp ^
  /link /SUBSYSTEM:WINDOWS user32.lib gdi32.lib gdiplus.lib

if %ERRORLEVEL% equ 0 (
    echo.
    echo Built: gesture.exe
    del gesture.obj 2>nul
) else (
    echo Build failed.
)

popd
