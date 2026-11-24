# -*- coding: utf-8 -*-
"""CosyVoice（阿里云百炼·华北2北京）合成：只用标准库，走 HTTP 非流式接口。

用法：
  python dev/tts_cosy.py narration            # 合成裁判全部台词 -> audio/narration/<key>.mp3
  python dev/tts_cosy.py xiaolu --fmt=opus    # 合成某个玩家 -> audio/players/xiaolu/<key>.opus
  python dev/tts_cosy.py narration intro dawn # 只合成指定几句（试听用）
  python dev/tts_cosy.py narration --dry      # 只估算费用，不调用接口

Key 只从环境变量 DASHSCOPE_API_KEY 读取；不要写进任何文件。
音色映射见《林中晚宴_角色音色_开发说明.md》，模型必须是 cosyvoice-v3.5-flash。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = "cosyvoice-v3.5-flash"
ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
VOICES = {
    "shitou":   "cosyvoice-v3.5-flash-vd-shitou-4849053f2e844507bd57bfd7cad7ed3d",
    "yeying":   "cosyvoice-v3.5-flash-vd-yeying-69b8d02168e04c648b1f4cd3fab34f65",
    "liuliu":   "cosyvoice-v3.5-flash-vd-liuliu3-cd6881173ab9487083b9268fcafba7ec",
    "nuonuo":   "cosyvoice-v3.5-flash-vd-nuonuo-35463b1201a545ff97ea90d424053bca",
    "xiaolu":   "cosyvoice-v3.5-flash-vd-xiaolu-90e508f268694005a1e6fc2b7e986630",
    "diandian": "cosyvoice-v3.5-flash-vd-liuliu-219a4cb04e14459db428740c44d91e52",
    "tantan":   "cosyvoice-v3.5-flash-vd-tantan-0dfcbfeb9ea04f21a9aace6feabb5c84",
    "narrator": "cosyvoice-v3.5-flash-vd-narrator-741c16219aa54818b78bab2a85923937",
}
PRICE_PER_10K = 0.8  # 元 / 万计费字符（汉字计 2）


def billed(text: str) -> int:
    return sum(2 if "一" <= ch <= "鿿" else 1 for ch in text)


def synth(text: str, voice: str, key: str, sr: int = 24000, fmt: str = "mp3") -> tuple[bytes, int]:
    body = {
        "model": MODEL,
        "input": {"text": text, "voice": voice, "format": fmt, "sample_rate": sr,
                  "volume": 50, "rate": 1.0, "pitch": 1.0, "language_hints": ["zh"]},
    }
    if text.lstrip().startswith("<speak"):   # SSML：例如 <speak>看清楚<break time="400ms"/>谁是白雪公主。</speak>
        body["input"]["enable_ssml"] = True
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
    out = res.get("output") or {}
    url = (out.get("audio") or {}).get("url") or out.get("url")
    if not url:
        raise RuntimeError(f"接口没有返回音频地址：{json.dumps(res, ensure_ascii=False)[:300]}")
    with urllib.request.urlopen(url, timeout=60) as r:
        audio = r.read()
    used = (res.get("usage") or {}).get("characters") or billed(text)
    return audio, int(used)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    missing_only = "--missing" in sys.argv
    sr = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--sr=")), 24000)
    fmt = next((a.split("=")[1] for a in sys.argv if a.startswith("--fmt=")), "mp3")
    suffix = next((a.split("=")[1] for a in sys.argv if a.startswith("--suffix=")), "")
    what = args[0] if args else "narration"
    only = set(args[1:])
    if what == "narration":
        base, voice = ROOT / "audio/narration", VOICES["narrator"]
    elif what in VOICES:
        base, voice = ROOT / "audio/players" / what, VOICES[what]
    else:
        raise SystemExit(f"未知角色：{what}（可用：narration、{'、'.join(k for k in VOICES if k != 'narrator')}）")
    lines = json.loads((base / "lines.json").read_text(encoding="utf-8"))
    items = [(k, v) for k, v in lines.items() if not k.startswith("_") and (not only or k in only)]
    ssml_path = base / "ssml.json"
    if ssml_path.exists():
        ssml = json.loads(ssml_path.read_text(encoding="utf-8"))
        items = [(k, ssml.get(k, v)) for k, v in items]
    override = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--text=")), None)
    tf = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--textfile=")), None)
    if tf:
        override = Path(tf).read_text(encoding="utf-8").strip()
    if override is not None:
        items = [(items[0][0], override)]
    units = sum(billed(t) for _, t in items)
    print(f"{len(items)} 句，粗算计费字符 {units}，约 {units / 10000 * PRICE_PER_10K:.3f} 元")
    if dry:
        return
    key = os.environ.get("DASHSCOPE_API_KEY")
    if not key:
        raise SystemExit("未设置环境变量 DASHSCOPE_API_KEY")
    out_dir = base
    total_bytes = total_used = 0
    for i, (k, t) in enumerate(items, 1):
        dest = out_dir / f"{k}{suffix}.{fmt}"
        if missing_only and dest.exists() and dest.stat().st_size > 0:
            continue
        for attempt in range(4):   # 服务端偶发 500，自动重试
            try:
                audio, used = synth(t, voice, key, sr, fmt)
                break
            except RuntimeError as e:
                if attempt == 3 or "HTTP 4" in str(e):
                    raise
                print(f"  {k} 失败，{2 * (attempt + 1)} 秒后重试：{str(e)[:80]}")
                time.sleep(2 * (attempt + 1))
        (out_dir / f"{k}{suffix}.{fmt}").write_bytes(audio)
        total_bytes += len(audio); total_used += used
        print(f"[{i}/{len(items)}] {k}{suffix}.{fmt}  {len(audio) / 1024:.1f} KB  ({used} 字符)  {t}")
        time.sleep(0.4)
    print(f"完成：共 {total_bytes / 1024:.1f} KB，实际计费字符 {total_used}，约 {total_used / 10000 * PRICE_PER_10K:.3f} 元")


if __name__ == "__main__":
    main()
