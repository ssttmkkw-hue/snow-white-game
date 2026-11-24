# 用 Windows 自带的中文语音（Microsoft Huihui）把 audio/narration/lines.json 里的台词生成占位 wav。
# 用法：powershell -ExecutionPolicy Bypass -File dev/gen_voice.ps1
# 以后有正式配音，直接用同名文件覆盖 audio/narration/<key>.wav 即可，不需要再跑这个脚本。
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'audio\narration'
$lines = Get-Content (Join-Path $dir 'lines.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$syn = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $syn.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
if (-not $voice) { throw '没有找到中文语音（zh-CN）' }
$syn.SelectVoice($voice.VoiceInfo.Name)
$syn.Rate = -2      # 稍慢一点，更有仪式感
$syn.Volume = 100
foreach ($p in $lines.PSObject.Properties) {
  if ($p.Name.StartsWith('_')) { continue }
  $out = Join-Path $dir ($p.Name + '.wav')
  $syn.SetOutputToWaveFile($out)
  $syn.Speak($p.Value)
  $syn.SetOutputToNull()
  Write-Output ("{0}.wav  <- {1}" -f $p.Name, $p.Value)
}
$syn.Dispose()
