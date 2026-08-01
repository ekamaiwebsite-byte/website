// ===== VANI-AI DEMO - HuggingFace Inference API =====
// No backend needed. Calls HF API directly from browser.

// ============ CONFIGURATION ============
// API calls are proxied through Vercel serverless functions (api/ folder)
// The HF_TOKEN is stored securely as a Vercel environment variable
const API_TRANSCRIBE = "/api/transcribe";
const API_ANALYZE = "/api/analyze";
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

// ===== STEP 1: AUDIO → TEXT (Whisper via serverless proxy) =====
async function transcribeAudio(file) {
    updateProcessing('Converting speech to text (Whisper)...');

    const audioBytes = await file.arrayBuffer();

    let response;
    try {
        response = await fetch(API_TRANSCRIBE, {
            method: 'POST',
            body: audioBytes
        });
    } catch (networkErr) {
        throw new Error('Network error — cannot reach transcription API. (' + networkErr.message + ')');
    }

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 503) {
            throw new Error('Whisper model is loading (cold start). Please wait 30-60 seconds and click Analyze again.');
        }
        throw new Error('Transcription error ' + response.status + ': ' + (data.error || 'Unknown error'));
    }

    return data.text || '';
}


// ===== STEP 2: TEXT → LLM ANALYSIS (via serverless proxy) =====
async function analyzeSentiment(transcript, audioDuration) {
    updateProcessing('Running sentiment analysis (LLM)...');

    // Format duration as MM:SS
    let durationStr = 'Unknown';
    if (audioDuration) {
        const mins = Math.floor(audioDuration / 60);
        const secs = Math.round(audioDuration % 60);
        durationStr = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    let analysisPrompt = 'You are an expert call center analyst. Analyze this telecall transcript and respond ONLY with valid JSON (no other text).\n\nDIARIZATION RULES:\n- Identify speakers: "Host" (the agent/executive making the business call) and "Customer" (the person being called/responding).\n- A "turn" is one speaker\'s complete uninterrupted speech before the other person responds. Split based on MEANING and CONTEXT, not by sentence.\n- When one person finishes speaking and the other starts, that is a new turn.\n- Short acknowledgments like "Yes sir", "Okay", "Hmm" that are responses from the other person should be their own turn.\n- If the same person says multiple sentences without being interrupted, keep them as ONE turn.\n\nDURATION: The actual audio duration is DURATION_PLACEHOLDER. You MUST use this exact value for "duration_estimate".\n\nRequired JSON fields:\n- "diarized_transcript": array of objects with {"speaker": "Host" or "Customer", "text": "what they said"} - one entry per speaker turn (a turn = everything one person says before the other responds)\n- "duration_estimate": "DURATION_PLACEHOLDER" (use this exact value)\n- "customer_sentiment": one of "Positive", "Neutral", "Negative", "Frustrated", "Angry"\n- "host_sentiment": one of "Professional", "Empathetic", "Neutral", "Rude", "Dismissive"\n- "anger_triggered": true or false\n- "anger_timestamp": "MM:SS" when anger started, or "N/A"\n- "anger_context": what triggered anger (1-2 sentences), or "No anger detected"\n- "main_issue": primary customer issue (2-3 sentences)\n- "issue_resolved": one of "Yes", "No", "Partial"\n- "resolution_summary": how resolved or why not (2-3 sentences)\n- "customer_rating": satisfaction score 1-10\n- "host_rating": performance score 1-10\n- "sentiment_timeline": array of objects with {"turn": 1, "speaker": "Host" or "Customer", "sentiment": number from -1.0 to 1.0, "summary": "brief 3-5 word description"} — one entry per diarized turn\n\nTRANSCRIPT:\n' + transcript + '\n\nRespond with ONLY the JSON object:';

    // Replace duration placeholder with actual value
    analysisPrompt = analysisPrompt.replace('DURATION_PLACEHOLDER', durationStr);

    let response;
    try {
        response = await fetch(API_ANALYZE, {
            method: 'POST',
            headers: {
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
        throw new Error('Network error — cannot reach analysis API. (' + networkErr.message + ')');
    }

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 503) {
            throw new Error('Mistral model is loading (cold start). Please wait 1-2 minutes and click Analyze again.');
        }
        if (response.status === 422) {
            throw new Error('Model input too long. Try a shorter transcript.');
        }
        throw new Error('Analysis error ' + response.status + ': ' + (data.error || 'Unknown error'));
    }

    let generatedText = '';
    if (Array.isArray(data) && data[0]) {
        generatedText = data[0].generated_text || '';
    } else if (data.generated_text) {
        generatedText = data.generated_text;
    } else if (data.error) {
        throw new Error('API error: ' + data.error);
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
        diarized_transcript: [],
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
        sentiment_timeline: [{turn: 1, speaker: "Unknown", sentiment: 0, summary: "N/A"}],
    };
}

function normalizeResult(data) {
    const defaults = {
        diarized_transcript: [],
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
        sentiment_timeline: [{turn: 1, speaker: "Unknown", sentiment: 0, summary: "N/A"}],
    };
    for (const key in defaults) {
        if (!(key in data)) data[key] = defaults[key];
    }
    // Clamp ratings
    data.customer_rating = Math.max(1, Math.min(10, parseInt(data.customer_rating) || 5));
    data.host_rating = Math.max(1, Math.min(10, parseInt(data.host_rating) || 5));
    // Normalize timeline - support both old format (array of numbers) and new format (array of objects)
    if (!Array.isArray(data.sentiment_timeline)) data.sentiment_timeline = [{turn: 1, speaker: "Unknown", sentiment: 0, summary: "N/A"}];
    data.sentiment_timeline = data.sentiment_timeline.map((v, i) => {
        if (typeof v === 'number') {
            return { turn: i + 1, speaker: "Unknown", sentiment: Math.max(-1, Math.min(1, v)), summary: "" };
        }
        return {
            turn: v.turn || i + 1,
            speaker: v.speaker || "Unknown",
            sentiment: Math.max(-1, Math.min(1, parseFloat(v.sentiment) || 0)),
            summary: v.summary || ""
        };
    });
    // Ensure diarized_transcript is an array
    if (!Array.isArray(data.diarized_transcript)) data.diarized_transcript = [];
    return data;
}


// ===== GET AUDIO DURATION =====
function getAudioDuration(file) {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.addEventListener('loadedmetadata', () => {
            resolve(audio.duration);
            URL.revokeObjectURL(audio.src);
        });
        audio.addEventListener('error', () => {
            resolve(null);
        });
        audio.src = URL.createObjectURL(file);
    });
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
        let audioDuration = null;

        // Step 1: Get transcript
        if (hasAudio) {
            // Get audio duration
            audioDuration = await getAudioDuration(audioFile);
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
        const results = await analyzeSentiment(transcript, audioDuration);
        results.transcript = transcript;
        results.audio_transcribed = hasAudio;

        // Override duration with actual audio duration if available
        if (audioDuration) {
            const mins = Math.floor(audioDuration / 60);
            const secs = Math.round(audioDuration % 60);
            results.duration_estimate = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }

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

    // Use diarized transcript if available, otherwise fall back to raw
    if (data.diarized_transcript && data.diarized_transcript.length > 0) {
        document.getElementById('transcriptBox').innerHTML = formatDiarizedTranscript(data.diarized_transcript);
    } else {
        document.getElementById('transcriptBox').innerHTML = formatTranscript(data.transcript || '');
    }

    drawSentimentChart(data.sentiment_timeline || [{turn: 1, speaker: "Unknown", sentiment: 0, summary: "N/A"}]);

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

function formatDiarizedTranscript(turns) {
    return turns.map((turn, i) => {
        const speaker = turn.speaker || 'Unknown';
        const text = turn.text || '';
        const isHost = speaker.toLowerCase().includes('host') || speaker.toLowerCase().includes('agent');
        const speakerClass = isHost ? 'speaker-host' : 'speaker-customer';
        const icon = isHost ? '🎧' : '👤';
        return `<div class="turn diarized-turn">
            <span class="turn-number">${i + 1}</span>
            <span class="${speakerClass}">${icon} ${speaker}:</span>
            <span class="turn-text">${text}</span>
        </div>`;
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

    // Extract sentiment values (support both old array-of-numbers and new array-of-objects)
    const points = data.map((d, i) => {
        if (typeof d === 'number') return { turn: i + 1, speaker: '', sentiment: d, summary: '' };
        return d;
    });
    const values = points.map(p => p.sentiment);

    // Layout
    const topPad = 20, bottomPad = 25, leftPad = 45, rightPad = 10;
    const graphW = w - leftPad - rightPad;
    const graphH = h - topPad - bottomPad;
    const zeroY = topPad + graphH / 2;

    // Background zones
    // Positive zone (green tint)
    const posGrad = ctx.createLinearGradient(0, topPad, 0, zeroY);
    posGrad.addColorStop(0, 'rgba(16, 185, 129, 0.08)');
    posGrad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');
    ctx.fillStyle = posGrad;
    ctx.fillRect(leftPad, topPad, graphW, graphH / 2);

    // Negative zone (red tint)
    const negGrad = ctx.createLinearGradient(0, zeroY, 0, topPad + graphH);
    negGrad.addColorStop(0, 'rgba(247, 37, 133, 0.01)');
    negGrad.addColorStop(1, 'rgba(247, 37, 133, 0.08)');
    ctx.fillStyle = negGrad;
    ctx.fillRect(leftPad, zeroY, graphW, graphH / 2);

    // Grid lines with labels
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    const yLabels = [
        { val: 1.0, label: '+1' },
        { val: 0, label: '0' },
        { val: -1.0, label: '-1' }
    ];
    yLabels.forEach(({ val, label }) => {
        const y = zeroY - val * (graphH / 2);
        ctx.strokeStyle = val === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)';
        ctx.lineWidth = val === 0 ? 1.5 : 0.5;
        ctx.setLineDash(val === 0 ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(leftPad + graphW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = val === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)';
        ctx.fillText(label, leftPad - 8, y + 4);
    });

    // Title / Legend
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px Space Grotesk, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('Conversation Flow', leftPad, 10);

    // Legend items
    ctx.font = '8px Inter, sans-serif';
    const legendX = leftPad + 100;
    ctx.fillStyle = '#10b981'; ctx.fillRect(legendX, 5, 6, 6); 
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('Positive', legendX + 9, 10);
    ctx.fillStyle = '#f59e0b'; ctx.fillRect(legendX + 45, 5, 6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('Neutral', legendX + 54, 10);
    ctx.fillStyle = '#f72585'; ctx.fillRect(legendX + 88, 5, 6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText('Negative', legendX + 97, 10);

    if (values.length < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '12px Space Grotesk, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Not enough data points for timeline', w / 2, h / 2);
        return;
    }

    const stepX = graphW / (values.length - 1);

    // Area fill under curve
    ctx.beginPath();
    ctx.moveTo(leftPad, zeroY - values[0] * (graphH / 2));
    for (let i = 1; i < values.length; i++) {
        const x = leftPad + i * stepX;
        const y = zeroY - values[i] * (graphH / 2);
        const prevX = leftPad + (i - 1) * stepX;
        const prevY = zeroY - values[i - 1] * (graphH / 2);
        ctx.bezierCurveTo((prevX + x) / 2, prevY, (prevX + x) / 2, y, x, y);
    }
    ctx.lineTo(leftPad + (values.length - 1) * stepX, zeroY);
    ctx.lineTo(leftPad, zeroY);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, topPad, 0, topPad + graphH);
    areaGrad.addColorStop(0, 'rgba(0, 245, 212, 0.2)');
    areaGrad.addColorStop(0.5, 'rgba(0, 245, 212, 0.02)');
    areaGrad.addColorStop(1, 'rgba(247, 37, 133, 0.15)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Main line
    ctx.beginPath();
    ctx.moveTo(leftPad, zeroY - values[0] * (graphH / 2));
    for (let i = 1; i < values.length; i++) {
        const x = leftPad + i * stepX;
        const y = zeroY - values[i] * (graphH / 2);
        const prevX = leftPad + (i - 1) * stepX;
        const prevY = zeroY - values[i - 1] * (graphH / 2);
        ctx.bezierCurveTo((prevX + x) / 2, prevY, (prevX + x) / 2, y, x, y);
    }
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Data points with turn labels
    ctx.textAlign = 'center';
    for (let i = 0; i < values.length; i++) {
        const x = leftPad + i * stepX;
        const y = zeroY - values[i] * (graphH / 2);
        const val = values[i];

        // Dot color based on sentiment
        let dotColor = '#f59e0b'; // neutral
        if (val > 0.2) dotColor = '#10b981'; // positive
        if (val < -0.2) dotColor = '#f72585'; // negative

        // Dot
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();

        // Turn number below x-axis
        ctx.font = '7px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText(points[i].turn || (i + 1), x, topPad + graphH + 10);
    }

    // X-axis label
    ctx.font = '7px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center';
    ctx.fillText('Turns →', leftPad + graphW / 2, topPad + graphH + 20);

    // Anger marker (lowest point)
    const minVal = Math.min(...values);
    if (minVal < -0.3) {
        const angerIdx = values.indexOf(minVal);
        const ax = leftPad + angerIdx * stepX;
        const ay = zeroY - values[angerIdx] * (graphH / 2);
        ctx.beginPath();
        ctx.arc(ax, ay, 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#f72585';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

// ===== TEST CONNECTION =====
async function testConnection() {
    const resultEl = document.getElementById('testResult');
    resultEl.textContent = '⏳ Testing...';
    resultEl.style.color = '#f59e0b';

    try {
        const res = await fetch(API_ANALYZE, {
            method: 'POST',
            headers: {
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
        } else {
            const data = await res.json();
            resultEl.textContent = '❌ Error ' + res.status + ': ' + (data.error || '').substring(0, 100);
            resultEl.style.color = '#f72585';
        }
    } catch (e) {
        resultEl.textContent = '❌ Network error: ' + e.message;
        resultEl.style.color = '#f72585';
    }
}
