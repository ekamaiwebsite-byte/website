module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const API_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' });
  }

  return res.status(200).json({ key: API_KEY });
};
