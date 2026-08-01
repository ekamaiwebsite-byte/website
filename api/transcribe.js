const https = require('https');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY environment variable not configured' });
  }

  try {
    // Read raw body (audio file)
    const audioBuffer = await getRawBody(req);

    // Step 1: Upload the audio file to AssemblyAI
    const uploadRes = await makeRequest('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/octet-stream',
        'Content-Length': audioBuffer.length,
      },
      body: audioBuffer,
    });

    if (uploadRes.statusCode !== 200) {
      return res.status(uploadRes.statusCode).json({ error: 'Upload failed: ' + uploadRes.body });
    }

    const uploadData = JSON.parse(uploadRes.body);
    const audioUrl = uploadData.upload_url;

    // Step 2: Get language from query param (default: auto-detect)
    const lang = req.query && req.query.lang;

    // Step 3: Submit transcription job with speaker diarization
    const transcriptPayload = {
      audio_url: audioUrl,
      speech_models: ['universal-3-5-pro', 'universal-2'],
      speaker_labels: true,
    };

    if (lang && lang !== 'auto') {
      transcriptPayload.language_code = lang;
    } else {
      transcriptPayload.language_detection = true;
    }

    const submitRes = await makeRequest('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(transcriptPayload)),
      },
      body: JSON.stringify(transcriptPayload),
    });

    if (submitRes.statusCode !== 200) {
      return res.status(submitRes.statusCode).json({ error: 'Submit failed: ' + submitRes.body });
    }

    const submitData = JSON.parse(submitRes.body);
    const transcriptId = submitData.id;

    // Step 4: Poll until completed
    let transcript = null;
    for (let i = 0; i < 60; i++) { // max ~3 minutes polling
      await sleep(3000);

      const pollRes = await makeRequest(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        method: 'GET',
        headers: {
          'Authorization': API_KEY,
        },
      });

      const pollData = JSON.parse(pollRes.body);

      if (pollData.status === 'completed') {
        transcript = pollData;
        break;
      } else if (pollData.status === 'error') {
        return res.status(500).json({ error: 'Transcription failed: ' + (pollData.error || 'Unknown error') });
      }
      // else still processing, keep polling
    }

    if (!transcript) {
      return res.status(504).json({ error: 'Transcription timed out. Try a shorter audio file.' });
    }

    // Step 5: Return structured response with speaker diarization
    const result = {
      text: transcript.text || '',
      utterances: (transcript.utterances || []).map(u => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
      })),
      audio_duration: transcript.audio_duration || null,
      language_code: transcript.language_code || null,
    };

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + (urlObj.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const request = https.request(reqOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    request.on('error', reject);

    if (options.body) {
      request.write(options.body);
    }
    request.end();
  });
}
