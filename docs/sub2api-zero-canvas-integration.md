# sub2api 与 USA零画布 OAuth 对接变更说明

本文档供外部 `sub2api` 项目维护人员设计、实现和验收 USA零画布集成。文中接口与文件清单均为待实施要求，不表示 `sub2api` 当前已经支持。

目标是复用 `sub2api` 现有 OAuth 2.0 Authorization Code + PKCE、用户登录和模型网关，使浏览器中的 USA零画布能够读取用户资料与分组，读取、创建和删除用户 API Key，并把用户的多个 Key 同步为模型来源。

## 1. 对接边界与地址

### 服务地址

- 生产环境默认控制面和模型网关 Base URL：`https://usa0.top`。
- Base URL 由部署配置提供，生产默认值不得影响开发环境替换服务地址；不再向用户提供可创建任意第三方渠道的编辑入口。
- `zero-canvas-web` 必须维护显式的画布 Origin 与回调注册表。每个正式部署的 HTTPS Origin 都要逐项注册，并只允许对应的精确回调 `<已注册 HTTPS Origin>/oauth/callback`。
- 本地开发只额外允许显式注册的 loopback HTTP 地址，例如 `http://localhost:3000`、`http://127.0.0.1:3000` 及其精确 `/oauth/callback`；端口也是匹配的一部分。
- HTTPS 部署和 loopback HTTP 均不得由通配符、正则、后缀、子域名继承、preview 域名模式或请求 Origin 反射自动放行。未注册的预览部署、其他端口、局域网 IP、`null` Origin、附加查询参数和片段一律拒绝。
- 正式环境实际使用的每个 HTTPS 画布 Origin 与回调必须先进入服务端配置和 OAuth 客户端注册，不能仅因使用 HTTPS 就获得访问权限。

### 复用的现有能力

| 用途 | 接口 |
| --- | --- |
| 创建授权请求 | `POST /api/v1/app-auth/authorize/requests` |
| 用户授权页面 | `GET /oauth/authorize` |
| code 换取 token、刷新 token | `POST /api/v1/app-auth/token` |
| 撤销授权 token | `POST /api/v1/app-auth/revoke` |
| 读取用户资料 | `GET /api/v1/app/me` |
| 查询每个 API Key 可用模型 | `GET /v1/models` |
| 查询每个 API Key 的余额、额度与 Token 用量 | `GET /v1/usage` |
| 文本、图片和视频调用 | 现有 `/v1/*` 模型网关接口 |

### 本次控制面契约

| 用途 | 接口 | Scope |
| --- | --- | --- |
| 读取可选分组 | `GET /api/v1/app/groups` | `groups:read` |
| 读取用户所有 API Key | `GET /api/v1/app/keys` | `keys:read` |
| 为用户创建 API Key | `POST /api/v1/app/groups/:groupId/keys` | `keys:write` |
| 删除用户 API Key | `DELETE /api/v1/app/keys/:id` | `keys:write` |

不新增账号密码、TOTP、第三方 OAuth、Passkey、access token、refresh token、授权记录或设备会话系统。不新增画布专用模型接口或 `models:read` scope；模型范围继续由每个 API Key 调用现有 `GET /v1/models` 得到。

## 2. OAuth 客户端与权限

在 `sub2api` 现有 OAuth public client 注册中增加 `zero-canvas-web`，允许且仅允许以下 scope：

```text
profile:read groups:read keys:read keys:write offline_access
```

Go 配置示意如下，实际名称应服从 `sub2api` 现有结构：

```go
var zeroCanvasAllowedScopes = map[string]struct{}{
    "profile:read":   {},
    "groups:read":    {},
    "keys:read":      {},
    "keys:write":     {},
    "offline_access": {},
}

"zero-canvas-web": {
    ID:               "zero-canvas-web",
    Platform:         "web",
    Name:             "USA零网页画布",
    AllowedScopes:    zeroCanvasAllowedScopes,
    ValidateRedirect: validateZeroCanvasRedirect,
}
```

客户端要求：

- `Confidential` 为 `false`，不得要求、嵌入或下发 client secret。
- 必须要求 S256 PKCE、`state` 和 `installation_id`。
- `redirect_uri` 必须是第 1 节显式注册的精确回调之一；其 Origin 必须同时属于同一客户端的已注册画布 Origin。
- access token 必须包含实际获批 scope；每个控制面接口必须在服务端校验相应 scope，不能只依赖前端隐藏入口。
- 保留现有 refresh token 轮换、重用检测、撤销和设备会话规则。
- 现有其他 OAuth 客户端及其 scope 不因本次集成扩大。

画布发起授权时使用：

```text
response_type=code
client_id=zero-canvas-web
redirect_uri=http://localhost:3000/oauth/callback
scope=profile:read groups:read keys:read keys:write offline_access
code_challenge=<S256 challenge>
code_challenge_method=S256
state=<cryptographically random state>
installation_id=<stable installation id>
device_name=USA零网页画布
platform=web
```

画布使用当前页面精确 Origin 生成 `/oauth/callback`。该地址只有在 HTTPS 部署 Origin 或 loopback HTTP Origin 已显式注册时才有效；不能把任意当前 Origin 动态视为可信回调。

### 授权请求预登录引导

`POST /api/v1/app-auth/authorize/requests` 是画布在用户进入官网登录流程前调用的公开引导接口。前端调用与后续顶层导航固定为：

1. 画布跨域 `POST /api/v1/app-auth/authorize/requests`，请求体携带上文完整授权参数，明确使用 `credentials: "omit"` / `withCredentials: false`。
2. 该请求不得携带 `Cookie` 或 `Authorization: Bearer`，服务端也不得要求用户已登录；它不是 `/api/v1/app/*` 控制面 Bearer 接口。
3. 服务端逐项校验请求 `Origin`、`client_id`、`redirect_uri`、`response_type=code`、完整 scope 集合和客户端注册的对应关系。`redirect_uri` 必须逐字匹配注册值，且其 Origin 必须与请求 Origin 和客户端注册一致。
4. 仅接受 `code_challenge_method=S256`，拒绝 `plain`、缺失方法和未知方法；`state`、`code_challenge`、`installation_id`、`device_name`、`platform`、scope 及整体 JSON 必须有明确的类型、字符和长度上限。
5. 成功时返回密码学随机、不可推断、短时有效且一次性使用的 opaque `request_id`。服务端记录必须把它绑定到原始客户端、精确 Origin/回调、scope、state、S256 challenge、installation 与设备参数，客户端不能通过后续 URL 改写这些值。
6. 画布随后只执行顶层导航 `https://usa0.top/oauth/authorize?request_id=<opaque value>`，URL 不再重复携带 client、redirect、scope、state 或 PKCE 参数。
7. `/oauth/authorize` 只能使用 USA零官网同源、`Secure`、`HttpOnly` 的登录 Cookie，重新读取并完整校验 `request_id` 记录、有效期、一次性状态和绑定参数；登录、同意及签发 code 前都不能信任浏览器重新提交的授权参数。
8. `request_id` 在授权成功、拒绝或超时后不可重放；授权 code 仍须绑定同一请求参数、用户和 PKCE verifier，并保持短期、单次兑换。

引导接口必须按精确 Origin 与客户端限速，限制未完成请求数量，并设置 `Cache-Control: no-store`。请求体、`request_id`、state、PKCE challenge、Cookie、Token 和完整 Key 均不得进入访问日志、错误追踪正文、分析事件或代理缓存；错误只返回稳定机器码和不含敏感参数的说明。

## 3. 鉴权与 Cookie 边界

除公开的 `POST /api/v1/app-auth/authorize/requests` 外，所有 `/api/v1/app/*` 控制面请求必须使用应用 OAuth access token：

```http
Authorization: Bearer <oauth_access_token>
```

必须遵守以下边界：

- `GET /api/v1/app/me`、`GET /api/v1/app/groups`、`GET /api/v1/app/keys`、`POST /api/v1/app/groups/:groupId/keys` 和 `DELETE /api/v1/app/keys/:id` 均不得接受官网登录 Cookie 作为认证兜底。
- 授权请求引导、token、revoke、控制面和模型网关的浏览器跨域调用均不得发送 Cookie；前端必须使用 `credentials: "omit"` / `withCredentials: false`，服务端不得返回 `Access-Control-Allow-Credentials: true`。
- `sub2api` 官网登录 Cookie 只能在 `https://usa0.top/oauth/authorize?request_id=...` 顶层导航及其同源登录、授权确认流程中使用，并且必须是官网正式会话的 `HttpOnly` Cookie。
- 官网 Cookie 不得复制给画布，不得通过跨域 XHR/fetch、URL、`postMessage` 或接口响应传给本地 Origin。
- 模型网关 `/v1/*` 继续使用具体 API Key 的 Bearer 鉴权，不使用 OAuth access token 或官网登录 Cookie。

OAuth access token 与 API Key 是两种独立凭据。控制面 Bearer token 用于管理当前用户的资源；完整 API Key 仅用于查询该 Key 的模型、用量以及发起模型调用。

## 4. 控制面 API 契约

### 通用规则

- 请求和响应使用 `application/json; charset=utf-8`，无响应体的删除成功除外。
- 列表接口延用 `sub2api` 已有分页格式；如果当前没有统一格式，应使用 `page`、`page_size`，并返回 `items`、`page`、`page_size`、`total`。
- `page_size` 最大值应允许画布可靠拉取全部 Key 和可选分组；画布必须遍历分页，不能假定只有第一页。
- 资源查询、创建和删除都必须限定为 access token 对应的当前用户，禁止仅凭资源 ID 跨用户访问。
- 时间字段统一使用 RFC 3339；金额、配额和状态字段延用现有 Key/分组数据模型。
- 错误响应采用第 7 节的统一结构。

### `GET /api/v1/app/groups`

用途：返回当前用户创建 Key 时可选择的分组，不应泄露仅供管理员或其他用户使用的分组。

```http
GET /api/v1/app/groups?page=1&page_size=100
Authorization: Bearer <oauth_access_token>
```

至少返回画布创建 Key 所需字段：

```json
{
  "items": [
    {
      "id": 2,
      "name": "Default",
      "platform": "openai",
      "status": "active"
    }
  ],
  "page": 1,
  "page_size": 100,
  "total": 1
}
```

只返回当前用户有权使用且可创建 Key 的分组。停用、删除、不可见或禁止新建 Key 的分组不得作为可选项返回。

### `GET /api/v1/app/keys`

用途：分页返回当前用户的全部 API Key。画布会同步所有有效 Key，而不是要求用户只选择一个 Key。

```http
GET /api/v1/app/keys?page=1&page_size=100
Authorization: Bearer <oauth_access_token>
```

至少返回：

```json
{
  "items": [
    {
      "id": 1,
      "key": "<完整 API Key>",
      "name": "USA零画布",
      "group_id": 2,
      "status": "active",
      "quota": 0,
      "quota_used": 0,
      "expires_at": null,
      "created_at": "2026-01-01T00:00:00Z",
      "group": {
        "id": 2,
        "name": "Default",
        "platform": "openai"
      }
    }
  ],
  "page": 1,
  "page_size": 100,
  "total": 1
}
```

`key` 必须是可直接用于模型网关 Bearer 鉴权的完整值。该高敏感字段仅能返回给拥有 `keys:read` 的当前用户应用会话，响应不得进入服务端访问日志、错误追踪正文或代理缓存。

### `POST /api/v1/app/groups/:groupId/keys`

用途：由用户在「账户管理」中明确选择分组并执行创建。即使账号没有任何可用 Key，画布也不得自动选择分组、自动创建或在同步失败后补建；创建和删除都以官网资源为准。

请求必须包含高熵、不可预测且在一次逻辑创建操作重试期间保持不变的 `Idempotency-Key`：

```http
POST /api/v1/app/groups/2/keys
Authorization: Bearer <oauth_access_token>
Content-Type: application/json
Idempotency-Key: 018f6f3e-4f9e-7d2a-9a23-1c8bb8e2b671

{
  "name": "USA零画布"
}
```

创建成功沿用现有 App 控制面 envelope，返回 `200 OK` 和完整 Key 资源，结构与列表项一致。服务端必须实现以下幂等语义：

- 幂等键的作用域至少包含当前用户和该接口，不能在不同用户之间共享结果。
- 首次请求原子地创建 Key，并保存请求指纹、状态码和不含完整凭据的重放引用；完整 Key 仍只保存在原 Key 资源中。
- 相同用户、相同 `Idempotency-Key`、相同请求体的重复请求不得创建第二个 Key，必须返回与首次创建相同的状态码和同一 Key 结果，包括相同 `id` 与完整 `key`。
- 相同用户、相同 `Idempotency-Key` 但分组 ID 或请求体不同，返回 `409 idempotency_key_conflict`。
- 并发重复请求必须收敛到一个创建结果，不能依赖先查后写的竞态实现。
- 幂等记录的保留时间不得短于 24 小时；过期策略应文档化并设置存储清理机制。
- 缺少或为空的 `Idempotency-Key` 返回 `400 idempotency_key_required`；格式非法返回 `400 idempotency_key_invalid`。

创建前必须验证 `group_id` 属于 `GET /api/v1/app/groups` 对当前用户可返回的可用分组。名称应应用现有长度和字符规则；不得允许客户端指定所有者、完整 Key、已用配额或其他服务端字段。

### `DELETE /api/v1/app/keys/:id`

用途：删除当前用户指定的 API Key。

```http
DELETE /api/v1/app/keys/1
Authorization: Bearer <oauth_access_token>
```

删除必须幂等：

- Key 存在且属于当前用户时删除并返回 `204 No Content`。
- 同一用户重复删除同一 ID 时仍返回 `204 No Content`。
- 为避免资源枚举，资源不存在、已经删除或不属于当前用户时统一返回 `204 No Content`。
- 删除完成后，该 Key 必须无法继续调用模型网关；相关缓存应同步失效。
- 非法 ID 格式返回 `400 invalid_key_id`；无效 token 或缺少 scope 仍按正常鉴权错误返回，不能伪装成成功。

## 5. 画布同步与创建流程

授权成功后，画布按以下顺序工作：

1. 使用 OAuth Bearer token 请求 `GET /api/v1/app/me`。
2. 遍历 `GET /api/v1/app/keys` 的全部分页。
3. 对每个启用、未过期、未耗尽且分组有效的 Key，分别使用该 API Key 请求 `GET /v1/models`。
4. 将每个 Key 及其模型集合独立同步为模型来源；来源标识必须包含稳定的 Key ID，不能按模型名把不同 Key 合并成一个来源。
5. 单个 Key 查询失败只标记该来源异常，不应阻断其他 Key 同步。
6. 用户查看某个来源的额度时，使用该来源对应 API Key 请求 `/v1/usage?days=30&timezone=<浏览器时区>`。

当账号没有任何可用 Key 时，画布进入「需要 Key」状态并打开「账户管理」，但不得自动创建。只有用户明确进入创建流程、从完整分组分页中选择一个可用分组并确认后，画布才生成新的 `Idempotency-Key` 并调用 `POST /api/v1/app/groups/:groupId/keys`。网络超时或结果不确定时，必须保持原 `Idempotency-Key` 和完全相同请求体重试；创建结果确认后再以官网完整 Key 快照重新同步。

如果没有可用分组，画布应展示可恢复错误并停止创建，不得反复提交请求。用户删除 Key 后应先立即移除该官网来源，再重新同步官网快照；删除已成功但重新同步失败时不得把已删除来源恢复，也不得自动新建替代 Key。官网是账号、分组、Key 创建与删除状态的唯一事实来源，本地摘要、缓存模型和运行时凭据不得反向覆盖官网。

`/v1/models` 和 `/v1/usage` 的平台、模型、余额与额度语义继续由现有 API Key 网关决定。用量属于单个 Key，不得展示为账号全局或跨 Key 汇总值。

## 6. CORS 契约

浏览器从已注册的正式 HTTPS 或 loopback HTTP 画布 Origin 直接访问生产默认地址 `https://usa0.top`。以下路径必须由同一套精确白名单 CORS 中间件覆盖：

```text
/api/v1/app-auth/authorize/requests
/api/v1/app-auth/token
/api/v1/app-auth/revoke
/api/v1/app/me
/api/v1/app/groups
/api/v1/app/groups/*/keys
/api/v1/app/keys
/api/v1/app/keys/*
/v1/models
/v1/usage
/v1/chat/completions
/v1/images/*
/v1/videos/*
以及画布实际调用的其他 /v1/* 模型路径
```

预检和实际响应要求：

```text
Access-Control-Allow-Origin: <与请求完全一致的允许 Origin>
Vary: Origin
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key
Access-Control-Max-Age: <服务端合理配置值>
```

- 允许 Origin 仅为 `zero-canvas-web` 显式注册的正式 HTTPS 画布 Origin 和显式注册的 loopback HTTP Origin；服务端配置必须逐项列出实际部署值。
- 禁止 `Access-Control-Allow-Origin: *`，禁止正则、preview 模式、后缀或子域名匹配，禁止反射任意 Origin，并明确拒绝 `null` Origin。
- 不设置 `Access-Control-Allow-Credentials: true`；实际跨域请求不得依赖 Cookie。
- OPTIONS 应在认证和 CSRF 检查前处理，不要求 Bearer token，并返回 `204 No Content` 或现有中间件约定的成功状态。
- 不允许的 Origin 不得获得任何 `Access-Control-Allow-Origin` 响应头。
- 反向代理、CDN 与应用服务必须保持相同策略，不得拦截 OPTIONS 或覆盖应用返回的 Origin。

配置示例（正式 HTTPS Origin 仅作占位，部署时替换为实际逐项注册值）：

```text
CORS_ALLOWED_ORIGINS=https://<正式画布域名>,http://localhost:3000,http://127.0.0.1:3000
OAUTH_ZERO_CANVAS_REDIRECT_URIS=https://<正式画布域名>/oauth/callback,http://localhost:3000/oauth/callback,http://127.0.0.1:3000/oauth/callback
```

配置加载器应按 `sub2api` 现有配置规范解析逗号分隔值、去除首尾空白、去重并拒绝空项或非法 Origin。不得因为环境变量缺失而回退到 `*`，也不得把未逐项注册的 preview 或同后缀域名视为有效。

## 7. 状态码与错误码

非 `204` 错误统一返回 JSON，至少包含稳定机器码和可读描述：

```json
{
  "success": false,
  "message": "Required scope is missing",
  "error": {
    "code": "insufficient_scope",
    "message": "Required scope is missing"
  }
}
```

| HTTP | `error.code` | 场景 |
| --- | --- | --- |
| `400` | `invalid_request` | JSON、分页参数或必填字段非法 |
| `400` | `idempotency_key_required` / `idempotency_key_invalid` | 创建 Key 缺少或使用非法幂等键 |
| `400` | `invalid_key_id` | 删除路径中的 Key ID 格式非法 |
| `401` | `invalid_token` | Bearer token 缺失、无效、过期或已撤销 |
| `403` | `insufficient_scope` | access token 缺少接口所需 scope |
| `403` | `group_not_available` | 分组对当前用户不可见或不可用于创建 Key |
| `409` | `idempotency_key_conflict` | 同一幂等键被用于不同创建参数 |
| `422` | `validation_error` | Key 名称等业务字段未通过校验 |
| `429` | `rate_limited` | 用户或客户端超过速率限制 |
| `500` | `internal_error` | 未分类服务端错误，响应不得泄露内部细节 |
| `503` | `temporarily_unavailable` | 依赖或服务暂时不可用，可按退避策略重试 |

OAuth 授权与 token 接口继续遵循 OAuth 标准错误，例如 `invalid_client`、`invalid_scope`、`invalid_grant`。`DELETE` 对不存在或不属于当前用户的 Key 按第 4 节统一返回 `204`，不返回 `404`。

错误响应不得包含 access token、refresh token、完整 API Key、Cookie、SQL 错误、堆栈或内部主机信息。可重试错误应通过 `Retry-After` 或现有标准字段明确重试时机。

## 8. 安全要求

- OAuth code 必须一次性使用，并绑定 client、精确 redirect URI、PKCE verifier、授权用户和有效期。
- `state` 必须由画布验证；授权服务不得放宽 S256 PKCE。
- `keys:write` 是敏感权限，授权确认页应明确显示“读取、创建和删除 API Key”，不能只显示笼统的账号访问。
- 控制面接口同时校验 Bearer token、scope、当前用户资源归属和资源状态。
- Key 创建应使用密码学安全随机源，完整值只在受 `keys:read` 保护的响应中返回。
- access token、refresh token、完整 API Key 和 `Idempotency-Key` 不得写入 URL、应用日志、代理日志、分析事件、错误追踪正文或页面可见报错。
- Key 列表和创建响应应设置 `Cache-Control: no-store`；代理/CDN 不得缓存私有控制面响应。
- 控制面应设置按用户和客户端区分的速率限制；创建和删除需要更严格的写操作限制。
- 幂等记录必须保存请求体的规范化哈希或等价指纹，避免保存不必要的敏感请求内容；记录读取和写入必须原子化。
- 删除必须校验用户归属后执行，但对外统一成功以防枚举；安全审计日志可记录用户 ID、Key ID 和结果，不能记录完整 Key。
- 完整 Key 只能驻留画布当前账号的运行时内存。它不得进入 Zustand 或其他持久化状态、localStorage、IndexedDB/localforage（OAuth refresh token 专用会话库除外但其中仍不得保存 Key）、配置导入导出、WebDAV、生成记录、视频任务记录、画布节点或元数据、素材元数据、DOM/属性、URL/query/hash、剪贴板、下载文件、截图、日志、控制台、分析事件、错误对象/消息、BroadcastChannel、`postMessage`、Service Worker/Cache API、插件存储或插件 SDK/运行时上下文。
- 可持久化或跨上下文传递的模型来源只能包含官网账号 ID、稳定 Key ID、非敏感摘要、模型名及必要指纹；任何 Agent、插件和宿主扩展调用都必须由宿主在最后一刻按当前账号和精确来源解析凭据，SDK 不得读取、枚举或接收完整 Key。
- 官网登录 Cookie 应使用现有 `Secure`、`HttpOnly`、合理 `SameSite` 设置，仅服务同源官网流程；不得为了本集成放宽 Cookie 跨站策略。
- 所有生产通信使用 HTTPS；`http://localhost` 和 `http://127.0.0.1` 例外只适用于本地页面 Origin 和回调，不改变 `https://usa0.top` 服务地址。

## 9. curl 验收

以下命令用于外部 `sub2api` 完成实现后的验收，不表示当前环境已经通过。准备变量：

```bash
BASE_URL='https://usa0.top'
APP_TOKEN='<zero-canvas OAuth access token>'
API_KEY='<由 keys 接口返回的 API Key>'
```

### OAuth 客户端与 scope

预期返回 `201` 和 opaque `request_id`；scope 必须完整保留。该请求不带 Cookie 或 Bearer，并从已注册画布 Origin 发起：

```bash
curl -i "$BASE_URL/api/v1/app-auth/authorize/requests" \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  --data '{
    "response_type":"code",
    "client_id":"zero-canvas-web",
    "redirect_uri":"http://localhost:3000/oauth/callback",
    "scope":"profile:read groups:read keys:read keys:write offline_access",
    "state":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "code_challenge":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "code_challenge_method":"S256",
    "installation_id":"zero-canvas-check",
    "device_name":"USA零网页画布",
    "platform":"web"
  }'
```

确认引导请求在没有官网登录 Cookie 时仍可创建请求；如果违规附带 Cookie 或 Bearer，服务端必须拒绝，且不得用其认证。随后以顶层 `/oauth/authorize?request_id=...` 验证官网同源 `HttpOnly` Cookie 可复用、参数不能在 URL 改写、过期/已用/伪造 `request_id` 被拒绝。对未注册 Origin、redirect/client 不匹配、`plain` PKCE、缺失或超长字段、超限频率分别验收拒绝，并确认日志中没有请求体与敏感值。

另以缺少 `keys:write` 的 token 调用写接口，预期 `403 insufficient_scope`；以无效 token 调用任一控制面接口，预期 `401 invalid_token`。

### CORS 预检

允许 Origin 的响应应包含完全相同的 `Access-Control-Allow-Origin`、`Vary: Origin`，且不包含 `Access-Control-Allow-Credentials: true`：

```bash
curl -i -X OPTIONS "$BASE_URL/api/v1/app/groups" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'

curl -i -X OPTIONS "$BASE_URL/api/v1/app/groups/2/keys" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,idempotency-key'

curl -i -X OPTIONS "$BASE_URL/api/v1/app/keys/1" \
  -H 'Origin: http://127.0.0.1:3000' \
  -H 'Access-Control-Request-Method: DELETE' \
  -H 'Access-Control-Request-Headers: authorization'

curl -i -X OPTIONS "$BASE_URL/v1/models" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

对每个已注册正式 HTTPS 画布 Origin 和 loopback HTTP Origin 重复以上预检；响应必须精确回显该单一 Origin、`withCredentials` 保持关闭，并允许 `Idempotency-Key`。不允许 Origin 的响应不得包含 `Access-Control-Allow-Origin`：

```bash
curl -i -X OPTIONS "$BASE_URL/api/v1/app/keys" \
  -H 'Origin: http://localhost:3001' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

### 分组与 Key 列表

```bash
curl -i "$BASE_URL/api/v1/app/groups?page=1&page_size=100" \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Origin: http://localhost:3000'

curl -i "$BASE_URL/api/v1/app/keys?page=1&page_size=100" \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Origin: http://localhost:3000'
```

确认分组仅包含当前用户可用于创建 Key 的选项；Key 列表仅包含当前用户资源，且所有分页都能遍历。账号无可用 Key 时只能在「账户管理」明确选择分组并点击创建，不得自动创建或静默选择第一个分组。

### 创建幂等性

将 `group_id` 替换为分组接口返回的有效 ID，连续执行两次完全相同的命令：

```bash
curl -i -X POST "$BASE_URL/api/v1/app/groups/2/keys" \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -H 'Idempotency-Key: zero-canvas-acceptance-018f6f3e' \
  --data '{"name":"USA零画布验收"}'
```

两次都应返回首次创建的同一结果，状态码、`id` 和完整 `key` 相同，Key 总数只增加一个。随后保持幂等键不变但修改 `name` 或 URL 中的 `groupId`，预期 `409 idempotency_key_conflict`。省略 `Idempotency-Key`，预期 `400 idempotency_key_required`。

还应使用并发请求执行同一幂等键和请求体，确认只创建一个数据库资源，所有成功响应指向同一 `id`。

### 删除幂等性

将 ID 替换为验收创建的 Key ID，连续执行两次：

```bash
curl -i -X DELETE "$BASE_URL/api/v1/app/keys/123" \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Origin: http://localhost:3000'
```

两次均应返回 `204`。删除后使用该 Key 请求模型网关必须失败：

```bash
curl -i "$BASE_URL/v1/models" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Origin: http://localhost:3000'
```

另用当前用户不拥有的合法 Key ID 执行删除，外部响应仍应为 `204`，同时确认该用户不能实际删除其他用户的资源。

### Cookie 禁用与多 Key

- 只携带官网登录 Cookie、不带 OAuth Bearer token 请求 `/api/v1/app/keys`，预期 `401 invalid_token`。
- 携带有效 OAuth Bearer token 和无关 Cookie 请求控制面，认证结果只能由 Bearer token 决定。
- 浏览器网络面板中，跨域控制面、token 与模型网关请求都不得携带 Cookie。
- 准备至少两个有效 Key，逐个请求 `/v1/models`，确认画布创建两个独立模型来源；一个 Key 失败时另一个来源仍可用。
- 账号无可用 Key 时，确认画布只进入「需要 Key」并引导到「账户管理」；用户未明确选择分组并确认创建时不得发起创建请求。

## 10. 外部 sub2api 预计变更文件清单

以下是交给外部 `sub2api` 仓库维护者的预计清单。具体文件名可按其当前代码结构调整；该清单描述需要评估和实施的位置，不声称文件已经修改或功能已经实现。

### 必须评估并修改

```text
backend/internal/service/app_auth_service.go
backend/internal/service/app_auth_service_test.go
  注册 zero-canvas-web 与完整 scope，并实现公开授权请求的精确 Origin/client/redirect、S256、字段边界、一次性 request_id、限流和脱敏验证

backend/internal/handler/app_handler.go
backend/internal/handler/app_handler_test.go
backend/internal/router/router.go
  注册 groups、keys 列表/创建/删除路由，校验 Bearer token 与 scope

backend/internal/service/app_service.go
backend/internal/service/app_service_test.go
backend/internal/repository/api_key_repository.go
  实现用户资源过滤、可用分组读取、Key 创建和幂等删除

backend/internal/model/app_oauth.go
backend/internal/model/api_key.go
backend/internal/model/idempotency.go
backend/internal/repository/idempotency_repository.go
  按现有分层补充 scope、请求响应模型和持久化幂等记录；若已有通用幂等组件则复用，不重复建模

backend/internal/middleware/cors.go
backend/internal/middleware/cors_test.go
backend/internal/config/config.go
backend/internal/config/config_test.go
  加入精确 Origin、Idempotency-Key 请求头及新增路径的 CORS 验证

backend/migrations/*_app_key_idempotency.*
  如现有数据库没有通用幂等表，新增带用户/接口/幂等键唯一约束及过期时间的迁移

deploy/config.example.yaml
deploy/docker-compose.dev.yml
deploy/production/compose.yaml
  逐项配置正式 HTTPS 与 loopback HTTP 的允许 Origin 和精确回调，禁止通配符、preview、后缀或 `null` 回退
```

### 授权页必须同步确认

```text
frontend/src/views/AppAuthorizationView.vue
frontend/src/api/client.ts
frontend/src/utils/apiError.ts
frontend/src/i18n/locales/zh/dashboard.ts
frontend/src/i18n/locales/en/dashboard.ts
frontend/src/views/__tests__/AppAuthorizationView.spec.ts
  展示 USA零网页画布及 profile/groups/keys 读写权限，保持登录 Cookie 仅用于顶层同源授权流程
```

### 不应修改或另建

```text
现有用户密码、TOTP、第三方 OAuth 和 Passkey 登录实现
现有 app-auth code、token、refresh、revoke 协议主体
现有 /v1/models、/v1/usage 和模型网关业务语义
画布专用 access token、refresh token、模型接口或 Cookie 跨域认证方案
```

实施时应先在外部 `sub2api` 仓库核对真实目录和已有通用组件，再落定最终文件清单，避免仅按本文示意文件名机械新增重复模块。
