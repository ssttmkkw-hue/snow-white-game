import {
  ROLES, CARDS, TEAMS, FOOD, remarkAfterPeek, cardName, newGame, act, legalMain, cardPlayable, cardDiscardable, validTarget, targetable,
  isFinal, visibleLog, settleQueen, settleFinish, queenSeat, queenCanGive, canSay,
} from './engine.js';
import { aiStep, aiQueenTarget, liesCaught, aiAfterPeek } from './ai.js';
import { say as voice, stop as voiceStop, loadLines, lineText, isMuted, setMuted, playClip, loadPlayerLines, playerLine, playerUrl } from './narrator.js';
import * as online from './online.js';
loadLines();

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ME = 0;   // 我的座位：单机固定 0；联机由服务器分配（观战时只用来决定从哪个座位看过去）
const isMe = s => !ui.spect && s === ME;
const badges = { '🐰': 'hare', '🐺': 'wolf', '🦌': 'stag', '🙂': 'guest', '🦡': 'badger', '🦦': 'otter', '🐶': 'spotted-pup', '🐈‍⬛': 'black-cat' };
function art(key, cls = '') {
  return `<img class="illustration ${cls}" src="art/${key}.webp" alt="" draggable="false">`;
}
// 7 名 AI 玩家（3 男 4 女）。voice = 以后的语音文件夹 audio/players/<voice>/
const AIS = [
  ['🦡', '石头', 'm', 'shitou'], ['🐺', '夜影', 'm', 'yeying'], ['🦦', '溜溜', 'm', 'liuliu'],
  ['🐰', '糯糯', 'f', 'nuonuo'], ['🦌', '小鹿', 'f', 'xiaolu'], ['🐶', '点点', 'f', 'diandian'], ['🐈‍⬛', '炭炭', 'f', 'tantan'],
];
// 长桌座位：k=0 你(桌脚) → 左侧自下而上 → 桌头 → 右侧自上而下（即顺时针）

let st = null;
let ui = fresh();
function fresh() { return { sel: null, target: null, busy: false, evSeen: 0, bubbles: {}, reveal: { roles: false, apples: false, final: false }, dead: null, speed: savedSpeed(), arr: null }; }
// AI 快速模式：菜单里的开关，记在本机，下一局也生效（联机时节奏由服务器定，不用这个）
function savedSpeed() { try { return localStorage.getItem('pa-ai-fast') === '1' ? 0.4 : 1; } catch { return 1; } }

// ---------------- 开始 ----------------
$('#count-pick').innerHTML = `<button class="on" disabled>8 人</button>`;
$('#count-pick').style.gridTemplateColumns = '1fr';
$('#setup-desc').textContent = '你与 7 名林中访客同席。本局有 4 颗毒苹果、29 张故事牌。';
$('#btn-start').onclick = startGame;
$('#btn-online').onclick = enterOnline;
$('#btn-rules').onclick = showRules;
try { const n = localStorage.getItem('pa-name'); if (n) $('#in-name').value = n; } catch {}
// 联机服务器（Render）会报自己的版本号：显示在开始页底部，方便确认手机上打开的是不是最新版（纯静态打开时没有）
fetch('api/version', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(v => { if (v?.version) $('.foot').textContent = `版本 ${v.version}`; }).catch(() => {});

function startGame() {
  const name = ($('#in-name').value.trim() || '我').slice(0, 8);
  try { localStorage.setItem('pa-name', name); } catch {}
  const ais = AIS.slice().sort(() => Math.random() - 0.5);
  loadPlayerLines(AIS.map(x => x[3]));
  st = newGame({ players: [{ name, human: true, avatar: '🙂' }, ...ais.map(([a, n, g, v]) => ({ name: n, avatar: a, gender: g, voice: v }))] });
  ui = fresh();
  $('#screen-start').classList.add('hidden');
  $('#screen-game').classList.remove('hidden');
  render();
  showIntro();
}

function showIntro() {
  const r = ROLES[st.players[ME].role];
  const ap = st.apples[st.players[ME].apple].type;
  ui.hideIntel = { green: true, black: true };   // 格林/布莱克的情报等夜里睁眼时再看
  ui.night = true;
  render();
  overlay(`
    <div class="portrait-frame">${art(st.players[ME].role)}</div>
    <h2>你是 ${r.name}</h2>
    <p><span class="role-tag team-${r.team}">${TEAMS[r.team]}</span> · 喜好 ${FOOD[r.food]}</p>
    <div class="ov-card"><p style="text-align:left">${r.desc}</p></div>
    <p>你的苹果：${ap === 'poison' ? '☠️ <b>毒苹果</b>' : '🍎 <b>普通苹果</b>'}　手牌：【${cardName(st.players[ME].hand[0])}】</p>
    <p class="hint">${r === ROLES.green || r === ROLES.black ? '夜里裁判会叫你睁眼，到时再看你的情报。' : '记住它们，别让别人看出来。'}</p>
    <button class="btn primary big" id="ov-go">我看好了</button>`);
  voice('intro');
  $('#ov-go').onclick = () => nightPhase();
}

// ---------------- 天黑请闭眼 ----------------
function nightScreen(key, { sub = '', peek = false, dawn = false } = {}) {
  const o = $('#overlay');
  o.className = 'overlay night' + (peek ? ' peek' : '') + (dawn ? ' dawn' : '');
  o.innerHTML = `<div class="ncard"><div class="tag-night">${art(dawn ? 'seal' : peek ? 'mirror' : 'guest')}</div><p class="nline">${lineText(key)}</p>${sub ? `<p class="nsub">${sub}</p>` : ''}</div>
    <button class="nskip" id="n-skip">跳过 ›</button>`;
  $('#n-skip').onclick = () => { ui.skipNight = true; voiceStop(); };
}

async function nightPhase() {
  const game = st;
  const me = st.players[ME].role;
  const alive = () => st === game && !ui.skipNight;
  const wait = ms => new Promise(r => { const t0 = Date.now(); const tick = () => (!alive() || Date.now() - t0 >= ms ? r() : setTimeout(tick, 80)); tick(); });
  const step = async (key, opts = {}, hold = 700) => { if (!alive()) return; nightScreen(key, opts); await voice(key); await wait(hold); };
  voiceStop();
  ui.skipNight = false;

  await step('night', { icon: '🌙', sub: '所有人闭上了眼睛……' }, 900);

  const sw = st.intel.green.snow;
  if (me === 'green') {
    if (alive()) { ui.hideIntel.green = false; ui.nightGlow = { seats: [sw] }; render(); }
    await step('green_open', { icon: '👁️', peek: true, sub: `你睁开眼：<b>${st.players[sw].name}</b> 就是白雪公主。` }, 2800);
  } else await step('green_open', { icon: '😌', sub: '你闭着眼……只听见有人轻轻动了一下。' }, 1400);
  ui.nightGlow = null; render();
  await step('green_close', { icon: '🌙' }, 600);

  const ps = st.intel.black.poison;
  if (me === 'black') {
    if (alive()) { ui.hideIntel.black = false; ui.nightGlow = { apples: ps }; render(); }
    await step('black_open', { icon: '👁️', peek: true, sub: `你睁开眼：毒苹果在 <b>${ps.map(x => nmS(x)).join('、')}</b> 手里。` }, 3200);
  } else await step('black_open', { icon: '😌', sub: '你闭着眼……屋里静得能听见心跳。' }, 1400);
  ui.nightGlow = null; render();
  await step('black_close', { icon: '🌙' }, 600);

  if (st !== game) return;
  if (!ui.skipNight) await step('dawn', { icon: '☀️', dawn: true }, 500);
  else voiceStop();
  ui.night = false; ui.hideIntel = {}; ui.nightGlow = null; ui.skipNight = false;
  closeOverlay();
  render();
  if (ui.nightDone) { const f = ui.nightDone; ui.nightDone = null; f(); } else loop();
}

// ---------------- 渲染 ----------------
const nmS = s => (isMe(s) ? '你' : st.players[s].name);
function render() {
  if (!st) return;
  $('#st-round').textContent = `第 ${st.round} 轮`;
  $('#st-deck').textContent = `余牌 ${st.deck.length}`;
  $('#st-final').classList.toggle('hidden', !isFinal(st) || st.phase !== 'play');
  renderTable();
  renderMe();
  renderActions();
}

// 座位 k（相对你）→ 头像格 / 桌上物品格
const AV = ['avb', 'al1', 'al2', 'al3', 'avt', 'ar5', 'ar6', 'ar7'];
const SP = ['sf', 'sl1', 'sl2', 'sl3', 'sh', 'sr5', 'sr6', 'sr7'];
const sideOf = k => (k === 0 ? 'b' : k === 4 ? 't' : k < 4 ? 'l' : 'r');

function seatClasses(s, forSpot) {
  const p = st.players[s], c = [];
  if (isMe(s)) c.push('me');
  if (!forSpot && st.turn === s && st.phase === 'play' && !ui.night && !ui.ringShow) c.push('turn');   // 当前行动者只点亮名牌
  if (ui.nightGlow?.seats?.includes(s)) c.push('nglow');
  const tg = ui.target;
  if (tg) { if (tg.ok(s)) c.push('pickable'); else c.push('dim'); if (tg.picked.includes(s)) c.push('picked'); }
  if (!forSpot && ui.reveal.final && st.result?.winners.includes(s)) c.push('win');
  return c.join(' ');
}
const ringShown = s => st.players[s].killedBy === 'ring' && !ui.hideRing?.has(s);   // 被戒指咒死、且已经演出过
// 已经生效、要正面朝上摆在桌前的手牌：诅咒戒指（被咒死 / 结尾还攥着）、啊，是王子大人（白雪被吻醒）
function cardsUp(s) {
  const p = st.players[s], up = [];
  if (ringShown(s) || (ui.reveal.apples && st.result?.ringDeath?.[s])) up.push('ring');
  if (ui.princeShown && st.result?.revived && p.role === 'snow') up.push('prince');
  return up;
}
const isDead = s => (st.players[s].killed && !ui.hideRing?.has(s)) || !!(ui.dead && ui.dead[s]);

function avatarHTML(s) {
  const p = st.players[s];
  const k = (s - ME + st.n) % st.n;
  const stt = [];
  if (p.roped) stt.push('🪢');
  if (p.warded) stt.push('🛡️');
  const ups = cardsUp(s);
  if (ups.includes('ring')) stt.push('💍');
  if (ups.includes('prince')) stt.push('🤴');
  if (!isMe(s) && !ui.spect && !ui.reveal.roles && liesCaught(st, ME, s) > 0) stt.push('🤥');
  const bub = ui.bubbles[s];
  return `<div class="av side-${sideOf(k)} ${seatClasses(s)}" data-seat="${s}" style="grid-area:${AV[k]}">
    ${bub ? `<div class="bubble">${bub}</div>` : ''}
    <div class="plate"><span class="face">${art(badges[p.avatar] || 'guest')}</span><span class="nm">${nmS(s)}</span>${stt.length ? `<span class="stt">${stt.join('')}</span>` : ''}</div>
  </div>`;
}

// 真实桌面：每人的牌都正对自己摆放（牌顶朝桌心）。从你的视角看，左边的人转 90°、右边 -90°、对面 180°
const SPIN = { b: 0, l: 90, r: -90, t: 180 };
const SPIN_SIDE = { l: 0.8, r: 0.8 };   // 左右两侧：转过去后居中摆在格子里，略缩小免得挤到邻座
function spotHTML(s) {
  const p = st.players[s];
  const k = (s - ME + st.n) % st.n;
  const r = ROLES[p.role];
  const dead = isDead(s);
  // 角色牌：对手隐藏的显示牌背，公开的显示牌面；死亡转灰 + 小骷髅
  const up = p.roleUp || ui.reveal.roles;
  const iKnow = st.roleKnow[ME][s] && !isMe(s) && !(ui.hideIntel?.green && st.players[ME].role === 'green');
  let rc;
  if (up || isMe(s)) rc = `<div class="tc rcard up team-${r.team} ${isMe(s) && !up ? 'mine' : ''} ${dead ? 'dead' : ''}" title="${r.name}">${art(p.role)}<span class="rn">${r.short}</span></div>`;
  else if (iKnow) rc = `<div class="tc rcard priv ${dead ? 'dead' : ''}" title="只有你知道：${r.name}">${art(p.role)}<span class="rn">${r.short}</span></div>`;
  else rc = `<div class="tc rcard back ${dead ? 'dead' : ''}"></div>`;
  if (dead) rc = rc.replace(/<\/div>$/, '<span class="skull">💀</span></div>');
  // 苹果牌（按苹果 id 标记，换位时能滑过去）
  const ap = st.apples[p.apple];
  const apUp = ap.up || ui.reveal.apples;
  const kn = (ui.hideIntel?.black && st.players[ME].role === 'black' && !isMe(s)) ? undefined : st.know[ME][ap.id];
  const fl = (ui.flash?.has(s) ? 'flash' : '') + (ui.nightGlow?.apples?.includes(s) ? ' nglow' : '');
  const visibleKind = apUp ? ap.type : (kn || 'back');
  const appleName = visibleKind === 'poison' ? '毒苹果' : '普通苹果';
  const appleLabel = apUp ? `已公开：${appleName}` : kn ? `你已知晓：${appleName}（未公开）` : '未知苹果（背面）';
  const acard = `<div class="acard ${visibleKind === 'back' ? 'back' : 'up ' + visibleKind} ${fl}" data-apple="${ap.id}" role="img" aria-label="${appleLabel}" title="${appleLabel}">
    ${appleArt(visibleKind)}
  </div>`;
  const n = Math.min(p.hand.length, 4);
  const ups = cardsUp(s), upAt = {};   // 生效的牌正面朝上（排到前面，保证扇形里看得到）
  ups.forEach((c, j) => { if (p.hand.includes(c)) upAt[j] = c; });
  const upTitle = ups.map(c => (c === 'ring' ? '手上的是【诅咒戒指】，被诅咒而死' : '亮出【啊，是王子大人】，被王子吻醒')).join('；');
  const hand = n ? `<div class="fan" data-hand="${p.hid ?? handId(p.hand)}" title="${upTitle || `手牌 ${p.hand.length} 张`}">${Array.from({ length: n }, (_, i) => `<i style="transform:rotate(${(i - (n - 1) / 2) * 14}deg)${upAt[i] ? `;background-image:url('art/${upAt[i]}.webp')` : ''}"></i>`).join('')}</div>` : '';
  const prefs = p.prefs.filter((x, i) => !(ui.hidePref && ui.hidePref.seat === s && i === p.prefs.length - 1)).map(x => `<div class="tc pref ${x.yes ? 'yes' : 'no'}" title="你喜欢${FOOD[x.q]}吗？${x.yes ? '竖放：喜欢' : '横放：不喜欢'}"><span>${art(x.q === 'apple' ? 'likeApple' : 'likeShroom')}</span><b>?</b></div>`).join('');
  return `<div class="spot side-${sideOf(k)} ${seatClasses(s, true)}" data-seat="${s}" style="grid-area:${SP[k]}">
    <div class="spin${SPIN_SIDE[sideOf(k)] ? ' spin-side' : ''}" data-rot="${SPIN[sideOf(k)]}" data-sc="${SPIN_SIDE[sideOf(k)] || 1}" style="transform:${SPIN_SIDE[sideOf(k)] ? 'translate(-50%,-50%) ' : ''}rotate(${SPIN[sideOf(k)]}deg)${SPIN_SIDE[sideOf(k)] ? ` scale(${SPIN_SIDE[sideOf(k)]})` : ''}">
      <div class="r1">${acard}${prefs ? `<div class="prefs">${prefs}</div>` : ''}</div>
      <div class="r2">${rc}${hand}</div>
    </div>
  </div>`;
}

// 苹果形状的苹果牌：未知=亮红苹果；普通=笑脸与小咬痕纹样；毒=骷髅。三种均为完整轮廓
function appleArt(kind) {
  return art('apple-' + kind);
}

// 中央：平时只有抽牌堆+弃牌堆；有人出牌时短暂亮出「牌名｜谁 → 谁」
function midHTML() {
  let idx = -1;
  for (let i = st.events.length - 1; i >= 0; i--) { const k = st.events[i].k; if (k === 'play' || k === 'discard') { idx = i; break; } }
  if (idx !== ui.lastPlayIdx) { ui.lastPlayIdx = idx; ui.lastPlayT = Date.now(); }
  const SHOW = 2600;
  let played = '';
  const el = Date.now() - (ui.lastPlayT || 0);
  if (idx >= 0 && el < SHOW && ui.evInit) {
    const e = st.events[idx], C = CARDS[e.card];
    const extra = e.k === 'discard' ? '弃掉' : e.card === 'roulette' || e.card === 'roulette2' ? (e.opt === 'ccw' ? '逆时针' : '顺时针') + (e.card === 'roulette2' ? '×2' : '') : e.card === 'itadaki' ? `弃 ${e.opt} 张` : e.card === 'mirror' ? { role: '看角色', apple: '看苹果', hand: '看手牌' }[e.opt] : '';
    const who = `${nmS(e.seat)}${e.target != null ? ' → ' + nmS(e.target) : ''}`;
    played = `<div class="played" style="animation-delay:-${el}ms"><span class="pi">${art(e.card)}</span><span class="pn">${cardName(e.card)}</span><span class="pw">${who}${extra ? ' · ' + extra : ''}</span></div>`;
    clearTimeout(ui.playT); ui.playT = setTimeout(() => st && renderTable(), SHOW - el + 30);
  }
  ui.evInit = true;
  return `<div class="mid">
    <div class="piles">
      <div class="pile draw" title="抽牌堆"><div class="pc"></div><span class="cnt">抽 ${st.deck.length}</span></div>
      <div class="pile disc" id="disc-pile" title="弃牌堆（点开查看）"><div class="pc">${st.discard.length ? art(st.discard[st.discard.length - 1]) : ''}</div><span class="cnt">弃 ${st.discard.length}</span></div>
    </div>
  </div>${played}`;
}

function renderTable() {
  const newEv = st.events.slice(ui.evSeen); ui.evSeen = st.events.length;
  ui.flash = new Set();
  for (const e of newEv) if (e.k === 'appleUp') ui.flash.add(e.seat);
  // FLIP：记下每颗苹果的旧位置，重绘后从旧位置滑到新位置
  const old = {};
  document.querySelectorAll('#longtable .acard[data-apple]').forEach(el => { old[el.dataset.apple] = el.getBoundingClientRect(); });
  // 手牌：按 data-hand 记下旧中心点（交换手牌后整叠滑到新主人面前）
  const center = r => [r.left + r.width / 2, r.top + r.height / 2];
  const oldFan = {};
  document.querySelectorAll('#longtable .fan[data-hand]').forEach(f => { oldFan[f.dataset.hand] = center(f.getBoundingClientRect()); });
  $('#longtable').innerHTML = `<div class="room"><div class="board"></div>${midHTML()}`
    + st.players.map(p => avatarHTML(p.seat) + spotHTML(p.seat)).join('') + `</div>`;
  document.querySelectorAll('#longtable .fan[data-hand]').forEach(f => {
    const o = oldFan[f.dataset.hand]; if (!o) return;
    const [nx, ny] = center(f.getBoundingClientRect());
    slideFrom(f, o[0] - nx, o[1] - ny, true);
  });
  document.querySelectorAll('#longtable .acard[data-apple]').forEach(el => {
    const o = old[el.dataset.apple]; if (!o) return;
    const n = el.getBoundingClientRect();
    slideFrom(el, o.left - n.left, o.top - n.top, false, 'moving');
  });
}

// 每叠手牌一个 id：交换手牌时数组整体换主人，id 跟着走，动画就能像苹果一样多次重绘也不断
const HAND_IDS = new WeakMap(); let handSeq = 0;
const handId = arr => { if (!HAND_IDS.has(arr)) HAND_IDS.set(arr, ++handSeq); return HAND_IDS.get(arr); };

// 让元素从屏幕位移 (dx, dy) 处滑回原位；自动换算到所在座位旋转/缩放后的本地坐标
// 用 Web Animations（element.animate）做：动画对象立即生成，重绘时从当前位置接着滑，不依赖样式过渡
function slideFrom(el, dx, dy, lift, cls) {
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  const sp = el.closest('.spin'), sc = +(sp?.dataset.sc || 1);
  const th = -(+(sp?.dataset.rot || 0)) * Math.PI / 180;
  const lx = (dx * Math.cos(th) - dy * Math.sin(th)) / sc, ly = (dx * Math.sin(th) + dy * Math.cos(th)) / sc;
  if (lift) { el.style.position = 'relative'; el.style.zIndex = '20'; }
  if (cls) el.classList.add(cls);
  const anim = el.animate([{ transform: `translate(${lx}px, ${ly}px)` }, { transform: 'translate(0, 0)' }],
    { duration: Math.round((ui.flipMs || 650) * Math.max(ui.speed, 0.4)), easing: 'cubic-bezier(.3,.7,.3,1)' });
  anim.onfinish = () => { if (lift) el.style.zIndex = ''; if (cls) el.classList.remove(cls); };
}

function renderMe() {
  if (ui.spect) { $('#my-hand').innerHTML = '<span class="empty">👀 你在观战（看不到任何人的私密信息）</span>'; return; }
  const p = st.players[ME];
  const r = ROLES[p.role];
  const pd = st.pending;
  const choose = pd?.mode === 'choose' && st.turn === ME;
  const arrange = pd?.mode === 'arrange' && st.turn === ME;
  $('#my-hand').innerHTML = p.hand.length ? p.hand.map((c, i) => {
    const C = CARDS[c];
    const off = choose && !cardPlayable(st, ME, c) && !cardDiscardable(c);
    let tag = '';
    if (arrange && ui.arr) { if (ui.arr.keep === i) tag = '<span class="tagk">保留</span>'; const o = ui.arr.order.indexOf(i); if (o >= 0) tag = `<span class="tagk">放回${o + 1}</span>`; }
    return `<button class="card ${choose && i === pd.drawn ? 'new' : ''} ${ui.sel === i ? 'sel' : ''} ${off ? 'off' : ''} ${C.passive ? 'passive' : ''}" data-card="${i}">
      ${tag}<span class="ci">${art(c)}</span><span class="cn">${cardName(c)}</span></button>`;
  }).join('') : '<span class="empty">手里没有故事牌</span>';
}

function renderActions() {
  const box = $('#actions'), pr = $('#prompt');
  const btn = (a, label, { cls = '', off = false } = {}) => `<button class="act ${cls}" data-a="${a}" ${off ? 'disabled' : ''}>${label}</button>`;
  if (ui.night) { box.innerHTML = btn('log', '记录'); pr.textContent = '🌙 夜晚……听裁判的'; return; }
  if (ui.spect && !ui.target) {
    box.innerHTML = btn('log', '记录');
    const who = st.pending?.mode === 'answer' ? st.players[st.pending.seat] : st.players[st.turn];
    pr.textContent = st.phase === 'play' && who ? `👀 观战中 · 等待 ${who.name} ……` : st.phase === 'over' ? '👀 观战中 · 晚宴结束' : '👀 观战中';
    return;
  }
  if (ui.target) {
    const t = ui.target;
    pr.innerHTML = `${t.label}${t.need > 1 ? `（已选 ${t.picked.length}/${t.need}）` : ''}`;
    box.innerHTML = (t.cancelable === false ? '' : btn('tgCancel', '✕ 取消')) + btn('log', '记录');
    return;
  }
  if (st.phase !== 'play') { box.innerHTML = btn('log', '记录'); pr.textContent = st.phase === 'over' ? '晚宴结束' : '最后的晚餐……'; return; }
  const pd = st.pending;
  if (pd?.mode === 'answer' && pd.seat === ME) { box.innerHTML = ''; pr.textContent = '有人在问你……'; return; }
  const mine = st.turn === ME && !ui.busy && !ui.sent;
  if (pd?.mode === 'arrange' && mine) return renderArrange();
  if (pd?.mode === 'choose' && mine) {
    const c = ui.sel !== null ? st.players[ME].hand[ui.sel] : null;
    const C = c && CARDS[c];
    const canPlay = c && cardPlayable(st, ME, c);
    const why = !c ? '' : C.passive ? '（持有生效，不能打出）' : C.final && !isFinal(st) ? '（最后一轮才能用）' : canPlay ? '' : '（没有可选目标）';
    pr.innerHTML = c ? `<b>${cardName(c)}</b>${why}：${C.desc}` : '点一张手牌：<b>打出</b>，或<b>公开弃掉</b>';
    box.innerHTML = btn('play', '打出', { cls: 'hot', off: !canPlay }) + btn('discard', c && !cardDiscardable(c) ? '戒指不能弃' : '弃掉', { off: !(c && cardDiscardable(c)) }) + btn('log', '记录');
    return;
  }
  if (!mine) {
    const who = pd?.mode === 'answer' ? st.players[pd.seat] : st.players[st.turn];
    pr.textContent = who ? `等待 ${who.name} ……` : '';
  } else if (st.baton?.to === ME) pr.innerHTML = `🤝 <b>${st.players[st.baton.from].name}</b> 交棒给你：立刻进行 1 个行动`;
  else pr.innerHTML = isFinal(st) ? '🕯️ <b>最后的回合</b>：这是你最后一次行动' : '轮到你了，选一个行动';
  const L = mine ? legalMain(st, ME) : {};
  const me = st.players[ME];
  const abName = me.role === 'light' ? '莱特技能' : me.role === 'grey' ? '葛瑞技能' : '角色技能';
  box.innerHTML =
    btn('story', '进行故事', { cls: 'hot', off: !L.story }) +
    btn('swapApple', '换苹果', { off: !L.swapApple }) +
    btn('peekOwn', '查苹果', { off: !L.peekOwn }) +
    btn('swapHand', '换手牌', { off: !L.swapHand }) +
    btn('ability', abName, { cls: L.ability ? 'gold' : '', off: !L.ability }) +
    btn('talk', mine && !canSay(st, ME) ? '已发言' : '发言', { cls: mine && canSay(st, ME) ? 'gold' : '', off: !(mine && canSay(st, ME)) });
}

// 【今天要做些什么好呢】：先点保留的 1 张，再按顺序点放回的牌（第一个放最上面）
function renderArrange() {
  const hand = st.players[ME].hand;
  ui.arr = ui.arr || { keep: hand.indexOf('ring') >= 0 ? hand.indexOf('ring') : null, order: [] };
  const a = ui.arr;
  const need = hand.length - 1;
  $('#prompt').innerHTML = a.keep === null ? '📅 点一张<b>保留</b>在手里' : a.order.length < need ? `📅 按顺序点要<b>放回牌堆</b>的牌（第 1 张会在最上面）` : '确认顺序';
  $('#actions').innerHTML = `
    <button class="act hot" data-a="arrOk" ${a.keep !== null && a.order.length === need ? '' : 'disabled'}>确认放回</button>
    <button class="act" data-a="arrReset">重选</button>
    <button class="act" data-a="log">记录</button>`;
}

// ---------------- 交互 ----------------
$('#actions').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a;
  if (a === 'log') return showLog();
  if (a === 'tgCancel') return ui.target?.cancel?.();
  if (st.turn !== ME || ui.busy || ui.spect || ui.sent) return;
  const others1 = (lbl, fn) => pickTargets(1, s => s !== ME && targetable(st, s, ME) && !st.players[s].killed, lbl, ([t]) => fn(t));
  switch (a) {
    case 'talk': return openTalk();
    case 'story': return doAct({ type: 'story' });
    case 'peekOwn': return doAct({ type: 'peekOwn' });
    case 'swapApple': return others1('选择要和你<b>交换苹果</b>的人', t => doAct({ type: 'swapApple', target: t }));
    case 'swapHand': return others1('选择要和你<b>交换故事牌</b>的人', t => doAct({ type: 'swapHand', target: t }));
    case 'ability':
      if (st.players[ME].role === 'light') return pickTargets(2, s => targetable(st, s, ME), '🟡 选择<b>两名</b>玩家，交换他们的苹果（会翻开你的角色卡）', t => doAct({ type: 'ability', targets: t }));
      return confirmBox('⚪ 发动葛瑞技能？', '翻开你的角色卡。直到你下个回合开始，你不能成为卡牌效果的对象，手牌和苹果也不能被交换。', () => doAct({ type: 'ability' }));
    case 'play': return playSelected();
    case 'discard': return doAct({ type: 'discard', idx: ui.sel });
    case 'arrOk': { const r = ui.arr; ui.arr = null; return doAct({ type: 'arrange', keep: r.keep, order: r.order }); }
    case 'arrReset': ui.arr = null; return render();
  }
});

function playSelected() {
  const idx = ui.sel, c = st.players[ME].hand[idx], C = CARDS[c];
  const go = (target, opt) => doAct({ type: 'play', idx, target, opt });
  const tgt = (lbl, then) => pickTargets(1, s => validTarget(st, ME, c, s) && !st.players[s].killed, `${C.icon} 【${cardName(c)}】${lbl}`, ([t]) => then(t));
  switch (c) {
    case 'mirror': return tgt('选择要照的人', t => choiceSheet(`🪞 魔镜啊魔镜，${nmS(t)} 的……`, [['role', '🎭 角色'], ['apple', '🍎 苹果'], ['hand', '🂠 手牌']], v => go(t, v)));
    case 'truth': return tgt('选择要揭穿的人', t => choiceSheet(`🎭 “${nmS(t)}，你这家伙的真面目是……”`, Object.entries(ROLES).filter(([k]) => k !== st.players[ME].role).map(([k, r]) => [k, `${r.icon} ${r.name}`]), v => go(t, v)));
    case 'roulette2': return choiceSheet('🎡 苹果轮盘赌！（转两次）往哪边传？', [['cw', '↻ 顺时针，传两位'], ['ccw', '↺ 逆时针，传两位']], v => go(null, v));
    case 'baton': return tgt('选择接棒的人（他立刻行动 1 次）', t => go(t));
    case 'roulette': return choiceSheet('🎡 苹果轮盘赌！往哪边传？', [['cw', '↻ 顺时针（传给左手边：桌脚→左侧→桌头→右侧）'], ['ccw', '↺ 逆时针（传给右手边）']], v => go(null, v));
    case 'itadaki': return choiceSheet('🍽️ 我开动了！从牌堆顶弃几张？', [[1, '1 张'], [2, '2 张'], [3, '3 张']], v => go(null, +v));
    case 'plan': return go(null);
    default:
      if (C.target === 'none') return go(null);
      return tgt('选择目标', t => go(t));
  }
}

$('#my-hand').addEventListener('click', e => {
  const b = e.target.closest('[data-card]'); if (!b) return;
  const i = +b.dataset.card;
  const pd = st.pending;
  if (pd?.mode === 'arrange' && st.turn === ME && ui.arr) {
    const a = ui.arr;
    if (a.keep === null) a.keep = i;
    else if (i !== a.keep && !a.order.includes(i)) a.order.push(i);
    return render();
  }
  if (pd?.mode === 'choose' && st.turn === ME) { ui.sel = ui.sel === i ? null : i; render(); }
  else { const c = st.players[ME].hand[i]; sheet(CARDS[c].name, `<div class="card-detail">${art(c)}<p>${CARDS[c].desc}</p></div>`); }
});
$('#longtable').addEventListener('click', e => {
  if (e.target.closest('#disc-pile')) { const d = st.discard.slice().reverse(); return sheet(`🗑️ 弃牌堆（${d.length} 张，最上面在前）`, d.length ? `<ul>${d.map(c => `<li class="entry">${art(c)} ${CARDS[c].name}</li>`).join('')}</ul>` : '<p>还没有弃牌。</p>'); }
  const el = e.target.closest('[data-seat]'); if (!el) return;
  const s = +el.dataset.seat;
  if (ui.target) {
    if (!ui.target.ok(s)) return;
    const t = ui.target;
    if (t.picked.includes(s)) t.picked = t.picked.filter(x => x !== s); else t.picked.push(s);
    if (t.picked.length >= t.need) { ui.target = null; t.done(t.picked); }
    render();
    return;
  }
  seatInfo(s);
});
$('#btn-log').onclick = showLog;
$('#btn-chart').onclick = () => {
  sheet('角色喜好与能力', '<img class="chart-img" src="assets/role_chart.png" alt="角色喜好与能力速查表">');
  document.querySelector('.sheet-body').classList.add('tall');
};
$('#btn-menu').onclick = () => {
  // 设置用开关：点了马上生效，菜单不关；其余是一次性的按钮
  const sw = (id, label, sub, on) => `<label class="setting"><span>${label}<small>${sub}</small></span><input type="checkbox" class="switch" id="${id}" ${on ? 'checked' : ''}></label>`;
  sheet('菜单', `<div class="setting-list">
    ${sw('m-voice', '🔊 语音', '裁判和 AI 角色的配音；关掉后仍有字幕', !isMuted())}
    ${online.isOnline() ? '' : sw('m-speed', '⏩ AI 快速模式', 'AI 行动之间的停顿缩短', ui.speed !== 1)}
  </div>
  <div class="menu-list">
    <button class="btn" id="m-rules">📘 规则说明</button>
    <button class="btn" id="m-deck">🃏 本局牌堆构成</button>
    ${online.isOnline() ? '' : '<button class="btn" id="m-restart">🔁 重新开一局</button>'}
    <button class="btn ghost" id="m-home">${online.isOnline() ? '🚪 离开房间' : '🏠 返回首页'}</button></div>`);
  $('#m-voice').onchange = e => setMuted(!e.target.checked);
  if ($('#m-speed')) $('#m-speed').onchange = e => { ui.speed = e.target.checked ? 0.4 : 1; try { localStorage.setItem('pa-ai-fast', e.target.checked ? '1' : '0'); } catch {} };
  $('#m-rules').onclick = showRules;
  $('#m-deck').onclick = () => sheet(`🃏 故事牌 ${Object.values(st.deckCounts).reduce((a, b) => a + b, 0)} 张`, `<ul>${Object.entries(st.deckCounts).map(([k, v]) => `<li class="entry">${art(k)} ${CARDS[k].name} × ${v}</li>`).join('')}</ul><p class="hint">固定配比，每局洗混。</p>`);
  if ($('#m-restart')) $('#m-restart').onclick = () => { closeSheet(); voiceStop(); startGame(); };
  $('#m-home').onclick = () => {
    closeSheet();
    if (online.isOnline() && !confirm(ui.spect || st?.phase !== 'play' ? '离开房间？' : '离开房间？这一局你的座位会交给 AI 代打。')) return;
    goHome();
  };
};

function pickTargets(need, ok, label, done, opts = {}) {
  ui.target = { need, ok, label, done, picked: [], cancel: () => { ui.target = null; render(); }, ...opts };
  render();
}
function choiceSheet(title, items, fn) {
  sheet(title, `<div class="menu-list">${items.map(([v, l]) => `<button class="btn" data-ch="${v}">${l}</button>`).join('')}</div>`);
  document.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { closeSheet(); fn(b.dataset.ch); });
}

async function doAct(a) {
  if (ui.busy) return;
  if (online.isOnline()) {
    if (ui.sent || ui.spect) return;
    ui.sent = true; if (a.type !== 'say') ui.sel = null;
    online.act(a); render();
    return;
  }
  const evStart = st.events.length, finalBefore = isFinal(st);
  try {
    const before = st.log.length;
    act(st, ME, a);
    if (a.type !== 'say') ui.sel = null;
    ui.flipMs = a.type === 'swapApple' || a.type === 'ability' || a.type === 'swapHand' ? 1300 : null;
    holdPref(evStart); holdRing(evStart);
    bubbleFor(ME, a);
    afterAct(before);
  } catch (err) { toast(err.message); render(); return; }
  render();
  ui.busy = true;
  try { await present(ME, a, evStart, finalBefore); } finally { ui.busy = false; }
  render();
  if (st.turn !== ME || st.phase !== 'play' || st.pending?.mode === 'answer') loop();
}

// 刚被提问的人：先藏起桌上那张新提问卡，等他开口回答时再摆出来
function holdPref(evStart) { const pf = st.events.slice(evStart).find(e => e.k === 'pref'); ui.hidePref = pf ? { seat: pf.seat } : null; }
// 最后的回合里有人被戒指咒死：先别显示，等这一步演出完再单独揭晓
function holdRing(evStart) { const ds = st.events.slice(evStart).filter(e => e.k === 'ringDeath').map(e => e.seat); ui.hideRing = ds.length ? new Set(ds) : null; }
function afterAct(before) {
  const mine = st.log.slice(before).filter(e => e.vis === ME);
  if (mine.length) toast(mine.map(e => e.text).join('<br>'), 2800);
  const pub = st.log.slice(before).filter(e => e.vis === 'all' && e.tag !== 'ringDeath');
  if (pub.length) $('#news').innerHTML = pub[pub.length - 1].text;
}

function bubbleFor(seat, a) {
  let txt = '';
  const ev = st.events.filter(e => e.seat === seat || e.a === seat).pop();
  switch (a.type) {
    case 'story': txt = '进行故事…'; break;
    case 'play': { const e = st.events.filter(x => x.k === 'play' && x.seat === seat).pop(); if (e) txt = `${CARDS[e.card].icon}${cardName(e.card)}${e.target != null ? ' → ' + nmS(e.target) : ''}`; break; }
    case 'arrange': txt = '📅 放回牌堆'; break;
    case 'discard': txt = '🗑️ 弃牌'; break;
    case 'swapApple': txt = `🍎⇄ ${nmS(a.target)}`; break;
    case 'swapHand': txt = `🂠⇄ ${nmS(a.target)}`; break;
    case 'peekOwn': txt = '👀 偷看自己的苹果'; break;
    case 'ability': txt = st.players[seat].role === 'light' ? `🟡 我是莱特！${nmS(a.targets[0])}⇄${nmS(a.targets[1])}` : '⚪ 我是葛瑞！别碰我'; break;
    case 'answer': txt = '……'; break;
    case 'say': txt = '💬 ' + (st.claims[st.claims.length - 1]?.text || ''); break;
  }
  ui.bubbles = { [seat]: txt };
}

// ---------------- 发言 ----------------
function openTalk() {
  const T = [
    ['rose', '🌹 “我觉得 ___ 是罗泽！”'],
    ['notRose', '🙅 “我才不是罗泽！”'],
    ['normal', '🍎 “我的苹果是好的。”'],
    ['poison', '☠️ “我的苹果……是毒的！”'],
    ['role', '🎭 “我是 ___。”'],
  ];
  sheet('发言（免费，每回合一句，可以说谎）', `<div class="menu-list">${T.map(([k, l]) => `<button class="btn" data-talk="${k}">${l}</button>`).join('')}</div>
    <p class="hint">说谎被看穿（比如别人看过你的苹果），AI 就不再信你。</p>`);
  document.querySelectorAll('[data-talk]').forEach(b => b.onclick = () => {
    const k = b.dataset.talk; closeSheet();
    const send = claim => doAct({ type: 'say', claim });
    if (k === 'role') return choiceSheet('🎭 我是……', Object.entries(ROLES).map(([rk, r]) => [rk, `${r.icon} ${r.name}`]), v => send({ type: 'role', value: v }));
    if (k === 'notRose') return send({ type: 'notRose' });
    if (k === 'normal' || k === 'poison') return send({ type: 'apple', value: k });
    pickTargets(1, s => s !== ME && !st.players[s].killed, '💬 你觉得谁是<b>罗泽</b>？', ([t]) => send({ type: 'rose', about: t }));
  });
}

// ---------------- AI 循环 ----------------
async function loop() {
  if (ui.busy) return;
  ui.busy = true;
  const game = st;
  try {
    while (st === game && st.phase === 'play') {
      if (st.pending?.mode === 'answer') {
        const s = st.pending.seat;
        if (s === ME) { ui.busy = false; render(); return askNavy(); }
        await step(s); continue;
      }
      if (st.turn === ME) break;
      await sleep(1100 * ui.speed);
      if (st !== game) return;
      if (st.phase !== 'play' || st.turn < 0) break;
      await step(st.turn);
    }
  } finally { if (st === game) ui.busy = false; }
  if (st !== game) return;
  render();
  if (st.phase === 'settle') settle();
  else if (st.phase === 'over' && st.result?.early) earlyEnd();
}

async function step(seat) {
  const before = st.log.length, evStart = st.events.length, finalBefore = isFinal(st);
  const a = aiStep(st, seat);
  // 换苹果：先开口“我要跟你换苹果”，说完再动手
  if ((a.type === 'swapApple' || a.type === 'swapHand') && Number.isInteger(a.target)) {
    const base = a.type === 'swapApple' ? 'act_swapApple' : 'act_swapHand';
    await speak(seat, base, { fallback: a.type === 'swapApple' ? `我要跟${nmS(a.target)}换苹果。` : `手牌跟${nmS(a.target)}换一换。` });
    if (st.phase !== 'play') return;
  }
  ui.flipMs = a.type === 'swapApple' || a.type === 'ability' || a.type === 'swapHand' ? 1300 : null;
  try { act(st, seat, a); } catch (e) { console.warn('AI 出错，改为看苹果', e, a); try { act(st, seat, { type: 'peekOwn' }); } catch {} }
  holdPref(evStart); holdRing(evStart);
  // 偷看完自己的苹果，偶尔顺口说一句
  if (a.type === 'peekOwn') { const v = aiAfterPeek(st, seat); if (v) { try { remarkAfterPeek(st, seat, v); a.remark = v; } catch {} } }
  bubbleFor(seat, a);
  afterAct(before);
  render();
  await present(seat, a, evStart, finalBefore);
  if ((st.pending?.mode === 'choose' || st.pending?.mode === 'arrange') && st.turn === seat) await step(seat);
}

// ---------------- 演出：让每一步都看得清、听得到 ----------------
// 停顿时长（毫秒，乘以 AI 速度系数）；语音会念完再算停顿
const HOLD = { story: 1300, discard: 1800, swapApple: 2300, swapHand: 2000, peekOwn: 2000, ability: 2500, arrange: 1500, say: 1000, answer: 1300,
  play: 1400, silentCard: 2200, afterAnswer: 1600, reveal: 2400, miss: 1600, dodge: 1300, roulette: 2100 };
const pace = key => sleep((HOLD[key] ?? 1000) * ui.speed);
const voiceOf = s => (st.players[s].human ? null : st.players[s].voice);   // 真人玩家没有配音

// 让 s 说一句（有语音就念，没有就按字数停一下）；bubble 为 true 时用台词原文当气泡
async function speak(s, base, { bubble = true, fallback = '' } = {}) {
  const id = voiceOf(s);
  const ln = id ? playerLine(id, base) : null;
  const text = ln ? ln.text : fallback;
  if (bubble && text) { ui.bubbles = { ...ui.bubbles, [s]: '💬 ' + text }; render(); }
  if (ln) await playClip(playerUrl(id, ln.key), ln.text);
  else if (text) await sleep((500 + text.length * 160) * ui.speed);
  return ln;
}

const CARD_VOICE = { likeApple: 'card_likeApple', likeShroom: 'card_likeShroom', mirror: 'card_mirror', knife: 'card_knife', baton: 'card_baton' };

async function present(seat, a, evStart, finalBefore) {
  const game = st;
  const evs = st.events.slice(evStart);
  const isAI = !st.players[seat].human;
  const say = async (s, base, opts) => (st === game ? speak(s, base, opts) : null);
  switch (a.type) {
    case 'say': {
      const c = st.claims[st.claims.length - 1];
      const base = c?.type === 'rose' ? 'say_rose' : c?.type === 'notRose' ? 'say_notRose' : c?.type === 'apple' ? 'say_apple_' + c.value : null;
      if (isAI && base) await say(seat, base, { bubble: false });
      await pace('say');
      break;
    }
    case 'play': {
      const pe = evs.find(e => e.k === 'play');
      if (!pe) break;
      const card = pe.card;
      // 出牌人的台词
      let vb = CARD_VOICE[card];
      if (card === 'roulette' || card === 'roulette2') vb = `card_${card}_${pe.opt === 'ccw' ? 'ccw' : 'cw'}`;
      if (card === 'truth') vb = 'card_truth';
      const spoken = isAI && vb ? await say(seat, vb, { bubble: false }) : null;
      if (card === 'truth') { if (isAI) await say(seat, 'guess_' + pe.opt, { fallback: ROLES[pe.opt]?.name + '！' }); }
      if (!spoken && card !== 'truth') await pace(isAI ? 'silentCard' : 'play');
      // 被武器打中的人亮出“好危险”
      const dg = evs.find(e => e.k === 'dodge');
      if (dg) { await say(dg.seat, 're_dodge', { fallback: '哎呀，好危险！' }); await pace('dodge'); }
      // 提问卡：被问的人回答，答完才把卡摆上桌
      const pf = evs.find(e => e.k === 'pref');
      if (pf) {
        await sleep(500 * ui.speed);
        ui.hidePref = null; render();
        await say(pf.seat, `ans_${pf.q === 'apple' ? 'apple' : 'shroom'}_${pf.yes ? 'yes' : 'no'}`,
          { fallback: pf.yes ? `嗯，我喜欢${FOOD[pf.q]}。` : `我不喜欢${FOOD[pf.q]}。` });
        await pace('afterAnswer');
      }
      if (card === 'truth') await pace(evs.some(e => e.k === 'reveal') ? 'reveal' : 'miss');
      else if (card === 'roulette' || card === 'roulette2') await pace('roulette');
      else if (!pf && !dg) await pace('play');
      break;
    }
    case 'answer': await pace('answer'); break;
    case 'peekOwn': {
      await pace('peekOwn');
      if (a.remark && isAI) { await say(seat, 'say_apple_' + a.remark); await pace('say'); }
      break;
    }
    default: await pace(a.type);
  }
  ui.hidePref = null;
  // 裁判报牌堆：只剩最后一张时提醒；最后一张被抽走后，等那个人把这回合做完，再宣布“每人最后一次机会”
  if (st === game && st.phase === 'play' && !isFinal(st) && st.deck.length === 1 && !ui.saidLastCard && !st.pending && st.turn !== seat) {
    ui.saidLastCard = true; $('#news').innerHTML = lineText('last_card'); await voice('last_card'); await sleep(400);
  }
  if (st === game && st.phase === 'play' && isFinal(st) && !ui.saidFinal && !st.pending && st.turn !== seat) {
    ui.saidFinal = true; $('#news').innerHTML = lineText('final_round'); await voice('final_round'); await sleep(400);
  }
  for (const e of evs) if (e.k === 'ringDeath' && st === game) await presentRingDeath(e.seat, game, e.via);
  if (st === game) { ui.bubbles = {}; render(); }
}

// 最后的回合轮到某人时，他手上还是诅咒戒指 → 当场倒下。停久一点，让大家看清发生了什么
async function presentRingDeath(s, game, via) {
  const who = isMe(s) ? '你' : st.players[s].name;
  ui.hideRing?.delete(s);
  ui.ringShow = true;
  ui.nightGlow = { seats: [s] };
  ui.bubbles = { [s]: '💍 被诅咒而死……' };
  $('#news').innerHTML = `💍 ${who}手上的是【诅咒戒指】，被诅咒而死！`;
  overlay(`<div class="scene-seal">${art('ring')}</div><h2>${who}被诅咒而死</h2>
    <p>${via === 'baton' ? `最后的回合里${who}接棒时` : `最后的回合轮到${who}时`}，手上还攥着【诅咒戒指】……<br>${who}倒下了，不能再行动。</p>`, true, posFor(s));
  render();
  // 裁判：“诅咒戒指……发作了。”念完再多停一会儿；整段至少 4.2 秒（快速模式按比例缩短）
  const k = Math.max(ui.speed, 0.6), t0 = Date.now();
  await voice('ring_curse');
  if (st !== game) return;
  await sleep(Math.max(4200 * k - (Date.now() - t0), 1500 * k));
  if (st !== game) return;
  closeOverlay();
  ui.ringShow = false; ui.nightGlow = null; ui.bubbles = {};
  render();
  await sleep(600 * ui.speed);
}

function askNavy() {
  const pd = st.pending;
  const food = FOOD[pd.q];
  const truth = ROLES.navy.food === pd.q;
  overlay(`<div class="portrait-frame">${art('navy')}</div><h2>${st.players[pd.asker].name} 问你</h2>
    <p>“你喜欢${food}吗？”（大家都看得到你怎么放这张牌）</p>
    <p class="hint">你是奈维，可以撒谎。奈维其实${truth ? '喜欢' : '不喜欢'}${food}。</p>
    <div class="ov-card"><button class="btn" data-ans="1">↕️ 竖放：喜欢${truth ? '（真话）' : ''}</button><button class="btn" data-ans="0">↔️ 横放：不喜欢${!truth ? '（真话）' : ''}</button></div>`);
  document.querySelectorAll('[data-ans]').forEach(b => b.onclick = () => {
    closeOverlay();
    if (online.isOnline()) { ui.sent = true; online.act({ type: 'answer', yes: b.dataset.ans === '1' }); render(); return; }
    const before = st.log.length;
    const evStart = st.events.length;
    act(st, ME, { type: 'answer', yes: b.dataset.ans === '1' });
    holdRing(evStart);
    bubbleFor(ME, { type: 'answer' }); afterAct(before); render();
    ui.busy = true;
    present(ME, { type: 'answer' }, evStart, isFinal(st)).finally(() => { ui.busy = false; render(); loop(); });
  });
}

// ---------------- 结算演出 ----------------
async function settle() {
  let game = st;
  render();
  overlay(`<div class="scene-seal">${art('itadaki')}</div><h2>最后的晚餐</h2><p>故事讲完了。女王，请现身吧……</p>`);
  await voice('supper'); await sleep(500);
  if (st !== game) return;
  await voice('queen_call'); await sleep(400);
  if (st !== game) return;
  const pickPoison = () => new Promise(res => {
    pickTargets(1, s => s !== ME && !st.players[s].killed, '👑 你手里是<b>毒苹果</b>！指定一个人吃下它', ([t]) => res(t), { cancelable: false });
  });
  let q, target = null, R = null;
  if (online.isOnline()) {
    // 我是持毒的女王：服务器会先来问我要指定谁
    const asked = await Promise.race([online.waitSettled().then(() => false), online.waitQueenAsk()]);
    if (st !== game) return;
    if (asked) { closeOverlay(); online.queenPick(await pickPoison()); }
    R = await online.waitSettled();
    if (st !== game) return;
    st = game = R.queen;
    q = queenSeat(st); target = st.forcedEat ?? null;
  } else {
    q = queenSeat(st);
    if (queenCanGive(st)) {
      if (q === ME) { closeOverlay(); target = await pickPoison(); }
      else target = aiQueenTarget(st);
    }
    settleQueen(st, target);
  }
  const qp = st.players[q];
  overlay(`<div class="scene-seal">${art('queen')}</div><h2>${isMe(q) ? '你' : qp.name} 是女王！</h2>
    <p>${qp.killed ? '可惜她已经被杀害，无法行动。' : target != null ? `她手里是 ☠️ 毒苹果……<br>她命令 <b>${nmS(target)}</b> 吃下去！` : `她手里是${queenCanGive(st) ? '毒苹果，但没有送出' : '一颗普通苹果'}。`}</p>`, true, posFor(q));
  render();
  if (qp.killed) await voice('queen_dead');
  else if (!qp.human) {
    await speak(q, 'q_reveal'); await sleep(300);
    if (st === game) await speak(q, target != null ? 'q_give' : 'q_nopoison');
  } else await voice(target != null ? 'queen_give' : 'queen_nopoison');
  await sleep(1400 * ui.speed);
  if (st !== game) return;
  ui.bubbles = {};
  ui.reveal.roles = true;
  if (R) st = game = R.roles;
  overlay(`<h2>所有人翻开角色卡</h2>`, true); render();
  await sleep(1800);
  if (st !== game) return;
  if (R) st = game = R.final; else settleFinish(st);
  overlay(`<h2>“我开动了！”</h2><p>所有人一起咬下苹果……</p>`, true);
  await sleep(1300);
  const sw = st.players.findIndex(p => p.role === 'snow');
  const dead = st.result.dead.slice();
  if (st.result.revived) dead[sw] = true;   // 先跟着倒下，再被王子吻醒
  ui.reveal.apples = true; ui.dead = dead; render();
  await sleep(1800);
  if (st !== game) return;
  if (st.result.revived) { await presentPrince(sw, game); if (st !== game) return; }
  ui.reveal.final = true; render();
  await voice(st.result.winner === 'queen' ? 'win_queen' : st.result.winner === 'rose' ? 'win_rose' : 'win_snow');
  if (st !== game) return;
  showResult();
}

// 白雪公主在晚宴前就倒下了（毒梳子 / 诅咒戒指）：不用再玩下去，交代清楚后直接进结果
async function earlyEnd() {
  const game = st, e = st.result.early, s = e.seat;
  const who = isMe(s) ? '你' : st.players[s].name;
  const how = e.cause === 'comb'
    ? `被${e.by == null ? '' : isMe(e.by) ? '你的' : ` ${nmS(e.by)} 的`}毒梳子刺中`
    : '最后的回合里手上还攥着诅咒戒指，被诅咒夺走了性命';
  ui.bubbles = {};
  ui.nightGlow = { seats: [s] };
  ui.reveal.roles = true; ui.reveal.apples = true; ui.dead = st.result.dead;
  $('#news').innerHTML = '👸 白雪公主倒下了，晚宴提前结束！';
  overlay(`<div class="scene-seal">${art('snow')}</div><h2>白雪公主倒下了</h2>
    <p>${who}就是白雪公主，${how}……<br>晚宴不必再继续了，<b>女王阵营获胜</b>。</p>`, true, posFor(s));
  render();
  const k = Math.max(ui.speed, 0.6), t0 = Date.now();
  await voice('snow_fell');
  if (st !== game) return;
  await sleep(Math.max(4500 * k - (Date.now() - t0), 1500 * k));
  if (st !== game) return;
  ui.nightGlow = null; ui.reveal.final = true; render();
  await sleep(600);
  if (st !== game) return;
  showResult();
}

// 白雪吃了毒苹果、但手里有【啊，是王子大人】：单独交代一下，桌上的王子牌翻开，她再醒过来
async function presentPrince(s, game) {
  const who = isMe(s) ? '你' : st.players[s].name;
  ui.princeShown = true;
  ui.nightGlow = { seats: [s] };
  ui.bubbles = { [s]: '🤴 啊，是王子大人！' };
  $('#news').innerHTML = `🤴 ${who}亮出【啊，是王子大人】，白雪公主被吻醒了！`;
  overlay(`<div class="scene-seal">${art('prince')}</div><h2>啊，是王子大人！</h2>
    <p>白雪公主${who === '你' ? '（你）' : ' ' + who + ' '}吃下了毒苹果……<br>可${who}手里握着【啊，是王子大人】，被王子吻醒了！</p>`, true, posFor(s));
  render();
  const k = Math.max(ui.speed, 0.6), t0 = Date.now();
  await voice('prince');
  if (st !== game) return;
  ui.dead = st.result.dead; render();   // 醒过来
  await sleep(Math.max(4200 * k - (Date.now() - t0), 1500 * k));
  if (st !== game) return;
  ui.nightGlow = null; ui.bubbles = {}; render();
}

function showResult() {
  const r = st.result;
  const meWin = !ui.spect && r.winners.includes(ME);
  const rows = st.players.map(p => {
    const role = ROLES[p.role];
    const fate = p.killedBy === 'ring' ? '💍 被诅咒而死' : p.killed ? '🪮 被杀害' : r.ringDeath[p.seat] ? '💍 戒指' : r.poisoned[p.seat] ? (st.forcedEat === p.seat ? '👑 被逼吃毒' : '☠️ 中毒') : (p.role === 'snow' && r.revived ? '🤴 复活' : '😋 存活');
    return `<div class="result-row ${r.winners.includes(p.seat) ? 'w' : ''} ${r.dead[p.seat] ? 'd' : ''}">
      ${art(p.role, 'result-portrait')}<span class="grow">${nmS(p.seat)} · ${role.name}</span><span>${fate}</span>${r.winners.includes(p.seat) ? '🏆' : ''}</div>`;
  }).join('');
  const title = r.winner === 'rose' ? '罗泽独自获胜' : TEAMS[r.winner] + '获胜';
  const sub = r.early ? (r.early.cause === 'comb' ? '白雪公主被毒梳子刺中，晚宴提前结束……' : '白雪公主被诅咒戒指夺走了性命，晚宴提前结束……')
    : r.winner === 'queen' ? '白雪公主倒在了餐桌上……' : r.winner === 'rose' ? '白雪公主和罗泽都活了下来——罗泽独占了胜利！' : '白雪公主平安吃完了晚餐，罗泽没能活下来。';
  overlay(`<div class="scene-seal">${art(r.winner === 'rose' ? 'rose' : r.winner === 'queen' ? 'queen' : 'snow')}</div>
    <h2>${title}</h2><p>${sub}</p><p><b>${ui.spect ? '观战结束' : meWin ? '你赢了！' : '你输了。'}</b></p>
    <div class="result-list">${rows}</div>
    <div style="display:flex;gap:8px;width:100%"><button class="btn" style="flex:1" id="r-log">📖 复盘</button><button class="btn" style="flex:1" id="r-table">👀 看桌面</button><button class="btn primary" style="flex:2" id="r-again">${online.isOnline() ? '回到房间' : '再来一局'}</button></div>`);
  $('#r-again').onclick = () => { closeOverlay(); if (online.isOnline()) showLobby(); else startGame(); };
  $('#r-log').onclick = showLog;
  $('#r-table').onclick = () => { closeOverlay(); $('#prompt').innerHTML = '<button class="cancel" id="back-res">↩ 回到结果</button>'; $('#back-res').onclick = showResult; };
}

// ---------------- 弹层工具 ----------------
const posFor = s => ((s - ME + st.n) % st.n === 0 ? 'top' : 'bottom');
function overlay(html, pass = false, pos = 'bottom') {
  const o = $('#overlay');
  o.className = 'overlay' + (pass ? ' pass' + (pos === 'top' ? ' at-top' : '') : '');
  o.innerHTML = pass ? `<div class="ov-card">${html}</div>` : html;
}
function closeOverlay() { $('#overlay').className = 'overlay hidden'; $('#overlay').innerHTML = ''; }
function sheet(title, html) { $('#sheet-title').innerHTML = title; $('#sheet-content').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); document.querySelector('.sheet-body')?.classList.remove('tall'); }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet(); });
let toastT;
function toast(html, ms = 1800) { const t = $('#toast'); t.innerHTML = html; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
function confirmBox(title, text, yes) {
  sheet(title, `<p>${text}</p><div style="display:flex;gap:8px"><button class="btn" style="flex:1" data-close>算了</button><button class="btn primary" style="flex:1" id="cf-yes">发动</button></div>`);
  $('#cf-yes').onclick = () => { closeSheet(); yes(); };
}

function showLog() {
  // 最新的在最下面；日志种类 'card' 会撞上手牌的 .card 样式，换个类名
  const cls = k => (k === 'card' ? 'cardlog' : k);
  const items = visibleLog(st, ME).map(e =>
    `<div class="log-item ${e.vis === ME ? 'private' : cls(e.kind)}"><span class="tn">R${e.round}</span>${e.vis === ME ? '🔒 ' : ''}${e.text}</div>`).join('');
  sheet('📖 晚宴记录（🔒 只有你知道）', items);
  const box = $('#sheet-content');
  box.scrollTop = box.scrollHeight;                         // 打开就停在最新一条
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function seatInfo(s) {
  const p = st.players[s];
  const lines = [];
  const r = ROLES[p.role];
  if (p.role && (isMe(s) || p.roleUp || st.roleKnow[ME][s] || ui.reveal.roles)) lines.push(`<div class="seat-portrait">${art(p.role)}</div><p><b>${r.name}</b>（${TEAMS[r.team]} · 喜好${FOOD[r.food]}）${!p.roleUp && !isMe(s) && !ui.reveal.roles ? ' <span class="hint">只有你知道</span>' : ''}</p><p>${r.desc}</p>`);
  else lines.push('<p>角色：❓ 未知（背面朝上）</p>');
  const ap = st.apples[p.apple], k = st.know[ME][ap.id];
  lines.push(`<p>苹果：${ap.up ? `正面朝上：${ap.type === 'poison' ? '☠️ 毒苹果' : '🍎 普通苹果'}` : k ? (k === 'poison' ? '☠️ 你知道这颗是毒的' : '🍎 你知道这颗是普通的') : '❓ 不知道'}</p>`);
  if (p.prefs.length) lines.push(`<p>桌前的提问卡：${p.prefs.map(x => `你喜欢${FOOD[x.q]}吗？→ ${x.yes ? '↕️ 竖放（喜欢）' : '↔️ 横放（不喜欢）'}`).join('；')}</p>`);
  if (isMe(s) && p.role === 'green') lines.push(`<p>👁️ 开局看到白雪公主：${st.players[st.intel.green.snow].name}</p>`);
  if (isMe(s) && p.role === 'black') lines.push(`<p>👁️ 开局毒苹果在：${st.intel.black.poison.map(x => st.players[x].name).join('、')}（之后可能被换走）</p>`);
  const hk = st.handKnow[ME][s];
  lines.push(`<p>手牌：${isMe(s) ? p.hand.map(cardName).join('、') || '无' : `${p.hand.length} 张${hk ? `（你在第 ${hk.turn} 手时知道是：${hk.cards.map(cardName).join('、') || '空'}）` : ''}`}</p>`);
  const said = st.claims.filter(c => c.seat === s).slice(-6);
  if (said.length) lines.push(`<p>💬 ${isMe(s) ? '你' : '他'}说过：</p><ul>${said.map(c => `<li>${c.text}</li>`).join('')}</ul>`);
  if (!isMe(s) && !ui.spect && liesCaught(st, ME, s) > 0) lines.push('<p>🤥 <b>你抓到他说过谎</b>（和你亲眼看到的对不上）</p>');
  if (p.roped) lines.push('<p>🪢 被绳索绑住：下个回合跳过</p>');
  if (p.warded) lines.push('<p>🛡️ 葛瑞守护中：现在不能对他做任何事</p>');
  if (p.killedBy === 'ring' && ringShown(s)) lines.push('<p>💍 手上的是【诅咒戒指】，被诅咒而死</p>');
  else if (p.killedBy === 'comb') lines.push('<p>🪮 已被毒梳子杀害</p>');
  sheet(nmS(s), lines.join(''));
}

function showRules() {
  sheet('规则与角色', `<details class="guide"><summary>查看八人角色喜好与能力表</summary><img src="art/role-guide.png" alt="八人场各角色的喜好、胜利条件和技能"></details>
  <h3>目标</h3><ul><li><b>白雪阵营</b>（白雪、格林、莱特、葛瑞）：白雪公主存活——但若罗泽也活着，则<b>罗泽独胜</b>。</li><li><b>女王阵营</b>（女王、布莱克、奈维）：白雪公主死亡。</li><li><b>罗泽</b>：白雪公主和自己都活着 → 独自获胜，其他人全输。</li></ul>
  <h3>准备</h3><ul><li>8 人，4 颗毒苹果，29 张故事牌（15 种，固定配比）。每人一张角色卡、一张故事牌、一颗苹果，开局都能看。</li><li>夜晚：格林得知白雪是谁，布莱克得知毒苹果在谁手里。</li></ul>
  <h3>你的回合（5 选 1）</h3><ul>
  <li><b>进行故事</b>：抽 1 张，从手里选 1 张<b>打出</b>或<b>公开弃掉</b>。牌堆空了就直接用手里的。</li>
  <li><b>换故事牌</b>：和一人交换手里的故事牌。</li><li><b>换苹果</b>：和一人交换苹果，谁都不能看。</li>
  <li><b>查苹果</b>：偷看自己现在的苹果。</li><li><b>角色技能</b>：莱特、葛瑞（翻开角色卡发动；已被翻开就不能用）。</li></ul>
  <h3>故事牌</h3><ul>${Object.entries(CARDS).map(([key,c]) => `<li class="entry">${art(key)}<b>${c.name}</b>${c.weapon ? '（武器）' : ''}：${c.desc}</li>`).join('')}</ul>
  <h3>桌面怎么看</h3><ul><li>每人桌前：角色卡（月下森林牌背为隐藏身份，紫色虚线表示私人情报）、苹果（亮红色为未知，笑脸为普通，骷髅为有毒）、手牌背面数、提问卡（<b>竖放=喜欢，横放=不喜欢</b>）。</li><li>🪢被绑（跳过下回合）🛡️葛瑞守护 🪮被杀害 🤥你抓到他撒谎。</li></ul>
  <h3>结束</h3><ul><li>白雪公主在晚宴前就倒下了（被毒梳子刺中，或最后的回合还攥着诅咒戒指）→ 晚宴立刻结束，女王阵营获胜。</li><li>牌堆空了以后，所有人再各行动一次（最后的回合）。轮到某人时他手上还是【诅咒戒指】，就当场被诅咒而死，不能行动。</li><li>女王最先公开身份和苹果；若是毒苹果，可以指定一人吃下。</li><li>所有人翻开：持毒苹果的、被毒梳子杀害的、手里还攥着诅咒戒指的都会死。白雪若持【啊，是王子大人】且死于毒苹果则复活。</li></ul>
  <h3>发言</h3><ul><li>每回合行动前免费说一句，可以说谎。AI 会对照自己看到的来判断信不信你。</li></ul>
  <h3>角色</h3><ul>${Object.entries(ROLES).map(([key,r]) => `<li class="entry">${art(key)}<b>${r.name}</b>（${TEAMS[r.team]}，喜好${FOOD[r.food]}）：${r.desc}</li>`).join('')}</ul>`);
}

// ---------------- 联机 ----------------
function showScreen(which) {
  $('#screen-start').classList.toggle('hidden', which === 'game');
  $('#screen-game').classList.toggle('hidden', which !== 'game');
  $('#start-main').classList.toggle('hidden', which !== 'home');
  $('#lobby-card').classList.toggle('hidden', which !== 'lobby');
  $('#start-sub').textContent = which === 'lobby' ? '联机房间 · 最多 8 人入座' : '毒苹果 · 八人身份推理';
}
function goHome() {
  voiceStop(); closeOverlay(); closeSheet();
  if (online.isOnline()) online.leave();
  st = null; ui = fresh(); ME = 0;
  showScreen('home');
}
function showLobby() { voiceStop(); closeOverlay(); closeSheet(); st = null; ui = fresh(); showScreen('lobby'); online.renderLobby(); }

function enterOnline() {
  const name = ($('#in-name').value.trim() || '我').slice(0, 8);
  try { localStorage.setItem('pa-name', name); } catch {}
  loadPlayerLines(AIS.map(x => x[3]));
  showLobby();
  online.renderLobby(null);
  $('#lobby-status').textContent = '';
  online.join(name, {
    onGame: onlineGame,
    onLobby: info => { if (!$('#lobby-card').classList.contains('hidden')) online.renderLobby(info); },
    onError: (msg, fatal) => { toast(msg, 4500); ui.sent = false; if (st) render(); if (fatal) { st = null; showScreen('home'); } },
    onStatus: text => { $('#lobby-status').textContent = text; if (text) toast(text, 2500); },
  });
}
$('#btn-lobby-start').onclick = () => online.startGame();
$('#btn-lobby-leave').onclick = goHome;

function enterTable(m) {
  ME = m.seat >= 0 ? m.seat : 0;
  st = m.view;
  ui = fresh(); ui.spect = m.seat < 0;
  loadPlayerLines(st.players.map(p => p.voice).filter(Boolean));
  closeOverlay(); closeSheet(); voiceStop();
  showScreen('game');
  render();
}

// 服务器发来的对局消息（已经按顺序排好队；返回的 Promise 结束 = 演完了）
async function onlineGame(m) {
  if (m.t === 'start') {
    enterTable(m);
    if (ui.spect) { toast('本局真人已满或已开局，你在观战', 2600); return; }
    await new Promise(res => { ui.nightDone = res; showIntro(); });
    return;
  }
  if (m.t === 'sync') {
    enterTable(m);
    if (st.phase === 'play' && st.pending?.mode === 'answer' && st.pending.seat === ME && !ui.spect) askNavy();
    return;
  }
  if (m.t !== 'up' || !st) return;
  const seat = m.seat, a = m.a, game = st, before = st.log.length;
  ui.sent = false;
  ui.busy = true;
  // AI 换苹果 / 换手牌：先开口，说完再动手（与单机一致）
  if ((a.type === 'swapApple' || a.type === 'swapHand') && Number.isInteger(a.target) && !st.players[seat].human) {
    await speak(seat, a.type === 'swapApple' ? 'act_swapApple' : 'act_swapHand', { fallback: a.type === 'swapApple' ? `我要跟${nmS(a.target)}换苹果。` : `手牌跟${nmS(a.target)}换一换。` });
    if (st !== game) return;
  }
  ui.flipMs = a.type === 'swapApple' || a.type === 'ability' || a.type === 'swapHand' ? 1300 : null;
  st = m.view;
  if (seat === ME && a.type !== 'say') ui.sel = null;
  if (m.auto && seat === ME && !ui.spect) toast('你太久没有操作，AI 帮你走了这一步', 2600);
  holdPref(m.evStart); holdRing(m.evStart);
  bubbleFor(seat, a);
  afterAct(before);
  render();
  try { await present(seat, a, m.evStart, false); } finally { ui.busy = false; }
  if (!st) return;
  render();
  if (st.phase === 'play' && st.pending?.mode === 'answer' && st.pending.seat === ME && !ui.spect) askNavy();
  if (st.phase === 'settle') await settle();
  else if (st.phase === 'over' && st.result?.early) await earlyEnd();
}

window.__pa = {
  get st() { return st; }, ui: () => ui, render,
  async autoMe() { if (st.turn !== ME || ui.busy) return false; let g = 0; while (st.turn === ME && st.phase === 'play' && g++ < 5) { const a = aiStep(st, ME); await doAct(a); if (a.type !== 'say' && !st.pending) break; } return true; },
  fast() { ui.speed = 0.05; },
  settle() { st.phase = 'settle'; st.turn = -1; return settle(); },   // 调试：直接进结算
};
