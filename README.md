# AquaAgent

水产病害观察、人工核对与病例随访的本地多角色 Agent 平台。本仓库发布的是既有 **fool fish** 项目的净化源码副本，界面保留原品牌；采用 React / Vite、Node.js 和本地 JSON 文件存储。

## 已实现的功能

- 普通问答由 Qwen 主 Agent 处理，可按需要调用 `search_fish_knowledge`。工具名称、参数、引用编号和调用预算均由后端校验。
- 图像观察依次执行 Qwen 可见特征提取、条件触发的资料检索、Qwen 综合分析和 DeepSeek 建议。任务最多两次检索，主 Agent 工具循环最多三回合；后端拒绝不存在的引用编号，引用内容是否受到原文支持仍需核对。
- 真实任务支持取消、人工核对、补充证据、事件结束和重新打开。病例支持建档、关联已核对的任务、复查、附件、结案和重新观察。
- 浏览器摄像头可预览和抽帧；自动提交默认关闭，只在页面可见时执行，每分钟最多一张、每次连接最多十张。
- 本机会话、来源校验、CSRF、幂等请求、版本冲突与附件校验。服务器仅监听 `127.0.0.1`。

巡检工作台中的池塘、事件和计划是明确标注的浏览器演示数据。Agent、图像审计和真实病例使用独立后端存储。公开版的池塘图为自制静态示意，不能作为鱼病证据；没有附带原始演示视频。

## 安装与启动

建议使用 Node.js 24 LTS；最低版本为 22.12。后端只使用 Node 内建模块。

```powershell
git clone https://github.com/fyfyuzhouwudi-boop/AquaAgent.git
cd AquaAgent\frontend
npm.cmd ci
```

返回仓库根目录，双击 `启动平台.cmd`，打开 `http://127.0.0.1:4173/`。启动脚本使用本机端口 8000 和 4173；如果被其他服务占用，会报错而不停止其他进程。运行日志保存在 `.runtime/`。

也可以在两个终端分别启动：

```powershell
# 终端一，在仓库根目录执行
cd backend
npm.cmd start
```

```powershell
# 终端二，在仓库根目录执行
cd frontend
npm.cmd run dev
```

缺少云端配置时仍可查看演示和空病例列表，真实模型任务会明确报配置错误，不会用模拟回答冒充真实调用。

## 配置

将 `backend/.env.example` 复制为 `backend/.env`，填写自己有权使用的服务地址、模型 ID 和密钥。双击 `配置模型.cmd` 也可创建并打开本地配置。服务端环境变量优先于文件值；显式空环境变量可禁用相应配置。

- `QWEN_BASE_URL` / `QWEN_MODEL` / `QWEN_API_KEY`：OpenAI 兼容协议；图像任务需要支持图像输入的模型。
- `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` / `DEEPSEEK_API_KEY`：OpenAI 兼容协议。
- 可选检索：`RAG_SEARCH_URL`、`RAG_ALLOWED_ORIGIN`、`RAG_API_KEY`。允许来源须为精确 HTTPS origin，例如 `https://knowledge.example.org`，并与请求地址匹配；禁止重定向。协议见 [配置说明](docs/configuration.md)。

型号和服务地址由服务提供方当前文档确认，本仓库不代填账号或密钥。密钥只进入服务端，不能放入 `VITE_` 变量。提交真实图像前，页面要求明确同意云端处理；上游服务可能计费。

## 检查

```powershell
cd backend
npm.cmd test
cd ..\frontend
npm.cmd test
npm.cmd run build
npm.cmd audit
```

测试使用隔离的文件状态与模型 / 检索替身，验证权限、状态迁移、取消、请求校验及错误处理；不等于真实服务连通、病原确诊或分类准确率验收。

## 限制与资料

当前是本机单人应用，没有多人账号体系、MySQL、后台全天摄像头调度、自动治疗或养殖设备控制。尚未接入另一个鱼病分类训练项目的 ResNet50 模型。输出用于辅助观察与专业人员核对，不构成病原学确诊。

本仓库不包含真实配置、病例、任务历史、附件、日志、数据集、模型权重、论文全文、内部交接或软著材料。第三方依赖和远端服务见 [第三方说明](THIRD_PARTY_NOTICES.md)，作品定位见 [项目介绍](docs/project-introduction.md)。

本次公开发布没有为项目自有源码新增开源许可证；公开可见不代表已授予任意再分发许可。第三方组件继续适用各自原有许可证。
