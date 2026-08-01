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

  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    return res.status(500).json({ error: 'HF_TOKEN environment variable not configured' });
  }

  const LLM_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3';

  try {
    const { inputs, parameters } = req.body;

    if (!inputs) {
      return res.status(400).json({ error: 'Missing "inputs" in request body' });
    }

    const payload = JSON.stringify({
      inputs,
      parameters: parameters || { max_new_tokens: 1500, temperature: 0.1, return_full_text: false },
    });

    const hfResponse = await makeRequest(
      `https://router.huggingface.co/hf-inference/models/${LLM_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        body: payload,
      }
    );

    return res.status(hfResponse.statusCode).json(JSON.parse(hfResponse.body));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: options.method || 'POST',
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
