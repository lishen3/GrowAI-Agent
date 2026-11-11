# GrowAI智能体

**AI WEB 网页开发挑战赛 · 方向一「AI Agent 智能助手」**

把一句“明天下午练听力30分钟”变成日历里的一次练习。GrowAI 根据当前阶段、已有任务和课表提出时间建议，由学生确认后写入日历。练习完成后记录实际用时，周末可以结合执行记录生成复盘。

**[下载 Windows 压缩包](https://github.com/lishen3/GrowAI-Agent/raw/refs/heads/main/downloads/GrowAI-Windows-x64.zip)**　·　[Windows 使用说明](docs/Windows使用说明.md)　·　[阅读作品技术文档（PDF）](docs/GrowAI-Agent.pdf)

## Windows 快速体验

1. 下载压缩包，右键选择 **全部解压**。进入解压后的 `GrowAI` 文件夹。
2. 双击 **Start-GrowAI.cmd**，保持窗口打开。浏览器会打开智能体；也可以手动访问 `http://localhost:8081/coach`。
3. 打开 **更多选项 → 查看本周状态**，即可体验本地数据读取。要生成 AI 建议，先关闭启动窗口，双击 **Configure-AI.cmd** 填入自己的 DeepSeek API Key，再重新启动。
4. 输入“明天下午练听力30分钟”，发送并核对建议。点 **确认并添加 → 查看当天日历**，即可看到这次安排。

Windows x64 包内含运行环境。关掉服务窗口即可退出。iPhone 和 Android 的私有网络访问方法见[手机使用说明](docs/手机使用.md)。

## 作品功能

| 入口 | 可以做什么 |
| --- | --- |
| 今日 | 查看当天待办，登记完成情况、实际用时和成果 |
| 计划 | 查看周历或月历，导入课程表，安排任务或临时日程 |
| 智能体 | 用自然语言安排任务、移动时间块、读取本周状态并生成复盘 |
| 我的 | 管理当前阶段、长期目标和业务数据备份 |

## 源码与运行

前端采用 Expo Router、React Native 与 TypeScript，Web 使用 IndexedDB 保存个人记录。Python/FastAPI 后端负责模型调用和结构校验。密钥在本机后端配置。

如需从源码运行，请安装 Node.js 24 和 Python 3.12。在项目根目录打开两个 PowerShell 窗口。首次安装时执行以下命令，已有配置请保留。

**前端**

```powershell
npm ci
Copy-Item .env.example .env
npm run start -- --web --port 8081
```

**后端**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# 在本机编辑 backend/.env 填写模型配置
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

应用界面位于 `app/`，排程、复盘和数据访问位于 `src/`，模型接口位于 `backend/app/`，浏览器验收用例位于 `e2e/`。
