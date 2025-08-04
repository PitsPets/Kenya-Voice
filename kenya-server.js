const express = require('express');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const wav = require('wav');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 10000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new textToSpeech.TextToSpeechClient();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
const TEMP_DIR = path.join(__dirname, 'temp');
fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });

// === TWIML RESPONSE USING GOOGLE TTS PRE-RECORDED AUDIO ===
app.post('/twiml', (req, res) => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host;
  const audioUrl = `https://${host}/audio/kenya-greeting.wav`;
  const wsUrl = `wss://${host}/stream`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Pause length="1" />
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// === WebSocket for Twilio <Stream> ===
wss.on('connection', (ws) => {
  console.log('🔗 Twilio connected to /stream');

  ws.audioChunks = [];
  ws.processing = false;

  ws.on('message', async (msg) => {
    const json = JSON.parse(msg.toString());

    if (json.event === 'start') {
      console.log('✅ Stream started');
    }

    if (json.event === 'media') {
      try {
        const chunk = Buffer.from(json.media.payload, 'base64');
        ws.audioChunks.push(chunk);

        // Wait until ~3s of audio is collected before processing
        if (ws.audioChunks.length >= 80 && !ws.processing) {
          ws.processing = true;
          const audioBuffer = Buffer.concat(ws.audioChunks);
          ws.audioChunks = [];

          console.log('🎧 Collected ~3s audio, sending to Whisper...');
          const transcript = await transcribeAudio(audioBuffer);
          console.log('📝 Transcribed:', transcript);

          const webhookResponse = await axios.post(
            'https://kenya-pi.taildbcf43.ts.net/webhook/315cc5c7-ce73-484a-bf20-dca643a15d2a',
            { text: transcript }
          );

          const reply = webhookResponse.data.text || 'Pasensya na, walang sagot.';
          console.log('🤖 Kenya said:', reply);

          const audioReply = await synthesizeGoogleTTS(reply);
          const mediaMessage = {
            event: 'media',
            media: {
              payload: audioReply.toString('base64'),
            },
          };
          ws.send(JSON.stringify(mediaMessage));
          ws.processing = false;
        }
      } catch (err) {
        console.error('❌ Error handling media:', err);
        ws.processing = false;
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
async function transcribeAudio(rawBuffer) {
  const tempPath = path.join(TEMP_DIR, `audio-${uuidv4()}.wav`);

  await new Promise((resolve, reject) => {
    const writer = new wav.FileWriter(tempPath, {
      channels: 1,
      sampleRate: 8000,
      bitDepth: 16,
    });

    writer.on('open', () => {
      writer.write(rawBuffer);
      writer.end();
    });

    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const resp = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempPath),
    model: 'whisper-1',
    response_format: 'text',
  });

  try {
    fs.unlinkSync(tempPath);
  } catch (e) {
    console.warn('⚠️ Failed to delete temp file:', tempPath);
  }

  return resp;
}

// === GOOGLE TTS ===
async function synthesizeGoogleTTS(text) {
  const [response] = await googleClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: 'fil-PH', name: 'fil-PH-Wavenet-A' },
    audioConfig: { audioEncoding: 'LINEAR16' },
  });
  return response.audioContent;
}

server.listen(port, () => {
  console.log(`📞 Kenya real-time server live on port ${port}`);
});
