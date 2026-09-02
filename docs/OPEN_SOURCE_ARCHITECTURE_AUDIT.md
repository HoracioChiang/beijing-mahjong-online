# 开源麻将项目架构审计

更新时间：2026-09-02

本项目对以下仓库做了架构和许可证核对。没有把它们的源文件复制进本仓库；仅将可验证的设计思路映射到已有的北京麻将实现中。

| 项目 | 观察到的成熟部分 | 许可证边界 | 本项目的处理 |
| --- | --- | --- | --- |
| [zorrofox/mahjong](https://github.com/zorrofox/mahjong) | `game_state`、房间管理、WebSocket、AI 填位、反应窗口、断线宽限、测试分层 | 仓库页未显示明确的 repo-wide 开源许可证，不能假定可复制；README 中的牌面资源另有 CC BY-SA 4.0 说明 | 只采用行为和模块边界作为参考。现有 `GameRoom`、`RoomManager`、`BotController`、`ActionResolver` 保持 TypeScript/北京规则实现，不复制其 Python 或资源 |
| [yuandom/mahjong](https://github.com/yuandom/mahjong) | React/TypeScript 前端分层、程序化牌面、四方桌面、客户端重连和私有状态同步 | 仓库页未显示明确的 repo-wide 开源许可证 | 采用“牌面组件 / 桌面布局 / 私有序列化”的思路；本项目使用 CSS/SVG，不复制 PixiJS 源码或素材 |
| [yixiaoer/MahjongGenerator](https://github.com/yixiaoer/MahjongGenerator) | Basic Rules 与 Customized Options 分离，joker 和区域规则可配置 | [MIT License](https://github.com/yixiaoer/MahjongGenerator/blob/main/LICENSE)，允许改编但仍需保留许可声明 | 仅移植抽象思想到现有 `RuleConfig`、`BeijingDefaultRules`、独立 pattern evaluator；没有复制 Python 代码 |
| [EpicOrange/riichi_advanced](https://github.com/EpicOrange/riichi_advanced) | ruleset 模块化、房间/牌局分离、AI、日志和扩展规则 | [AGPL-3.0](https://github.com/EpicOrange/riichi_advanced/blob/main/LICENSE)；复制或形成衍生代码会带来对应的 copyleft 义务 | 不复制其 Elixir/Phoenix 源码，仅保留“规则层与网络层隔离”的设计原则 |

## 当前代码与参考架构的对应关系

本次适配是在已有代码上完成的，不是重新生成第二套游戏：

- `packages/mahjong-core/src/tiles.ts`、`wall.ts`、`hu.ts`、`ting.ts`、`meld.ts`、`score.ts` 是不依赖网络和 React 的规则内核。
- `packages/mahjong-core/src/patterns/` 现在由独立 evaluator 组成，并由 `BEIJING_PATTERN_EVALUATORS` 组合；`ScoreCalculator` 会遍历每个合法标准拆解并选最高分。
- `apps/server/src/room.ts` 是唯一修改牌局状态的 authoritative orchestrator；每个动作都会重新检查 phase、version、turn、实体牌所有权和规则合法性。
- `apps/server/src/action-resolver.ts` 只负责无副作用地解析 reaction window。`GameRoom` 负责收集响应、timeout 自动 PASS，再根据 `HU > GANG/PENG > CHI > PASS` 统一提交状态变更。
- `apps/server/src/bot-controller.ts` 只调 `GameRoom` 的同一套公开动作入口，机器人没有旁路权限，也不接收完整牌墙。
- `apps/server/src/room-manager.ts` 负责房间生命周期、断线宽限、身份 token 重连和单实例内存房间清理。
- `apps/web/src/App.tsx`、`index.css` 只负责桌面呈现；隐藏手牌由服务端按 playerId 序列化，前端没有机会用 CSS “隐藏”其他玩家的暗牌。

## 有意保留的北京麻将差异

参考项目包含香港麻将或日麻规则，不能直接移植到本项目。当前实现明确使用：136 张无花牌、混坯/混儿、三混点炮限制、吃碰明杠破门清、四面 17 墩牌墙、14 张尾牌、杠后补牌、北京计分、东南西北四圈一锅、庄家连庄和荒庄上楼。

未来新增地区规则时，应增加或替换 `RuleConfig` 与 pattern evaluator，不要在 React 组件或 Socket handler 中加入规则分支。
