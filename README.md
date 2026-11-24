# 林中晚宴 · 毒苹果

手机竖屏优先的 8 人身份推理桌游网页版：你 + 7 名 AI 玩家，4 颗毒苹果，30 张故事牌。
开局有“天黑请闭眼”的裁判环节，AI 玩家和裁判都有配音。

## 运行

**单机**（你 + 7 名 AI）：纯静态页面，任意静态服务器都可以：

```bash
python -m http.server 5226
# 打开 http://localhost:5226 → 单人开始
```

**联机**（一个房间，最多 8 名真人，空位 AI 补满）：需要 Node 18+：

```bash
npm install
npm start            # 打开 http://localhost:5226 → 多人联机
node dev/net-test.mjs  # 无头联机测试（会自己起一个服务器）
```

- 第一个进房间的人是房主，点「开始游戏」；空位由 AI（带配音）补满 8 人，真人没有配音、用自己填的名字。
- 对局开始后再进来的人观战（看不到任何私密信息）。手机锁屏 / 断网后重新打开「多人联机」会接回原座位。
- 真人 90 秒不操作、或掉线 8 秒以上，这一步由 AI 代打。

**部署到 Render**（免费档）：仓库带 `render.yaml`，在 Render 选 New → Blueprint 选本仓库即可，
或打开 <https://render.com/deploy?repo=https://github.com/ssttmkkw-hue/snow-white-game>。
免费档 15 分钟没人访问会休眠，再打开约 1 分钟唤醒。

## 目录

- `server.js` 联机服务器（静态页面 + WebSocket）；`server/room.js` 房间与对局流程（服务器跑规则引擎和 AI）；`server/view.js` 按座位裁掉看不到的信息
- `js/online.js` 联机客户端（连接、重连、大厅、消息排队）

- `js/engine.js` 规则引擎（纯逻辑，可在 node 里跑）
- `js/ai.js` AI 玩家（推理、出牌、发言）
- `js/main.js` 长桌界面与演出节奏
- `js/narrator.js` 裁判与玩家语音播放（优先 Opus，退回 MP3）
- `audio/narration/`、`audio/players/<id>/` 配音与台词表 `lines.json`
- `art/`、`css/` 美术与样式
- `dev/sim.js` 无头对局测平衡：`node dev/sim.js 2000`
- `dev/tts_cosy.py` 用 CosyVoice 合成台词（API Key 只从环境变量 `DASHSCOPE_API_KEY` 读取，不入库）
- `dev/listen.html` 台词试听页
