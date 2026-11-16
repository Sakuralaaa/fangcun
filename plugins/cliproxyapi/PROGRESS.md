# CLIProxyAPI 接入 · 进度

## 已完成
- `plugins/cliproxyapi`：CLIProxyAPI 插件（Go c-shared，id `fangcun`，sdk v8.0.75）。
  - 管理接口 `GET /v0/management/fangcun/connection`、`POST /v0/management/fangcun/token/rotate`（CLIProxyAPI 管理密钥保护）。
  - 资源路由：面板 `/v0/resource/plugins/fangcun/index.html`（菜单「方寸」，复制连接串、重新生成），只读额度接口 `/v0/resource/plugins/fangcun/feed`（只认 `Authorization: Bearer fcq_…` / `X-Fangcun-Token`）。
  - 读 host.auth.list / host.auth.get，在插件内调用 Codex `wham/usage`、Antigravity `loadCodeAssist` + `retrieveUserQuotaSummary`；缓存 5 分钟，强制刷新间隔 ≥60 秒；响应不含任何凭证（单测）。
  - 令牌存 `<auth-dir>/.fangcun-feed`。
  - `go vet` / `go test` 通过；本地交叉编译 amd64 / arm64 `.so` 成功。
- 连接串：`fangcun-cliproxyapi:` + base64url(JSON `{v:1,u,p,t}`)（面板 JS 生成，`packages/core/src/cliproxyapi.ts` 解析）。
- `registry.json`（仓库根，github-release 安装）+ `.github/workflows/cliproxyapi-plugin.yml`（`v*` 标签时原生 amd64/arm64 runner 构建 `fangcun_<ver>_linux_<arch>.zip` + `checksums.txt` 并建 GitHub Release）。
- 方寸：表 `cliproxyapi_connections`（迁移 #3，令牌只在这里，不进设置 / 备份 / 导出 / API）；`apps/server/src/cliproxyapi.ts`（每 10 分钟拉取）；API `GET /api/cliproxyapi`、`POST /api/cliproxyapi/connections|test|refresh`、`PATCH/DELETE /api/cliproxyapi/connections/:id`。
- 匹配（core）：订阅的登录账号 / 详细信息邮箱 / 团队母号与成员邮箱自动关联；`asset.quotaBinds` 手动关联（可指定 member）。
- 网页：设置「CLIProxyAPI」页（连接列表、添加 / 编辑 / 删除 / 测试 / 刷新、全部账号额度）；订阅详情额度卡片、团队成员 5 小时 / 每周剩余改用真实数据并标明来自哪个连接；演示模式有两条示例连接。CpaBadge → CliproxyBadge，界面 / README 不再写缩写。
- README「CLIProxyAPI 接入（只读）」章节。npm test（141）+ typecheck 通过。

## 已确认的 CLIProxyAPI 行为（router-for-me/CLIProxyAPI @ c19787b，2026-11-16）
- 插件源（`plugins.store-sources`）地址被原样当 JSON 下载（`internal/pluginstore/github.go` FetchRegistry），**不支持填仓库主页**，必须填 `https://raw.githubusercontent.com/Sakuralaaa/fangcun/main/registry.json`。
- github-release 安装取仓库 **latest release**，找 `<id>_<ver>_<os>_<arch>.zip` + `checksums.txt`；所以插件随方寸 `v*` 发版一起出包。仓库目前还没有任何 GitHub Release，打下一个 `v*` 标签后商店才能安装。
- 资源路由不经过管理密钥认证（`ServeResourceHTTP`），且 `home.enabled: true` 时资源路由全部 404。

## 未完成
- 未在真实 CLIProxyAPI 里加载测试 `.so`（只做了单测 + 编译）。下一步：`git clone router-for-me/CLIProxyAPI`，`go build ./cmd/server`，把 `fangcun.so` 放到 `plugins/linux/<arch>/`，配置里启用，访问面板与 feed 验证。
- 网页里手动关联 / 取消关联号池账号的编辑入口（数据字段 `quotaBinds` 已有，可经 CLI/API 写）。
- CLI / MCP 的额度查询命令（`GET /api/cliproxyapi` 已支持只读令牌）。
- 插件面板截图、订阅详情截图（`/workspace/projects/.../cliproxyapi/team.png` 已有团队页一张）。
- 发版：改 `package.json` / `APP_VERSION` / `registry.json` 版本并打 `v0.1.9` 标签（按用户要求本次未打标签）。

## 如何继续
- Go：`cd plugins/cliproxyapi && go vet ./... && go test ./...`；编译：`CGO_ENABLED=1 go build -buildmode=c-shared -o fangcun.so ./cmd/plugin`。
- 方寸：`npm test && npm run typecheck`；界面：`npm run build -w apps/web && cd apps/web && npx vite preview`，打开 `/?demo=1#/settings/cliproxyapi`。
