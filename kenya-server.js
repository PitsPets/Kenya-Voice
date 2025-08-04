const express = require('express');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 3001;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new textToSpeech.TextToSpeechClient();

app.use(express.static('public'));
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// === WEBSOCKET STREAM HANDLER ===
wss.on('connection', (ws) => {
  console.log('🔗 Twilio connected to /stream');

  ws.on('message', async (msg) => {
    const json = JSON.parse(msg.toString());

    if (json.event === 'start') {
      console.log('✅ Stream started');
    }

    if (json.event === 'media') {
      try {
        const audioBuffer = Buffer.from(json.media.payload, 'base64');

        // Step 1: Transcribe audio
        const transcript = await transcribeAudio(audioBuffer);
        console.log('📝 Transcribed:', transcript);

        // Step 2: POST to your n8n webhook
        const webhookResponse = await axios.post('https://kenya-pi.taildbcf43.ts.net/webhook/315cc5c7-ce73-484a-bf20-dca643a15d2a', {
          text: transcript
        });

        const reply = webhookResponse.data.text || 'Pasensya na, walang sagot.';
        console.log('🤖 Kenya said:', reply);

        // Step 3: Synthesize audio
        const audioReply = await synthesizeGoogleTTS(reply);

        // Step 4: Send back to Twilio stream
        const mediaMessage = {
          event: 'media',
          media: {
            payload: audioReply.toString('base64'),
          },
        };
        ws.send(JSON.stringify(mediaMessage));
      } catch (err) {
        console.error('❌ Error in WebSocket message:', err);
      }
    }

    if (json.event === 'stop') {
      console.log('🛑 Stream ended');
    }
  });

  ws.on('close', () => {
    console.log('🔌 Twilio disconnected');
  });
});

// === TRANSCRIBE AUDIO ===
async function transcribeAudio(buffer) {
  const resp = await openai.audio.transcriptions.create({
    file: buffer,
    model: 'whisper-1',
    response_format: 'text',
  });
  return resp;
}

// === GOOGLE TTS ===
async function synthesizeGoogleTTS(text) {
  const [response] = await googleClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: 'fil-PH', name: 'fil-PH-Wavenet-A' },
    audioConfig: { audioEncoding: 'LINEAR16' }, // LINEAR16 = PCM = Twilio requirement
  });
  return response.audioContent;
}

server.listen(port, () => {
  console.log(`📞 Kenya real-time server live on port ${port}`);
});
