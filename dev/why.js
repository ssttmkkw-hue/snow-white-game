// 白雪死因拆解：node dev/why.js [局数]
import { playOut } from './sim.js';
const N = +process.argv[2] || 800;
const c = { alive: 0, comb: 0, ring: 0, given: 0, poison: 0, roseWin: 0, queenHadPoison: 0, queenGuessRight: 0, ringSources: {}, combBy: {} };
for (let i = 0; i < N; i++) {
  const st = playOut(7000 + i * 13);
  const sw = st.players.findIndex(p => p.role === 'snow');
  const r = st.result;
  if (r.winner === 'rose') c.roseWin++;
  if (st.settleSteps[0]?.poison) c.queenHadPoison++;
  if (st.forcedEat === sw) c.queenGuessRight++;
  if (!r.dead[sw]) c.alive++;
  else if (st.players[sw].killedBy === 'comb') { c.comb++; }
  else if (r.ringDeath[sw] || st.players[sw].killedBy === 'ring') {
    c.ring++;
    const last = [...st.events].reverse().find(e => e.k === 'swapHand' && (e.a === sw || e.b === sw));
    const from = last ? st.players[last.a === sw ? last.b : last.a].role : 'drew';
    c.ringSources[from] = (c.ringSources[from] || 0) + 1;
  } else if (st.forcedEat === sw) c.given++;
  else c.poison++;
}
const pc = x => (100 * x / N).toFixed(1) + '%';
console.log(`白雪存活 ${pc(c.alive)} | 死因：毒梳子 ${pc(c.comb)} 戒指 ${pc(c.ring)} 女王指定 ${pc(c.given)} 自己毒苹果 ${pc(c.poison)} | 罗泽独胜 ${pc(c.roseWin)}`);
console.log(`女王结尾持毒 ${pc(c.queenHadPoison)} | 女王猜中白雪 ${pc(c.queenGuessRight)} | 戒指最后来源`, c.ringSources);
