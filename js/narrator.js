// 裁判旁白：播放 audio/narration/<key>.wav；文件不存在就用浏览器朗读兜底；静音时按字数估算停顿。
// 换正式配音：用同名文件覆盖 audio/narration/<key>.wav 即可（换格式就改 EXT）。
const DIR = 'audio/narration/';
// 优先用体积小 6 倍的 Opus（Ogg 封装），设备不支持时退回 MP3。每句用到时才下载。
// 有些设备嘴上说支持 Opus、实际放不出来（老 iPhone / 微信）：第一次放失败就整局改用 MP3。
let EXT = (() => {
  try { const a = document.createElement('audio'); return a.canPlayType('audio/ogg; codecs="opus"') ? 'opus' : 'mp3'; } catch { return 'mp3'; }
})();
export const audioExt = () => EXT;

// ---------- 手机的自动播放限制 ----------
// iPhone / 微信内置浏览器：声音只能在“用户点了一下”时开始放；每 new 一个 Audio 都要重新被点一次，
// 所以以前只有点按钮后的头两句能出声。做法：全程只用一个共享的播放器，用户每次点屏幕时（空闲的话）
// 用一段极短的静音“解锁”它；解锁过的播放器之后由程序换片源播放也会被放行。
const SILENT = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAykAWlpaWlpaWlpaWlpaWlpaWnt7e3t7e3t7e3t7e3t7e3t7nJycnJycnJycnJycnJycnL29vb29vb29vb29vb29vb293t7e3t7e3t7e3t7e3t7e3t7/////////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQCowAAAAAAAAMpso+sIAAAAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
let el = null, unlocked = false;
function player() {
  if (!el) { el = new Audio(); el.preload = 'auto'; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); }
  return el;
}
export function unlockAudio() {
  const a = player();
  if (cur && cur.audio === a && !cur.blocked) return;   // 正在念（或正在加载）台词，别打断
  try {
    a.src = SILENT;
    const p = a.play();
    if (p && p.then) p.then(() => { unlocked = true; if (!cur || cur.audio !== a) a.pause(); }).catch(() => {});
  } catch {}
}
export const audioUnlocked = () => unlocked;
if (typeof document !== 'undefined') {
  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  // 微信内置浏览器：拿到 WeixinJSBridge 后可以直接放行一次
  const wx = () => { try { window.WeixinJSBridge.invoke('getNetworkType', {}, unlockAudio); } catch {} };
  if (window.WeixinJSBridge) wx(); else document.addEventListener('WeixinJSBridgeReady', wx, false);
}

// 台词默认值（与 audio/narration/lines.json 一致；页面会优先读 json）
let LINES = {
  intro: '欢迎来到林中晚宴。',
  night: '夜深了……天黑，请所有人闭眼。',
  green_open: '格林，请睁眼。看清楚，谁是白雪公主。',
  green_close: '格林，请闭眼。',
  black_open: '布莱克，请睁眼。看看，毒苹果在谁的手上。',
  black_close: '布莱克，请闭眼。',
  dawn: '天亮了。所有人，请睁眼。晚宴……开始。',
  ring_curse: '诅咒戒指……发作了。',
};
let loaded = false;
let muted = false;
try { muted = localStorage.getItem('pa-voice-muted') === '1'; } catch {}
let cur = null; // { audio, resolve, timer }

export async function loadLines() {
  if (loaded) return LINES;
  loaded = true;
  try {
    const j = await fetch(DIR + 'lines.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
    if (j) for (const [k, v] of Object.entries(j)) if (!k.startsWith('_')) LINES[k] = v;
  } catch {}
  return LINES;
}
export const lineText = key => LINES[key] || '';
export const isMuted = () => muted;
export function setMuted(m) { muted = !!m; try { localStorage.setItem('pa-voice-muted', muted ? '1' : '0'); } catch {} if (muted) stop(); }

export function stop() {
  if (!cur) return;
  try { cur.audio?.pause(); } catch {}
  if (cur.audio) { cur.audio.onended = cur.audio.onerror = null; }
  try { window.speechSynthesis?.cancel(); } catch {}
  clearTimeout(cur.timer);
  const r = cur.resolve; cur = null; r();
}

const estimate = text => 600 + text.length * 230;

// 播放一句裁判旁白，返回在念完时 resolve 的 Promise
export function say(key) { return playClip(DIR + key + '.' + EXT, lineText(key), true); }

// 通用：播放一个音频文件；静音或文件缺失时按字数等一会儿（保证字幕有时间看），裁判可用浏览器朗读兜底
export function playClip(url, text = '', tts = false) {
  stop();
  return new Promise(resolve => {
    const me = { resolve, audio: null, timer: 0 };
    cur = me;
    const done = () => { if (cur !== me) return; clearTimeout(me.timer); cur = null; resolve(); };
    const wait = () => { if (cur !== me) return; clearTimeout(me.timer); me.timer = setTimeout(done, estimate(text)); };
    me.timer = setTimeout(done, estimate(text) + 8000); // 兜底：最长不卡住
    if (muted || !url) { wait(); return; }
    const a = player();
    me.audio = a;
    const give = () => (tts ? speakFallback(text, done, me) : wait());
    // Opus 放不出来 → 这一句和以后都改用 MP3
    const fail = () => {
      if (cur !== me) return;
      if (/\.opus$/.test(url)) { EXT = 'mp3'; url = url.replace(/\.opus$/, '.mp3'); return start(); }
      give();
    };
    const start = () => {
      a.onended = () => done();
      a.onerror = () => fail();
      try { a.src = url; a.currentTime = 0; } catch {}
      let p;
      try { p = a.play(); } catch { return fail(); }
      if (p && p.catch) p.catch(err => {
        if (cur !== me) return;
        if (err && err.name === 'NotAllowedError') { me.blocked = true; a.onended = a.onerror = null; give(); }   // 被拦了：按字数等，等下次点击再解锁
        else fail();
      });
    };
    start();
  });
}

// ---------- AI 玩家语音：audio/players/<id>/<key>.(opus|mp3)，台词在同目录 lines.json ----------
const PDIR = 'audio/players/';
const PLINES = {};   // id -> { key: text }
export async function loadPlayerLines(ids) {
  await Promise.all(ids.filter(id => id && !PLINES[id]).map(async id => {
    try { const j = await fetch(PDIR + id + '/lines.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)); if (j) PLINES[id] = j; } catch {}
  }));
}
// 找某人某时机的一句：base 或 base_1/base_2…（随机挑一个变体）
export function playerLine(id, base) {
  const L = PLINES[id]; if (!L) return null;
  const keys = Object.keys(L).filter(k => k === base || new RegExp('^' + base + '_\\d+$').test(k));
  if (!keys.length) return null;
  const key = keys[Math.floor(Math.random() * keys.length)];
  return { key, text: L[key] };
}
export const playerUrl = (id, key) => PDIR + id + '/' + key + '.' + EXT;   // 按当前格式（Opus 失败后会变成 MP3）
// 播放某人某时机的一句；返回 {text}（没有这句就返回 null，不等待）
export async function playPlayer(id, base) {
  const ln = playerLine(id, base);
  if (!ln) return null;
  await playClip(PDIR + id + '/' + ln.key + '.' + EXT, ln.text);
  return ln;
}

function speakFallback(text, done, me) {
  if (cur !== me) return;
  const ss = window.speechSynthesis;
  if (!ss || !text) { clearTimeout(me.timer); me.timer = setTimeout(done, estimate(text)); return; }
  try {
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 0.9;
    u.onend = done; u.onerror = () => { clearTimeout(me.timer); me.timer = setTimeout(done, estimate(text)); };
    ss.speak(u);
  } catch { clearTimeout(me.timer); me.timer = setTimeout(done, estimate(text)); }
}
