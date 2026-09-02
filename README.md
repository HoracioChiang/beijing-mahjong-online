# 北京麻将 · Friends Table

一个不需要注册、支持四人实时联机的北京麻将网页版。房间、洗牌、发牌、混儿、胡牌、吃碰杠、计分和回合状态全部由 Node.js 服务端 authoritative 判定；浏览器只接收自己的暗牌和其他玩家的牌数。

## 项目结构

```text
apps/web              React + TypeScript + Vite + Tailwind 桌面/移动端
apps/server           Express + Socket.IO 单实例游戏服务
packages/mahjong-core 纯 TypeScript 规则引擎，不依赖 React/Socket.IO
packages/shared       Socket 事件类型、Zod payload schema、公开状态类型
```

本次参考的开源麻将项目、许可证核对结果以及“参考而不复制”的模块映射见 [`docs/OPEN_SOURCE_ARCHITECTURE_AUDIT.md`](docs/OPEN_SOURCE_ARCHITECTURE_AUDIT.md)。

核心模块的公开入口为 `tiles.ts`、`rules.ts`、`hu.ts`、`ting.ts`、`meld.ts`、`scoring.ts`、`index.ts`。`tile.ts`、`score.ts`、`actions.ts` 是为 baseline 兼容保留的内部实现文件。`wall.ts` 额外提供四面 17 墩实体牌墙、`WallBreakInfo`、`WallCursor` 和物理取牌函数。

## 本地开发

需要 Node.js 20+ 和 pnpm 9+。

```bash
pnpm install
pnpm dev
```

开发时 Vite 在 `5173` 提供前端，Socket.IO 服务在 `3000` 提供后端。若需要指定后端地址，可设置 `VITE_SERVER_URL`。

```bash
pnpm lint
pnpm test
pnpm build
pnpm start
```

生产服务同时提供 React 静态文件、SPA fallback 和 Socket.IO：

```text
GET /        -> apps/web/dist/index.html
GET /room/123456 -> SPA fallback，不会 404
GET /health  -> 200 JSON
```

## 测试与模拟

核心包目前包含超过 150 个 Vitest cases，覆盖牌墙、实体牌唯一性、混儿、标准胡牌、所有标准拆解枚举、七小对系列、听牌、吃碰杠、计分和零和结算。服务端测试覆盖 ActionResolver 优先级、状态版本、防重复/越权操作、断线重连和暗牌序列化。

```bash
pnpm test
pnpm simulate
```

`pnpm simulate` 默认使用 deterministic seed 1–10000 模拟牌局，并在每个事件边界检查：136 张实体牌、每种牌四张、无重复 tileId、没有重复摸牌、phase 合法、无 deadlock 和积分零和。失败时会打印 seed；可以用 `SIMULATION_GAMES=100` 缩短本地调试。额外用 `SIMULATION_GAMES=0 SIMULATION_POTS=100 pnpm simulate` 验证 100 锅的东南西北推进及每锅的完整牌局模拟。

Playwright 多浏览器房间 smoke test：

```bash
pnpm build
pnpm test:e2e
```

第一次运行 Playwright 需要额外执行 `pnpm exec playwright install chromium`。

## 北京麻将默认规则

`packages/mahjong-core/src/rules/beijing-default.ts` 是唯一默认规则表，房间创建时复制到 RoomState，牌局开始后不再修改。

- 136 张、无花牌；0–8 万、9–17 筒、18–26 条、27–33 字牌，每种四张。
- 混坯子翻开后，按万/筒/条循环和东南西北、中发白循环取下一张为混儿。
- 混儿可作为万能牌胡牌，不能代替牌组成吃、碰、明杠；默认不能主动打出混儿。
- 三混只能自摸；四混自动胡由 `fourJokerAutoHu` 控制，默认关闭。
- 吃、碰、明杠后 `hasOpenedHand=true`，不能胡正常点炮；暗杠不破门清。
- 反应窗口为 10 秒，出牌为 30 秒；超时自动托管并执行最小合法动作。
- 优先级为 HU > GANG/PENG > CHI > PASS；同优先级按与出牌者顺时针距离，默认一炮一响。
- 发牌后公开一个混坯子；正常牌墙和最后 7 墩/14 张 dead wall 分开，杠从 dead wall 补牌。
- 首锅开始先进入 `DETERMINING_DEALER` 打庄：服务器用 `crypto.randomInt(1, 7)` 为真人/机器人掷两颗骰子，同点只让同点组重掷，最高东、次高南、再次西、最低北。每局进入 `ROLLING_FOR_WALL` 后由当前庄家再次掷骰，决定四面牌墙的目标边、断口和第一张牌位置。
- 牌墙不是抽象数组：四边各 17 墩、每墩上下两张；发牌/摸牌/杠后补牌都通过 `WallCursor` 消耗具体实体位置，客户端同步每个墩的剩余上下层。混坯子也从 dead wall 的实体位置翻出。
- 庄家胡牌/荒庄连庄，闲家胡牌下家坐庄；四个连续庄位完成后推进东、南、西、北四圈，北圈第四庄结束进入 `POT_SETTLEMENT`。
- 等待房间支持真人与机器人混合，机器人由服务端 `BotController` 驱动，使用同一个 discard/reaction/kong/hu 校验入口，不接收 socket，也没有浏览器手牌。
- 荒庄后下一局默认上楼 ×2，设置可切换为累计或关闭。
- 番型包含普通胡、素、门清、自摸、庄家、对对胡、大钓/全求人、一条龙、本混龙、捉五魁、七小对、豪华/双豪华/三豪华七小对、清一色、杠上开花、杠上炮、抢杠胡、海底、天胡、地胡、混杠。
- 默认倍数集中在 `BeijingDefaultRules.scoring`，本混龙不重复算一条龙，豪华七对不重复算普通七对，ScoreCalculator 会比较所有合法标准拆法后取最高分。
- 自摸由三家支付，庄家相关支付按配置翻倍；点炮默认 `discarder_covers_all`，可切换 `all_three_pay_discarder_double`；每次结算都强制校验 `sum(scoreDelta) === 0`。

## 房间与断线

房间 ID 为六位数字。等待房间中房主可以点击“添加机器人”或“添加机器人并开始”，支持 1 真人 + 3 Bot 到 4 真人。浏览器 localStorage 保存 `playerId`、`reconnectToken`、`roomId`、`nickname`。Socket ID 不是玩家身份；刷新或网络切换会用 token 恢复原座位、手牌、积分、meld、弃牌和当前牌局。断线座位保留 5 分钟；没有真人连接/真人主动退出后，包含 Bot 的临时房间也会清理。

`serializeForPlayer(room, playerId)` 的逻辑在 `GameRoom.serializeForPlayer`：只有当前玩家自己的 hand 被序列化，其他玩家仅有 `handCount`；结算阶段才公开全部手牌。暗牌泄露测试会直接检查 JSON payload。

## 语音

语音是 `apps/web/src/voice.ts` 的独立 `VoiceManager`，使用四人 WebRTC mesh，Socket.IO 只转发 offer/answer/ICE。麦克风权限失败、offer collision、ICE 失败或单个 peer 断线只显示语音错误，不会断开游戏 socket、离开房间、清除 localStorage 或刷新页面。

## GitHub 与 Railway

1. 在 GitHub 创建空 repository。
2. 本地提交并推送：

   ```bash
   git init
   git add .
   git commit -m "Build authoritative Beijing Mahjong online game"
   git branch -M main
   git remote add origin https://github.com/<your-name>/<repo>.git
   git push -u origin main
   ```

3. Railway 选择该 GitHub repository，使用根目录部署。
4. `railway.toml` 已配置 Nixpacks build：`pnpm install --frozen-lockfile && pnpm build`；start：`pnpm start`；healthcheck：`/health`。
5. 可配置环境变量：`NODE_ENV=production`、`ENABLE_VOICE_CHAT=true`。Railway 会注入 `PORT`，服务端读取 `process.env.PORT`，不要手动固定端口。
6. Railway HTTPS 域名可以直接分享；自定义域名在 Railway service 的 Domains 中添加并按提示配置 DNS。Socket.IO 会在 HTTPS 页面使用 WSS。

当前房间状态在单个 Node 进程内存中，因此 Railway 必须保持 **1 replica / 1 instance**；扩容会把同一房间分散到不同进程，导致玩家看不到彼此。未来扩展时，把 RoomManager 状态迁移到 Redis，并使用 `@socket.io/redis-adapter`，同时用 sticky session 或统一 websocket 路由。

## 安全边界

客户端发送的 tileId、version、actionId、吃牌组合和动作类型都必须通过 Zod schema；服务端继续验证房间、玩家身份、phase、轮次、牌所有权、混儿限制、吃碰杠合法性和 HuCalculator 结果。客户端按钮只是提示层，不能绕过服务器。
