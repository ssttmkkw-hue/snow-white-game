// AI 出牌/弃牌统计：node dev/cards.js [局数]
import { playOut } from './sim.js';
const N = +process.argv[2] || 800;
const play = {}, disc = {};
let rosePicked = 0, roseKnown = 0;
for (let i = 0; i < N; i++) {
  const st = playOut(9100 + i * 7);
  for (const e of st.events) {
    if (e.k === 'play') play[e.card] = (play[e.card] || 0) + 1;
    if (e.k === 'discard') disc[e.card] = (disc[e.card] || 0) + 1;
  }
  const rose = st.players.findIndex(p => p.role === 'rose');
  const combs = st.events.filter(e => e.k === 'play' && e.card === 'comb');
  if (combs.some(e => e.target === rose)) rosePicked++;
}
const cards = [...new Set([...Object.keys(play), ...Object.keys(disc)])];
let tp = 0, td = 0;
const rows = cards.map(c => { const p = play[c] || 0, d = disc[c] || 0; tp += p; td += d; return [c, p, d, d / Math.max(1, p + d)]; }).sort((a, b) => b[3] - a[3]);
console.log(`总计：打出 ${tp}，弃掉 ${td}，弃牌率 ${(100 * td / (tp + td)).toFixed(1)}%`);
for (const [c, p, d, r] of rows) console.log(`  ${c.padEnd(11)} 打出 ${String(p).padStart(5)}  弃 ${String(d).padStart(5)}  弃牌率 ${(100 * r).toFixed(0)}%`);
console.log(`毒梳子打向罗泽的局：${(100 * rosePicked / N).toFixed(1)}%`);
