# sub2api 与 USA零画布 OAuth 对接变更说明

本文档供 `usa0.top` 的 sub2api 维护人员实施和验收。目标是在不重写现有登录认证的前提下，让本地 USA零画布通过 sub2api 已有 OAuth 2.0 Authorization Code + PKCE 框架读取用户资料和已有 API Key，再使用该 Key 调用原生模型网关。

## 1. 对接范围

### 服务地址

- sub2api 控制面和模型网关：`https://usa0.top`
- USA零画布允许的本地地址：
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
- OAuth 回调地址：
  - `http://localhost:3000/oauth/callback`
  - `http://127.0.0.1:3000/oauth/callback`

### 复用的现有接口

| 用途 | 接口 |
| --- | --- |
| 创建授权请求 | `POST /api/v1/app-auth/authorize/requests` |
| 用户授权页面 | `GET /oauth/authorize` |
| code 换取 token、刷新 token | `POST /api/v1/app-auth/token` |
| 撤销授权 token | `POST /api/v1/app-auth/revoke` |
| 读取用户资料 | `GET /api/v1/app/me` |
| 读取用户已有 API Key | `GET /api/v1/app/keys` |
| 查询所选 Key 可用模型 | `GET /v1/models` |
| 文本、图片和视频调用 | 现有 `/v1/*` 网关接口 |

### 不需要新增的能力

- 不新增账号密码、TOTP、第三方 OAuth 或 Passkey 登录实现。
- 不新增另一套 access token、refresh token、授权记录或设备会话系统。
- 不新增 `GET /api/v1/app/keys/:id/models`。
- 不新增 `models:read` scope。
- 画布不创建、修改或删除网站 API Key，因此不授予 `keys:write`。

## 2. OAuth 客户端注册

在 sub2api 现有 `appOAuthClients` 中增加独立的 public client：

```go
var zeroCanvasAllowedScopes = map[string]struct{}{
    "profile:read":   {},
    "keys:read":      {},
    "offline_access": {},
}

var appOAuthClients = map[string]AppOAuthClient{
    // 保留现有 ZeroAgent 客户端。
    "zero-canvas-web": {
        ID:               "zero-canvas-web",
        Platform:         "web",
        Name:             "USA零网页画布",
        AllowedScopes:    zeroCanvasAllowedScopes,
        ValidateRedirect: validateZeroCanvasRedirect,
    },
}

func validateZeroCanvasRedirect(raw string) bool {
    return raw == "http://localhost:3000/oauth/callback" ||
        raw == "http://127.0.0.1:3000/oauth/callback"
}
```

要求：

- `Confidential` 保持默认 `false`，不得要求或下发 client secret。
- 必须继续要求 S256 PKCE、`state` 和 `installation_id`。
- 回调地址必须精确匹配，不能接受其他端口、查询参数、局域网 IP 或通配符。
- 该客户端只能申请 `profile:read keys:read offline_access`。
- 现有 `zeroagent-desktop`、`zeroagent-web` 和 `zeroagent-android` 保持不变。

对应文件：

```text
backend/internal/service/app_auth_service.go
backend/internal/service/app_auth_service_test.go
```

## 3. CORS 配置

Zero-canvas 是运行在浏览器中的静态前端，会从本地 Origin 直接访问 `https://usa0.top`。以下请求都必须通过 CORS：

- `/api/v1/app-auth/token`
- `/api/v1/app-auth/revoke`
- `/api/v1/app/me`
- `/api/v1/app/keys`
- `/v1/models`
- `/v1/chat/completions`、`/v1/images/*`、`/v1/videos/*` 等实际模型接口

### 环境变量解析

配置加载器应显式支持逗号分隔的环境变量：

```go
corsAllowedOriginsEnv, configured := os.LookupEnv("CORS_ALLOWED_ORIGINS")
if configured {
    cfg.CORS.AllowedOrigins = normalizeStringSlice(
        strings.Split(corsAllowedOriginsEnv, ","),
    )
}
```

生产环境配置：

```text
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Compose 示例：

```yaml
environment:
  CORS_ALLOWED_ORIGINS: "${CORS_ALLOWED_ORIGINS:-http://localhost:3000,http://127.0.0.1:3000}"
```

现有全局 CORS 中间件应继续允许：

```text
Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Headers: Content-Type, Authorization
```

不要使用 `*` 代替精确 Origin，尤其不要同时启用通配符和 credentials。

对应文件：

```text
backend/internal/config/config.go
backend/internal/config/config_test.go
deploy/config.example.yaml
deploy/docker-compose.dev.yml
deploy/production/compose.yaml
```

## 4. 授权页兼容调整

授权页继续使用 sub2api 原有登录态和授权确认流程：

1. 画布打开 `https://usa0.top/oauth/authorize`，携带完整 OAuth 和 PKCE 参数。
2. 授权页在 `usa0.top` 同源创建 authorization request。
3. 用户已登录时直接显示权限确认；未登录时跳转原生登录页。
4. 登录完成后返回同一授权请求。
5. 用户同意后跳回本地 `/oauth/callback`。

建议保留以下界面调整：

- `client_id=zero-canvas-web` 显示“USA零网页画布”。
- 正确解析 OAuth 标准错误字段 `error` 和 `error_description`。
- `invalid_client` 显示“授权服务尚未部署此应用客户端，请更新并重启 sub2api 服务”。

这些调整只改善显示和排错，不改变 OAuth 协议。

对应文件：

```text
frontend/src/views/AppAuthorizationView.vue
frontend/src/api/client.ts
frontend/src/utils/apiError.ts
frontend/src/i18n/locales/zh/dashboard.ts
frontend/src/i18n/locales/en/dashboard.ts
frontend/src/views/__tests__/AppAuthorizationView.spec.ts
```

## 5. Zero-canvas 请求参数

画布发起授权时使用：

```text
response_type=code
client_id=zero-canvas-web
redirect_uri=http://localhost:3000/oauth/callback
scope=profile:read keys:read offline_access
code_challenge=<S256 challenge>
code_challenge_method=S256
state=<random state>
installation_id=<stable installation id>
device_name=USA零网页画布
platform=web
```

如果画布运行在 `127.0.0.1:3000`，`redirect_uri` 使用对应的 `127.0.0.1` 地址。

画布不会读取或传递 `usa0.top` 的网站登录 token。网站登录态仅由授权页在同源环境中使用，画布最终只获得 `zero-canvas-web` 的应用 access/refresh token。

## 6. API Key 与模型调用流程

授权成功后的请求顺序：

```text
GET /api/v1/app/me
GET /api/v1/app/keys?page=1&page_size=100
用户选择一个启用、未过期、未耗尽且已绑定分组的 Key
GET /v1/models，Authorization 使用所选 API Key
```

`/api/v1/app/keys` 继续使用原有返回结构，画布需要以下字段：

```json
{
  "id": 1,
  "key": "<完整 API Key>",
  "name": "Canvas Key",
  "group_id": 2,
  "status": "active",
  "quota": 0,
  "quota_used": 0,
  "expires_at": null,
  "group": {
    "id": 2,
    "name": "Default",
    "platform": "openai"
  }
}
```

模型平台和可调用范围由 `/v1/models` 现有 API Key 鉴权与分组逻辑决定。Zero-canvas 根据返回的模型名称在前端归类为文本、图片或视频能力，不要求 sub2api 返回画布专用能力字段。

## 7. 部署步骤

1. 合并 `zero-canvas-web` 客户端注册和 CORS 配置改动。
2. 构建包含这些改动的新 sub2api 后端镜像；授权页提示调整涉及前端时，同时构建前端资源。
3. 在生产环境设置：

   ```text
   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
   ```

4. 重新创建或重启 sub2api 服务，使新二进制和环境变量生效。
5. 确认 Cloudflare、Nginx 或其他反向代理没有拦截 OPTIONS。

重启的原因不是 OAuth 框架本身发生变化，而是正在运行的进程需要加载新增客户端和 CORS 环境变量。

## 8. 验收命令

### 客户端注册

向同源接口提交授权请求，预期返回 `201` 和 `request_id`：

```bash
curl -i 'https://usa0.top/api/v1/app-auth/authorize/requests' \
  -H 'Content-Type: application/json' \
  --data '{
    "response_type":"code",
    "client_id":"zero-canvas-web",
    "redirect_uri":"http://localhost:3000/oauth/callback",
    "scope":"profile:read keys:read offline_access",
    "state":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "code_challenge":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "code_challenge_method":"S256",
    "installation_id":"zero-canvas-check",
    "device_name":"USA零网页画布",
    "platform":"web"
  }'
```

如果返回以下内容，说明线上仍是未包含客户端注册的旧版本：

```json
{
  "error": "invalid_client",
  "error_description": "unknown public client"
}
```

### CORS 预检

分别将 Origin 换成两个本地地址执行。预期状态为 `204`，且 `Access-Control-Allow-Origin` 与请求 Origin 完全一致。

```bash
curl -i -X OPTIONS 'https://usa0.top/api/v1/app-auth/token' \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'

curl -i -X OPTIONS 'https://usa0.top/api/v1/app/keys' \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'

curl -i -X OPTIONS 'https://usa0.top/v1/models' \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

### 完整浏览器流程

- 网站已登录：点击画布登录后直接进入授权确认，不再次显示登录表单。
- 网站未登录：密码、TOTP、第三方 OAuth 或 Passkey 登录后继续原授权请求。
- 同意授权：回到本地画布并成功读取资料和 Key。
- 选择 Key：`/v1/models` 返回该 Key 分组可用模型。
- 刷新页面：使用 refresh token 恢复应用授权和已选 Key。
- 退出登录：调用 revoke 并清除画布本地会话，不删除网站 API Key。

## 9. 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `invalid_client: unknown public client` | 线上镜像没有注册 `zero-canvas-web` | 部署包含客户端注册的新后端 |
| `invalid_scope` | 客户端 scope 与画布申请范围不一致 | 允许且仅允许 `profile:read keys:read offline_access` |
| `redirect_uri is not registered` | 回调地址、主机或端口不匹配 | 使用两个精确回调地址之一 |
| OPTIONS 返回 `403` | Origin 未进入 CORS 白名单，或代理拦截 OPTIONS | 检查环境变量、容器环境和反向代理 |
| 授权页正常但 token 交换失败 | `/app-auth/token` 的 CORS 或新客户端未生效 | 检查 token 预检和运行镜像版本 |
| 能登录但模型列表失败 | `/v1/models` CORS、Key 状态或分组配置异常 | 使用同一个 Key 直接请求 `/v1/models` 排查 |

## 10. 安全要求

- 不把网站登录 token 复制给画布。
- 不通过 URL、日志、错误信息或 `postMessage` 传递 access token、refresh token 或完整 API Key。
- OAuth code 必须一次性使用并绑定 client、redirect URI 和 PKCE verifier。
- API Key 只由 `/api/v1/app/keys` 返回给已获得 `keys:read` 的应用会话。
- 画布只在运行时内存中向模型请求注入完整 API Key，不写入 AI 配置、配置导出或 WebDAV。
- 保留现有 refresh token 轮换、重用检测、授权撤销和设备会话逻辑。

## 11. 最小变更文件清单

必须修改：

```text
backend/internal/service/app_auth_service.go
backend/internal/service/app_auth_service_test.go
backend/internal/config/config.go
backend/internal/config/config_test.go
deploy/config.example.yaml
deploy/docker-compose.dev.yml
deploy/production/compose.yaml
```

建议修改，用于授权页展示和错误定位：

```text
frontend/src/views/AppAuthorizationView.vue
frontend/src/api/client.ts
frontend/src/utils/apiError.ts
frontend/src/i18n/locales/zh/dashboard.ts
frontend/src/i18n/locales/en/dashboard.ts
frontend/src/views/__tests__/AppAuthorizationView.spec.ts
```

不需要修改：

```text
现有用户登录方式
现有 app-auth token、refresh、revoke 协议
现有 /api/v1/app/me
现有 /api/v1/app/keys
现有 /v1/models 和模型网关调用链
```
