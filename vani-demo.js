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

// ===== STEP 1: AUDIO → TEXT (AssemblyAI with Speaker Diarization) =====
async function transcribeAudio(file) {
    updateProcessing('Initializing transcription...');

    // Get API key from our secure endpoint
    const keyRes = await fetch('/api/get-key');
    const keyData = await keyRes.json();
    if (!keyRes.ok || !keyData.key) {
        throw new Error('Failed to initialize: ' + (keyData.error || 'Unknown error'));
    }
    const API_KEY = keyData.key;

    // Step 1: Upload audio directly to AssemblyAI (bypasses Vercel size limit)
    updateProcessing('Uploading audio file...');
    const audioBytes = await file.arrayBuffer();

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
            'Authorization': API_KEY,
        },
        body: audioBytes,
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error('Upload failed: ' + errText.substring(0, 100));
    }

    const uploadData = await uploadRes.json();
    const audioUrl = uploadData.upload_url;

    // Step 2: Submit transcription job with speaker diarization
    updateProcessing('Transcribing audio with speaker detection...');
    const langSelect = document.getElementById('langSelect');
    const lang = langSelect ? langSelect.value : 'auto';

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

    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
            'Authorization': API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(transcriptPayload),
    });

    if (!submitRes.ok) {
        const errText = await submitRes.text();
        throw new Error('Transcription submit failed: ' + errText.substring(0, 100));
    }

    const submitData = await submitRes.json();
    const transcriptId = submitData.id;

    // Step 3: Poll for completion
    updateProcessing('Processing audio (this may take a moment)...');
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));

        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            headers: { 'Authorization': API_KEY },
        });

        const pollData = await pollRes.json();

        if (pollData.status === 'completed') {
            return {
                text: pollData.text || '',
                utterances: (pollData.utterances || []).map(u => ({
                    speaker: u.speaker,
                    text: u.text,
                    start: u.start,
                    end: u.end,
                })),
                audio_duration: pollData.audio_duration || null,
                language_code: pollData.language_code || null,
            };
        } else if (pollData.status === 'error') {
            throw new Error('Transcription failed: ' + (pollData.error || 'Unknown error'));
        }

        updateProcessing('Processing audio (' + Math.round((i + 1) * 3) + 's)...');
    }

    throw new Error('Transcription timed out. Try a shorter audio file.');

    // Return full response (includes utterances with speaker labels)
    return data;
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

    let analysisPrompt = 'You are an expert conversation analyst. Analyze this transcript and respond ONLY with valid JSON (no other text).\n\nSPEAKER RULES:\n- Use "Speaker 1" and "Speaker 2" to identify speakers. If there is only ONE speaker in the audio, use only "Speaker 1" and leave Speaker 2 fields as "N/A".\n- Split the transcript into INDIVIDUAL SENTENCES. Each sentence ending with a period (.), question mark (?), exclamation mark (!), or ellipsis (...) is a SEPARATE entry.\n\nDURATION: The actual audio duration is DURATION_PLACEHOLDER. You MUST use this exact value for "duration_estimate".\n\nRequired JSON fields:\n- "diarized_transcript": array of objects with {"speaker": "Speaker 1" or "Speaker 2", "text": "single sentence"} - one entry PER SENTENCE\n- "duration_estimate": "DURATION_PLACEHOLDER" (use this exact value)\n- "speaker_count": 1 or 2 (number of distinct speakers detected)\n- "speaker1_sentiment": one of "Positive", "Neutral", "Negative", "Frustrated", "Angry"\n- "speaker2_sentiment": one of "Positive", "Neutral", "Negative", "Frustrated", "Angry", or "N/A" if single speaker\n- "anger_triggered": true or false\n- "anger_timestamp": "MM:SS" when anger started, or "N/A"\n- "anger_context": what triggered anger (1-2 sentences), or "No anger detected"\n- "main_issue": the main topic/issue discussed by BOTH speakers together (2-3 sentences). Consider what both Speaker 1 and Speaker 2 said.\n- "issue_resolved": one of "Yes", "No", "Partial", or "N/A" if not applicable\n- "resolution_summary": how the conversation concluded considering both speakers (2-3 sentences)\n- "speaker1_rating": Speaker 1 performance/satisfaction score 1-10\n- "speaker2_rating": Speaker 2 performance/satisfaction score 1-10, or 0 if single speaker\n- "sentiment_timeline": array of objects with {"turn": 1, "speaker": "Speaker 1" or "Speaker 2", "sentiment": number from -1.0 to 1.0, "summary": "brief 3-5 word description"} — one entry per diarized turn\n\nTRANSCRIPT:\n' + transcript + '\n\nRespond with ONLY the JSON object:';

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
        speaker_count: 2,
        speaker1_sentiment: "Neutral",
        speaker2_sentiment: "Neutral",
        anger_triggered: false,
        anger_timestamp: "N/A",
        anger_context: "No anger detected",
        main_issue: "No issue detected",
        issue_resolved: "Unknown",
        resolution_summary: "N/A",
        speaker1_rating: 5,
        speaker2_rating: 5,
        sentiment_timeline: [{turn: 1, speaker: "Unknown", sentiment: 0, summary: "N/A"}],
    };
    // Support old field names mapping to new
    if (data.customer_sentiment && !data.speaker1_sentiment) data.speaker1_sentiment = data.customer_sentiment;
    if (data.host_sentiment && !data.speaker2_sentiment) data.speaker2_sentiment = data.host_sentiment;
    if (data.customer_rating && !data.speaker1_rating) data.speaker1_rating = data.customer_rating;
    if (data.host_rating && !data.speaker2_rating) data.speaker2_rating = data.host_rating;

    for (const key in defaults) {
        if (!(key in data)) data[key] = defaults[key];
    }
    // Clamp ratings
    data.speaker1_rating = Math.max(1, Math.min(10, parseInt(data.speaker1_rating) || 5));
    data.speaker2_rating = Math.max(0, Math.min(10, parseInt(data.speaker2_rating) || 0));
    // Normalize timeline
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
    resetPipelineSteps();

    try {
        let transcript = '';
        let utterances = [];
        let audioDuration = null;

        // Step 1: Get transcript
        if (hasAudio) {
            activatePipelineStep(0);
            // Audio → AssemblyAI (transcription + speaker diarization)
            const transcriptionResult = await transcribeAudio(audioFile);
            transcript = transcriptionResult.text || '';
            utterances = transcriptionResult.utterances || [];
            audioDuration = transcriptionResult.audio_duration || null;
            if (!transcript.trim()) throw new Error('Transcription returned empty. Try a clearer audio file.');
            completePipelineStep(0);
        } else if (hasTranscriptFile) {
            // Read file content
            transcript = await transcriptFile.text();
        } else {
            transcript = pasteText;
        }

        // Step 2: Speaker Diarization (already done by AssemblyAI for audio)
        activatePipelineStep(1);
        completePipelineStep(1);

        // If we have utterances from AssemblyAI, format transcript with speaker labels for LLM
        let llmTranscript = transcript;
        if (utterances.length > 0) {
            llmTranscript = utterances.map(u => {
                const spk = u.speaker === 'A' ? 'Speaker 1' : 'Speaker 2';
                return spk + ': ' + u.text;
            }).join('\n');
        }

        // Step 3: LLM Analysis (pass speaker-labeled transcript)
        activatePipelineStep(2);
        const results = await analyzeSentiment(llmTranscript, audioDuration);
        results.transcript = transcript;
        results.audio_transcribed = hasAudio;

        // Use AssemblyAI utterances for diarization display (overrides LLM diarization)
        if (utterances.length > 0) {
            results.diarized_transcript = utterances.map(u => ({
                speaker: u.speaker === 'A' ? 'Speaker 1' : 'Speaker 2',
                text: u.text,
            }));
        }
        completePipelineStep(2);

        // Override duration with actual audio duration if available
        if (audioDuration) {
            const mins = Math.floor(audioDuration / 60);
            const secs = Math.round(audioDuration % 60);
            results.duration_estimate = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
        }

        // Step 3: Display
        activatePipelineStep(3);
        updateProcessing('Rendering dashboard...');
        await sleep(500);
        displayResults(results);
        completePipelineStep(3);

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

// Pipeline step visual feedback
function resetPipelineSteps() {
    document.querySelectorAll('.pipeline-step-mini .step-dot').forEach(dot => {
        dot.classList.remove('active', 'completed', 'processing');
    });
}

function activatePipelineStep(index) {
    const dots = document.querySelectorAll('.pipeline-step-mini .step-dot');
    if (dots[index]) {
        dots[index].classList.add('processing');
        dots[index].classList.remove('completed');
    }
}

function completePipelineStep(index) {
    const dots = document.querySelectorAll('.pipeline-step-mini .step-dot');
    if (dots[index]) {
        dots[index].classList.remove('processing');
        dots[index].classList.add('completed');
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== DISPLAY RESULTS =====
function displayResults(data) {
    document.getElementById('dashPlaceholder').style.display = 'none';
    document.getElementById('dashResults').style.display = 'block';

    document.getElementById('metricDuration').textContent = data.duration_estimate || 'N/A';
    document.getElementById('metricCustSentiment').textContent = data.speaker1_sentiment || 'N/A';
    document.getElementById('metricHostSentiment').textContent = data.speaker2_sentiment || 'N/A';
    document.getElementById('metricResolved').textContent = data.issue_resolved || 'N/A';

    document.getElementById('angerTime').textContent = data.anger_timestamp || 'N/A';
    document.getElementById('angerContext').textContent = data.anger_context || 'No anger detected';

    document.getElementById('mainIssue').textContent = data.main_issue || 'N/A';
    document.getElementById('resolutionSummary').textContent = data.resolution_summary || 'N/A';

    const spk1Rating = data.speaker1_rating || 5;
    const spk2Rating = data.speaker2_rating || 0;
    document.getElementById('custRating').textContent = spk1Rating;
    document.getElementById('hostRating').textContent = spk2Rating > 0 ? spk2Rating : 'N/A';
    document.getElementById('custRatingBar').style.width = (spk1Rating * 10) + '%';
    document.getElementById('hostRatingBar').style.width = (spk2Rating > 0 ? spk2Rating * 10 : 0) + '%';

    // Hide Speaker 2 metrics if single speaker
    if (data.speaker_count === 1 || data.speaker2_sentiment === 'N/A') {
        document.getElementById('metricHostSentiment').textContent = 'N/A';
        document.getElementById('hostRating').textContent = 'N/A';
        document.getElementById('hostRatingBar').style.width = '0%';
    }

    // Use diarized transcript if available, otherwise fall back to raw
    if (data.diarized_transcript && data.diarized_transcript.length > 0) {
        document.getElementById('transcriptBox').innerHTML = formatDiarizedTranscript(data.diarized_transcript);
    } else {
        document.getElementById('transcriptBox').innerHTML = formatTranscript(data.transcript || '');
    }

    drawSentimentChart(data.sentiment_timeline || [{turn: 1, speaker: "Unknown", sentiment: 0, summary: "N/A"}]);

    colorSentiment('metricCustSentiment', data.speaker1_sentiment);
    colorSentiment('metricHostSentiment', data.speaker2_sentiment);
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
        const text = turn.text || '';
        const speaker = turn.speaker || '';
        const isFirstSpeaker = speaker === 'Speaker 1' || speaker === 'Speaker A' || speaker === 'A';
        const bgClass = isFirstSpeaker ? 'turn-host' : 'turn-customer';
        const speakerLabel = isFirstSpeaker ? 'Speaker 1' : 'Speaker 2';
        return `<div class="turn diarized-turn ${bgClass}">
            <span class="turn-number">${i + 1}</span>
            <span class="speaker-label">${speakerLabel}:</span>
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
