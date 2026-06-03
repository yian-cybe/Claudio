@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Claudio 个人 AI 电台 — 一键启动
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 未检测到 Node.js，请先安装 Node.js ^>= 20
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo [OK] Node.js: %%i

:: 检查 .env
if not exist ".env" (
    if exist ".env.example" (
        echo [WARN] .env 不存在，从 .env.example 复制模板...
        copy .env.example .env >nul
        echo [INFO] 已创建 .env，请编辑并填入 API Key 后重新运行
        start notepad .env
        echo.
        echo 按任意键继续启动（使用默认配置）...
        pause >nul
    ) else (
        echo [WARN] 未找到 .env 或 .env.example，将使用默认配置
    )
)

:: 检查依赖
if not exist "node_modules" (
    echo [INFO] 正在安装依赖...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] 依赖安装失败
        pause
        exit /b 1
    )
)

:: 启动服务
echo.
echo [Claudio] 正在启动服务...
start "Claudio Server" cmd /k "npm start"

echo [Claudio] 等待服务就绪...
timeout /t 3 /nobreak >nul

echo [Claudio] 打开浏览器 http://127.0.0.1:8080
start "" "http://127.0.0.1:8080"

echo.
echo 提示:
echo   - 浏览器访问: http://127.0.0.1:8080
echo   - API 文档见: README.md
echo   - 按 Ctrl+C 关闭服务
echo   - 运行测试: npm test
echo.

pause
