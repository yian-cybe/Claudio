# Fish Audio TTS 配置

Claudio 可选使用 [Fish Audio](https://fish.audio) 合成主持人语音；未配置时使用浏览器 Web Speech。

## 环境变量

在 `.env` 中设置：

```env
FISH_AUDIO_API_KEY=你的密钥
FISH_AUDIO_MODEL=s2-pro
FISH_AUDIO_REFERENCE_ID=可选的音色参考 ID
```

## 行为

- 配置后，每轮 `say` 会尝试生成 MP3 并缓存到 `state/tts-cache/`
- 合成失败自动回退浏览器朗读（前端调试栏会记录 `fish tts play failed`）
- `/api/health` → `tts.fish.enabled` 可确认是否生效

## 验证

1. 配置 Key 并重启 `npm start`
2. 发一条消息，调试面板应出现 `ttsUrl` 字段
3. 关闭「朗读」复选框可只听文字不播语音
