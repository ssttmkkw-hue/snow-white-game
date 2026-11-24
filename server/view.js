// 联机：把服务器上的完整对局状态，裁成“某个座位看得到的样子”再发给他。
// 形状与 engine.js 的状态完全一致（界面代码可以直接用），只是把看不到的东西抹掉：
//   别人的角色（没翻开、自己也不知道的）→ null；没公开也没看过的苹果种类 → null；
//   别人的手牌 → 同样张数的 null；牌堆 → 只剩张数；私人日志 / 别人的情报 → 去掉；随机种子 → 去掉。
// seat = -1 表示观战：只看公开信息。

export function redact(st, seat, handIdOf, { allRoles = false } = {}) {
  const me = Number.isInteger(seat) && seat >= 0 ? seat : null;
  const kn = me !== null ? st.know[me] : {};
  const row = (tbl, clone) => st.players.map((_, i) => (i === me ? clone(tbl[i]) : {}));
  const players = st.players.map(p => {
    const roleSeen = allRoles || p.roleUp || p.seat === me || (me !== null && !!st.roleKnow[me][p.seat]);
    let hand;
    if (p.seat === me) hand = p.hand.slice();
    else if (p.killedBy === 'ring') hand = p.hand.map(c => (c === 'ring' ? 'ring' : null));   // 被诅咒而死：戒指已经亮在桌上
    else hand = p.hand.map(() => null);
    return {
      seat: p.seat, name: p.name, human: p.human, avatar: p.avatar, gender: p.gender, voice: p.voice,
      role: roleSeen ? p.role : null, roleUp: p.roleUp, used: p.used,
      apple: p.apple, hand, hid: handIdOf(p.hand),
      warded: p.warded, roped: p.roped, killed: p.killed, killedBy: p.killedBy,
      prefs: p.prefs.map(x => ({ ...x })),
    };
  });
  const intel = { green: {}, black: {} };
  if (me !== null && st.intel.green.seat === me) intel.green = { ...st.intel.green };
  if (me !== null && st.intel.black.seat === me) intel.black = { ...st.intel.black, poison: st.intel.black.poison.slice() };
  return {
    n: st.n, poison: st.poison, deckCounts: { ...st.deckCounts },
    apples: st.apples.map(a => ({ id: a.id, up: a.up, type: a.up || kn[a.id] ? a.type : null })),
    players,
    deck: st.deck.map(() => null), discard: st.discard.slice(),
    turn: st.turn, start: st.start, round: st.round, turnCount: st.turnCount,
    finalTurnsLeft: st.finalTurnsLeft,
    pending: st.pending ? { ...st.pending } : null,
    know: row(st.know, o => ({ ...o })),
    roleKnow: row(st.roleKnow, o => ({ ...o })),
    handKnow: row(st.handKnow, o => JSON.parse(JSON.stringify(o))),
    claims: st.claims.map(c => ({ ...c })), saidThisTurn: st.saidThisTurn,
    phase: st.phase,
    log: st.log.filter(e => e.vis === 'all' || e.vis === me).map(e => ({ ...e })),
    events: st.events.map(e => JSON.parse(JSON.stringify(e))),
    result: st.result ? JSON.parse(JSON.stringify(st.result)) : null,
    settleSteps: st.settleSteps.map(s => ({ ...s })),
    intel,
    baton: st.baton ? { ...st.baton } : null,
    wrongGuess: st.wrongGuess ? st.wrongGuess.map(w => ({ ...w })) : undefined,
    planKnow: st.planKnow && st.planKnow.seat === me ? JSON.parse(JSON.stringify(st.planKnow)) : undefined,
    forcedEat: st.forcedEat,
  };
}
