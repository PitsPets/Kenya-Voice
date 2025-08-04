// kenya-server.js (Option 2: Twilio <Record> + <Play> flow)
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const textToSpeech = require('@google-cloud/text-to-speech');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new textToSpeech.TextToSpeechClient();

const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- STEP 1: Twilio hits this to begin the call ---
app.post('/twiml', (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hi! This is Kenya. Anong gusto mong pag-usapan?</Say>
  <Record action="/process-recording" maxLength="10" timeout="2" playBeep="true" />
</Response>`;
  res.type('text/xml');
  res.send(twiml);
});

// --- STEP 2: After user speaks, Twilio sends the recording URL here ---
app.post('/process-recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  const fileUrl = `${recordingUrl}.wav`;
  const localPath = path.join(AUDIO_DIR, `recording-${uuidv4()}.wav`);

  try {
    // Download audio from Twilio
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(localPath, response.data);

    // Transcribe with Whisper
    const transcript = await transcribeAudio(response.data);

    // Get Kenya's response
    const reply = await askKenya(transcript);

    // Synthesize with Google TTS
    const mp3Url = await synthesizeGoogleTTS(reply);

    // Reply to Twilio with <Play>
    const host = process.env.RENDER_EXTERNAL_HOSTNAME || req.headers.host;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>https://${host}${mp3Url}</Play>
  <Redirect>/twiml</Redirect>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('❌ Error in processing recording:', err);
    res.type('text/xml').send('<Response><Say>Sorry, nagka-error si Kenya.</Say></Response>');
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

app.listen(port, () => {
  console.log(`📞 Kenya webhook server live on port ${port}`);
});
