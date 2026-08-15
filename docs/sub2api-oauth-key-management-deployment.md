# sub2api OAuth Key 管理线上变更说明

本文档用于向线上 `sub2api` 维护人员说明 USA零画布 OAuth Key 管理补丁的目的、实现方式、影响范围、发布顺序与验收方法。内容以本地已实现并验证的代码为准，不要求重写现有 OAuth、官网面板或 API Key 业务链路。

## 1. 变更目标

USA零画布使用 `zero-canvas-web` 应用 OAuth 登录后，需要通过 App OAuth 控制面完成以下操作：

1. 读取当前用户可用分组。
2. 读取当前用户全部 API Key。
3. 用户明确选择分组后创建 API Key。
4. 用户删除自己的 API Key。

本次修改遵循最小变更原则：

- 不改变官网面板使用的网站 JWT 登录与 Key 管理接口。
- 不改变其他 OAuth 客户端的 scope、token、grant、refresh 或 revoke 协议。
- 不新增重复的 `POST /api/v1/app/keys` 路由，继续使用现有 group-scoped 创建路由。
- 复用现有 `APIKeyService.Create`、`APIKeyService.Delete`、软删除、凭据墓碑和缓存失效逻辑。
- 不新增数据库迁移；创建幂等复用现有 `idempotency_records` 表和协调器。

## 2. 最终接口契约

### OAuth scope

`zero-canvas-web` 只允许以下五个 scope：

```text
profile:read groups:read keys:read keys:write offline_access
```

旧 access token 和 refresh token 不会自动获得新增 scope。服务端发布后，画布用户必须退出当前 OAuth 会话并重新授权。

### 创建 Key

```http
POST /api/v1/app/groups/:groupId/keys
Authorization: Bearer <app access token>
Content-Type: application/json
Idempotency-Key: <一次逻辑创建操作的稳定随机值>

{
  "name": "USA零画布"
}
```

约束：

- 路由要求 `keys:write`。
- `groupId` 只能来自 URL。
- JSON body 只允许 `name`，不得接受 `group_id`、`custom_key`、所有者或其他服务端字段。
- `name` 去除首尾空白后不能为空。当前 handler 使用 Go 的 `len(name) <= 100` 校验，因此实际上限制为最多 100 个 UTF-8 字节，而不是 100 个 Unicode 字符；中文等多字节名称会更早达到上限。线上若要统一为数据库 `VARCHAR(100)` 的字符语义，应另行将校验改为字符计数。
- 沿用现有 App 控制面响应，成功返回 `200 OK` 和完整 Key 资源 envelope。
- 缺少幂等键返回 `400 idempotency_key_required`。
- 幂等键格式错误返回 `400 idempotency_key_invalid`。
- 同一用户复用同一幂等键但更换分组或名称，返回 `409 idempotency_key_conflict`。
- 重放成功时响应头包含 `X-Idempotency-Replayed: true`。

示例成功响应：

```json
{
  "success": true,
  "message": "success",
  "data": {
    "id": 123,
    "user_id": 7,
    "key": "<完整 API Key>",
    "name": "USA零画布",
    "group_id": 2,
    "status": "active"
  }
}
```

### 删除 Key

```http
DELETE /api/v1/app/keys/:id
Authorization: Bearer <app access token>
```

约束：

- 路由要求 `keys:write`。
- 正整数 ID 才是合法输入；非法 ID 返回 `400 invalid_key_id`。
- 本人 Key 删除成功返回空 body 的 `204 No Content`。
- 重复删除、不存在、已经删除或属于其他用户的 Key，同样返回空 body 的 `204`。
- 他人 Key 不会被删除；统一 204 只用于避免资源枚举。
- 非预期数据库或内部错误返回 `500 key_delete_failed`，响应不得包含原始 `err.Error()`。

### 鉴权边界

所有 `/api/v1/app/*` 请求继续使用应用 OAuth Bearer token：

```http
Authorization: Bearer <app access token>
```

官网登录 Cookie 不得作为 App OAuth 接口的认证兜底。无 token 返回 `401 invalid_token`，缺少 `keys:write` 返回 `403 insufficient_scope`。

## 3. 核心代码修改

核心补丁涉及以下 8 个 Go 文件。

### 3.1 `backend/internal/service/app_auth_service.go`

为 `zero-canvas-web` 使用独立 allowlist：

```go
var zeroCanvasAllowedScopes = map[string]struct{}{
    "profile:read":   {},
    "groups:read":    {},
    "keys:read":      {},
    "keys:write":     {},
    "offline_access": {},
}
```

只扩展该客户端，不修改共享的 `appAllowedScopes`，因此 ZeroAgent Desktop/Web/Android 等其他客户端行为不变。

如果线上分支尚未注册 `zero-canvas-web`，还需要保留该 public client：

```go
"zero-canvas-web": {
    ID:               "zero-canvas-web",
    Platform:         "web",
    Name:             "USA零网页画布",
    AllowedScopes:    zeroCanvasAllowedScopes,
    ValidateRedirect: validateZeroCanvasRedirect,
},
```

生产回调必须使用线上画布的精确 HTTPS `/oauth/callback` 地址。`localhost:3000` 和 `127.0.0.1:3000` 仅用于本地测试，不能替代线上回调注册。

> **线上发布阻断项：** 当前本地实现的 `validateZeroCanvasRedirect` 只硬编码接受上述两个 loopback 地址。现有 `APP_AUTH_WEB_REDIRECT_URIS` / `ConfigureAppAuthWebRedirectURIs` 只被 ZeroAgent Web 的 validator 使用，并且校验路径是 `/api/auth/oauth/callback`；它不会自动为 `zero-canvas-web` 放行 `/oauth/callback`。线上发布前必须在代码中为 `zero-canvas-web` 增加真实 HTTPS 回调的精确校验，不能只设置现有环境变量。

单一固定线上域名可采用最小改动，例如将占位地址替换为真实地址：

```go
func validateZeroCanvasRedirect(raw string) bool {
    switch raw {
    case "https://<线上画布域名>/oauth/callback",
        "http://localhost:3000/oauth/callback",
        "http://127.0.0.1:3000/oauth/callback":
        return true
    default:
        return false
    }
}
```

如果存在多个线上画布域名，应新增 `zero-canvas-web` 专用的精确回调配置和 validator，不要复用路径契约不同的 `APP_AUTH_WEB_REDIRECT_URIS`，也不要用通配符、后缀或请求值反射。

### 3.2 `backend/internal/server/routes/app_auth.go`

保留已有创建路由，并新增删除路由：

```go
app.POST("/groups/:groupId/keys",
    servermiddleware.RequireAppScope("keys:write"),
    h.AppResource.CreateKey)

app.DELETE("/keys/:id",
    servermiddleware.RequireAppScope("keys:write"),
    h.AppResource.DeleteKey)
```

不新增 `POST /api/v1/app/keys` 别名，避免线上出现两套创建契约、重复监控路径或不同请求体验证逻辑。

### 3.3 `backend/internal/handler/idempotency_helper.go`

新增 App OAuth 专用幂等适配 `executeAppIdempotent`，不能直接复用网站 JWT 的 `executeUserIdempotentJSON`。

原因是网站 helper 从 `AuthSubject` 读取用户，而 App OAuth 路由存放的是 `AppAuthSubject`。直接复用会把 App OAuth 请求错误地归为 `user:0`。

App OAuth helper 的关键规则：

```text
actor scope: app-user:<userID>
operation scope: app.api_keys.create
payload: {group_id, name}
coordinator key: SHA-256(app-user:<userID> + NUL + raw Idempotency-Key)
```

用户 ID 同时进入协调器 key 命名空间和请求指纹，因此在幂等记录有效期内：

- 同一用户、同一键、同一请求在成功记录存在时直接重放结果。
- 同一用户、同一键、不同分组或名称产生冲突。
- 不同用户可以安全使用相同原始幂等键，不会共享记录或结果。

该 helper 显式要求 `Idempotency-Key`，不受通用协调器 `ObserveOnly` 配置影响。协调器或存储不可用时创建操作 fail closed，返回 503，不允许绕过幂等直接创建。

这里提供的是有时限的重复请求抑制，不是跨事务的 exactly-once 保证：成功记录默认保留 24 小时，过期后再次使用相同幂等键可以重新执行。Key 写入与幂等记录标记成功也不在同一个数据库事务中；极端情况下，Key 已创建但 `MarkSucceeded` 失败，接口仍会返回 `503 idempotency_unavailable`。客户端遇到此错误时应先重新同步 Key 列表确认结果，不应立即更换幂等键盲目重试；线上也应监控幂等记录写入失败。

### 3.4 `backend/internal/handler/app_resource_handler.go`

#### 创建逻辑

现有严格 JSON 校验和 group-scoped 请求保持不变，服务调用改为通过 App OAuth 幂等 helper 执行。

为了避免泄漏完整 API Key，幂等协调器只持久化：

```json
{"key_id": 123}
```

不能把 `dto.APIKey` 直接作为协调器返回值，因为通用幂等表会持久化成功响应，而完整 Key 位于 `key` 字段；现有通用日志脱敏规则不会自动把所有名为 `key` 的业务字段当作凭据处理。

首次执行或重放完成后，handler 使用 `APIKeyService.GetByID(keyID)` 从 Key 主表读取资源，并再次验证 `key.UserID == AppAuthSubject.UserID`，随后才向当前 OAuth 用户返回完整 Key。这样可以：

- 保持第一次和重放返回同一个 Key。
- 不在 `idempotency_records.response_body` 保存第二份完整凭据。
- 防止错误或被篡改的幂等引用跨用户读取 Key。

#### 删除逻辑

新增 `DeleteKey` handler，调用现有：

```go
APIKeyService.Delete(ctx, keyID, subject.UserID)
```

该 Service 已经负责：

- 查询 Key 所有者。
- 拒绝删除他人 Key。
- 将完整凭据替换为 `__deleted__...` tombstone。
- 设置 `deleted_at` 软删除。
- 发起 Key 认证缓存失效，并清理创建尝试状态。

数据库 tombstone 与 `deleted_at` 在删除事务中完成，但 Redis 删除和 Pub/Sub 缓存失效是 best-effort，相关错误不会让删除接口失败。多实例环境中若缓存失效链路异常，其他实例可能暂时继续接受旧缓存中的凭据，直到缓存 TTL 到期；当前默认 L1/L2 TTL 分别为 15 秒和 300 秒。需要立即吊销语义时，发布和验收必须同时确认 Redis、Pub/Sub 与各实例缓存失效链路健康。

App OAuth handler 只在边界转换响应：

- `ErrAPIKeyNotFound` 转为 204。
- `ErrInsufficientPerms` 转为 204。
- 其他错误转为固定的脱敏 500。

官网面板原有删除 handler 不修改，因此其既有 200/403/404 行为不受影响。

#### 内部接口

`AppResourceHandler.apiKeyService` 收窄为文件内部 `appAPIKeyService` 接口。生产 wiring 仍注入同一个 `*APIKeyService`；这一调整只用于清晰限定依赖并支持 handler 单元测试，不新增运行时实现。

### 3.5 `backend/internal/server/middleware/cors.go`

浏览器创建 Key 会发送非简单请求头，因此 CORS allow headers 增加：

```text
Idempotency-Key
```

现有 Origin 精确匹配、OPTIONS 处理和允许方法保持不变。线上应配置真实画布 Origin，例如：

```text
CORS_ALLOWED_ORIGINS=https://<线上画布域名>
```

若仍需本地联调，可额外逐项加入：

```text
http://localhost:3000,http://127.0.0.1:3000
```

不要使用 `*`、后缀匹配或动态反射请求 Origin。

### 3.6 测试文件

以下测试同步更新：

- `backend/internal/service/app_auth_service_test.go`
  - 验证 `zero-canvas-web` 只允许约定的五个 scope。
  - 验证本地回调精确匹配，附加 query、错误端口和错误 scheme 被拒绝。
- `backend/internal/handler/app_resource_handler_test.go`
  - body 只能包含 `name`。
  - 缺少幂等键时拒绝创建。
  - 在有效成功记录内，相同请求重放只创建一个 Key。
  - 幂等记录不包含完整 Key。
  - 不同用户可使用相同原始幂等键。
  - 同键不同请求返回冲突。
  - 删除本人、重复删除、不存在和他人 Key 的外部响应均为 204。
  - 他人 Key 实际保留。
  - 非法 ID 和内部错误经过稳定、脱敏的响应处理。
- `backend/internal/server/middleware/cors_test.go`
  - 验证允许 Origin 的响应包含 `Idempotency-Key`。

## 4. 线上前置条件

部署前必须核对以下条件。

### 4.1 数据库已有幂等表

本次补丁复用已有迁移：

```text
backend/migrations/057_add_idempotency_records.sql
```

线上数据库必须已经存在 `idempotency_records` 表及以下索引：

- `(scope, idempotency_key_hash)` 唯一索引。
- `expires_at` 清理索引。
- `(status, locked_until)` 状态索引。

如果线上版本早于该迁移，应先执行已有迁移，不能另建一张画布专用幂等表。

### 4.2 幂等协调器已注入

现有 `ProvideIdempotencyCoordinator` 必须正常初始化并调用 `SetDefaultIdempotencyCoordinator`。现有 `IdempotencyCleanupService` 应保持启动，用于清理过期记录。

如果协调器未初始化，创建接口会按安全设计返回 `503 idempotency_unavailable`，不会直接创建 Key。

### 4.3 OAuth 客户端与回调已注册

确认 `zero-canvas-web` 已注册，并在 `validateZeroCanvasRedirect` 或新增的 Zero-canvas 专用回调配置中加入线上画布精确 HTTPS 回调。不要把本地 loopback 地址作为唯一生产回调，也不要误以为现有 `APP_AUTH_WEB_REDIRECT_URIS` 会自动应用到该客户端。

发布前至少增加一个针对真实生产回调的单元测试，并继续验证附加 query、fragment、错误 scheme、错误端口及相似后缀域名被拒绝。

### 4.4 CORS 已包含线上画布 Origin

应用层、反向代理和 CDN 都必须允许线上画布 Origin，并保证 OPTIONS 不被拦截。至少允许：

```text
Authorization
Content-Type
Idempotency-Key
```

跨域控制面请求不依赖 Cookie，不能为了本功能放宽官网 Cookie 跨站策略。

## 5. 发布顺序

推荐按以下顺序发布：

1. 备份数据库，并确认迁移 057 已执行。
2. 合并 8 个核心 Go 文件的增量修改。
3. 修改 `validateZeroCanvasRedirect` 或新增专用配置，注册线上画布精确 HTTPS callback；仅设置现有 `APP_AUTH_WEB_REDIRECT_URIS` 不足以完成此步骤。
4. 配置线上画布精确 CORS Origin，并运行聚焦 Go 测试。
5. 构建新的 `sub2api` 应用镜像。
6. 只滚动更新应用实例，不删除 PostgreSQL、Redis 或持久卷。
7. 检查健康端点和启动日志中的路由注册。
8. 在 Zero-canvas 中退出登录并重新发起 OAuth 授权。
9. 使用新 token 验证分组、Key 列表、创建、重放和删除。
10. 确认旧官网面板的创建与删除仍正常。

多实例部署时应在所有实例均完成发布后再开放画布。幂等状态存放在 PostgreSQL，不依赖单实例内存，但旧实例若尚未注册 `zero-canvas-web`，会把其 token 视为未知客户端并返回 `401 invalid_token`，使读取和写入都可能随机失败；已有的 group-scoped 创建路由并非本补丁新增，只有删除路由在旧实例中缺失。

## 6. 发布前测试

在 `backend` 目录执行：

```bash
go test ./internal/handler -run 'Test(CreateAppKey|DeleteAppKey|ResolveAppGroupRates|ExecuteUserIdempotentJSON)'
go test ./internal/service -run 'TestZeroCanvasWebClientRedirectsAndScopes'
go test ./internal/server/middleware -run 'TestCORS_|TestRequireAppScope'
go test ./internal/server/routes
```

本地实施时以上测试均已通过。

## 7. 发布后验收

准备：

```bash
BASE_URL='https://usa0.top'
APP_TOKEN='<重新授权后获得的 zero-canvas OAuth access token>'
GROUP_ID='<GET /api/v1/app/groups 返回的可用分组 ID>'
```

### 7.1 路由与鉴权

无 token 请求应返回 401，而不是 404：

```bash
curl -i -X POST "$BASE_URL/api/v1/app/groups/$GROUP_ID/keys" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: route-check' \
  --data '{"name":"route-check"}'

curl -i -X DELETE "$BASE_URL/api/v1/app/keys/1"
```

缺少 `keys:write` 的有效 token 应返回 `403 insufficient_scope`。

### 7.2 CORS 预检

```bash
curl -i -X OPTIONS "$BASE_URL/api/v1/app/groups/$GROUP_ID/keys" \
  -H 'Origin: https://<线上画布域名>' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,idempotency-key'
```

预期：

- 返回 204。
- `Access-Control-Allow-Origin` 精确等于请求 Origin。
- `Access-Control-Allow-Headers` 包含 `Idempotency-Key`。
- 不允许的 Origin 不获得 `Access-Control-Allow-Origin`。

### 7.3 创建与重放

连续执行两次完全相同的命令：

```bash
curl -i -X POST "$BASE_URL/api/v1/app/groups/$GROUP_ID/keys" \
  -H "Authorization: Bearer $APP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: zero-canvas-online-acceptance-001' \
  --data '{"name":"USA零画布线上验收"}'
```

在协调器和数据库均正常、两次请求发生在幂等记录有效期内时，预期：

- 两次均返回 200。
- 两次返回相同 `id` 和完整 `key`。
- 第二次响应包含 `X-Idempotency-Replayed: true`。
- 此次成功重放场景中数据库只新增一个 Key。
- `idempotency_records.response_body` 只包含 `key_id`，不包含完整 API Key。

保持幂等键不变但修改名称或 URL 中的分组 ID，预期返回 `409 idempotency_key_conflict`。

省略 `Idempotency-Key`，预期返回 `400 idempotency_key_required`。

不要把此验收结果解释为永久或事务级 exactly-once：默认 24 小时记录过期后，同一幂等键可再次执行；如果创建已提交但幂等成功状态写入失败，客户端可能收到 503，此时先通过 Key 列表确认是否已经创建。

### 7.4 删除与不可枚举性

```bash
curl -i -X DELETE "$BASE_URL/api/v1/app/keys/<刚创建的 ID>" \
  -H "Authorization: Bearer $APP_TOKEN"
```

预期首次和重复请求都返回空 body 的 204。删除后：

- 数据库记录已写入 tombstone 并设置 `deleted_at`。
- Redis、Pub/Sub 和各应用实例健康时，原完整 Key 应立即无法调用 `/v1/models`。
- 若缓存失效链路异常，应在配置的认证缓存 TTL 内最终失效；当前默认最长 L2 TTL 为 300 秒。超过 TTL 仍可使用属于验收失败，应检查缓存和实例配置。
- 当前用户删除不存在 ID 返回 204。
- 当前用户删除其他用户的合法 Key ID 也返回 204，但对方 Key 仍存在且可用。

## 8. 安全说明

- 网站登录 token 与 App OAuth token 继续严格分离。
- 官网 Cookie 只用于官网同源登录和授权页面，不进入画布控制面请求。
- access token、refresh token、完整 API Key 和 `Idempotency-Key` 不得写入 URL、日志或错误正文。
- 完整 API Key 只存在于原 Key 资源和当前受权响应中；幂等表只保存 Key ID。
- 删除对外统一 204 是防枚举响应，不代表跳过所有权检查。
- 创建失败时不返回原始内部错误，避免数据库、主机或敏感数据泄漏。

## 9. 影响范围与回滚

### 不受影响的功能

- 官网面板 JWT 登录。
- 官网原有 `POST /api/v1/keys` 与 `DELETE /api/v1/keys/:id`。
- 其他 App OAuth 客户端。
- `/v1/models`、`/v1/usage` 和其他模型网关接口。
- API Key 数据结构和现有软删除格式。

### 回滚边界

如果发布后需要回滚应用代码：

1. 回滚应用镜像即可，不需要回滚数据库结构。
2. 不删除 `idempotency_records`，它是现有通用能力，且已有清理服务。
3. 已创建的 Key 是正常官网 Key，不应因应用回滚而删除。
4. 已删除的 Key 已完成凭据墓碑化，不能恢复原完整凭据；如用户仍需要，应重新创建新 Key。
5. 如果回滚版本未注册 `zero-canvas-web`，现有画布 token 会因未知客户端返回 `401 invalid_token`，包括读取接口在内都会失效；已有 group-scoped 创建路由仍在，但新增删除路由不存在。若线上旧版本已注册该客户端，则应按该版本实际 allowlist 和路由重新评估影响。

## 10. 线上合并清单

核心必须合入：

```text
backend/internal/service/app_auth_service.go
backend/internal/service/app_auth_service_test.go
backend/internal/handler/idempotency_helper.go
backend/internal/handler/app_resource_handler.go
backend/internal/handler/app_resource_handler_test.go
backend/internal/server/routes/app_auth.go
backend/internal/server/middleware/cors.go
backend/internal/server/middleware/cors_test.go
```

按线上分支实际状态核对并合入：

```text
backend/internal/config/config.go
backend/internal/config/config_test.go
deploy/production/compose.yaml
frontend/src/views/AppAuthorizationView.vue
frontend/src/i18n/locales/*/dashboard.ts
```

第二组不是创建/删除核心逻辑本身，但若线上还没有以下能力，就必须一并处理：

- 从环境变量读取精确 CORS Origin。
- 注册线上画布回调。
- 授权页正确显示 USA零网页画布和新增 scope。
- 授权页正确展示 OAuth 标准错误。

不要直接把本地 `docker-compose.dev.yml` 的 localhost 默认值照搬为生产唯一配置。生产必须显式填写真实 HTTPS 画布 Origin 和 callback。
