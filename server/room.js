// 联机房间：大厅（第一个进来的人是房主，按“开始”）→ 对局（服务器跑规则引擎和 AI）→ 结算 → 回到大厅。
// 目前只有一个房间。最多 8 名真人入座，其余进来的人观战；对局开始后进来的人也观战。
// 空位由 AI 补满 8 人。真人掉线 / 太久不操作时，由 AI 代打这一步。
import { newGame, act, settleQueen, settleFinish, queenCanGive, queenSeat, remarkAfterPeek } from '../js/engine.js';
import { aiStep, aiQueenTarget, aiAfterPeek } from '../js/ai.js';
import { redact } from './view.js';

export const MAX_SEATS = 8;
// 与 js/main.js 的 AIS 一致：[头像, 名字, 性别, 语音目录]
const AIS = [
  ['🦡', '石头', 'm', 'shitou'], ['🐺', '夜影', 'm', 'yeying'], ['🦦', '溜溜', 'm', 'liuliu'],
  ['🐰', '糯糯', 'f', 'nuonuo'], ['🦌', '小鹿', 'f', 'xiaolu'], ['🐶', '点点', 'f', 'diandian'], ['🐈‍⬛', '炭炭', 'f', 'tantan'],
];
const env = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const T = {
  turn: env('TURN_MS', 90000),        // 真人回合最长等待，超时由 AI 代打
  offline: env('OFFLINE_MS', 8000),   // 掉线的真人，等这么久就由 AI 代打
  ack: env('ACK_MS', 25000),          // 等所有真人看完一步演出的上限
  night: env('NIGHT_MS', 60000),      // 开局看身份 + 夜晚的上限
  queen: env('QUEEN_MS', 60000),      // 真人女王挑人的上限
  gap: env('GAP_MS', 1100),           // 换人行动前的停顿（与单机一致）
  lobbyGrace: env('LOBBY_GRACE_MS', 20000), // 大厅里掉线多久后移出房间
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Room {
  constructor(id = 'main') {
    this.id = id;
    this.members = [];   // 按进入顺序：{ id, token, name, ws, connected, offAt, ack, seat }
    this.state = 'lobby';
    this.game = null;    // { st, seatOf: Map(memberId→seat), human: [memberId|null]×8, v, waiting }
    this.nextId = 1;
  }

  // ---------- 连接 ----------
  hello(ws, m) {
    const name = cleanName(m.name);
    let mem = m.token && this.members.find(x => x.token === m.token);
    if (mem) {   // 重连：接回原来的座位
      if (mem.ws && mem.ws !== ws) try { mem.ws.close(4000, 'replaced'); } catch {}
      mem.ws = ws; mem.connected = true; mem.offAt = 0;
      if (name && this.state === 'lobby') mem.name = this.uniqueName(name, mem);
    } else {
      mem = { id: this.nextId++, token: randToken(), name: this.uniqueName(name || '客人', null), ws, connected: true, offAt: 0, ack: 0, seat: null };
      this.members.push(mem);
    }
    send(ws, { t: 'welcome', id: mem.id, token: mem.token, name: mem.name });
    this.broadcastLobby();
    if (this.game) this.sync(mem);
    return mem;
  }

  bye(mem) {
    if (!mem) return;
    mem.connected = false; mem.offAt = Date.now(); mem.ws = null;
    if (this.state === 'lobby' && !this.game) {
      setTimeout(() => { if (!mem.connected && this.state === 'lobby' && !this.game) this.remove(mem); }, T.lobbyGrace);
    }
    this.broadcastLobby();
  }

  leave(mem) {   // 主动离开：大厅里直接移出；对局中座位交给 AI
    if (!mem) return;
    if (this.game && this.game.seatOf.has(mem.id)) { this.game.human[this.game.seatOf.get(mem.id)] = null; this.game.seatOf.delete(mem.id); }
    this.remove(mem);
  }

  remove(mem) {
    const i = this.members.indexOf(mem);
    if (i >= 0) this.members.splice(i, 1);
    this.broadcastLobby();
  }

  uniqueName(name, self) {
    let n = name, k = 2;
    while (this.members.some(x => x !== self && x.name === n)) n = name.slice(0, 6) + k++;
    return n;
  }

  host() { return this.members.find(x => x.connected) || this.members[0] || null; }

  lobbyInfo() {
    const h = this.host();
    const live = this.members.filter(x => x.connected || this.game?.seatOf.has(x.id));
    return {
      t: 'lobby', state: this.state, max: MAX_SEATS, hostId: h?.id ?? null,
      members: live.map((x, i) => ({
        id: x.id, name: x.name, connected: x.connected,
        role: this.game ? (this.game.seatOf.has(x.id) ? 'player' : 'watch') : (i < MAX_SEATS ? 'player' : 'watch'),
      })),
    };
  }
  broadcastLobby() { const info = this.lobbyInfo(); for (const x of this.members) send(x.ws, info); }

  // ---------- 开局 ----------
  start(mem) {
    if (this.state !== 'lobby' || this.game) return send(mem.ws, { t: 'error', msg: '游戏已经开始了' });
    if (this.host() !== mem) return send(mem.ws, { t: 'error', msg: '只有房主可以开始' });
    const humans = this.members.filter(x => x.connected).slice(0, MAX_SEATS);
    const ais = shuffle(AIS.slice()).slice(0, MAX_SEATS - humans.length);
    const seats = shuffle([...humans.map(x => ({ mem: x })), ...ais.map(a => ({ ai: a }))]);
    const players = seats.map(s => (s.mem
      ? { name: s.mem.name, human: true, avatar: '🙂' }
      : { name: s.ai[1], avatar: s.ai[0], gender: s.ai[2], voice: s.ai[3] }));
    const st = newGame({ players });
    const g = { st, seatOf: new Map(), human: seats.map(s => s.mem?.id ?? null), v: 1, waiting: null, queenWait: null, hands: new WeakMap(), handSeq: 0 };
    seats.forEach((s, i) => { if (s.mem) g.seatOf.set(s.mem.id, i); });
    this.game = g; this.state = 'playing';
    for (const x of this.members) x.ack = 0;
    this.broadcastLobby();
    for (const x of this.members) send(x.ws, { t: 'start', seat: this.seatOf(x), v: g.v, view: this.view(x) });
    this.run(g).catch(e => { console.error('对局出错', e); this.endGame(g); });
  }

  seatOf(mem) { return this.game?.seatOf.has(mem.id) ? this.game.seatOf.get(mem.id) : -1; }
  handId(arr) { const g = this.game; if (!g.hands.has(arr)) g.hands.set(arr, ++g.handSeq); return g.hands.get(arr); }
  view(mem, opts) { return redact(this.game.st, this.seatOf(mem), a => this.handId(a), opts); }
  memberAt(seat) { const id = this.game.human[seat]; return id == null ? null : this.members.find(x => x.id === id) || null; }
  sync(mem) { const g = this.game; mem.ack = g.v; send(mem.ws, { t: 'sync', seat: this.seatOf(mem), v: g.v, view: this.view(mem) }); }

  // ---------- 对局主循环（服务器说了算） ----------
  async run(g) {
    const st = g.st;
    await this.waitAcks(g, T.night);
    let last = -1;
    while (this.game === g && st.phase === 'play') {
      if (!this.members.some(x => x.connected)) return this.endGame(g);   // 真人都走了
      const seat = st.pending?.mode === 'answer' ? st.pending.seat : st.turn;
      if (seat !== last) await sleep(T.gap);
      last = seat;
      if (this.game !== g) return;
      const mem = this.memberAt(seat);
      let a = null, auto = false;
      if (mem) {
        a = await this.waitAction(g, seat, mem);
        if (this.game !== g) return;
        if (!a) { a = aiStep(st, seat); auto = true; }
      } else a = aiStep(st, seat);
      const evStart = st.events.length;
      try { act(st, seat, a); }
      catch (e) {
        if (mem && !auto) { send(mem.ws, { t: 'error', msg: e.message }); continue; }
        console.warn('AI 出错，改为看苹果', e.message);
        a = { type: 'peekOwn' }; act(st, seat, a);
      }
      if (!mem && a.type === 'peekOwn') { const val = aiAfterPeek(st, seat); if (val) { try { remarkAfterPeek(st, seat, val); a = { ...a, remark: val }; } catch {} } }
      g.v++;
      for (const x of this.members) send(x.ws, { t: 'up', v: g.v, seat, a: publicAction(a), auto, evStart, view: this.view(x) });
      await this.waitAcks(g, T.ack);
    }
    if (this.game !== g) return;
    await this.settle(g);
  }

  // 等某个真人在自己的决策点出手；超时或掉线太久返回 null（由 AI 代打）
  async waitAction(g, seat, mem) {
    const t0 = Date.now();
    g.waiting = { seat, action: null };
    try {
      while (this.game === g) {
        if (g.waiting.action) return g.waiting.action;
        const now = Date.now();
        if (now - t0 > T.turn) return null;
        if (!mem.connected && now - mem.offAt > T.offline) return null;
        if (g.human[seat] == null) return null;   // 主动离开了
        await sleep(100);
      }
      return null;
    } finally { g.waiting = null; }
  }

  onAction(mem, m) {
    const g = this.game;
    if (!g || g.st.phase !== 'play') return;
    const seat = this.seatOf(mem);
    if (seat < 0 || !g.waiting || g.waiting.seat !== seat || g.waiting.action) return send(mem.ws, { t: 'error', msg: '现在不是你的行动' });
    if (!m.a || typeof m.a !== 'object' || typeof m.a.type !== 'string') return;
    g.waiting.action = cleanAction(m.a);
  }

  onAck(mem, v) { if (Number.isInteger(v) && v > mem.ack) mem.ack = v; }

  // 等所有在线的入座真人把第 v 步看完（演出 + 语音），最多等 limit 毫秒
  async waitAcks(g, limit) {
    const t0 = Date.now();
    while (this.game === g && Date.now() - t0 < limit) {
      const behind = this.members.some(x => x.connected && g.seatOf.has(x.id) && x.ack < g.v);
      if (!behind) return;
      await sleep(80);
    }
  }

  // ---------- 结算 ----------
  async settle(g) {
    const st = g.st;
    const q = queenSeat(st);
    let target = null;
    if (queenCanGive(st)) {
      const mem = this.memberAt(q);
      if (mem && mem.connected) {
        g.queenWait = { target: undefined };
        send(mem.ws, { t: 'queenAsk' });
        const t0 = Date.now();
        while (this.game === g && g.queenWait.target === undefined && Date.now() - t0 < T.queen && (mem.connected || Date.now() - mem.offAt < T.offline)) await sleep(100);
        target = g.queenWait.target;
        g.queenWait = null;
      }
      if (!Number.isInteger(target) || target === q || target < 0 || target >= st.n || st.players[target].killed) target = aiQueenTarget(st);
    }
    if (this.game !== g) return;
    settleQueen(st, target);
    const qv = new Map(), rv = new Map();
    for (const x of this.members) { qv.set(x, this.view(x)); rv.set(x, this.view(x, { allRoles: true })); }
    settleFinish(st);
    g.v++;
    for (const x of this.members) send(x.ws, { t: 'settled', v: g.v, queen: qv.get(x) || this.view(x), roles: rv.get(x) || this.view(x, { allRoles: true }), final: this.view(x) });
    this.endGame(g);
  }

  onQueen(mem, target) {
    const g = this.game;
    if (!g?.queenWait || this.seatOf(mem) !== queenSeat(g.st)) return;
    g.queenWait.target = Number(target);
  }

  endGame(g) {
    if (this.game !== g) return;
    this.game = null; this.state = 'lobby';
    // 对局中掉线、一直没回来的人移出房间
    this.members = this.members.filter(x => x.connected);
    this.broadcastLobby();
  }
}

// ---------- 小工具 ----------
export function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function cleanName(s) { return String(s ?? '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 8); }
function randToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
// 只收需要的字段，防止乱塞
function cleanAction(a) {
  const o = { type: String(a.type) };
  for (const k of ['idx', 'target', 'keep', 'yes']) if (a[k] !== undefined) o[k] = k === 'yes' ? !!a[k] : Number(a[k]);
  if (a.opt !== undefined) o.opt = typeof a.opt === 'number' ? a.opt : String(a.opt).slice(0, 16);
  if (Array.isArray(a.targets)) o.targets = a.targets.slice(0, 2).map(Number);
  if (Array.isArray(a.order)) o.order = a.order.slice(0, 8).map(Number);
  if (a.claim && typeof a.claim === 'object') {
    o.claim = { type: String(a.claim.type) };
    if (a.claim.value !== undefined) o.claim.value = String(a.claim.value);
    if (a.claim.about !== undefined) o.claim.about = Number(a.claim.about);
  }
  return o;
}
// 发给大家的动作：去掉只有本人该知道的细节（整理牌堆时的放回顺序）
function publicAction(a) { const o = { ...a }; if (o.type === 'arrange') { delete o.order; delete o.keep; } return o; }
