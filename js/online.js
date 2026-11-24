// 联机客户端：连接 / 断线重连 / 大厅 / 消息排队。
// 对局里的每条消息（开局、每一步、重连同步）按顺序交给界面演出，演完再处理下一条，并回执给服务器（服务器等大家看完才走下一步）。
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let ws = null, H = null, wanted = false, retry = 0, retryT = 0;
let me = { id: null, token: null, name: '' };
let lobby = null;
let queue = Promise.resolve();
let settledP = null, settledR = null, askP = null, askR = null;
try { me.token = sessionStorage.getItem('pa-online-token'); } catch {}

export const isOnline = () => wanted;
export const myId = () => me.id;
export const lobbyState = () => lobby;

// handlers: { onGame(msg) → Promise（演完 resolve），onLobby(info)，onError(msg)，onStatus(text) }
export function join(name, handlers) {
  H = handlers; wanted = true; me.name = name;
  queue = Promise.resolve();   // 上一次进房间残留的演出不再等
  resetSettle();
  open();
}
export function leave() {
  wanted = false; clearTimeout(retryT);
  if (ws) { try { send({ t: 'leave' }); ws.close(); } catch {} }
  ws = null; lobby = null;
  try { sessionStorage.removeItem('pa-online-token'); } catch {}
  me.token = null;
}
export function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
export const act = a => send({ t: 'act', a });
export const startGame = () => send({ t: 'start' });
export const queenPick = target => send({ t: 'queen', target });

// 结算：服务器发来的三份视图（女王现身后 / 全员翻开 / 最终）；真人女王会先收到“请指定”
function resetSettle() {
  settledP = new Promise(r => { settledR = r; });
  askP = new Promise(r => { askR = r; });
}
export const waitSettled = () => settledP;
export const waitQueenAsk = () => askP;

function open() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  let opened = false;
  try { ws = new WebSocket(url); } catch { return fail(); }
  const sock = ws;
  sock.onopen = () => { opened = true; retry = 0; H.onStatus?.(''); sock.send(JSON.stringify({ t: 'hello', name: me.name, token: me.token })); };
  sock.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  sock.onclose = () => {
    if (sock !== ws) return;
    ws = null;
    if (!wanted) return;
    if (!opened && !me.id) return fail();
    H.onStatus?.('连接断开，正在重连……');
    clearTimeout(retryT);
    retryT = setTimeout(open, Math.min(8000, 800 * 2 ** retry++));
  };
}
function fail() {
  wanted = false; ws = null;
  H.onError?.('连不上联机服务器。单机版可以用任意静态服务器打开，联机需要用 npm start 启动的服务器（或部署到 Render）。', true);
}

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      me.id = m.id; me.token = m.token; me.name = m.name;
      try { sessionStorage.setItem('pa-online-token', m.token); } catch {}
      return;
    case 'lobby': lobby = m; return H.onLobby?.(m);
    case 'error': return H.onError?.(m.msg);
    case 'queenAsk': return askR?.(true);
    case 'settled': return settledR?.(m);
    case 'start': resetSettle(); break;
    case 'up': case 'sync': break;
    default: return;
  }
  // 对局消息：排队演出，演完回执
  queue = queue.then(() => H.onGame(m)).catch(err => console.error('联机演出出错', err)).then(() => { if (m.v) send({ t: 'ack', v: m.v }); });
}

// ---------- 大厅界面 ----------
export function renderLobby(info = lobby) {
  if (!info) { $('#lobby-list').innerHTML = '<p class="hint">正在进入房间……</p>'; $('#btn-lobby-start').classList.add('hidden'); return; }
  const host = info.members.find(x => x.id === info.hostId);
  const imHost = info.hostId === me.id;
  const players = info.members.filter(x => x.role === 'player');
  $('#lobby-list').innerHTML = info.members.map(x => `<div class="result-row lobby-row ${x.id === info.hostId ? 'w' : ''} ${x.connected ? '' : 'd'}">
      <img class="illustration result-portrait" src="art/guest.webp" alt="" draggable="false">
      <span class="grow">${esc(x.name)}${x.id === me.id ? '（你）' : ''}</span>
      <span>${[x.id === info.hostId ? '👑 房主' : '', x.role === 'watch' ? '👀 观战' : '', x.connected ? '' : '📴 离线'].filter(Boolean).join(' ')}</span>
    </div>`).join('');
  let hint;
  if (info.state === 'playing') hint = '游戏进行中……这一局结束后，房主可以再开一局。';
  else if (imHost) hint = `人到齐了就点开始：现在 ${players.length} 名真人，空位由 AI 补满 8 人。之后进来的人会观战。`;
  else hint = `等待房主 <b>${esc(host?.name || '……')}</b> 开始。${info.members.find(x => x.id === me.id)?.role === 'watch' ? '本局真人已满 8 人，你会观战。' : ''}`;
  $('#lobby-hint').innerHTML = hint;
  const btn = $('#btn-lobby-start');
  btn.classList.toggle('hidden', !imHost);
  btn.disabled = info.state !== 'lobby';
}
