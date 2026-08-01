// ===== VANI-AI DEMO - HuggingFace Inference API =====
// No backend needed. Calls HF API directly from browser.

// ============ CONFIGURATION ============
const HF_TOKEN = "YOUR_HUGGINGFACE_TOKEN_HERE";

// Models (hosted by HuggingFace, free tier)
const WHISPER_MODEL = "openai/whisper-large-v3-turbo";
const LLM_MODEL = "mistralai/Mistral-7B-Instruct-v0.3";

const HF_INFERENCE_URL = "https://api-inference.huggingface.co/models/";
// ========================================

let currentTab = 'audio';
let audioFile = null;
let transcriptFile = null;

// Tab switching
function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tabAudio').classList.toggle('active', tab === 'audio');
    document.getElementById('tabTranscript').classList.toggle('active', tab === 'transcript');
    document.getElementById('audioSection').style.display = tab === 'audio' ? 'block' : 'none';
    document.getElementById('transcriptSection').style.display = tab === 'transcript' ? 'block' : 'none';
}

// Dropzone interactions
document.addEventListener('DOMContentLoaded', () => {
    setupDropzone('audioDropzone', 'audioInput', 'audio');
    setupDropzone('transcriptDropzone', 'transcriptInput', 'transcript');
});

function setupDropzone(dropzoneId, inputId, type) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#00f5d4'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '';
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0], type);
    });
    input.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0], type);
    });
}

function handleFile(file, type) {
    if (type === 'audio') {
        audioFile = file;
        document.getElementById('audioDropzone').style.display = 'none';
        document.getElementById('audioFileInfo').style.display = 'flex';
        document.getElementById('audioFileName').textContent = file.name;
    } else {
        transcriptFile = file;
        document.getElementById('transcriptDropzone').style.display = 'none';
        document.getElementById('transcriptFileInfo').style.display = 'flex';
        document.getElementById('transcriptFileName').textContent = file.name;
    }
}

function removeFile(type) {
    if (type === 'audio') {
        audioFile = null;
        document.getElementById('audioDropzone').style.display = 'block';
        document.getElementById('audioFileInfo').style.display = 'none';
        document.getElementById('audioInput').value = '';
    } else {
        transcriptFile = null;
        document.getElementById('transcriptDropzone').style.display = 'block';
        document.getElementById('transcriptFileInfo').style.display = 'none';
        document.getElementById('transcriptInput').value = '';
    }
}

// ===== STEP 1: AUDIO → TEXT (Whisper via HF Inference API) =====
async function transcribeAudio(file) {
    updateProcessing('Converting speech to text (Whisper)...');

    const audioBytes = await file.arrayBuffer();

    let response;
    try {
        response = await fetch("https://api-inference.huggingface.co/models/" + WHISPER_MODEL, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + HF_TOKEN,
            },
            body: audioBytes
        });
    } catch (networkErr) {
        throw new Error('Network error — cannot reach HuggingFace API. Check your internet connection. (' + networkErr.message + ')');
    }

    if (!response.ok) {
        const errText = await response.text();
        if (response.status === 503) {
            throw new Error('Whisper model is loading (cold start). Please wait 30-60 seconds and click Analyze again.');
        }
        if (response.status === 401) {
            throw new Error('Invalid HuggingFace token. Check HF_TOKEN in vani-demo.js');
        }
        throw new Error('Whisper API error ' + response.status + ': ' + errText);
    }

    const data = await response.json();
    return data.text || '';
}


// ===== STEP 2: TEXT → LLM ANALYSIS (Mistral via HF Inference API) =====
async function analyzeSentiment(transcript) {
    updateProcessing('Running sentiment analysis (Mistral LLM)...');

    const analysisPrompt = '<s>[INST] You are an expert call center analyst. Analyze this telecall transcript and respond ONLY with valid JSON (no other text).\n\nRequired JSON fields:\n- "duration_estimate": estimated call duration in "MM:SS" format\n- "customer_sentiment": one of "Positive", "Neutral", "Negative", "Frustrated", "Angry"\n- "host_sentiment": one of "Professional", "Empathetic", "Neutral", "Rude", "Dismissive"\n- "anger_triggered": true or false\n- "anger_timestamp": "MM:SS" when anger started, or "N/A"\n- "anger_context": what triggered anger (1-2 sentences), or "No anger detected"\n- "main_issue": primary customer issue (2-3 sentences)\n- "issue_resolved": one of "Yes", "No", "Partial"\n- "resolution_summary": how resolved or why not (2-3 sentences)\n- "customer_rating": satisfaction score 1-10\n- "host_rating": performance score 1-10\n- "sentiment_timeline": array of numbers from -1.0 to 1.0 for each conversation turn (customer perspective)\n\nTRANSCRIPT:\n' + transcript + '\n\nRespond with ONLY the JSON object: [/INST]';

    let response;
    try {
        response = await fetch("https://api-inference.huggingface.co/models/" + LLM_MODEL, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + HF_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                inputs: analysisPrompt,
                parameters: {
                    max_new_tokens: 1500,
                    temperature: 0.1,
                    return_full_text: false,
                }
            })
        });
    } catch (networkErr) {
        throw new Error('Network error — cannot reach HuggingFace API. Check your internet connection. (' + networkErr.message + ')');
    }

    if (!response.ok) {
        const errText = await response.text();
        if (response.status === 503) {
            throw new Error('Mistral model is loading (cold start). Please wait 1-2 minutes and click Analyze again.');
        }
        if (response.status === 401) {
            throw new Error('Invalid HuggingFace token. Check HF_TOKEN in vani-demo.js');
        }
        if (response.status === 422) {
            throw new Error('Model input too long. Try a shorter transcript.');
        }
        throw new Error('LLM API error ' + response.status + ': ' + errText);
    }

    const data = await response.json();
    let generatedText = '';
    if (Array.isArray(data) && data[0]) {
        generatedText = data[0].generated_text || '';
    } else if (data.generated_text) {
        generatedText = data.generated_text;
    } else if (data.error) {
        throw new Error('HF API error: ' + data.error);
    }

    return parseLLMResponse(generatedText);
}

// ===== PARSE LLM JSON RESPONSE =====
function parseLLMResponse(text) {
    text = text.trim();

    // Remove markdown code fences
    if (text.includes('```json')) {
        text = text.split('```json')[1].split('```')[0].trim();
    } else if (text.includes('```')) {
        text = text.split('```')[1].split('```')[0].trim();
    }

    // Try direct parse
    try {
        return normalizeResult(JSON.parse(text));
    } catch (e) {}

    // Try finding JSON object
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return normalizeResult(JSON.parse(match[0]));
        } catch (e) {}
    }

    // Fallback
    return {
        duration_estimate: "N/A",
        customer_sentiment: "Unknown",
        host_sentiment: "Unknown",
        anger_triggered: false,
        anger_timestamp: "N/A",
        anger_context: "Could not parse LLM response",
        main_issue: "Analysis failed — raw response: " + text.substring(0, 200),
        issue_resolved: "Unknown",
        resolution_summary: "Please try again",
        customer_rating: 5,
        host_rating: 5,
        sentiment_timeline: [0],
    };
}

function normalizeResult(data) {
    const defaults = {
        duration_estimate: "N/A",
        customer_sentiment: "Neutral",
        host_sentiment: "Professional",
        anger_triggered: false,
        anger_timestamp: "N/A",
        anger_context: "No anger detected",
        main_issue: "No issue detected",
        issue_resolved: "Unknown",
        resolution_summary: "N/A",
        customer_rating: 5,
        host_rating: 5,
        sentiment_timeline: [0],
    };
    for (const key in defaults) {
        if (!(key in data)) data[key] = defaults[key];
    }
    // Clamp ratings
    data.customer_rating = Math.max(1, Math.min(10, parseInt(data.customer_rating) || 5));
    data.host_rating = Math.max(1, Math.min(10, parseInt(data.host_rating) || 5));
    // Clamp timeline
    if (!Array.isArray(data.sentiment_timeline)) data.sentiment_timeline = [0];
    data.sentiment_timeline = data.sentiment_timeline.map(v => Math.max(-1, Math.min(1, parseFloat(v) || 0)));
    return data;
}


// ===== MAIN ANALYSIS FLOW =====
async function runAnalysis() {
    const pasteText = document.getElementById('pasteTranscript')?.value || '';
    const hasAudio = currentTab === 'audio' && audioFile;
    const hasTranscriptFile = currentTab === 'transcript' && transcriptFile;
    const hasTranscriptText = currentTab === 'transcript' && pasteText.trim().length > 0;

    if (!hasAudio && !hasTranscriptFile && !hasTranscriptText) {
        alert('Please upload an audio file or provide a transcript to analyze.');
        return;
    }

    // Show processing
    document.getElementById('analyzeBtn').style.display = 'none';
    document.getElementById('processingIndicator').style.display = 'flex';

    try {
        let transcript = '';

        // Step 1: Get transcript
        if (hasAudio) {
            // Audio → Whisper → Text
            transcript = await transcribeAudio(audioFile);
            if (!transcript.trim()) throw new Error('Whisper returned empty transcript. Try a clearer audio file.');
        } else if (hasTranscriptFile) {
            // Read file content
            transcript = await transcriptFile.text();
        } else {
            transcript = pasteText;
        }

        // Step 2: LLM Analysis
        const results = await analyzeSentiment(transcript);
        results.transcript = transcript;
        results.audio_transcribed = hasAudio;

        // Step 3: Display
        updateProcessing('Rendering dashboard...');
        await sleep(500);
        displayResults(results);

    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        document.getElementById('processingIndicator').style.display = 'none';
        document.getElementById('analyzeBtn').style.display = 'flex';
    }
}

function updateProcessing(text) {
    const el = document.getElementById('processingText');
    if (el) el.textContent = text;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== DISPLAY RESULTS =====
function displayResults(data) {
    document.getElementById('dashPlaceholder').style.display = 'none';
    document.getElementById('dashResults').style.display = 'block';

    document.getElementById('metricDuration').textContent = data.duration_estimate || 'N/A';
    document.getElementById('metricCustSentiment').textContent = data.customer_sentiment || 'N/A';
    document.getElementById('metricHostSentiment').textContent = data.host_sentiment || 'N/A';
    document.getElementById('metricResolved').textContent = data.issue_resolved || 'N/A';

    document.getElementById('angerTime').textContent = data.anger_timestamp || 'N/A';
    document.getElementById('angerContext').textContent = data.anger_context || 'No anger detected';

    document.getElementById('mainIssue').textContent = data.main_issue || 'N/A';
    document.getElementById('resolutionSummary').textContent = data.resolution_summary || 'N/A';

    const custRating = data.customer_rating || 5;
    const hostRating = data.host_rating || 5;
    document.getElementById('custRating').textContent = custRating;
    document.getElementById('hostRating').textContent = hostRating;
    document.getElementById('custRatingBar').style.width = (custRating * 10) + '%';
    document.getElementById('hostRatingBar').style.width = (hostRating * 10) + '%';

    document.getElementById('transcriptBox').innerHTML = formatTranscript(data.transcript || '');

    drawSentimentChart(data.sentiment_timeline || [0]);

    colorSentiment('metricCustSentiment', data.customer_sentiment);
    colorSentiment('metricHostSentiment', data.host_sentiment);
    colorResolved('metricResolved', data.issue_resolved);
}

function formatTranscript(text) {
    const lines = text.split('\n').filter(l => l.trim());
    return lines.map(line => {
        if (line.match(/^(Customer|Caller|User)/i)) {
            const parts = line.split(':');
            return `<div class="turn"><span class="speaker-customer">${parts[0]}:</span>${parts.slice(1).join(':')}</div>`;
        } else if (line.match(/^(Host|Agent|Executive|Support|Priya)/i)) {
            const parts = line.split(':');
            return `<div class="turn"><span class="speaker-host">${parts[0]}:</span>${parts.slice(1).join(':')}</div>`;
        }
        return `<div class="turn">${line}</div>`;
    }).join('');
}

function colorSentiment(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (['Negative', 'Frustrated', 'Angry', 'Rude', 'Dismissive'].includes(value)) el.style.color = '#f72585';
    else if (['Positive', 'Empathetic', 'Professional'].includes(value)) el.style.color = '#10b981';
    else el.style.color = '#f59e0b';
}

function colorResolved(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === 'Yes') el.style.color = '#10b981';
    else if (value === 'No') el.style.color = '#f72585';
    else el.style.color = '#f59e0b';
}

// ===== SENTIMENT CHART (Canvas) =====
function drawSentimentChart(data) {
    const canvas = document.getElementById('sentimentChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Zero line
    const zeroY = h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('Positive', 4, 14);
    ctx.fillText('Negative', 4, h - 6);

    if (data.length < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '12px Space Grotesk, sans-serif';
        ctx.fillText('Not enough data points', w / 2 - 60, h / 2);
        return;
    }

    const padding = 30;
    const graphW = w - padding * 2;
    const stepX = graphW / (data.length - 1);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 245, 212, 0.15)');
    grad.addColorStop(0.5, 'rgba(0, 245, 212, 0.02)');
    grad.addColorStop(1, 'rgba(247, 37, 133, 0.15)');

    // Fill area
    ctx.beginPath();
    ctx.moveTo(padding, zeroY - data[0] * (h * 0.4));
    for (let i = 1; i < data.length; i++) {
        const x = padding + i * stepX;
        const y = zeroY - data[i] * (h * 0.4);
        const prevX = padding + (i - 1) * stepX;
        const prevY = zeroY - data[i - 1] * (h * 0.4);
        ctx.bezierCurveTo((prevX + x) / 2, prevY, (prevX + x) / 2, y, x, y);
    }
    ctx.lineTo(padding + (data.length - 1) * stepX, h);
    ctx.lineTo(padding, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(padding, zeroY - data[0] * (h * 0.4));
    for (let i = 1; i < data.length; i++) {
        const x = padding + i * stepX;
        const y = zeroY - data[i] * (h * 0.4);
        const prevX = padding + (i - 1) * stepX;
        const prevY = zeroY - data[i - 1] * (h * 0.4);
        ctx.bezierCurveTo((prevX + x) / 2, prevY, (prevX + x) / 2, y, x, y);
    }
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots
    for (let i = 0; i < data.length; i++) {
        const x = padding + i * stepX;
        const y = zeroY - data[i] * (h * 0.4);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = data[i] < -0.5 ? '#f72585' : data[i] > 0.2 ? '#10b981' : '#00f5d4';
        ctx.fill();
    }

    // Anger marker (lowest point)
    const minVal = Math.min(...data);
    if (minVal < -0.3) {
        const angerIdx = data.indexOf(minVal);
        const ax = padding + angerIdx * stepX;
        const ay = zeroY - data[angerIdx] * (h * 0.4);
        ctx.beginPath();
        ctx.arc(ax, ay, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#f72585';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '9px Space Grotesk, sans-serif';
        ctx.fillStyle = '#f72585';
        ctx.fillText('⚡ Anger', ax - 15, ay - 12);
    }
}

// ===== TEST CONNECTION =====
async function testConnection() {
    const resultEl = document.getElementById('testResult');
    resultEl.textContent = '⏳ Testing...';
    resultEl.style.color = '#f59e0b';

    try {
        const res = await fetch("https://api-inference.huggingface.co/models/" + LLM_MODEL, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + HF_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                inputs: '<s>[INST] Say "hello" [/INST]',
                parameters: { max_new_tokens: 10 }
            })
        });

        if (res.status === 200) {
            resultEl.textContent = '✅ Connected! API is working.';
            resultEl.style.color = '#10b981';
        } else if (res.status === 503) {
            resultEl.textContent = '⏳ Model is loading (cold start). Wait 1-2 min and retry.';
            resultEl.style.color = '#f59e0b';
        } else if (res.status === 401) {
            resultEl.textContent = '❌ Invalid token. Update HF_TOKEN in vani-demo.js';
            resultEl.style.color = '#f72585';
        } else {
            const errText = await res.text();
            resultEl.textContent = '❌ Error ' + res.status + ': ' + errText.substring(0, 100);
            resultEl.style.color = '#f72585';
        }
    } catch (e) {
        resultEl.textContent = '❌ Network error: ' + e.message + ' (Are you on file:// ? Use a local server)';
        resultEl.style.color = '#f72585';
    }
}
