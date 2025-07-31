// stream-server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { OpenAI } = require('openai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new textToSpeech.TextToSpeechClient();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// --- TWILIO TWIML RESPONSE ---
app.post('/twiml', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Hi! Kenya is now listening.</Say>
      <Connect>
        <Stream url="wss://${req.headers.host}/stream" />
      </Connect>
    </Response>`;
  res.type('text/xml');
  res.send(twiml);
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  let audioChunks = [];

  ws.on('message', async (data) => {
    const msg = JSON.parse(data);
    if (msg.event === 'media') {
      const audio = Buffer.from(msg.media.payload, 'base64');
      audioChunks.push(audio);
    } else if (msg.event === 'stop') {
      const fullAudio = Buffer.concat(audioChunks);
      const wavPath = path.join(AUDIO_DIR, `input-${uuidv4()}.wav`);
      fs.writeFileSync(wavPath, fullAudio);

      const transcript = await transcribeAudio(fullAudio);
      const reply = await askKenya(transcript);
      const mp3Url = await synthesizeGoogleTTS(reply);

      console.log(`Transcript: ${transcript}`);
      console.log(`Reply: ${reply}`);
      console.log(`URL: ${mp3Url}`);
    }
  });
});

app.server = app.listen(port, () => {
  console.log(`🧠 Kenya server listening on port ${port}`);
});

app.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/stream') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

// --- TRANSCRIBE AUDIO ---
async function transcribeAudio(buffer) {
  const resp = await openai.audio.transcriptions.create({
    file: buffer,
    model: 'whisper-1',
    response_format: 'text',
  });
  return resp;
}

// --- KENYA AI ---
async function askKenya(prompt) {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are Kenya, a professional Taglish AI assistant. Keep replies short and natural.' },
      { role: 'user', content: prompt },
    ],
  });
  return resp.choices[0].message.content;
}

// --- GOOGLE TTS ---
async function synthesizeGoogleTTS(text) {
  const request = {
    input: { text },
    voice: { languageCode: 'fil-PH', name: 'fil-PH-Wavenet-A' },
    audioConfig: { audioEncoding: 'MP3' },
  };
  const [response] = await googleClient.synthesizeSpeech(request);
  const filename = `kenya-${uuidv4()}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);
  fs.writeFileSync(filepath, response.audioContent);
  return `/audio/${filename}`;
}