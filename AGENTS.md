# 给 AI 代理的方寸整理规范

你通过 `fangcun` CLI 或 `fangcun mcp` 访问的是用户的个人资产台账。请按下面的规矩整理。

## 基本原则

- **价格按实付填写，绝不换算汇率**。用户在土耳其区、折扣价付的钱就填实际金额和币种，区域写进 `region`（如「土耳其区」），折扣写进 `discount`（如「年付 8 折」）。
- **绝不写入完整卡号或 CVV**。支付卡只有 `payment.last4`（正好 4 位数字）。服务端会拒绝看起来像完整卡号的内容。
- 不确定的值留空，不要编造。用 `fangcun doctor` 找缺字段，再向用户确认。
- 写操作用的是「可写（需审批）」令牌时，会生成变更计划，用户在网页批准后才生效——一次改动尽量合成一个清晰的计划。
- 每次写入都有日志，可以 `fangcun undo <编号>` 撤销。

## 类型与字段

| type | 名称 | 关键字段 |
| --- | --- | --- |
| `server` | 服务器 | `details`：IPv4 / IPv6 / 地区 / CPU / 内存 / 硬盘 / 系统；`komari.uuid` 绑定探针；`komari.trafficResetDay` 流量重置日；`atoll.serverId` 手动指定对应的 Atoll 服务器（`null` = 不关联，不填 = 按公网 IP 自动匹配） |
| `domain` | 域名 | `details`：DNS、注册人、实名、转移锁 |
| `cert` | 证书 | `details`：域名、签发者、类型、部署在；通常 `cycle: quarter`、`price: 0` |
| `subscription` | 订阅 | `team`（团队订阅）：`owner` 母号，`workspaces[]` 各自 `seats / price / currency / cycle / expiresAt / region / discount / members[]` |
| `mail` | 邮箱 | `details`：席位等 |
| `phone` | 号码 | `phone.number / carrier / country / purpose`；`expiresAt` = 保号 / 续费到期；`price` = 月租 |
| `payment` | 支付 | `payment.issuer`（发卡平台）、`network`（Visa / Mastercard / 银联 / American Express / JCB / Discover / 其他）、`last4`、`cardExpiry`（YYYY-MM，决定到期日）、`fees`（开卡费 / 充值手续费，文本）、`billingRegion`、`status`（active / frozen / closed）；`price` = 年费或月费 |
| `account` | 账号 | `account.username / site / websites[] / hasTotp`；不含密码 |
| `document` | 文档 | 附件随备份导出 |

通用字段：`name`、`subtitle`（一句话用途）、`provider`、`price`、`currency`（3 位代码）、`cycle`（month / quarter / halfyear / year / 2year / 3year / once）、`expiresAt`（YYYY-MM-DD）、`autoRenew`、`purchasedAt`、`tags`、`related`（关联资产 id）、`accountId`（登录用的账号资产）、`note`。

## 命名与标签

- 服务器名用主机名（`hk-api-01`），`subtitle` 写用途（「香港 API 主节点」）。
- 标签用短词，项目名用中文全称（`星桥商城`），环境用英文小写（`production`、`database`）。不要造同义标签，先 `fangcun ls --json` 看已有标签。
- 用某张卡付款的订阅 / 服务器，用 `fangcun link <资产> <卡>` 建关联。
- 同一个东西不要建两条；发现重复先告诉用户。
