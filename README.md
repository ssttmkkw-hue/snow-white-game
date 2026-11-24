# 林中晚宴 · 毒苹果

手机竖屏优先的 8 人身份推理桌游网页版：你 + 7 名 AI 玩家，4 颗毒苹果，28 张故事牌。
开局有“天黑请闭眼”的裁判环节，AI 玩家和裁判都有配音。

## 运行

纯静态页面，任意静态服务器都可以：

```bash
python -m http.server 5226
# 打开 http://localhost:5226
```

## 目录

- `js/engine.js` 规则引擎（纯逻辑，可在 node 里跑）
- `js/ai.js` AI 玩家（推理、出牌、发言）
- `js/main.js` 长桌界面与演出节奏
- `js/narrator.js` 裁判与玩家语音播放（优先 Opus，退回 MP3）
- `audio/narration/`、`audio/players/<id>/` 配音与台词表 `lines.json`
- `art/`、`css/` 美术与样式
- `dev/sim.js` 无头对局测平衡：`node dev/sim.js 2000`
- `dev/tts_cosy.py` 用 CosyVoice 合成台词（API Key 只从环境变量 `DASHSCOPE_API_KEY` 读取，不入库）
- `dev/listen.html` 台词试听页
