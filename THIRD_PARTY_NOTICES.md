# Third-party notices

本仓库只发布项目源码、测试、配置空白示例及自制 SVG。依赖代码由 npm 根据锁文件从原始包来源安装，node_modules、构建包、模型权重和数据集不随本仓库分发；保留依赖自身的许可证与版权声明。

## 直接依赖

| 组件 | 锁定版本 | 许可证 | 来源与用途 |
| --- | --- | --- | --- |
| React / React DOM | 19.3.0 | MIT | [React](https://github.com/facebook/react)，界面与渲染 |
| @phosphor-icons/react | 2.1.10 | MIT | [Phosphor](https://github.com/phosphor-icons/react)，界面图标 |
| react-markdown | 10.1.0 | MIT | [react-markdown](https://github.com/remarkjs/react-markdown)，受限 Markdown 渲染 |
| remark-gfm | 4.0.1 | MIT | [remark-gfm](https://github.com/remarkjs/remark-gfm)，Markdown 扩展 |
| Vite | 8.3.0 | MIT | [Vite](https://github.com/vitejs/vite)，开发与构建 |
| Node.js | 运行环境，发布验证使用 24.14.0 | Node.js 原有许可及附属组件许可 | [Node.js](https://github.com/nodejs/node)，本机运行，不随源码分发 |

完整锁文件共记录 146 个依赖条目（含可选平台包），许可证字段为 MIT、ISC、Apache-2.0、MPL-2.0 或 BSD-3-Clause。[依赖清单](docs/dependency-inventory.json)逐项记录名称、版本、来源、完整性和许可字段。该清单根据 package-lock.json 生成，后续更新依赖时应一并更新；实际包中的 LICENSE / NOTICE 保持其效力。本轮将 source-map-js 从 1.2.1 升级至 1.2.2，未改变直接依赖体系。

## 模型与检索服务

Qwen、DeepSeek 为使用者配置的远端推理服务；Coze 是现有检索适配器所兼容的一种服务，亦可使用同样 JSON 契约的自有服务。本仓库不包含它们的模型参数、账户、密钥、特定型号或第三方服务代码。型号、调用费用和使用权限以提供方当前文档及条款为准：

- [阿里云模型服务文档](https://help.aliyun.com/zh/model-studio/)
- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [Coze](https://www.coze.com/)

检索结果的文献原文仍适用其来源许可，不因被检索或写入病例就获得再分发授权。公开仓库仅保留空的兼容知识列表，不附带论文全文或外部知识库资料。

## 数据、字体和展示素材

- 原安装的 fish-pool.png、brand-mark.png 和 demo-loop.mp4 未核实再分发许可，全部排除。
- 公开版 pond-demo.svg / brand-mark.svg 是为净化副本新绘制的几何示意，来源见 frontend/public/assets/README.md。示意不代表真实鱼体照片、监控视频或疾病证据。
- 演示病例由源码构造，明确是虚构流程数据；未附带个人病例、联系方式、养殖场数据或真实摄像头附件。
- 界面使用操作系统字体，不打包字体文件。
- 未附带鱼病分类购买数据集、外部验证数据或 ResNet50 / CA 模型权重。

项目自有代码没有在本次发布中新增开源许可证；不将第三方资源统称为项目原创，也不修改它们的署名或原有授权。
