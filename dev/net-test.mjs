// 无头联机测试：node dev/net-test.mjs
// 起一个服务器（超时调得很短），3 名真人进房间、房主开始，中途再来 1 人观战；
// 1 号真人自己出手（看苹果 / 进行故事），其余真人不动、由 AI 代打。
// 检查：能打完一局、每条消息里都不泄露别人的身份 / 没看过的苹果 / 别人的手牌 / 牌堆 / 种子。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5300 + Math.floor(Math.random() * 400);
const srv = spawn(process.execPath, ['server.js', String(PORT)], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, TURN_MS: '150', GAP_MS: '0', ACK_MS: '2000', NIGHT_MS: '2000', QUEEN_MS: '300' },
});
await new Promise(r => srv.stdout.once('data', r));

const fails = [];
const check = (ok, msg) => { if (!ok && fails.length < 20) fails.push(msg); };
function audit(who, seat, v, allRoles = false) {
  if (!v) return;
  check(!('seed' in v), `${who}: 状态里带了随机种子`);
  check(v.deck.every(c => c === null), `${who}: 牌堆内容泄露`);
  for (const p of v.players) {
    if (p.seat !== seat) {
      check(p.hand.every(c => c === null || (c === 'ring' && (p.killedBy === 'ring' || v.result?.ringDeath?.[p.seat])) || (c === 'prince' && v.result?.revived && p.role === 'snow')), `${who}: 看到了 ${p.name} 的手牌`);
      if (p.role && !allRoles) check(p.roleUp || v.roleKnow[seat]?.[p.seat] || v.phase === 'over', `${who}: 看到了 ${p.name} 的身份`);
    }
  }
  for (const a of v.apples) if (a.type) check(a.up || v.know[seat]?.[a.id], `${who}: 看到了没看过的苹果`);
  for (const e of v.log) check(e.vis === 'all' || e.vis === seat, `${who}: 看到了别人的私人记录`);
  v.know.forEach((k, i) => { if (i !== seat) check(!Object.keys(k).length, `${who}: 拿到了别人的情报表`); });
  if (v.intel.green.snow !== undefined) check(v.intel.green.seat === seat, `${who}: 拿到了格林的情报`);
  if (v.intel.black.poison) check(v.intel.black.seat === seat, `${who}: 拿到了布莱克的情报`);
}

function client(name, { play = false, late = false } = {}) {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const c = { name, ws, seat: null, msgs: 0, settled: null, lobby: null, sync: null, acted: 0 };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name })));
    ws.on('message', raw => {
      const m = JSON.parse(raw); c.msgs++;
      if (m.t === 'welcome') { c.id = m.id; resolve(c); }
      if (m.t === 'lobby') c.lobby = m;
      if (m.t === 'start' || m.t === 'sync') { c.seat = m.seat; c.v = m.view; if (m.t === 'sync') c.sync = m; audit(name, m.seat, m.view); }
      if (m.t === 'up') { c.v = m.view; audit(name, c.seat, m.view); }
      if (m.t === 'settled') { c.settled = m; for (const k of ['queen', 'roles', 'final']) audit(name + '/' + k, c.seat, m[k], k === 'roles'); }   // roles = 结算时所有人翻开角色卡
      if (['start', 'sync', 'up'].includes(m.t)) {
        ws.send(JSON.stringify({ t: 'ack', v: m.v }));
        const v = c.v;
        if (play && c.seat >= 0 && v.phase === 'play' && v.turn === c.seat) {
          let a = null;
          if (!v.pending) a = c.acted++ % 2 ? { type: 'peekOwn' } : { type: 'story' };
          else if (v.pending.mode === 'choose') {
            const i = v.players[c.seat].hand.findIndex(x => x !== 'ring');
            if (i >= 0) a = { type: 'discard', idx: i };
          }
          if (a) ws.send(JSON.stringify({ t: 'act', a }));
        }
      }
    });
  });
}

const host = await client('房主', { play: true });
const b = await client('小二');
const c3 = await client('小三');
await new Promise(r => setTimeout(r, 100));
check(host.lobby?.hostId === host.id, '第一个进来的人不是房主');
b.ws.send(JSON.stringify({ t: 'start' }));          // 非房主点开始 → 应被拒绝
await new Promise(r => setTimeout(r, 100));
check(host.seat === null, '非房主也能开始');
host.ws.send(JSON.stringify({ t: 'start' }));
await new Promise(r => setTimeout(r, 600));
check([host, b, c3].every(x => Number.isInteger(x.seat) && x.seat >= 0), '真人没有拿到座位');
const watcher = await client('观众', { late: true });
await new Promise(r => setTimeout(r, 300));
check(watcher.sync?.seat === -1, '中途进来的人不是观战');

const t0 = Date.now();
while (!host.settled && Date.now() - t0 < 120000) await new Promise(r => setTimeout(r, 200));
check(!!host.settled, '一局没打完（超时）');
const fin = host.settled?.final;
if (fin) {
  console.log(`打完一局：${fin.turnCount} 手，胜方 ${fin.result.winner}，房主手动出手 ${host.acted} 次，观战收到 ${watcher.msgs} 条消息`);
  check(fin.players.filter(p => p.human).length === 3, '真人数量不对');
  check(fin.players.every(p => p.role), '结算时没有翻开所有身份');
}
await new Promise(r => setTimeout(r, 300));
check(host.lobby?.state === 'lobby', '打完没有回到大厅');

for (const x of [host, b, c3, watcher]) x.ws.close();
srv.kill();
if (fails.length) { console.log('❌ 失败：\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('✅ 联机测试通过：房主开始 / 非房主不能开始 / 中途观战 / 代打 / 打完回大厅 / 无信息泄露');
