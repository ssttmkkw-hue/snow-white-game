// 最后一轮 AI 在做什么：node dev/final.js [局数]
// 统计最后一轮（牌堆抽空之后）每次行动的类型；“废动作”= 看自己苹果、打出/弃掉没用的牌（我开动了、今天做什么）、换手牌但手里没有戒指/好危险/王子
import { playOut } from './sim.js';
import { isFinal } from '../js/engine.js';
const N = +process.argv[2] || 600;
const cnt = {}; let total = 0;
for (let i = 0; i < N; i++) {
  const st = playOut(4200 + i * 17);
  const fe = st.events.findIndex(e => e.t >= 0 && e.final);
  // 用日志里“最后一张故事牌被抽走”之后的事件
  const li = st.log.findIndex(e => e.text.includes('最后一张故事牌被抽走'));
  if (li < 0) continue;
  const t0 = st.log[li].turn;
  for (const e of st.events) {
    if (e.t <= t0) continue;
    let k = e.k;
    if (k === 'play') k = 'play:' + e.card;
    else if (k === 'discard') k = 'discard:' + e.card;
    else if (!['peekOwn', 'swapApple', 'swapHand', 'ward', 'say'].includes(k)) continue;
    if (k === 'say') continue;
    cnt[k] = (cnt[k] || 0) + 1; total++;
  }
}
const rows = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
console.log(`最后一轮共 ${total} 次行动（${N} 局，平均每局 ${(total / N).toFixed(1)}）`);
for (const [k, v] of rows) console.log(`  ${k.padEnd(18)} ${String(v).padStart(5)}  ${(100 * v / total).toFixed(1)}%`);
