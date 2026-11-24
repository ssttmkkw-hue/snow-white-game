// 林中晚宴·毒苹果 —— 纯规则引擎（无 DOM，可在 node 里跑）
// 规则依据：D:\AI-Space\Codex\桌游卡牌\8人场故事卡使用指南.docx + 8人场角色表.txt
// 状态是普通对象：以后联机同步 / 存档 / 喂给大模型都直接用。

export const TEAMS = { snow: '白雪阵营', queen: '女王阵营', rose: '第三阵营' };
export const FOOD = { apple: '苹果', mushroom: '蘑菇', none: '×' };

export const ROLES = {
  snow:  { name: '白雪公主', short: '白雪', team: 'snow',  food: 'apple',    icon: '👸',
           desc: '没有技能。结算时你活着 → 白雪阵营胜（若罗泽也活着则罗泽独胜）。' },
  green: { name: '格林', short: '格林', team: 'snow', food: 'mushroom', icon: '🟢',
           desc: '开局得知谁是白雪公主。' },
  light: { name: '莱特', short: '莱特', team: 'snow', food: 'apple', icon: '🟡',
           desc: '行动：把角色卡翻为正面，交换任意两名玩家的苹果（保持朝向）。角色卡已正面朝上时不能发动。' },
  grey:  { name: '葛瑞', short: '葛瑞', team: 'snow', food: 'mushroom', icon: '⚪',
           desc: '行动：把角色卡翻为正面。直到你下个回合开始，你不能成为卡牌效果的对象，手牌和苹果也不能被交换。角色卡已正面朝上时不能发动。' },
  queen: { name: '女王', short: '女王', team: 'queen', food: 'apple', icon: '👑',
           desc: '白雪公主死亡 → 女王阵营胜。结尾阶段最先声明身份；若此时持有毒苹果，可以指定一位玩家吃下。' },
  black: { name: '布莱克', short: '布莱克', team: 'queen', food: 'mushroom', icon: '⚫',
           desc: '开局得知毒苹果的位置。' },
  navy:  { name: '奈维', short: '奈维', team: 'queen', food: 'mushroom', icon: '🔵',
           desc: '被【你喜欢苹果吗？】【你喜欢蘑菇吗？】询问时可以撒谎。' },
  rose:  { name: '罗泽', short: '罗泽', team: 'rose', food: 'none', icon: '🌹',
           desc: '第三阵营：白雪公主与你都存活时，你独自获胜，其他人全部失败。喜好为 ×。' },
};

// target: none | other(其他人) | any(含自己)；weapon: 会被【哎呀好危险】挡下；passive: 只能持有不能打出
export const CARDS = {
  mirror:  { name: '魔镜啊魔镜', icon: '🪞', target: 'other', desc: '指定一位玩家，从其角色、苹果、手牌中选一项查看。' },
  truth:   { name: '你这家伙的真面目是……', short: '真面目', icon: '🎭', target: 'other', desc: '指定一位玩家，说出你猜的角色名。猜中则把对方角色卡翻到正面（莱特/葛瑞因此不能再发动能力）。' },
  likeApple: { name: '你喜欢苹果吗？', short: '喜欢苹果吗', icon: '🍎', target: 'other', desc: '把这张牌交给一位玩家：喜欢苹果就竖放，否则横放，留在他桌前。（奈维可以撒谎）' },
  likeShroom:{ name: '你喜欢蘑菇吗？', short: '喜欢蘑菇吗', icon: '🍄', target: 'other', desc: '把这张牌交给一位玩家：喜欢蘑菇就竖放，否则横放，留在他桌前。（奈维可以撒谎）' },
  roulette:{ name: '苹果轮盘赌！', short: '轮盘赌', icon: '🎡', target: 'none', desc: '宣布顺时针或逆时针，所有玩家把自己的苹果传给该方向的相邻玩家（一次）。' },
  roulette2:{ name: '苹果轮盘赌！（转两次）', short: '轮盘赌×2', icon: '🎡', target: 'none', desc: '宣布顺时针或逆时针，所有玩家按该方向传苹果，连续传两次（苹果移动两个座位）。' },
  baton:   { name: '交棒！', short: '交棒', icon: '🤝', target: 'other', desc: '指定一位其他玩家，被指定的玩家立刻进行 1 个行动（之后轮次照常从你的下家继续）。' },
  knife:   { name: '菜刀', icon: '🔪', target: 'other', weapon: true, desc: '武器。指定一位玩家，把他的苹果翻到正面（之后一直正面朝上）。' },
  itadaki: { name: '我开动了', icon: '🍽️', target: 'none', desc: '宣布 1、2 或 3，从牌堆顶弃置相应张数（正面朝上）。' },
  plan:    { name: '今天要做些什么好呢', short: '今天做什么', icon: '📅', target: 'none', desc: '从牌堆顶抽 3 张加入手牌，只保留 1 张，其余按你选的顺序放回牌堆顶。' },
  rope:    { name: '绳索', icon: '🪢', target: 'other', weapon: true, desc: '武器。指定一位玩家，他跳过下一个回合。' },
  comb:    { name: '毒梳子', icon: '🪮', target: 'other', weapon: true, final: true, desc: '武器。只能在最后的回合阶段使用：杀害指定玩家。' },
  dodge:   { name: '哎呀好危险', short: '好危险', icon: '🛡️', passive: true, desc: '持有时，被武器攻击会自动亮出，让那张武器无效，然后收回手牌。' },
  ring:    { name: '诅咒戒指', icon: '💍', passive: true, cursed: true, desc: '不能主动弃置，只能通过交换手牌送出去。最后的回合里，轮到你时手上还是戒指，会立刻被诅咒而死、不能行动；结尾仍持有戒指的玩家也会被杀害。' },
  prince:  { name: '啊，是王子大人', short: '王子大人', icon: '🤴', passive: true, desc: '白雪公主持有这张牌、并且死于毒苹果时，可以复活。' },
};
export const cardName = c => CARDS[c].short || CARDS[c].name;

// 8 人局：故事卡固定 28 张（用户 2026-11-23 定的配比）
export const SETUPS = {
  8: { roles: ['snow', 'green', 'light', 'grey', 'queen', 'black', 'navy', 'rose'], poison: 4,
       deck: { mirror: 2, truth: 1, likeApple: 3, likeShroom: 4, roulette: 2, roulette2: 1, knife: 1,
               itadaki: 3, plan: 2, rope: 3, baton: 1, comb: 1, dodge: 2, ring: 1, prince: 1 } },
};

// ---------- 随机数（可复现） ----------
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function randomDeckCounts(cfg, r) {
  if (cfg.deck) return { ...cfg.deck };
  const keys = Object.keys(CARDS);
  const cnt = Object.fromEntries(keys.map(k => [k, 1]));
  let left = cfg.deckSize - keys.length;
  while (left > 0) {
    const k = keys[Math.floor(r() * keys.length)];
    if (cnt[k] >= (cfg.cap[k] ?? cfg.capDefault)) continue;
    cnt[k]++; left--;
  }
  return cnt;
}

// ---------- 查询 ----------
export const roleOf = (st, s) => st.players[s].role;
export const R = (st, s) => ROLES[st.players[s].role];
export const teamOf = (st, s) => R(st, s).team;
export const appleOf = (st, s) => st.apples[st.players[s].apple];
export const appleType = (st, s) => appleOf(st, s).type;
export const seatOfRole = (st, role) => st.players.findIndex(p => p.role === role);
export const isFinal = st => st.finalTurnsLeft !== null;
const nm = (st, s) => st.players[s].name;
const showApple = t => (t === 'poison' ? '☠️毒苹果' : '🍎普通苹果');

export function log(st, text, vis = 'all', kind = 'info', tag) {
  st.log.push({ i: st.log.length, text, vis, kind, turn: st.turnCount, round: st.round, ...(tag ? { tag } : {}) });
}
export const visibleLog = (st, seat) => st.log.filter(e => e.vis === 'all' || e.vis === seat);
function ev(st, e) { e.t = st.turnCount; st.events.push(e); }

// ---------- 建局 ----------
export function newGame({ players, seed = (Date.now() & 0x7fffffff), setup } = {}) {
  const n = players.length;
  const cfg = setup || SETUPS[n];
  if (!cfg) throw new Error(`暂时只支持 ${Object.keys(SETUPS).join('/')} 人局`);
  const r = rng(seed);
  const roles = shuffle(cfg.roles.slice(), r);
  const apples = shuffle(Array.from({ length: n }, (_, i) => (i < cfg.poison ? 'poison' : 'normal')), r).map((type, id) => ({ id, type, up: false }));
  const deckCounts = randomDeckCounts(cfg, r);
  const deck = [];
  for (const [k, v] of Object.entries(deckCounts)) for (let i = 0; i < v; i++) deck.push(k);
  shuffle(deck, r);

  const st = {
    seed, n, poison: cfg.poison, deckCounts,
    apples,
    players: players.map((p, i) => ({
      seat: i, name: p.name, human: !!p.human, avatar: p.avatar || '', gender: p.gender || '', voice: p.voice || '',
      role: roles[i], roleUp: false, used: false,
      apple: i, hand: [deck.pop()],
      warded: false, roped: false, killed: false, killedBy: null,   // killedBy: 'comb' | 'ring'
      prefs: [],            // 桌前的提问卡 {q:'apple'|'mushroom', yes, by}
    })),
    deck, discard: [],
    turn: Math.floor(r() * n), start: 0, round: 1, turnCount: 0,
    finalTurnsLeft: null,
    pending: null,
    know: players.map(() => ({})),      // know[v][appleId] = 'poison'|'normal'
    roleKnow: players.map(() => ({})),  // roleKnow[v][seat] = true
    handKnow: players.map(() => ({})),  // handKnow[v][seat] = {cards, turn}（魔镜看手牌 / 交换手牌时得知）
    claims: [], saidThisTurn: false,
    phase: 'play', log: [], events: [], result: null, settleSteps: [],
  };
  st.start = st.turn;
  st._r = r;

  st.players.forEach(p => { st.know[p.seat][p.apple] = st.apples[p.apple].type; st.roleKnow[p.seat][p.seat] = true; });
  const g = seatOfRole(st, 'green'), sw = seatOfRole(st, 'snow'), bk = seatOfRole(st, 'black');
  st.roleKnow[g][sw] = true;
  st.apples.forEach(a => { st.know[bk][a.id] = a.type; });
  st.intel = { green: { seat: g, snow: sw }, black: { seat: bk, poison: st.players.filter(p => st.apples[p.apple].type === 'poison').map(p => p.seat) } };

  log(st, `晚宴开始！8 人入席，桌上藏着 ${cfg.poison} 颗毒苹果，故事牌 ${Object.values(deckCounts).reduce((a, b) => a + b, 0)} 张。`);
  log(st, `本局故事牌：${Object.entries(deckCounts).map(([k, v]) => `${cardName(k)}×${v}`).join('、')}`, 'all', 'info');
  log(st, `夜深了……格林确认了白雪公主，布莱克记下了毒苹果的位置。天亮了，${nm(st, st.turn)} 先开始。`);
  st.players.forEach(p => log(st, `你的苹果是 ${showApple(st.apples[p.apple].type)}，手牌【${cardName(p.hand[0])}】。`, p.seat, 'private'));
  log(st, `你看到：白雪公主是 ${nm(st, sw)}。`, g, 'private');
  log(st, `你看到：毒苹果在 ${st.intel.black.poison.map(s => nm(st, s)).join('、')} 手里。`, bk, 'private');
  skipIfNeeded(st);
  return st;
}

function rnd(st) { return (st._r || (st._r = rng(st.seed + st.turnCount * 7919 + 17)))(); }

// ---------- 合法性 ----------
// 已倒下的人（毒梳子 / 诅咒戒指）不能再被指定，也不能和他交换（免得把戒指塞给死人）
export const targetable = (st, s, by) => s === by || (!st.players[s].warded && !st.players[s].killed);

export function legalMain(st, seat) {
  const p = st.players[seat];
  const others = st.players.filter(o => o.seat !== seat && targetable(st, o.seat, seat));
  const storyOk = st.deck.length > 0 || p.hand.some(c => cardPlayable(st, seat, c) || !CARDS[c].cursed);
  return {
    story: storyOk,
    swapHand: others.some(o => o.hand.length > 0 || p.hand.length > 0),
    swapApple: others.length > 0,
    peekOwn: true,
    ability: (p.role === 'light' || p.role === 'grey') && !p.roleUp && !p.used,
  };
}

export function cardPlayable(st, seat, card) {
  const c = CARDS[card];
  if (c.passive) return false;
  if (c.final && !isFinal(st)) return false;
  if (c.target === 'other') return st.players.some(o => o.seat !== seat && targetable(st, o.seat, seat));
  return true;
}
export const cardDiscardable = card => !CARDS[card].cursed;
export function validTarget(st, seat, card, t) {
  const c = CARDS[card];
  if (c.target === 'none') return true;
  if (!Number.isInteger(t) || t < 0 || t >= st.n) return false;
  if (c.target === 'other' && t === seat) return false;
  if (card === 'baton' && st.players[t].killed) return false;
  return targetable(st, t, seat);
}

// ---------- 行动 ----------
// {type:'say', claim}                         免费发言（见 say）
// {type:'story'} → pending choose：{type:'play', idx, target, opt} / {type:'discard', idx}
//     opt：mirror→'role'|'apple'|'hand'；truth→角色key；roulette→'cw'|'ccw'；itadaki→1|2|3
//     plan 打出后 → pending arrange：{type:'arrange', keep: idx, order:[idx...]}（order 第一个放最上面）
// {type:'swapHand', target} {type:'swapApple', target} {type:'peekOwn'}
// {type:'ability', targets:[a,b]}（莱特）/ {type:'ability'}（葛瑞）
// {type:'answer', yes}（奈维被问喜好时，由奈维提交）
export function act(st, seat, a) {
  if (st.phase !== 'play') throw new Error('不在行动阶段');
  const pd = st.pending;
  if (pd && pd.mode === 'answer') {
    if (seat !== pd.seat || a.type !== 'answer') throw new Error('等待奈维回答');
    st.pending = null;
    placePref(st, pd.asker, pd.seat, pd.q, !!a.yes);
    return endTurn(st);
  }
  if (seat !== st.turn) throw new Error('不是你的回合');
  const p = st.players[seat];
  if (a.type === 'say') { say(st, seat, a.claim); return { ok: true, free: true }; }

  if (pd && pd.mode === 'arrange') {
    if (a.type !== 'arrange') throw new Error('请先整理手牌');
    return doArrange(st, seat, a);
  }
  if (pd && pd.mode === 'choose') {
    const card = p.hand[a.idx];
    if (!card) throw new Error('没有这张牌');
    if (a.type === 'discard') {
      if (!cardDiscardable(card)) throw new Error('诅咒戒指不能主动弃置');
      p.hand.splice(a.idx, 1); st.discard.push(card);
      log(st, `${nm(st, seat)} 公开弃掉了【${cardName(card)}】。`, 'all', 'card');
      ev(st, { k: 'discard', seat, card });
      return endTurn(st);
    }
    if (a.type === 'play') {
      if (!cardPlayable(st, seat, card) || !validTarget(st, seat, card, a.target)) throw new Error('现在不能这样打这张牌');
      p.hand.splice(a.idx, 1);
      st.pending = null;
      const res = playCard(st, seat, card, a.target, a.opt);
      if (res === 'wait') return { ok: true, waiting: true };
      if (res === 'baton') return { ok: true, baton: true };
      return endTurn(st);
    }
    throw new Error('请选择打出或弃掉一张牌');
  }

  const L = legalMain(st, seat);
  switch (a.type) {
    case 'story': {
      if (!L.story) throw new Error('没有牌可以进行故事');
      let drew = false;
      if (st.deck.length) {
        const c = st.deck.pop(); p.hand.push(c); drew = true;
        log(st, `${nm(st, seat)} 抽了一张故事牌（牌堆剩 ${st.deck.length}）。`);
        log(st, `你抽到了【${cardName(c)}】。`, seat, 'private');
        if (st.deck.length === 0) triggerFinal(st, 1);
      } else log(st, `${nm(st, seat)} 拿起手里的故事牌。`);
      st.pending = { mode: 'choose', drawn: drew ? p.hand.length - 1 : -1 };
      // 手里全是不能打也不能弃的牌（只剩戒指且牌堆空）→ 直接结束
      if (!p.hand.some(c => cardPlayable(st, seat, c) || cardDiscardable(c))) { log(st, `${nm(st, seat)} 什么也做不了。`); return endTurn(st); }
      return { ok: true, pending: true };
    }
    case 'swapHand': {
      const o = st.players[a.target];
      if (a.target === seat || !o || !targetable(st, a.target, seat)) throw new Error('目标不合法');
      [p.hand, o.hand] = [o.hand, p.hand];
      st.handKnow[seat][a.target] = { cards: o.hand.slice(), turn: st.turnCount };
      st.handKnow[a.target][seat] = { cards: p.hand.slice(), turn: st.turnCount };
      log(st, `${nm(st, seat)} 和 ${nm(st, a.target)} 交换了手里的故事牌。`, 'all', 'swap');
      log(st, `你换到了：${p.hand.map(cardName).join('、') || '（空）'}`, seat, 'private');
      log(st, `${nm(st, seat)} 换给你：${o.hand.map(cardName).join('、') || '（空）'}`, a.target, 'private');
      ev(st, { k: 'swapHand', a: seat, b: a.target });
      return endTurn(st);
    }
    case 'swapApple': {
      const o = st.players[a.target];
      if (a.target === seat || !o || !targetable(st, a.target, seat)) throw new Error('目标不合法');
      [p.apple, o.apple] = [o.apple, p.apple];
      log(st, `${nm(st, seat)} 和 ${nm(st, a.target)} 交换了苹果！`, 'all', 'swap');
      ev(st, { k: 'swapApple', a: seat, b: a.target });
      return endTurn(st);
    }
    case 'peekOwn': {
      st.know[seat][p.apple] = st.apples[p.apple].type;
      log(st, `${nm(st, seat)} 偷偷检查了自己的苹果。`);
      log(st, `你的苹果是：${showApple(st.apples[p.apple].type)}`, seat, 'private');
      ev(st, { k: 'peekOwn', seat });
      return endTurn(st);
    }
    case 'ability': {
      if (!L.ability) throw new Error('无法发动技能');
      if (p.role === 'light') {
        const [x, y] = a.targets || [];
        if (![x, y].every(t => Number.isInteger(t) && t >= 0 && t < st.n && targetable(st, t, seat)) || x === y) throw new Error('需要两名不同的玩家');
        p.roleUp = p.used = true; revealRole(st, seat);
        [st.players[x].apple, st.players[y].apple] = [st.players[y].apple, st.players[x].apple];
        log(st, `🟡 ${nm(st, seat)} 翻开角色卡【莱特】，把 ${nm(st, x)} 和 ${nm(st, y)} 的苹果交换了！`, 'all', 'swap');
        ev(st, { k: 'swapApple', a: x, b: y, by: seat });
      } else {
        p.roleUp = p.used = true; revealRole(st, seat);
        p.warded = true;
        log(st, `⚪ ${nm(st, seat)} 翻开角色卡【葛瑞】，直到他下个回合前，谁也碰不了他！`, 'all', 'card');
        ev(st, { k: 'ward', seat });
      }
      return endTurn(st);
    }
  }
  throw new Error('未知行动 ' + a.type);
}

function revealRole(st, s) { st.players.forEach(p => { st.roleKnow[p.seat][s] = true; }); }

// 武器结算：目标持有【哎呀好危险】则无效
function weapon(st, by, t, card, fn) {
  const o = st.players[t];
  if (o.hand.includes('dodge')) {
    st.discard.push(card);
    log(st, `🛡️ ${nm(st, t)} 亮出【哎呀好危险】！${nm(st, by)} 的【${cardName(card)}】无效了。`, 'all', 'warn');
    st.handKnow.forEach((hk, v) => { hk[t] = { cards: o.hand.slice(), turn: st.turnCount, partial: true }; });
    ev(st, { k: 'dodge', seat: t, by, card });
    return;
  }
  fn();
}

function playCard(st, seat, card, t, opt) {
  const P = st.players;
  ev(st, { k: 'play', seat, card, target: t, opt });
  const toDiscard = () => st.discard.push(card);
  switch (card) {
    case 'mirror': {
      toDiscard();
      const what = ['role', 'apple', 'hand'].includes(opt) ? opt : 'apple';
      const label = { role: '角色', apple: '苹果', hand: '手牌' }[what];
      log(st, `${nm(st, seat)} 打出【魔镜啊魔镜】，查看了 ${nm(st, t)} 的${label}。`, 'all', 'card');
      if (what === 'role') { st.roleKnow[seat][t] = true; log(st, `${nm(st, t)} 是【${R(st, t).name}】（${TEAMS[R(st, t).team]}）。`, seat, 'private'); }
      if (what === 'apple') { st.know[seat][P[t].apple] = st.apples[P[t].apple].type; log(st, `${nm(st, t)} 的苹果是 ${showApple(st.apples[P[t].apple].type)}。`, seat, 'private'); }
      if (what === 'hand') { st.handKnow[seat][t] = { cards: P[t].hand.slice(), turn: st.turnCount }; log(st, `${nm(st, t)} 的手牌：${P[t].hand.map(cardName).join('、') || '（空）'}`, seat, 'private'); }
      return;
    }
    case 'truth': {
      toDiscard();
      const guess = ROLES[opt] ? opt : 'snow';
      log(st, `🎭 ${nm(st, seat)}：“${nm(st, t)}，你这家伙的真面目是……${ROLES[guess].name}！”`, 'all', 'card');
      if (P[t].role === guess) {
        P[t].roleUp = true; revealRole(st, t);
        log(st, `猜中了！${nm(st, t)} 的角色卡被翻开：【${ROLES[guess].name}】。`, 'all', 'warn');
        ev(st, { k: 'reveal', seat: t });
      } else {
        log(st, `没猜中。`, 'all', 'card');
        st.wrongGuess = st.wrongGuess || []; st.wrongGuess.push({ seat: t, role: guess });
      }
      return;
    }
    case 'likeApple': case 'likeShroom': {
      const q = card === 'likeApple' ? 'apple' : 'mushroom';
      log(st, `${nm(st, seat)} 把【${CARDS[card].name}】交给了 ${nm(st, t)}……`, 'all', 'card');
      if (P[t].role === 'navy') {
        if (P[t].human) { st.pending = { mode: 'answer', seat: t, asker: seat, q }; return 'wait'; }
        placePref(st, seat, t, q, navyAnswer(st, q));
      } else placePref(st, seat, t, q, R(st, t).food === q);
      return;
    }
    case 'roulette': case 'roulette2': {
      toDiscard();
      const dir = opt === 'ccw' ? 'ccw' : 'cw';
      const times = card === 'roulette2' ? 2 : 1;
      const seats = P.filter(p => !p.warded).map(p => p.seat);
      for (let k = 0; k < times; k++) {
        const ap = seats.map(s => P[s].apple);
        // 顺时针：每人把苹果交给下一位 → 我收到上一位的
        seats.forEach((s, i) => { P[s].apple = dir === 'cw' ? ap[(i - 1 + seats.length) % seats.length] : ap[(i + 1) % seats.length]; });
      }
      log(st, `🎡 ${nm(st, seat)} 打出【苹果轮盘赌！】——${dir === 'cw' ? '顺时针' : '逆时针'}${times > 1 ? '，转两次' : ''}！所有苹果传了${times > 1 ? '两' : '一'}位。`, 'all', 'swap');
      ev(st, { k: 'pass', seats, dir, times });
      return;
    }
    case 'baton': {
      toDiscard();
      log(st, `🤝 ${nm(st, seat)} 打出【交棒！】——${nm(st, t)} 立刻进行 1 个行动。`, 'all', 'card');
      st.baton = { from: seat, to: t };
      st.turn = t;
      st.saidThisTurn = false;
      ev(st, { k: 'baton', seat, target: t });
      if (cursedNow(st, t, 'baton')) return;   // 接棒的人当场被戒指咒死：这次额外行动没了，回到出牌人收尾
      return 'baton';
    }
    case 'knife': {
      log(st, `🔪 ${nm(st, seat)} 对 ${nm(st, t)} 打出【菜刀】！`, 'all', 'card');
      weapon(st, seat, t, card, () => {
        toDiscard();
        const ap = st.apples[P[t].apple];
        ap.up = true;
        P.forEach(p => { st.know[p.seat][ap.id] = ap.type; });
        log(st, `${nm(st, t)} 的苹果被翻开：${showApple(ap.type)}！`, 'all', 'warn');
        ev(st, { k: 'appleUp', seat: t });
      });
      return;
    }
    case 'rope': {
      log(st, `🪢 ${nm(st, seat)} 对 ${nm(st, t)} 打出【绳索】！`, 'all', 'card');
      weapon(st, seat, t, card, () => { toDiscard(); P[t].roped = true; log(st, `${nm(st, t)} 被绑住了，将跳过下一个回合。`, 'all', 'warn'); });
      return;
    }
    case 'comb': {
      log(st, `🪮 ${nm(st, seat)} 对 ${nm(st, t)} 打出【毒梳子】！`, 'all', 'warn');
      weapon(st, seat, t, card, () => { toDiscard(); P[t].killed = true; P[t].killedBy = 'comb'; log(st, `💀 ${nm(st, t)} 被毒梳子杀害了。`, 'all', 'warn'); ev(st, { k: 'killed', seat: t }); });
      return;
    }
    case 'itadaki': {
      toDiscard();
      const k = Math.max(1, Math.min(3, opt | 0 || 1));
      const burned = [];
      for (let i = 0; i < k && st.deck.length; i++) { const c = st.deck.pop(); st.discard.push(c); burned.push(c); }
      log(st, `🍽️ ${nm(st, seat)}：“我开动了！”从牌堆顶弃掉 ${burned.length} 张：${burned.map(cardName).join('、') || '（牌堆已空）'}（剩 ${st.deck.length}）。`, 'all', 'card');
      if (st.deck.length === 0) triggerFinal(st, 1);
      return;
    }
    case 'plan': {
      toDiscard();
      const drawn = [];
      for (let i = 0; i < 3 && st.deck.length; i++) { const c = st.deck.pop(); P[seat].hand.push(c); drawn.push(c); }
      log(st, `📅 ${nm(st, seat)}：“今天要做些什么好呢……”抽了 ${drawn.length} 张，正在挑选。`, 'all', 'card');
      log(st, `你抽到：${drawn.map(cardName).join('、')}。保留 1 张，其余放回牌堆顶。`, seat, 'private');
      if (P[seat].hand.length <= 1) return; // 没牌可挑
      st.pending = { mode: 'arrange', seat };
      return 'wait';
    }
  }
}

function doArrange(st, seat, a) {
  const p = st.players[seat];
  const hand = p.hand;
  const keep = a.keep;
  if (!Number.isInteger(keep) || !hand[keep]) throw new Error('请选一张保留');
  const ringIdx = hand.indexOf('ring');
  if (ringIdx >= 0 && hand[keep] !== 'ring') throw new Error('诅咒戒指不能放回，必须保留它');
  const rest = hand.map((c, i) => i).filter(i => i !== keep);
  let order = Array.isArray(a.order) ? a.order.filter(i => rest.includes(i)) : [];
  for (const i of rest) if (!order.includes(i)) order.push(i);
  // order[0] 放最上面 → 最后 push
  const back = order.map(i => hand[i]);
  for (let i = back.length - 1; i >= 0; i--) st.deck.push(back[i]);
  p.hand = [hand[keep]];
  st.planKnow = { seat, top: back.slice(), turn: st.turnCount };
  st.pending = null;
  if (st.finalTurnsLeft !== null && st.deck.length) { /* 已进入最后一轮则保持 */ }
  log(st, `${nm(st, seat)} 留下 1 张，把 ${back.length} 张放回了牌堆顶（剩 ${st.deck.length}）。`, 'all', 'card');
  log(st, `牌堆顶从上到下：${back.map(cardName).join(' → ')}`, seat, 'private');
  return endTurn(st);
}

function navyAnswer(st, q) {
  // AI 奈维：装成喜欢苹果（冒充白雪/莱特），否认蘑菇
  return q === 'apple' ? rnd(st) < 0.75 : rnd(st) < 0.3;
}
function placePref(st, asker, t, q, yes) {
  st.players[t].prefs.push({ q, yes, by: asker });
  log(st, `${nm(st, t)} 把【你喜欢${FOOD[q]}吗？】${yes ? '竖着放下 ↕️ ——喜欢' : '横着放下 ↔️ ——不喜欢'}。`, 'all', 'talk');
  ev(st, { k: 'pref', seat: t, q, yes });
}

function triggerFinal(st, extra) {
  if (st.finalTurnsLeft !== null) return;
  st.finalTurnsLeft = st.n + extra;
  log(st, '🕯️ 最后一张故事牌被抽走了。这一回合结束后，每人还有最后一次行动。', 'all', 'warn');
}

function endTurn(st) {
  st.pending = null;
  // 交棒的额外行动结束：回到出牌人，再把出牌人的回合正常结束（额外行动不占最后一轮的名额）
  if (st.baton) { const b = st.baton; st.baton = null; st.turn = b.from; }
  st.turnCount++;
  if (st.finalTurnsLeft !== null) {
    st.finalTurnsLeft--;
    if (st.finalTurnsLeft <= 0) return toSettle(st);
  }
  st.turn = (st.turn + 1) % st.n;
  if (st.turn === st.start) st.round++;
  st.players[st.turn].warded = false; // 葛瑞的守护到自己下回合开始为止
  st.saidThisTurn = false;
  return skipIfNeeded(st) || { ok: true };
}
function skipIfNeeded(st) {
  const p = st.players[st.turn];
  if (p.killed) { log(st, `${p.name} 已经倒下，跳过。`); return endTurn(st); }
  if (cursedNow(st, p.seat)) return endTurn(st);
  if (p.roped) { p.roped = false; log(st, `🪢 ${p.name} 被绳索绑着，跳过这个回合。`, 'all', 'warn'); ev(st, { k: 'skip', seat: p.seat }); return endTurn(st); }
  return null;
}
// 诅咒戒指：已经进入最后的回合，某人要开始行动（自己的回合，或被【交棒！】提前叫起来）时手里还攥着戒指 → 立刻被诅咒而死，不能行动
function cursedNow(st, s, via = 'turn') {
  const p = st.players[s];
  if (!isFinal(st) || p.killed || !p.hand.includes('ring')) return false;
  p.killed = true; p.killedBy = 'ring';
  st.handKnow.forEach(hk => { hk[s] = { cards: ['ring'], turn: st.turnCount, partial: true }; });
  log(st, `💍 ${via === 'baton' ? `${p.name} 接棒时` : `轮到 ${p.name} 时`}，手里还攥着【诅咒戒指】……被诅咒而死！`, 'all', 'warn', 'ringDeath');
  ev(st, { k: 'ringDeath', seat: s, via });
  return true;
}
function toSettle(st) { st.phase = 'settle'; st.turn = -1; log(st, '🍽️ 最后的回合结束——最后的晚餐开始了！', 'all', 'warn'); return { ok: true, settle: true }; }

// ---------- 公开发言（嘴炮） ----------
// 线下最常见、也最自然的几句（主动乱报阵营、乱报别人的苹果反而很蠢，已删去）：
//   {type:'apple', value:'poison'|'normal'}  “我的苹果是好的/毒的”——只能说自己的（可以说谎）
//   {type:'rose', about}                       “我觉得 X 是罗泽！”——大家最爱的调侃
//   {type:'notRose'}                           “我才不是罗泽！”
//   {type:'role', value}                       “我是 某角色”（可以说谎）
export const CLAIM_TYPES = ['apple', 'rose', 'notRose', 'role'];
export function claimText(st, c) {
  switch (c.type) {
    case 'apple': return c.value === 'poison' ? '我的苹果……是毒的！' : '我的苹果是好的。';
    case 'rose': return `我觉得 ${nm(st, c.about)} 是罗泽！`;
    case 'notRose': return '我才不是罗泽！';
    case 'role': return `我是${ROLES[c.value].name}。`;
  }
  return '……';
}
// 刚偷看完自己的苹果，紧接着说一句（这是唯一自然说“我的苹果是…”的时机；可以说谎）
export function canRemarkAfterPeek(st, seat) {
  // 自己最后一次偷看之后，只允许出现“被绳索跳过 / 下家被戒指咒死”之类的自动事件
  for (let i = st.events.length - 1; i >= 0; i--) {
    const e = st.events[i];
    if (e.k === 'peekOwn') return (st.phase === 'play' || st.phase === 'settle') && e.seat === seat;
    if (e.k !== 'skip' && e.k !== 'ringDeath') return false;
  }
  return false;
}
export function remarkAfterPeek(st, seat, value) {
  if (!canRemarkAfterPeek(st, seat)) throw new Error('只能在刚看完自己的苹果时说');
  if (!['poison', 'normal'].includes(value)) throw new Error('苹果只能说好或毒');
  const cl = { i: st.claims.length, seat, type: 'apple', value, about: seat, aboutApple: st.players[seat].apple, turn: st.turnCount - 1, afterPeek: true };
  cl.text = claimText(st, cl);
  st.claims.push(cl);
  log(st, `💬 ${nm(st, seat)}：“${cl.text}”`, 'all', 'talk');
  ev(st, { k: 'say', seat, claim: cl.i });
  return cl;
}
export function canSay(st, seat) { return st.phase === 'play' && st.turn === seat && !st.pending && !st.saidThisTurn; }
export function say(st, seat, c) {
  if (!canSay(st, seat)) throw new Error('现在不能发言（每回合行动前可以说一句）');
  if (!CLAIM_TYPES.includes(c.type)) throw new Error('未知发言');
  if (c.type === 'apple' && !['poison', 'normal'].includes(c.value)) throw new Error('苹果只能说好或毒');
  if (c.type === 'rose' && (!Number.isInteger(c.about) || c.about < 0 || c.about >= st.n || c.about === seat)) throw new Error('要指一个别人');
  if (c.type === 'role' && !ROLES[c.value]) throw new Error('未知角色');
  const about = c.type === 'rose' ? c.about : seat;
  const cl = { i: st.claims.length, seat, type: c.type, value: c.value ?? null, about, aboutApple: c.type === 'apple' ? st.players[seat].apple : null, turn: st.turnCount };
  cl.text = claimText(st, cl);
  st.claims.push(cl);
  st.saidThisTurn = true;
  log(st, `💬 ${nm(st, seat)}：“${cl.text}”`, 'all', 'talk');
  ev(st, { k: 'say', seat, claim: cl.i });
  return cl;
}

// ---------- 结算 ----------
export const queenSeat = st => seatOfRole(st, 'queen');
export const queenCanGive = st => { const q = queenSeat(st); return !st.players[q].killed && appleType(st, q) === 'poison'; };

// 女王最后行动：公开身份和苹果；若持毒苹果可指定一人吃下
export function settleQueen(st, target) {
  const q = queenSeat(st), qp = st.players[q];
  qp.roleUp = true; revealRole(st, q);
  const poison = appleType(st, q) === 'poison';
  st.apples[qp.apple].up = true;
  st.settleSteps.push({ k: 'queen', seat: q, poison, killed: qp.killed });
  if (qp.killed) { log(st, `👑 女王是 ${qp.name}——但她已经被杀害，无法行动。`, 'all', 'warn'); return; }
  if (poison && Number.isInteger(target) && target !== q && !st.players[target].killed) {
    st.forcedEat = target;
    st.settleSteps.push({ k: 'queenGive', seat: q, target });
    log(st, `👑 女王是 ${qp.name}！她举起毒苹果，命令 ${st.players[target].name} 吃下去。`, 'all', 'warn');
  } else log(st, `👑 女王是 ${qp.name}，她手里是${poison ? '毒苹果，但她没有送出' : '普通苹果'}。`, 'all', 'warn');
}

export function settleFinish(st) {
  const P = st.players;
  const q = queenSeat(st);
  const gave = st.forcedEat !== undefined && st.forcedEat !== null;
  const poisoned = P.map(p => (p.seat === q && gave) ? false : st.apples[p.apple].type === 'poison');
  if (gave) poisoned[st.forcedEat] = true;
  const killed = P.map(p => p.killed || p.hand.includes('ring'));
  const ringDeath = P.map(p => !p.killed && p.hand.includes('ring'));
  const sw = seatOfRole(st, 'snow'), rose = seatOfRole(st, 'rose');
  let revived = false;
  if (poisoned[sw] && !killed[sw] && P[sw].hand.includes('prince')) { poisoned[sw] = false; revived = true; }
  const dead = P.map((_, i) => poisoned[i] || killed[i]);
  P.forEach(p => { p.roleUp = true; st.apples[p.apple].up = true; });
  let winner;
  if (dead[sw]) winner = 'queen';
  else if (!dead[rose]) winner = 'rose';
  else winner = 'snow';
  const winners = P.filter(p => (winner === 'rose' ? p.role === 'rose' : teamOf(st, p.seat) === winner)).map(p => p.seat);
  st.result = { winner, poisoned, killed, ringDeath, dead, winners, revived };
  st.phase = 'over';
  log(st, '“我开动了！” 所有人同时咬下苹果……', 'all', 'warn');
  P.forEach(p => { if (ringDeath[p.seat]) log(st, `💍 ${p.name} 手里还攥着诅咒戒指……倒下了。`, 'all', 'warn'); });
  if (revived) log(st, `🤴 “啊，是王子大人！”白雪公主被吻醒了！`, 'all', 'warn');
  log(st, `🏆 ${winner === 'rose' ? '罗泽独自获胜！' : TEAMS[winner] + '获胜！'}`, 'all', 'win');
  return st.result;
}
