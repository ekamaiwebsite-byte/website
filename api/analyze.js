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

  try {
    const { inputs, parameters } = req.body;

    if (!inputs) {
      return res.status(400).json({ error: 'Missing "inputs" in request body' });
    }

    // Use HuggingFace router with OpenAI-compatible chat completions API
    // Model format: "model_id:provider"
    const payload = JSON.stringify({
      model: 'Qwen/Qwen2.5-7B-Instruct',
      messages: [
        { role: 'user', content: inputs }
      ],
      max_tokens: (parameters && parameters.max_new_tokens) || 1500,
      temperature: (parameters && parameters.temperature) || 0.1,
    });

    const hfResponse = await makeRequest(
      'https://router.huggingface.co/v1/chat/completions',
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

    const data = JSON.parse(hfResponse.body);

    if (hfResponse.statusCode !== 200) {
      const errMsg = typeof data === 'object' ? JSON.stringify(data) : String(data);
      return res.status(hfResponse.statusCode).json({ error: errMsg });
    }

    // Convert chat completions response to the format our frontend expects
    let generatedText = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      generatedText = data.choices[0].message.content || '';
    }

    return res.status(200).json([{ generated_text: generatedText }]);
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
