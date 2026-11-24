// 无头对局：node dev/sim.js [局数]     NOTALK=1 关闭嘴炮对比
import { newGame, act, settleQueen, settleFinish, queenCanGive, remarkAfterPeek } from '../js/engine.js';
import { aiStep, aiQueenTarget, setTalk, aiAfterPeek } from '../js/ai.js';

let TALK_ON = true;
export function playOut(seed) {
  const VO = ['', 'shitou', 'yeying', 'liuliu', 'nuonuo', 'xiaolu', 'diandian', 'tantan'];
  const st = newGame({ players: Array.from({ length: 8 }, (_, i) => ({ name: 'P' + i, voice: VO[i] })), seed });
  let guard = 0;
  while (st.phase === 'play') {
    if (++guard > 4000) throw new Error('死循环 seed=' + seed);
    const v = st.pending?.mode === 'answer' ? st.pending.seat : st.turn;
    const a = aiStep(st, v);
    act(st, v, a);
    if (a.type === 'peekOwn' && TALK_ON) { const val = aiAfterPeek(st, v); if (val) remarkAfterPeek(st, v, val); }
  }
  settleQueen(st, queenCanGive(st) ? aiQueenTarget(st) : null);
  settleFinish(st);
  return st;
}

if (process.argv[1]?.endsWith('sim.js')) {
  const games = +process.argv[2] || 2000;
  if (process.env.NOTALK) { setTalk(false); TALK_ON = false; }
  const c = { snow: 0, queen: 0, rose: 0, errs: 0, turns: 0, combKill: 0, ring: 0, prince: 0, give: 0, talk: 0, dodge: 0, reveal: 0 };
  for (let i = 0; i < games; i++) {
    try {
      const st = playOut(1000 + i * 31);
      c[st.result.winner]++;
      c.turns += st.turnCount;
      if (st.players.some(p => p.killed)) c.combKill++;
      if (st.result.ringDeath.some(Boolean)) c.ring++;
      if (st.result.revived) c.prince++;
      if (st.settleSteps.some(s => s.k === 'queenGive')) c.give++;
      if (st.events.some(e => e.k === 'dodge')) c.dodge++;
      if (st.events.some(e => e.k === 'reveal')) c.reveal++;
      c.talk += st.claims.length; for (const cl of st.claims) { c.byType = c.byType || {}; c.byType[cl.type] = (c.byType[cl.type] || 0) + 1; c.byVoice = c.byVoice || {}; const vo = st.players[cl.seat].voice || 'P0'; c.byVoice[vo] = (c.byVoice[vo] || 0) + 1; }
    } catch (e) { c.errs++; if (c.errs <= 3) console.error(e.stack); }
  }
  const pc = x => (100 * x / games).toFixed(1) + '%';
  console.log(`8人4毒28牌  白雪阵营 ${pc(c.snow)}  女王阵营 ${pc(c.queen)}  罗泽独胜 ${pc(c.rose)}`);
  console.log(`平均回合 ${(c.turns / games).toFixed(1)} | 毒梳子杀人 ${pc(c.combKill)} | 戒指致死 ${pc(c.ring)} | 王子复活 ${pc(c.prince)} | 女王送毒 ${pc(c.give)} | 挡武器 ${pc(c.dodge)} | 真面目猜中 ${pc(c.reveal)} | 发言 ${(c.talk / games).toFixed(1)} | 错误 ${c.errs}`);
  const per = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, +(v / games).toFixed(2)]));
  console.log('每局发言·按类型', per(c.byType));
  console.log('每局发言·按人', per(c.byVoice));
}
