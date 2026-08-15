# USA零 文档索引

## 项目介绍

- [快速开始](/zh-CN/docs/overview/quick-start)
- [功能介绍](/zh-CN/docs/overview/features)
- [Render 部署](/zh-CN/docs/overview/render)
- [Docker 部署](/zh-CN/docs/overview/docker)
- [第三方 GitHub 提示词仓库](/zh-CN/docs/overview/third-party-prompt-repositories)

## 操作手册

- [画布节点操作手册](/zh-CN/docs/canvas/canvas-node-manual)
- [画布快捷键](/zh-CN/docs/canvas/canvas-shortcuts)

## 开发与数据

- [本地开发](/zh-CN/docs/development/local-development)
- [画布数据结构](/zh-CN/docs/development/canvas-data-structure)
- [sub2api OAuth Key 管理线上变更说明](sub2api-oauth-key-management-deployment.md)

## 商务合作

- [开源协议](/zh-CN/docs/business/license)
- [商务合作](/zh-CN/docs/business/business)

## 支持与安全

- [漏洞提交](/zh-CN/docs/support/security)
- [赞助支持](/zh-CN/docs/support/sponsor)

## 项目进度

- [更新日志](/zh-CN/docs/progress/changelog)
- [待测试](/zh-CN/docs/progress/pending-test)
- [TODO](/zh-CN/docs/progress/todo)

## 说明

- 所有业务页面都需要 USA零 OAuth。官网登录 Cookie 只在官网同源的 `/oauth/authorize` 页面自然复用，画布不会读取或传输官网 Cookie 或网站 Token。
- 官网全部 Key 会自动同步为独立模型来源，同名模型也按 Key 区分。没有 Key 的用户需要在“账号管理”中选择官网分组并创建；创建和删除会直接更新作为数据源的官网。
- 不提供自定义、本地渠道或手工接口凭证配置，官网完整 Key 只保留在运行期内存。
- 当前画布项目和“我的素材”主要保存在浏览器本地，跨设备可自行配置 WebDAV 同步。
- 生产 OAuth 需要稳定的 HTTPS 画布来源，并由外部官方服务登记精确的 CORS 来源和 `<来源>/oauth/callback` 回调地址；不支持通配符或随机预览域名。

## 原理说明

- [本地 Codex 连接画布原理](/zh-CN/docs/development/local-codex-canvas)
