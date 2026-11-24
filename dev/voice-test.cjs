// 手机语音测试：node dev/voice-test.cjs        （需要 Playwright + Chromium）
// 模拟 iPhone / 微信内置浏览器（WebKit）的自动播放规则：一个播放器必须先在用户点击里成功播放过一次，
// 之后才能由程序自己播放。只点「单人开始」「我看好了」两下，之后不再点，看 AI 的台词能不能一直出声。
// 加 --opus-fail 模拟“说支持 Opus 但放不出来”的设备，检查会自动改用 MP3。
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PORT = 5600 + Math.floor(Math.random() * 300);
const opusFail = process.argv.includes('--opus-fail');

(async () => {
  const srv = spawn(process.execPath, ['server.js', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.once('data', r));
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  await pg.addInitScript(() => {
    window.__au = { ok: [], blocked: [] };
    const orig = HTMLMediaElement.prototype.play, unlocked = new WeakSet();
    let lastTap = 0;
    for (const ev of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) addEventListener(ev, e => { if (e.isTrusted) lastTap = performance.now(); }, true);
    HTMLMediaElement.prototype.play = function () {
      const name = (this.src || '').startsWith('data:') ? null : (this.src || '').split('/').slice(-2).join('/');
      if (!unlocked.has(this)) {
        if (performance.now() - lastTap > 1000) { if (name) __au.blocked.push(name); return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }
        unlocked.add(this);
      }
      const p = orig.call(this);
      p.then(() => { if (name) __au.ok.push(name); }).catch(() => {});
      return p;
    };
    try { localStorage.setItem('pa-voice-muted', '0'); } catch {}
  });
  if (opusFail) await pg.route('**/*.opus', r => r.abort());
  await pg.goto(`http://localhost:${PORT}/`);
  await pg.click('#btn-start');
  await pg.waitForTimeout(2500);
  await pg.click('#ov-go');
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await pg.evaluate(() => { if (__pa.st && __pa.st.turn === 0 && !__pa.ui().busy) __pa.autoMe(); });   // 轮到我时让 AI 代走（不算点击）
    await pg.waitForTimeout(500);
  }
  const r = await pg.evaluate(() => __au);
  await b.close(); srv.kill();
  const ai = r.ok.filter(x => !x.startsWith('narration/'));
  console.log(`出声 ${r.ok.length} 句（其中 AI 台词 ${ai.length} 句），被拦 ${r.blocked.length} 句`);
  console.log('  最近出声：', r.ok.slice(-6).join('  '));
  if (r.blocked.length) console.log('  被拦：', r.blocked.slice(0, 6).join('  '));
  const ok = !r.blocked.length && ai.length > 0 && (!opusFail || r.ok.slice(1).every(x => x.endsWith('.mp3')));
  console.log(ok ? '✅ 语音在手机限制下也能持续播放' : '❌ 有台词被拦或没出声');
  process.exit(ok ? 0 : 1);
})();
