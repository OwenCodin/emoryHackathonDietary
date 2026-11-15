# Voice samples

`voice-1.pcm` (Puck) and `voice-2.pcm` (Sulafat) are the samples the agent plays in setup before asking "voice one or voice two?".
They are raw 24 kHz mono 16-bit PCM, about five seconds each, made once with Gemini speech (`gemini-3.1-flash-tts-preview`, API version `v1beta`)
from the sentences in `agent/voices.mjs`. To hear one, convert it first:
`ffmpeg -f s16le -ar 24000 -ac 1 -i agent/voices/voice-1.pcm voice-1.wav`.
