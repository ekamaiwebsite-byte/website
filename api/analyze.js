export default async function handler(req, res) {
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

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${LLM_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs,
          parameters: parameters || { max_new_tokens: 1500, temperature: 0.1, return_full_text: false },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
