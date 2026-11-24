// 林中晚宴 · 联机服务器：托管静态页面 + WebSocket 房间
// 运行：npm install && npm start      （端口取环境变量 PORT，默认 5226）
// 单机版仍然可以用任何静态服务器打开；联机需要这个服务器。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { Room, send } from './server/room.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 5226);

// ---------- 静态文件（只放行游戏用到的目录） ----------
const PUBLIC = ['index.html', 'js/', 'css/', 'art/', 'assets/', 'audio/'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon',
};
const room = new Room('main');
// 版本号：Render 部署时取它提供的提交号；本机取 git。开始页底部会显示，方便确认手机上是不是最新版
const VERSION = (() => {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'dev'; }
})();
const STARTED = new Date();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return res.end('ok');
  if (url.pathname === '/api/version') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ version: VERSION, started: STARTED.toISOString() }));
  }
  if (url.pathname === '/api/room') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const info = room.lobbyInfo();
    return res.end(JSON.stringify({ state: info.state, players: info.members.length }));
  }
  let p;
  try { p = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { res.writeHead(400); return res.end(); }
  if (!p) p = 'index.html';
  p = path.posix.normalize(p);
  if (p.startsWith('..') || !PUBLIC.some(x => (x.endsWith('/') ? p.startsWith(x) : p === x))) { res.writeHead(404); return res.end('not found'); }
  const file = path.join(ROOT, p);
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // 代码和台词表每次都问一下有没有更新；图片和语音可以缓存
    const cache = /\.(webp|png|jpg|mp3|opus|ogg)$/i.test(file) ? 'public, max-age=86400' : 'no-cache';
    const head = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', 'Last-Modified': stat.mtime.toUTCString() };
    // iPhone 的 Safari 播放音频要求支持 Range 分段请求
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
      let end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
wss.on('connection', ws => {
  let mem = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') return send(ws, { t: 'pong' });
    if (m.t === 'hello') { if (!mem) mem = room.hello(ws, m); return; }
    if (!mem) return;
    switch (m.t) {
      case 'start': return room.start(mem);
      case 'act': return room.onAction(mem, m);
      case 'ack': return room.onAck(mem, m.v);
      case 'queen': return room.onQueen(mem, m.target);
      case 'leave': { const x = mem; mem = null; room.leave(x); return; }
    }
  });
  ws.on('close', () => { if (mem && mem.ws === ws) room.bye(mem); });
});
// 心跳：清掉死连接（手机锁屏、断网）
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch {}
  }
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`林中晚宴联机服务器已启动：http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  局域网: http://${a.address}:${PORT}`);
});
