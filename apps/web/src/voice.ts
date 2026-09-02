import type { ClientSocket } from "./store.js";

type VoiceSignal = { type: "offer" | "answer" | "ice"; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export class VoiceManager {
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly remoteAudio = new Map<string, HTMLAudioElement>();
  private stream: MediaStream | null = null;
  private enabled = false;
  private readonly onSignal = (payload: { fromPlayerId: string; signal: unknown }) => { void this.handleSignal(payload.fromPlayerId, payload.signal as VoiceSignal); };
  constructor(private readonly socket: ClientSocket, private readonly playerId: string, private readonly reportError: (message: string) => void) { socket.on("voice:signal", this.onSignal); }

  async start(peerIds: string[]): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.enabled = true;
      for (const peerId of peerIds.filter((id) => id !== this.playerId)) this.createPeer(peerId);
      this.socket.emit("game:voice-enabled", true);
      return true;
    } catch (error) {
      this.enabled = false;
      this.reportError(error instanceof DOMException && error.name === "NotAllowedError" ? "麦克风权限被拒绝，游戏仍可正常进行。" : "语音初始化失败，游戏仍可正常进行。");
      return false;
    }
  }
  stop(): void { this.enabled = false; this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null; for (const peer of this.peers.values()) peer.close(); this.peers.clear(); for (const audio of this.remoteAudio.values()) audio.remove(); this.remoteAudio.clear(); this.socket.emit("game:voice-enabled", false); }
  isEnabled(): boolean { return this.enabled; }
  private createPeer(peerId: string): RTCPeerConnection {
    const existing = this.peers.get(peerId); if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    this.peers.set(peerId, peer);
    this.stream?.getTracks().forEach((track) => peer.addTrack(track, this.stream!));
    peer.onicecandidate = (event) => { if (event.candidate) this.send(peerId, { type: "ice", candidate: event.candidate.toJSON() }); };
    peer.ontrack = (event) => { const audio = this.remoteAudio.get(peerId) ?? new Audio(); audio.autoplay = true; audio.srcObject = event.streams[0] ?? null; this.remoteAudio.set(peerId, audio); void audio.play().catch(() => undefined); };
    peer.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(peer.connectionState)) { peer.close(); this.peers.delete(peerId); } };
    if (this.playerId < peerId) void this.makeOffer(peerId, peer);
    return peer;
  }
  private async makeOffer(peerId: string, peer: RTCPeerConnection): Promise<void> { try { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); this.send(peerId, { type: "offer", description: peer.localDescription ?? offer }); } catch (error) { this.reportError("语音连接协商失败，已跳过该玩家。"); } }
  private send(toPlayerId: string, signal: VoiceSignal): void { this.socket.emit("voice:signal", { toPlayerId, signal }); }
  private async handleSignal(fromPlayerId: string, signal: VoiceSignal): Promise<void> { if (!this.enabled) return; const peer = this.createPeer(fromPlayerId); try { if (signal.type === "offer" && signal.description) { const offerCollision = peer.signalingState !== "stable"; if (offerCollision && this.playerId > fromPlayerId) return; await peer.setRemoteDescription(signal.description); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); this.send(fromPlayerId, { type: "answer", description: peer.localDescription ?? answer }); } else if (signal.type === "answer" && signal.description && peer.signalingState === "have-local-offer") await peer.setRemoteDescription(signal.description); else if (signal.type === "ice" && signal.candidate) await peer.addIceCandidate(signal.candidate); } catch { this.reportError("语音连接已断开，正在等待重连。"); } }
  destroy(): void { this.stop(); this.socket.off("voice:signal", this.onSignal); }
}
