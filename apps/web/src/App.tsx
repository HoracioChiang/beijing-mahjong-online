import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Meld, Tile, TileType } from "@beijing-mahjong/mahjong-core";
import { tileLabel, tileRank, tileSuit } from "@beijing-mahjong/mahjong-core";
import type { PublicPlayerState, PublicRoomState, PublicRoundState } from "@beijing-mahjong/shared";
import { useGameStore } from "./store.js";
import { VoiceManager } from "./voice.js";
import { playSound, setSoundEnabled, speak } from "./sounds.js";

const roomFromPath = () => window.location.pathname.match(/^\/room\/(\d{6})/)?.[1] ?? null;
const WINDS = ["东", "南", "西", "北"];
const windLabel = (wind?: string) => ({ EAST: "东圈", SOUTH: "南圈", WEST: "西圈", NORTH: "北圈" }[wind ?? ""] ?? "等待开局");
const roundLabel = (round: PublicRoundState) => `${({ EAST: "东", SOUTH: "南", WEST: "西", NORTH: "北" }[round.progress?.roundWind ?? "EAST"] ?? "东")}${(round.progress?.dealerPosition ?? 0) + 1}`;

type SeatPosition = "self-seat" | "left-seat" | "top-seat" | "right-seat";
type TileSize = "hand" | "discard" | "meld" | "wall" | "indicator";

function App() {
  const state = useGameStore((store) => store.state);
  const identity = useGameStore((store) => store.identity);
  const pathRoom = roomFromPath();
  if (!state) return <Lobby initialRoom={pathRoom ?? identity?.roomId ?? ""} />;
  return <GameRoomView state={state.room} self={state.self} legalActions={state.legalActions} ting={state.ting} />;
}

function Lobby({ initialRoom }: { initialRoom: string }) {
  const createRoom = useGameStore((store) => store.createRoom);
  const connect = useGameStore((store) => store.connectToRoom);
  const error = useGameStore((store) => store.error);
  const connected = useGameStore((store) => store.connected);
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState(initialRoom);
  const [advanced, setAdvanced] = useState(false);
  const [voice, setVoice] = useState(true);
  return (
    <main className="lobby-shell">
      <div className="lobby-card">
        <div className="brand-mark">麻</div>
        <p className="eyebrow">FRIENDS TABLE · BEIJING</p>
        <h1>北京麻将</h1>
        <p className="muted">不注册，输入昵称即可开局。四位朋友围桌，服务器负责每一张牌。</p>
        <label className="field-label">昵称<input value={nickname} maxLength={20} onChange={(event) => setNickname(event.target.value)} placeholder="例如：张三" /></label>
        <div className="lobby-actions">
          <button className="primary-button" disabled={!nickname.trim() || !connected} onClick={() => createRoom(nickname.trim(), { enableVoiceChat: voice })}>创建房间</button>
          <button className="secondary-button" disabled={!nickname.trim() || !/^\d{6}$/.test(roomId)} onClick={() => connect(roomId, nickname.trim())}>加入房间</button>
        </div>
        <label className="field-label">房间号<input value={roomId} inputMode="numeric" maxLength={6} onChange={(event) => setRoomId(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="六位数字" /></label>
        <button className="link-button" onClick={() => setAdvanced(!advanced)}>{advanced ? "收起高级规则" : "高级规则"}</button>
        {advanced && <div className="rule-card"><label><input type="checkbox" checked={voice} onChange={(event) => setVoice(event.target.checked)} /> 启用 WebRTC 语音</label><p>实体四面牌墙、四圈一锅和机器人陪练已启用，其余规则使用 BeijingDefaultRules。</p></div>}
        {error && <div className="error-box">{error}</div>}
        <p className="connection-line"><span className={connected ? "online-dot" : "offline-dot"} />{connected ? "服务器已连接" : "正在连接服务器…"}</p>
      </div>
    </main>
  );
}

function GameRoomView({ state, self, legalActions, ting }: { state: PublicRoomState; self: PublicPlayerState | null; legalActions: Array<Record<string, unknown>>; ting: Array<Record<string, any>> }) {
  const ready = useGameStore((store) => store.toggleReady);
  const startGame = useGameStore((store) => store.startGame);
  const leave = useGameStore((store) => store.leaveRoom);
  const discard = useGameStore((store) => store.discard);
  const reaction = useGameStore((store) => store.reaction);
  const hu = useGameStore((store) => store.hu);
  const kong = useGameStore((store) => store.kong);
  const addBot = useGameStore((store) => store.addBot);
  const removeBot = useGameStore((store) => store.removeBot);
  const addBotsAndStart = useGameStore((store) => store.addBotsAndStart);
  const rollDice = useGameStore((store) => store.rollDice);
  const event = useGameStore((store) => store.event);
  const settlement = useGameStore((store) => store.settlement);
  const voiceError = useGameStore((store) => store.voiceError);
  const setVoiceError = useGameStore((store) => store.setVoiceError);
  const setVoice = useGameStore((store) => store.setVoiceEnabled);
  const [showBoard, setShowBoard] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sound, setSound] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const [dealing, setDealing] = useState(false);
  const voiceRef = useRef<VoiceManager | null>(null);
  const players = state.players;
  const round = state.round;
  const isHost = self?.playerId === state.hostPlayerId;
  const peerIds = players.filter((player) => player.connected && player.playerType === "HUMAN").map((player) => player.playerId);

  useEffect(() => {
    if (!event) return;
    if (["draw", "DRAW", "discard", "chi", "peng", "kong", "win"].includes(event.type)) playSound(event.type === "win" ? "hu" : event.type.toLowerCase());
    if (event.type === "deal") speak("发牌");
    if (event.type === "DEALER_ROLL" || event.type === "WALL_ROLL") speak("掷骰");
    if (["discard", "chi", "peng", "kong", "win"].includes(event.type)) {
      document.body.dataset.tableEvent = event.type;
      const timer = window.setTimeout(() => delete document.body.dataset.tableEvent, 650);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [event]);

  useEffect(() => {
    if (event?.type !== "DEAL_ANIMATION") return;
    setDealing(true);
    document.body.dataset.dealing = "true";
    const timer = window.setTimeout(() => { delete document.body.dataset.dealing; setDealing(false); }, 3400);
    return () => window.clearTimeout(timer);
  }, [event]);

  useEffect(() => () => voiceRef.current?.destroy(), []);

  const toggleVoice = async () => {
    if (!self) return;
    if (voiceOn) {
      voiceRef.current?.stop();
      voiceRef.current = null;
      setVoiceOn(false);
      setVoice(false);
      return;
    }
    const manager = new VoiceManager(useGameStore.getState().socket, self.playerId, setVoiceError);
    voiceRef.current = manager;
    if (await manager.start(peerIds)) { setVoiceOn(true); setVoice(true); }
  };

  const relative = (player: PublicPlayerState): SeatPosition => {
    const offset = (player.seat - (self?.seat ?? 0) + 4) % 4;
    return (["self-seat", "left-seat", "top-seat", "right-seat"] as SeatPosition[])[offset] ?? "self-seat";
  };
  const hasAction = (kind: string) => legalActions.some((action) => action.kind === kind);
  const reveal = round?.phase === "SETTLEMENT" || round?.phase === "POT_SETTLEMENT";
  const canDiscard = hasAction("discard");
  const canRoll = hasAction("roll-dice");

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="header-brand"><span className="brand-small">麻</span><span className="room-title">房间 {state.roomId}</span><span className="live-badge"><span />LIVE</span></div>
        <div className="header-actions">
          <button onClick={() => setShowBoard(!showBoard)}>排行榜</button>
          <button onClick={() => setShowHistory(!showHistory)}>牌局记录</button>
          <button onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/room/${state.roomId}`); }}>复制邀请链接</button>
          <button className={voiceOn ? "active-button" : ""} onClick={() => { void toggleVoice(); }}>{voiceOn ? "关闭语音" : "开启语音"}</button>
          <button onClick={leave}>退出</button>
        </div>
      </header>

      <section className="table-wrap">
        <div className="rotate-tip">建议横屏体验，竖屏也可以操作</div>
        <div className="mahjong-table">
          <div className="table-wood-edge" />
          <div className="table-felt"><div className="felt-grain" /></div>
          <WallView round={round} />
          {players.map((player) => <PlayerSeat key={player.playerId} player={player} position={relative(player)} round={round} isSelf={player.playerId === self?.playerId} reveal={Boolean(reveal)} />)}
          <CenterInfo round={round} />
          <div className="event-toast">{event?.type === "player-disconnected" ? `${String(event.data)} 已断线` : event?.type === "player-reconnected" ? `${String(event.data)} 已重连` : event?.type === "DETERMINING_DEALER" ? "开始打庄" : event?.type === "DEALER_REROLL" ? "相同点数，重新掷骰" : event?.type === "WALL_ROLL" ? "开牌！" : event?.type === "chi" ? "吃" : event?.type === "peng" ? "碰" : event?.type === "kong" ? "杠" : event?.type === "win" ? "胡！" : ""}</div>
          {dealing && <button className="skip-deal" onClick={() => { delete document.body.dataset.dealing; setDealing(false); }}>跳过发牌动画</button>}
        </div>

        <div className="control-panel">
          {(round?.phase === "WAITING_FOR_PLAYERS" || round?.phase === "READY") && self ? <button className={self.ready ? "secondary-button" : "primary-button"} onClick={ready}>{self.ready ? "取消准备" : "准备"}</button> : null}
          {isHost && players.length < 4 && <button className="secondary-button" onClick={() => addBot()}>🤖 添加机器人</button>}
          {isHost && players.length < 4 && players.length >= 1 && <button className="primary-button" onClick={addBotsAndStart}>添加机器人并开始</button>}
          {isHost && round?.phase === "WAITING_FOR_PLAYERS" && players.length === 4 && players.every((player) => player.ready) && <button className="primary-button" onClick={startGame}>开始游戏</button>}
          {isHost && round?.phase === "SETTLEMENT" && <button className="primary-button" onClick={startGame}>下一局</button>}
          {isHost && round?.phase === "POT_SETTLEMENT" && <button className="primary-button" onClick={startGame}>再来一锅</button>}
          {canRoll && <DiceButton round={round} onRoll={rollDice} />}
          {hasAction("hu") && <button className="action-button hu-button" onClick={() => round?.phase === "WAITING_FOR_REACTIONS" ? reaction("hu") : hu()}>胡</button>}
          {hasAction("peng") && <button className="action-button" onClick={() => reaction("peng")}>碰</button>}
          {hasAction("chi") && <ChiChoices legalActions={legalActions} onChoose={(types) => reaction("chi", types)} />}
          {legalActions.filter((item) => item.kind === "kong").map((item, index) => <button key={`${String(item.tileType)}-${index}`} className="action-button" onClick={() => kong(Number(item.tileType), item.kongKind as "concealed" | "added")}>杠 {tileLabel(Number(item.tileType) as TileType)}</button>)}
          {(hasAction("pass") || (round?.phase === "WAITING_FOR_REACTIONS" && round.reactionWindow?.eligiblePlayerIds.includes(self?.playerId ?? ""))) && <button className="action-button pass-button" onClick={() => reaction("pass")}>过</button>}
          {canDiscard && <span className="hint-label">选择手牌出牌</span>}
          {ting.length > 0 && <span className="ting-hint">听：{ting.map((item) => `${tileLabel(Number(item.tileType) as TileType)} ×${item.remainingVisibleCount}`).join("、")}</span>}
        </div>
        {isHost && players.some((player) => player.playerType === "BOT") && <div className="bot-roster">{players.filter((player) => player.playerType === "BOT").map((player) => <span key={player.playerId}>🤖 {player.nickname} <button onClick={() => removeBot(player.playerId)}>移除</button></span>)}</div>}
      </section>

      {showBoard && <Leaderboard players={players} />}
      {showHistory && <History history={state.history} />}
      {settlement && <SettlementOverlay settlement={settlement} onContinue={startGame} />}
      {voiceError && <div className="floating-error" onClick={() => setVoiceError(null)}>{voiceError}</div>}
      <label className="sound-toggle"><input type="checkbox" checked={sound} onChange={(event) => { setSound(event.target.checked); setSoundEnabled(event.target.checked); }} /> 音效</label>
    </main>
  );
}

function MahjongTile({ tile, jokerType, disabled, onClick, size = "hand", extraClass = "", dealIndex }: { tile: Tile; jokerType: TileType | null; disabled?: boolean; onClick?: () => void; size?: TileSize; extraClass?: string; dealIndex?: number }) {
  const suit = tileSuit(tile.type);
  const rank = tileRank(tile.type);
  const style = dealIndex === undefined ? undefined : { "--deal-index": dealIndex } as CSSProperties;
  return <button className={`mahjong-tile tile-${size} tile-${suit} ${disabled ? "tile-disabled" : ""} ${extraClass}`} style={style} disabled={disabled} onClick={onClick} title={tileLabel(tile.type)} aria-label={tileLabel(tile.type)}>
    <span className="tile-inner">
      {rank === null ? <span className="honor-glyph">{["東", "南", "西", "北", "中", "發", "白"][tile.type - 27] ?? "牌"}</span> : <><span className="tile-rank">{rank}</span><span className="suit-glyph">{suit === "characters" ? "萬" : suit === "circles" ? "筒" : "索"}</span></>}
    </span>
    <span className="tile-shine" />
    {tile.type === jokerType && <b className="joker-stamp">混</b>}
  </button>;
}

function TileBack({ size = "hand", dealIndex }: { size?: TileSize; dealIndex?: number }) {
  const style = dealIndex === undefined ? undefined : { "--deal-index": dealIndex } as CSSProperties;
  return <span className={`mahjong-tile tile-${size} tile-back`} style={style} aria-label="牌背"><span className="back-medallion">麻</span></span>;
}

function WallView({ round }: { round: PublicRoundState | null }) {
  const wall = round?.wall;
  if (!wall) return null;
  const indicator = wall.indicatorPosition;
  return <div className="physical-wall" aria-label="四面实体牌墙">
    <div className="wall-break-caption">{round.wallBreak ? `断口 · ${round.wallBreak.dice1}+${round.wallBreak.dice2}` : "四面牌墙"}</div>
    {wall.sides.map((side) => <div className={`wall-side wall-side-${side.sideIndex} ${round.wallBreak?.targetSeat === side.seat ? "wall-target-side" : ""}`} key={side.sideIndex}>
      {side.stacks.map((stack) => {
        const indicatorLayer = indicator?.sideIndex === side.sideIndex && indicator.stackIndex === stack.stackIndex ? indicator.layer : null;
        return <span className={`wall-stack ${round.wallBreak?.targetSeat === side.seat && round.wallBreak.breakStackIndex === stack.stackIndex ? "wall-break-stack" : ""}`} key={stack.stackIndex}>
          {stack.bottomPresent && <i className="wall-block wall-bottom" />}
          {stack.topPresent && <i className="wall-block wall-top" />}
          {indicatorLayer && round.jokerIndicator && <MahjongTile tile={round.jokerIndicator} jokerType={null} disabled size="wall" extraClass={`wall-indicator wall-indicator-${indicatorLayer.toLowerCase()}`} />}
        </span>;
      })}
    </div>)}
  </div>;
}

function PlayerSeat({ player, position, round, isSelf, reveal }: { player: PublicPlayerState; position: SeatPosition; round: PublicRoomState["round"]; isSelf: boolean; reveal: boolean }) {
  const latest = round?.lastAction?.type === "discard" && round.lastAction.playerId === player.playerId ? Number(round.lastAction.tileType) : null;
  return <div className={`player-seat ${position} ${player.isTurn ? "turn-seat" : ""}`} data-seat={player.seat}>
    <PlayerInfo player={player} />
    <MeldArea melds={player.melds} jokerType={round?.jokerType ?? null} />
    <PlayerHand player={player} isSelf={isSelf} reveal={reveal} isTurn={player.isTurn} jokerType={round?.jokerType ?? null} />
    <DiscardGrid tiles={player.discards} jokerType={round?.jokerType ?? null} latestType={latest} />
    {player.isAutopilot && <span className="autopilot-tag">托管中</span>}
  </div>;
}

function PlayerInfo({ player }: { player: PublicPlayerState }) {
  return <div className="player-info player-badge"><span className={`status-dot ${player.connected ? "connected" : "disconnected"}`} /><strong>{player.playerType === "BOT" ? "🤖 " : ""}{player.nickname}</strong><span className="seat-tag">{WINDS[player.seat]}</span>{player.isDealer && <span className="dealer-tag">庄</span>}{player.voiceEnabled && <span className="voice-tag">🎙</span>}<small>{player.score >= 0 ? "+" : ""}{player.score} · 胡 {player.wins}</small></div>;
}

function PlayerHand({ player, isSelf, reveal, isTurn, jokerType }: { player: PublicPlayerState; isSelf: boolean; reveal: boolean; isTurn: boolean; jokerType: TileType | null }) {
  const discard = useGameStore((store) => store.discard);
  const hand = player.hand ?? [];
  const showTiles = isSelf || reveal;
  return <div className={`seat-hand ${isSelf ? "own-hand" : "hidden-hand"}`} aria-label={isSelf ? "我的手牌" : `${player.nickname}的手牌`}>
    {showTiles ? hand.map((tile, index) => <MahjongTile key={tile.tileId} tile={tile} jokerType={jokerType} size="hand" disabled={!isSelf || !isTurn || tile.type === jokerType} onClick={() => discard(tile.tileId)} extraClass={index === hand.length - 1 ? "draw-gap" : ""} dealIndex={index} />) : Array.from({ length: player.handCount }, (_, index) => <TileBack key={index} size="hand" dealIndex={index} />)}
  </div>;
}

function MeldArea({ melds, jokerType }: { melds: Meld[]; jokerType: TileType | null }) {
  if (!melds.length) return <div className="meld-area meld-area-empty" aria-label="明牌区" />;
  return <div className="meld-area" aria-label="吃碰杠明牌区">{melds.map((meld) => <div className="meld-group" key={meld.id}>
    <div className="meld-tiles">{meld.tiles.map((tile) => <MahjongTile key={tile.tileId} tile={tile} jokerType={jokerType} disabled size="meld" />)}</div>
    <span className="meld-label">{meld.kind === "chi" ? "吃" : meld.kind === "peng" ? "碰" : "杠"}</span>
  </div>)}</div>;
}

function DiscardGrid({ tiles, jokerType, latestType }: { tiles: Tile[]; jokerType: TileType | null; latestType: number | null }) {
  return <div className="discard-grid" aria-label="弃牌区">{tiles.map((tile, index) => <MahjongTile key={tile.tileId} tile={tile} jokerType={jokerType} disabled size="discard" extraClass={latestType === tile.type && index === tiles.length - 1 ? "latest-discard" : ""} />)}</div>;
}

function CenterInfo({ round }: { round: PublicRoomState["round"] }) {
  if (!round) return null;
  const progress = round.progress;
  const phaseLabel = round.phase === "DETERMINING_DEALER" ? "骰子定座" : round.phase === "ROLLING_FOR_WALL" ? "庄家开牌" : round.phase === "WAITING_FOR_REACTIONS" ? "等待响应" : round.phase === "POT_SETTLEMENT" ? "本锅结束" : round.phase === "SETTLEMENT" ? "本局结算" : "进行中";
  const wall = round.wall;
  return <div className="center-info">
    <div className="center-seal"><span className="center-caption">{phaseLabel}</span><strong>{progress ? roundLabel(round) : "北京麻将"}</strong><span>{windLabel(progress?.roundWind)} · {progress ? `连庄 ${progress.continuationCount}` : "等待开局"}</span></div>
    <div className="center-stats"><span><b>可摸</b>{wall?.liveRemaining ?? round.remainingTiles}</span><span><b>尾牌</b>{wall?.deadRemaining ?? 0}</span><span><b>第几局</b>{progress?.totalHandsPlayed ? progress.totalHandsPlayed : 1}</span><span><b>第几锅</b>{progress?.potNumber ?? 1}</span></div>
    {round.jokerIndicator && <div className="joker-center"><span>混坯子</span><MahjongTile tile={round.jokerIndicator} jokerType={null} disabled size="indicator" /><b>混儿 {round.jokerType === null ? "—" : tileLabel(round.jokerType)}</b></div>}
    {round.reactionWindow && <div className="reaction-clock">{Math.max(0, Math.ceil((round.reactionWindow.deadline - Date.now()) / 1000))}s</div>}
    {round.dealerDetermination && <div className="dice-results">{round.dealerDetermination.rolls.slice(-4).map((roll) => <span key={`${roll.playerId}-${roll.rerollRound}`}>{roll.dice1}+{roll.dice2}={roll.total}</span>)}</div>}
  </div>;
}

function Die({ value }: { value: number }) {
  const active = value >= 1 && value <= 6 ? [[5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]][value - 1]! : [];
  return <span className="die" aria-label={`${value}点`}>{Array.from({ length: 9 }, (_, index) => <i key={index} className={`pip pip-${index + 1} ${active.includes(index + 1) ? "pip-active" : ""}`} />)}</span>;
}

function DiceButton({ round, onRoll }: { round: PublicRoundState | null; onRoll: () => void }) {
  if (!round) return null;
  const roll = round.dealerDetermination?.rolls.at(-1);
  const wallRoll = round.wallRoll;
  const dice1 = wallRoll?.dice1 ?? roll?.dice1 ?? 5;
  const dice2 = wallRoll?.dice2 ?? roll?.dice2 ?? 6;
  return <button className="dice-panel" onClick={onRoll}><span className="dice-title">{round.phase === "DETERMINING_DEALER" ? "掷骰定座" : "掷骰开牌"}</span><span className="dice-pair"><Die value={dice1} /><Die value={dice2} /></span><small>{wallRoll ? `${wallRoll.dice1} + ${wallRoll.dice2} = ${wallRoll.total}` : roll ? `${roll.dice1} + ${roll.dice2} = ${roll.total}` : "骰子由服务器生成"}</small></button>;
}

function ChiChoices({ legalActions, onChoose }: { legalActions: Array<Record<string, unknown>>; onChoose: (types: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const choices = legalActions.filter((action) => action.kind === "chi");
  return <div className="chi-choice-wrap"><button className="action-button" onClick={() => choices.length === 1 ? onChoose(choices[0]!.tileTypes as number[]) : setOpen(!open)}>吃 {choices.length > 1 ? `(${choices.length})` : ""}</button>{open && <div className="chi-menu">{choices.map((choice, index) => <button key={index} onClick={() => { onChoose(choice.tileTypes as number[]); setOpen(false); }}>{(choice.tileTypes as number[]).map((type) => tileLabel(type as TileType)).join(" · ")}</button>)}</div>}</div>;
}

function Leaderboard({ players }: { players: PublicPlayerState[] }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return <aside className="side-panel"><h2>排行榜</h2>{sorted.map((player, index) => <div className="ranking-row" key={player.playerId}><b>{index + 1}</b><span>{player.playerType === "BOT" ? "🤖 " : ""}{player.nickname}<small>胡牌 {player.wins} 次 · 自摸 {player.selfDrawWins} 次 · 点炮 {player.discardCount} 次 · 胡牌率 {player.roundsPlayed ? Math.round(player.wins / player.roundsPlayed * 100) : 0}%</small></span><strong className={player.score < 0 ? "negative" : ""}>{player.score >= 0 ? "+" : ""}{player.score}</strong></div>)}<p className="panel-note">积分是整个房间 Session 累计，实时同步。</p></aside>;
}

function History({ history }: { history: Array<Record<string, unknown>> }) {
  return <aside className="side-panel history-panel"><h2>牌局记录</h2>{history.length === 0 ? <p className="muted">还没有完成的牌局。</p> : [...history].reverse().map((item, index) => <div className="history-row" key={index}><b>{String(item.roundWind ?? "")}{String(item.handNumber)} 局</b><span>{String(item.winner ?? "荒庄")} · {String(item.winType)}</span><small>{new Date(String(item.timestamp)).toLocaleTimeString()}</small></div>)}</aside>;
}

function SettlementOverlay({ settlement, onContinue }: { settlement: unknown; onContinue: () => void }) {
  const data = settlement as { winnerName?: string; method?: string; potEnded?: boolean; players?: Array<{ playerId: string; nickname: string; score: number }>; potSummary?: Array<{ playerId: string; nickname: string; totalWins: number; selfDrawWins: number; discardCount: number; maxSingleWin: number; continuationWins: number; winRate: number; score: number }>; score?: { totalMultiplier?: number; breakdown?: Array<{ label: string; multiplier: number }>; deltas?: Record<string, number> } };
  return <div className="overlay"><div className="settlement-card"><p className="eyebrow">{data.potEnded ? "POT SETTLEMENT" : "ROUND SETTLEMENT"}</p><h2>{data.potEnded ? "本锅结束" : data.winnerName ? `胡牌：${data.winnerName}` : "荒庄"}</h2><p className="win-method">{data.method}{data.score?.totalMultiplier ? ` · 总倍率 ×${data.score.totalMultiplier}` : ""}</p>{data.score?.breakdown?.length ? <div className="breakdown">{data.score.breakdown.map((item) => <span key={item.label}>{item.label} <b>×{item.multiplier}</b></span>)}</div> : null}{data.potEnded && data.potSummary?.length ? <div className="pot-summary">{data.potSummary.map((item) => <div key={item.playerId}><b>{item.nickname}</b><small>胡 {item.totalWins} · 自摸 {item.selfDrawWins} · 点炮 {item.discardCount} · 最大单局 {item.maxSingleWin} · 连庄 {item.continuationWins} · 胡牌率 {item.winRate}%</small><strong>{item.score >= 0 ? "+" : ""}{item.score}</strong></div>)}</div> : null}<div className="settlement-deltas">{Object.entries(data.score?.deltas ?? {}).map(([playerId, delta]) => <span key={playerId}><b>{data.players?.find((player) => player.playerId === playerId)?.nickname ?? playerId.slice(-6)}</b><strong className={delta < 0 ? "negative" : ""}>{delta >= 0 ? "+" : ""}{delta}</strong></span>)}</div><button className="primary-button" onClick={onContinue}>{data.potEnded ? "再来一锅" : "准备下一局"}</button></div></div>;
}

export default App;
