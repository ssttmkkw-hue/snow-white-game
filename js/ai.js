// 简单模拟 AI：只用自己“看得到”的信息（身份、看过的苹果/角色/手牌、桌前提问卡、公开动作、发言）。
// 以后接大模型：把 viewFor(st, v) 喂给模型即可。
import { ROLES, CARDS, isFinal, legalMain, cardPlayable, cardDiscardable, validTarget, targetable, queenSeat, canSay } from './engine.js';

export let TALK = true;
export function setTalk(on) { TALK = on; }

const rand = Math.random;
const pick = a => a[Math.floor(rand() * a.length)];
const others = (st, v) => st.players.filter(p => p.seat !== v).map(p => p.seat);
const known = (st, v, s) => st.know[v][st.players[s].apple];
const roleOf = (st, s) => st.players[s].role;
const side = (st, v) => ({ snow: 'snow', queen: 'queen', rose: 'rose' })[ROLES[roleOf(st, v)].team];
const can = (st, v, s) => s !== v && targetable(st, s, v);

// ---------- 听话：谎言与软情报 ----------
export function liesCaught(st, v, s) {
  let n = 0;
  for (const c of st.claims) {
    if (c.seat !== s || s === v) continue;
    if (c.type === 'apple') { const k = st.know[v][c.aboutApple]; if (k && k !== c.value) n++; }
    else if (c.type === 'role') { if (st.roleKnow[v][s] && roleOf(st, s) !== c.value) n++; }
  }
  return n;
}
const trusted = (st, v, s) => liesCaught(st, v, s) === 0;
export function soft(st, v, s) {
  const id = st.players[s].apple;
  if (st.know[v][id]) return st.know[v][id];
  let score = 0;
  for (const c of st.claims) if (c.type === 'apple' && c.aboutApple === id && c.seat !== v && trusted(st, v, c.seat)) score += c.value === 'poison' ? 1 : -1;
  return score > 0 ? 'poison' : score < 0 ? 'normal' : undefined;
}

// ---------- 身份推理：v 眼中 s 是各角色的概率 ----------
export function roleDist(st, v, s) {
  const out = {};
  if (st.roleKnow[v][s]) { out[roleOf(st, s)] = 1; return out; }
  const takenByKnown = new Set();
  for (const o of st.players) if (o.seat !== s && st.roleKnow[v][o.seat]) takenByKnown.add(roleOf(st, o.seat));
  const lies = liesCaught(st, v, s);
  // 被别人（可信的）点名“你是罗泽” → 稍微更像罗泽（这是调侃，权重很轻）
  let roseCalls = 0;
  for (const c of st.claims) if (c.type === 'rose' && c.about === s && c.seat !== v && trusted(st, v, c.seat)) roseCalls++;
  let tot = 0;
  for (const [rk, r] of Object.entries(ROLES)) {
    if (takenByKnown.has(rk)) continue;
    let w = 1;
    if (rk !== 'navy') for (const pf of st.players[s].prefs) if ((r.food === pf.q) !== pf.yes) { w = 0; break; }
    if (st.wrongGuess) for (const g of st.wrongGuess) if (g.seat === s && g.role === rk) w = 0;
    if (lies > 0) w *= r.team === 'snow' ? 0.15 : 2;
    if (roseCalls && rk === 'rose') w *= Math.pow(1.35, Math.min(roseCalls, 3));
    if (st.players[s].used && rk !== 'light' && rk !== 'grey') w = 0;
    for (const c of st.claims) if (c.type === 'role' && c.seat === s && c.value === rk && trusted(st, v, s)) w *= 2;
    if (w > 0) { out[rk] = w; tot += w; }
  }
  for (const k in out) out[k] /= tot || 1;
  return out;
}
export const snowP = (st, v, s) => (s === v ? (roleOf(st, v) === 'snow' ? 1 : 0) : (roleDist(st, v, s).snow || 0));
export const queenP = (st, v, s) => (s === v ? (roleOf(st, v) === 'queen' ? 1 : 0) : (roleDist(st, v, s).queen || 0));

function best(st, v, fn, filter = () => true) {
  let b = -1, bw = -1;
  for (const s of others(st, v)) {
    if (!filter(s) || st.players[s].killed) continue;
    const w = fn(st, v, s) + rand() * 0.02;
    if (w > bw) { bw = w; b = s; }
  }
  return b;
}
const snowGuess = (st, v) => (roleOf(st, v) === 'snow' ? v : best(st, v, snowP));
const hasDodge = (st, v, s) => !!st.handKnow[v][s]?.cards?.includes('dodge');

// ---------- 最后一轮：这是不是我最后一次行动 ----------
// 最后一轮里每人只剩一次行动，只有自己知道的情报（偷看苹果、魔镜）已经派不上用场；
// 这时要挑真正能改变结局的事做：换苹果、杀人、绑住还没行动的人、把关键牌递给白雪……
export function lastChance(st, v) {
  if (!isFinal(st)) return false;
  const base = st.baton ? st.baton.from : st.turn;
  const left = st.finalTurnsLeft - 1;          // 这一步之后还剩几次行动
  for (let i = 1; i <= left; i++) if ((base + i) % st.n === v) return false;
  return true;
}
// 这一步之后，最后一轮里还会行动的人
function actorsAfter(st) {
  if (!isFinal(st)) return [];
  const base = st.baton ? st.baton.from : st.turn, out = [];
  for (let i = 1; i <= st.finalTurnsLeft - 1; i++) { const s = (base + i) % st.n; if (!st.players[s].killed && !out.includes(s)) out.push(s); }
  return out;
}
// v 眼中每颗苹果是毒的概率：看过的就是 0/1；可信的人说过的偏向那边；其余按“剩下的毒苹果 / 剩下没看过的苹果”
function poisonOdds(st, v) {
  const kn = st.know[v]; let kp = 0, kc = 0;
  for (const a of st.apples) if (kn[a.id]) { kc++; if (kn[a.id] === 'poison') kp++; }
  const prior = Math.min(1, Math.max(0, (st.poison - kp) / Math.max(1, st.n - kc)));
  return id => {
    if (kn[id]) return kn[id] === 'poison' ? 1 : 0;
    let sc = 0;
    for (const c of st.claims) if (c.type === 'apple' && c.aboutApple === id && c.seat !== v && trusted(st, v, c.seat)) sc += c.value === 'poison' ? 1 : -1;
    return sc > 0 ? Math.max(prior, 0.8) : sc < 0 ? Math.min(prior, 0.2) : prior;
  };
}
// 按 v 的阵营给“谁手里是哪颗苹果”打分（map: 座位 → 苹果 id）。只看结尾咬苹果这一刻：
//   白雪阵营：白雪别吃到毒（最重要）、罗泽吃到毒、女王手里别有毒（她会指定人吃）
//   女王阵营：白雪吃到毒、女王手里有毒；罗泽：白雪和自己都别吃到毒
function teamValue(st, v, pz, map) {
  const my = roleOf(st, v), sd = side(st, v);
  let u = 0;
  for (const p of st.players) {
    if (p.killed) continue;
    const s = p.seat, z = pz(map[s]);
    const d = s === v ? { [my]: 1 } : roleDist(st, v, s);
    const ps = d.snow || 0, pr = d.rose || 0, pq = d.queen || 0;
    if (sd === 'snow') u += ps * (1 - z) + pr * z * 0.6 - pq * z * 0.35;
    else if (sd === 'queen') u += ps * z + pq * z * 0.35;
    else u += ps * (1 - z) + (s === v ? (1 - z) * 1.2 : 0) - pq * z * 0.35;
  }
  return u;
}
const SWAP_W = 12;   // 苹果分差 → 与出牌估值同一量级

// ---------- 出牌评估 ----------
function rouletteOutcome(st, dir, times = 1) {
  const P = st.players;
  const seats = P.filter(p => !p.warded).map(p => p.seat);
  const L = seats.length, res = {};
  seats.forEach((s, i) => { res[s] = dir === 'cw' ? P[seats[((i - times) % L + L) % L]].apple : P[seats[(i + times) % L]].apple; });
  return res;
}
function appleScore(st, v, appleId) { // 对 v 而言这颗苹果“毒”的估计 1=毒 0=好 0.5=不知
  const k = st.know[v][appleId];
  return k === 'poison' ? 1 : k === 'normal' ? 0 : st.poison / st.n;
}

function cardOptions(st, v) {
  const me = st.players[v], my = roleOf(st, v), sd = side(st, v);
  const sw = snowGuess(st, v), swP = sw === v ? 1 : snowP(st, v, sw);
  const q = best(st, v, queenP), qP = q >= 0 ? queenP(st, v, q) : 0;
  const tg = s => can(st, v, s) && !st.players[s].killed;
  // 规则：罗泽基本暴露后（概率 > 0.5），白雪阵营优先针对罗泽——罗泽活着、白雪也活着，就是罗泽独赢
  const roseOf = (a, b, c) => roleDist(a, b, c).rose || 0;
  const roseP = s => roseOf(st, v, s);
  const rz = sd === 'snow' && my !== 'rose' ? best(st, v, roseOf, s => tg(s)) : -1;
  const rp = rz >= 0 ? roseP(rz) : 0;
  const huntRose = rp > 0.5;
  const last = lastChance(st, v), after = last ? actorsAfter(st) : [];
  const allyAfter = after.some(s => st.roleKnow[v][s] && ROLES[roleOf(st, s)].team === ROLES[my].team) || after.length >= 3;
  const opts = [];
  me.hand.forEach((card, idx) => {
    if (!cardPlayable(st, v, card)) return;
    const add = (value, target = null, opt) => { if (CARDS[card].target === 'none' || validTarget(st, v, card, target)) opts.push({ idx, card, target, opt, value }); };
    switch (card) {
      case 'mirror': {
        const ua = others(st, v).filter(s => tg(s) && known(st, v, s) === undefined).sort((a, b) => (b === sw) - (a === sw) + (rand() - 0.5) * 0.5)[0];
        if (ua !== undefined) add(5, ua, 'apple');
        const focus = sd === 'queen' ? snowP : queenP;
        const ur = others(st, v).filter(s => tg(s) && !st.roleKnow[v][s]).sort((a, b) => focus(st, v, b) - focus(st, v, a))[0];
        if (ur !== undefined) add(4 + 2 * focus(st, v, ur), ur, 'role');
        if (rz >= 0 && rp > 0.3 && rp < 0.85 && !st.roleKnow[v][rz]) add(4 + 3 * rp, rz, 'role');   // 确认罗泽
        break;
      }
      case 'truth': {
        if (sd === 'queen' && sw >= 0 && sw !== v && tg(sw) && !st.roleKnow[v][sw]) add(swP >= 0.45 ? 3 + 6 * swP : 0.3, sw, 'snow');
        else if (sd === 'queen' && sw >= 0 && st.roleKnow[v][sw] && !st.players[sw].roleUp && tg(sw)) add(8, sw, 'snow'); // 确知白雪 → 当众揭穿
        if (sd !== 'queen' && q >= 0 && tg(q) && !st.players[q].roleUp) add(qP >= 0.35 ? 3 + 5 * qP : 0.3, q, 'queen');
        if (rz >= 0 && !st.players[rz].roleUp && rp > 0.35) add(3 + 6 * rp, rz, 'rose');
        break;
      }
      case 'likeApple': case 'likeShroom': {
        const q = card === 'likeApple' ? 'apple' : 'mushroom';
        // 白雪阵营：优先追问“已经横放过一次、另一题还没问”的人（找罗泽）
        const prio = s => {
          const pf = st.players[s].prefs;
          if (pf.some(x => x.q === q)) return -1;
          let w = 2 - pf.length;
          if (sd === 'snow' && pf.length === 1 && !pf[0].yes) w += 2;
          return w + rand() * 0.5;
        };
        const t = others(st, v).filter(s => tg(s) && !st.roleKnow[v][s] && !(my === 'green' && s === sw)).sort((a, b) => prio(b) - prio(a))[0];
        if (t !== undefined && prio(t) >= 0) add(2 + prio(t), t);
        break;
      }
      case 'roulette': case 'roulette2': {
        const evalDir = dir => {
          const res = rouletteOutcome(st, dir, card === 'roulette2' ? 2 : 1);
          let sc = 0;
          if (sd === 'queen') { if (res[sw] !== undefined) sc += appleScore(st, v, res[sw]) * 4; if (my === 'queen' && res[v] !== undefined) sc += appleScore(st, v, res[v]) * 2; }
          else { if (res[sw] !== undefined) sc -= appleScore(st, v, res[sw]) * 4; if ((my === 'rose' || my === 'snow') && res[v] !== undefined) sc -= appleScore(st, v, res[v]) * 3; }
          return sc;
        };
        const cw = evalDir('cw'), ccw = evalDir('ccw');
        const now = sd === 'queen' ? appleScore(st, v, st.players[Math.max(sw, 0)].apple) * 4 : -appleScore(st, v, st.players[Math.max(sw, 0)].apple) * 4;
        const bestDir = cw >= ccw ? 'cw' : 'ccw';
        const gain = Math.max(cw, ccw) - now;
        add(gain > 1 ? 5 : gain >= -0.2 ? 0.3 : -1, null, bestDir);
        break;
      }
      case 'baton': {
        // 把额外行动交给确定的自己人（格林→白雪 等），否则价值很低
        const friends = others(st, v).filter(s => tg(s) && st.roleKnow[v][s] && ROLES[roleOf(st, s)].team === ROLES[my].team);
        const sosSw = sd === 'snow' && sw >= 0 && sw !== v && tg(sw) && soft(st, v, sw) === 'poison';
        if (sosSw) add(7, sw);
        else if (friends.length) add(2.5, pick(friends));
        else { const t = others(st, v).find(s => tg(s)); if (t !== undefined) add(0.3, t); }
        break;
      }
      case 'knife': {
        const t = others(st, v).filter(s => tg(s) && known(st, v, s) === undefined && !hasDodge(st, v, s)).sort((a, b) => (b === sw) - (a === sw))[0];
        if (t !== undefined) add(2.5, t);
        if (huntRose && tg(rz) && known(st, v, rz) === undefined && !hasDodge(st, v, rz)) add(3.5, rz);
        break;
      }
      case 'rope': {
        const t = sd === 'queen' ? sw : q;
        const conf = sd === 'queen' ? swP : qP;
        if (t >= 0 && t !== v && tg(t) && !hasDodge(st, v, t)) add(isFinal(st) ? 4 + 2 * conf : 0.8 + 2 * conf, t);
        if (huntRose && tg(rz) && !hasDodge(st, v, rz)) add(isFinal(st) ? 6.5 : 2.2, rz);
        break;
      }
      case 'comb': {
        if (sd === 'queen' && sw >= 0 && sw !== v && tg(sw) && !hasDodge(st, v, sw)) add(6 + 6 * swP, sw);
        else if (sd !== 'queen' && q >= 0 && tg(q) && !hasDodge(st, v, q)) add(4 + 5 * qP, q);
        if (rz >= 0 && rp > 0.3 && !hasDodge(st, v, rz)) add(huntRose ? 10 + rp : 3 + 7 * rp, rz);
        break;
      }
      case 'itadaki': add(isFinal(st) ? 0.2 : 1.6, null, st.deck.length <= 6 ? 3 : 2); break;
      case 'plan': add(st.deck.length ? 3 : 0.2); break;
    }
  });
  if (last) {
    const pz = poisonOdds(st, v), map = st.players.map(p => p.apple), base = teamValue(st, v, pz, map);
    for (const o of opts) {
      switch (o.card) {
        case 'mirror': o.value = 0.1; break;                                   // 只有自己知道，用不上了
        case 'itadaki': case 'plan': o.value = -1; break;                     // 牌堆已空，打了等于没打
        case 'likeApple': case 'likeShroom': o.value = sd === 'queen' ? o.value : 0.2; break;  // 问出白雪是谁只对女王结尾指人有用
        case 'rope': if (!after.includes(o.target)) o.value = 0; break;        // 他已经行动过了，绑了也没用
        case 'knife': o.value = allyAfter ? 1.5 : 0.1; break;                  // 公开苹果，要有人在后面接着利用
        case 'truth': if (sd !== 'queen' && o.opt === 'queen') o.value = 0.5; break;   // 女王结尾自己会现身
        case 'baton': if (o.value < 1) o.value = 0.1; break;
        case 'roulette': case 'roulette2': {
          const res = rouletteOutcome(st, o.opt, o.card === 'roulette2' ? 2 : 1);
          const m = map.slice(); for (const [k, id] of Object.entries(res)) m[k] = id;
          o.value = SWAP_W * (teamValue(st, v, pz, m) - base);
          break;
        }
      }
    }
  }
  return opts.sort((a, b) => b.value - a.value);
}
function keepVal(st, v, c) {
  if (lastChance(st, v)) {   // 以后用不上了：只有“留在手里就生效”的牌还有价值
    const my = roleOf(st, v);
    return c === 'ring' ? 99 : c === 'dodge' ? 3 : c === 'prince' ? (my === 'snow' ? 10 : 0) : 0;
  }
  const my = roleOf(st, v), sd = side(st, v);
  switch (c) {
    case 'ring': return 99;
    case 'dodge': return 7;
    case 'prince': return my === 'snow' ? 10 : sd === 'snow' ? 5 : 1;
    case 'comb': return sd === 'queen' ? 7 : 5;
    case 'mirror': return 4; case 'truth': return 3.5; case 'baton': return 2; case 'roulette2': return 3; case 'rope': return 3.5; case 'roulette': return 3;
    case 'likeApple': case 'likeShroom': return 3; case 'knife': return 2.5; case 'plan': return 2.5; case 'itadaki': return 1;
  }
  return 1;
}

// 抽牌后手里有两张、必须送走一张：比较“送走哪张”。
// 送走第 i 张的得分 = max(打出它的效果, 弃掉=0) − 它留着的价值。打出效果为正就打，比白白弃掉强。
function chooseAfterDraw(st, v) {
  const me = st.players[v];
  const opts = cardOptions(st, v);
  let bestPick = null;
  me.hand.forEach((c, i) => {
    const o = opts.filter(x => x.idx === i)[0];          // cardOptions 已按价值排好序
    const playV = o ? o.value : -Infinity;
    const discV = cardDiscardable(c) ? 0 : -Infinity;
    const gain = Math.max(playV, discV);
    if (gain === -Infinity) return;
    const score = gain - keepVal(st, v, c) * 0.6 + rand() * 0.05;
    if (!bestPick || score > bestPick.score) bestPick = { i, score, o, play: playV > 0.05 && playV >= discV };
  });
  if (!bestPick) return opts[0] ? { type: 'play', idx: opts[0].idx, target: opts[0].target, opt: opts[0].opt } : { type: 'discard', idx: 0 };
  if (bestPick.play) return { type: 'play', idx: bestPick.i, target: bestPick.o.target, opt: bestPick.o.opt };
  return { type: 'discard', idx: bestPick.i };
}

export function aiArrange(st, v) {
  const hand = st.players[v].hand;
  let keep = hand.indexOf('ring');
  if (keep < 0) hand.forEach((c, i) => { if (keep < 0 || keepVal(st, v, c) > keepVal(st, v, hand[keep])) keep = i; });
  const order = hand.map((_, i) => i).filter(i => i !== keep).sort(() => rand() - 0.5);
  return { type: 'arrange', keep, order };
}

function storyWorth(st, v) {
  const L = legalMain(st, v);
  if (!L.story) return -1;
  const o = cardOptions(st, v)[0];
  return st.deck.length ? Math.max(o ? o.value : 0, 3) : (o ? o.value : 0);
}

// ---------- 说话 ----------
// 主动乱报阵营、报别人的苹果都很蠢，线下也没人这么干。只保留三种自然的时机：
//   1) 真的偷看过自己的苹果之后，偶尔接一句“我的苹果是好的/毒的”（女王阵营可能说反话）
//   2) 调侃“我觉得 X 是罗泽！”（大家最爱的梗）
//   3) 被人说是罗泽时，回一句“我才不是罗泽！”
// 话多话少看性格：溜溜、小鹿最爱说；点点偶尔；其余四人几乎不说。
const TALKY = { liuliu: 1, xiaolu: 1, diandian: 0.55, nuonuo: 0.25, shitou: 0.15, tantan: 0.15, yeying: 0.1 };
export const talkLevel = (st, v) => TALKY[st.players[v].voice] ?? 0.4;
const myClaims = (st, v, type) => st.claims.filter(c => c.seat === v && c.type === type);
const lastTurnOf = (st, v) => { for (let i = st.events.length - 1; i >= 0; i--) { const e = st.events[i]; if ((e.seat === v || e.a === v) && e.t < st.turnCount) return e.t; } return -1; };

// 刚偷看完自己的苹果：偶尔顺口说一句。白雪这边说真话；女王阵营可能借机撒谎（女王拿着毒苹果时最想装无辜）
export function aiAfterPeek(st, v) {
  const lv = talkLevel(st, v), my = roleOf(st, v), sd = side(st, v);
  const me = st.players[v], mine = st.know[v][me.apple];
  if (!mine || st.apples[me.apple].up) return null;
  if (st.claims.some(c => c.seat === v && c.type === 'apple' && c.aboutApple === me.apple)) return null;
  if (sd === 'queen') {
    if (my === 'queen' && mine === 'poison') return rand() < 0.4 * lv ? 'normal' : null;   // 骗人
    if (rand() < 0.12 * lv) return mine === 'poison' ? 'normal' : 'poison';
    return rand() < 0.1 * lv ? mine : null;
  }
  return rand() < 0.22 * lv ? mine : null;
}

export function aiSay(st, v) {
  const lv = talkLevel(st, v);
  const my = roleOf(st, v), sd = side(st, v);
  const me = st.players[v];

  // 3) 被点名是罗泽 → 否认（话少的人也会回一句）
  const since = lastTurnOf(st, v);
  const calledRose = st.claims.some(c => c.type === 'rose' && c.about === v && c.turn > since);
  if (calledRose && !myClaims(st, v, 'notRose').some(c => c.turn > since) && rand() < Math.max(lv, 0.35) * 0.8) return { type: 'notRose' };

  // （“我的苹果是…”不再在这里主动说，只在刚偷看完时由 aiAfterPeek 偶尔接一句）

  // 2) 调侃谁是罗泽：有人两张提问卡都横放 → 很像；否则偶尔随口一说
  const roseP = s => roleDist(st, v, s).rose || 0;
  const said = new Set(myClaims(st, v, 'rose').map(c => c.about));
  if (said.size < 2) {
    const cand = others(st, v).filter(s => !st.players[s].killed && !said.has(s) && !(my === 'rose' && false));
    const t = cand.sort((a, b) => roseP(b) - roseP(a))[0];
    if (t !== undefined) {
      const p = roseP(t);
      const chance = (p > 0.3 ? 0.3 : st.round <= 2 ? 0.07 : 0.04) * lv;
      if (rand() < chance) return { type: 'rose', about: p > 0.3 ? t : pick(cand) };
    }
  }
  return null;
}

// 最后一次行动：把所有“真能改变结局”的选项放在一起比，挑最好的；偷看自己的苹果当作“什么都不做”的基准
function finalMove(st, v) {
  const me = st.players[v], L = legalMain(st, v), my = roleOf(st, v), sd = side(st, v);
  const pz = poisonOdds(st, v), map = st.players.map(p => p.apple), base = teamValue(st, v, pz, map);
  const gain = m => SWAP_W * (teamValue(st, v, pz, m) - base);
  const ot = others(st, v).filter(s => can(st, v, s) && !st.players[s].killed);
  const cands = [{ a: { type: 'peekOwn' }, val: 0 }];
  for (const t of ot) { const m = map.slice(); [m[v], m[t]] = [m[t], m[v]]; cands.push({ a: { type: 'swapApple', target: t }, val: gain(m) }); }
  if (L.ability && my === 'light') {
    const pool = [v, ...ot];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const m = map.slice(); [m[pool[i]], m[pool[j]]] = [m[pool[j]], m[pool[i]]];
      cands.push({ a: { type: 'ability', targets: [pool[i], pool[j]] }, val: gain(m) - 0.05 });
    }
  }
  if (L.ability && my === 'grey') cands.push({ a: { type: 'ability' }, val: actorsAfter(st).length ? 0.3 : 0 });   // 护住自己到结尾
  if (L.story) { const o = cardOptions(st, v)[0]; if (o) cands.push({ a: { type: 'story' }, val: o.value }); }
  // 手牌：把【哎呀好危险】（挡毒梳子）/【王子大人】（被毒死能复活）递给白雪
  const sw = snowGuess(st, v);
  if (sd === 'snow' && my !== 'snow' && L.swapHand && sw >= 0 && sw !== v && can(st, v, sw) && !st.handKnow[v][sw]?.cards?.includes('ring')) {
    const conf = my === 'green' ? 1 : snowP(st, v, sw);
    const combLive = !st.discard.includes('comb') && !st.players.some(p => p.killedBy === 'comb');
    let val = 0;
    if (me.hand.includes('prince')) val = Math.max(val, 8 * conf * pz(map[sw]));
    if (me.hand.includes('dodge') && combLive) val = Math.max(val, 2.5 * conf);
    if (val > 0) cands.push({ a: { type: 'swapHand', target: sw }, val });
  }
  cands.sort((a, b) => b.val - a.val || rand() - 0.5);
  return cands[0].a;
}

// ---------- 主决策 ----------
export function aiStep(st, v) {
  if (st.pending?.mode === 'choose') return chooseAfterDraw(st, v);
  if (st.pending?.mode === 'arrange') return aiArrange(st, v);
  if (st.pending?.mode === 'answer') return { type: 'answer', yes: st.pending.q === 'apple' };
  if (TALK && canSay(st, v)) { const cl = aiSay(st, v); if (cl) return { type: 'say', claim: cl }; }
  const me = st.players[v], my = roleOf(st, v), sd = side(st, v);
  const L = legalMain(st, v);
  const mine = soft(st, v, v);
  const sw = snowGuess(st, v);
  const ot = others(st, v).filter(s => can(st, v, s) && !st.players[s].killed);
  const sortHard = arr => arr.sort((a, b) => (known(st, v, b) ? 1 : 0) - (known(st, v, a) ? 1 : 0));
  const poisonAt = sortHard(ot.filter(s => soft(st, v, s) === 'poison'));
  const normalAt = sortHard(ot.filter(s => soft(st, v, s) === 'normal'));
  const story = storyWorth(st, v);
  const qGuess = () => best(st, v, queenP, s => can(st, v, s));
  const fallback = () => (L.story && story > 0 ? { type: 'story' } : known(st, v, v) === undefined ? { type: 'peekOwn' } : (L.story && st.deck.length) ? { type: 'story' } : { type: 'peekOwn' });

  // 诅咒戒指：赶紧送走
  if (me.hand.includes('ring') && L.swapHand) {
    const t = sd === 'queen' ? best(st, v, snowP, s => can(st, v, s)) : qGuess();
    if (t >= 0 && can(st, v, t)) return { type: 'swapHand', target: t };
  }
  // 最后一轮、这是我最后一次行动：只做真能改变结局的事
  if (lastChance(st, v)) return finalMove(st, v);
  // 王子大人：白雪阵营想让白雪拿到
  if (me.hand.includes('prince') && sd === 'snow' && my !== 'snow' && sw >= 0 && sw !== v && can(st, v, sw) && (my === 'green' || snowP(st, v, sw) > 0.5)) {
    if (!st.players[sw].hand.includes('ring') || !st.handKnow[v][sw]) return { type: 'swapHand', target: sw };
  }
  const late = isFinal(st) || st.deck.length <= 5;
  const swSure = sw >= 0 && sw !== v && (my === 'green' || snowP(st, v, sw) > 0.55);
  if (sd === 'snow' && my !== 'snow' && swSure && can(st, v, sw) && !me.hand.includes('ring')) {
    // 有人（不是确定的自己人）刚和白雪换过手牌 → 白雪可能拿到了诅咒戒指，接过来
    const lastSwap = [...st.events].reverse().find(e => e.k === 'swapHand' && (e.a === sw || e.b === sw));
    if (lastSwap && late) {
      const other = lastSwap.a === sw ? lastSwap.b : lastSwap.a;
      const friend = other === v || (st.roleKnow[v][other] && ROLES[roleOf(st, other)].team === 'snow');
      if (!friend && !(st.handKnow[v][sw] && st.handKnow[v][sw].turn >= lastSwap.t)) return { type: 'swapHand', target: sw };
    }
    // 把【哎呀好危险】/【王子大人】递给白雪
    if (me.hand.includes('dodge') && !st.handKnow[v][sw]?.cards?.includes('dodge') && (late || (my === 'green' && rand() < 0.6))) return { type: 'swapHand', target: sw };
  }
  if (my === 'snow' && !me.hand.includes('prince') && !me.hand.includes('dodge')) {
    const holder = ot.find(s => st.handKnow[v][s]?.cards?.includes('prince'));
    if (holder !== undefined) return { type: 'swapHand', target: holder };
  }

  if (sd !== 'queen') {
    if (L.ability && my === 'light' && sw !== v) {
      if (sw >= 0 && soft(st, v, sw) === 'poison' && can(st, v, sw)) {
        const dst = normalAt.filter(s => s !== sw)[0] ?? qGuess();
        if (dst >= 0 && dst !== sw) return { type: 'ability', targets: [sw, dst] };
      }
      const q = qGuess();
      if (isFinal(st) && q >= 0 && soft(st, v, q) !== 'normal' && queenP(st, v, q) > 0.4) {
        const src = normalAt.filter(s => s !== q)[0];
        if (src !== undefined) return { type: 'ability', targets: [q, src] };
      }
    }
    if (L.ability && my === 'grey' && isFinal(st) && mine === 'normal' && rand() < 0.4) return { type: 'ability' };

    if (my === 'snow' || my === 'rose') {
      if (mine === 'poison') {
        const t = normalAt.sort((a, b) => queenP(st, v, b) - queenP(st, v, a))[0] ?? qGuess();
        if (t >= 0) return { type: 'swapApple', target: t };
      }
      if (late && mine !== 'normal') {
        const hardNormal = normalAt.filter(s => known(st, v, s) === 'normal');
        if (hardNormal.length) return { type: 'swapApple', target: hardNormal.sort((a, b) => queenP(st, v, b) - queenP(st, v, a))[0] };
      }
      if (known(st, v, v) === undefined && rand() < 0.7) return { type: 'peekOwn' };
      if (my === 'snow' || sw < 0) return fallback();
    }
    // 护驾：白雪手里是毒苹果 → 换过来自己吃
    if (sw >= 0 && sw !== v && soft(st, v, sw) === 'poison' && can(st, v, sw)) {
      const conf = my === 'green' ? 1 : snowP(st, v, sw);
      if (conf > 0.35 || isFinal(st)) return { type: 'swapApple', target: sw };
    }
    // 罗泽活着会独胜 → 把毒苹果塞给最像罗泽的人
    if (my !== 'rose') {
      const roseP = (a, b, c) => roleDist(a, b, c).rose || 0;
      const rz = best(st, v, roseP, s => can(st, v, s) && s !== sw);
      const rp = rz >= 0 ? roseP(st, v, rz) : 0;
      if (rz >= 0 && rp > 0.35 && soft(st, v, rz) !== 'poison') {
        if (mine === 'poison' && (late || rand() < 0.5)) return { type: 'swapApple', target: rz };
        if (L.ability && my === 'light' && late) { const src = poisonAt.find(s => s !== sw && s !== rz); if (src !== undefined) return { type: 'ability', targets: [rz, src] }; }
      }
    }
    // 最后一轮：疑似女王手里有毒 → 用普通苹果换走它
    if (isFinal(st)) {
      const q = qGuess();
      if (q >= 0 && mine === 'normal' && soft(st, v, q) !== 'normal' && queenP(st, v, q) > 0.3) return { type: 'swapApple', target: q };
      // 拿普通苹果去换“爱吃苹果的人”手里不确定的苹果：是白雪就保住她，是女王就缴了她的毒
      if (known(st, v, v) === 'normal' && my !== 'rose') {
        const lover = ot.filter(s => soft(st, v, s) !== 'normal' && ((snowP(st, v, s) + queenP(st, v, s)) > 0.5)).sort((a, b) => (snowP(st, v, b) + queenP(st, v, b)) - (snowP(st, v, a) + queenP(st, v, a)))[0];
        if (lover !== undefined) return { type: 'swapApple', target: lover };
      }
    }
    return fallback();
  }

  // ---- 女王阵营 ----
  if (my === 'queen') {
    if (mine === 'poison') return L.story ? { type: 'story' } : { type: 'peekOwn' };
    const src = poisonAt.sort((a, b) => snowP(st, v, a) - snowP(st, v, b))[0];
    if (src !== undefined) return { type: 'swapApple', target: src };
    if (known(st, v, v) === undefined) return { type: 'peekOwn' };
    return fallback();
  }
  const swOk = sw >= 0 && can(st, v, sw);
  if (mine === 'poison' && swOk && soft(st, v, sw) !== 'poison' && (snowP(st, v, sw) > 0.3 || isFinal(st))) return { type: 'swapApple', target: sw };
  if (mine === 'normal' && poisonAt.length && rand() < 0.5 && !isFinal(st)) {
    const src = poisonAt.filter(s => s !== sw).sort((a, b) => snowP(st, v, a) - snowP(st, v, b))[0];
    if (src !== undefined) return { type: 'swapApple', target: src };
  }
  if (known(st, v, v) === undefined && rand() < 0.6) return { type: 'peekOwn' };
  return fallback();
}

export function aiQueenTarget(st) {
  const q = queenSeat(st);
  return best(st, q, snowP);
}

export function viewFor(st, v) {
  return {
    me: { seat: v, role: roleOf(st, v), hand: st.players[v].hand.slice() },
    players: st.players.map(p => ({
      seat: p.seat, name: p.name, handCount: p.hand.length,
      knownApple: st.know[v][p.apple] || null, appleFaceUp: st.apples[p.apple].up,
      knownRole: st.roleKnow[v][p.seat] ? p.role : null, roleFaceUp: p.roleUp,
      prefs: p.prefs.map(x => ({ q: x.q, yes: x.yes })), warded: p.warded, roped: p.roped, killed: p.killed,
    })),
    claims: st.claims.map(c => ({ seat: c.seat, text: c.text })),
    deck: st.deck.length, final: isFinal(st),
  };
}
