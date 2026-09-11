/* ============================================================
   CallQC AI — Recording Category Detector
   Pure client-side app: IndexedDB + HLS.js + Web Audio + Gemini
   ============================================================ */

'use strict';

/* ---------- Default Category Chart ---------- */
const DEFAULT_CHART = `Clean Conversation | Dono (Host female + User male) normally baat kar rahe hain, koi violation nahi, call 5 min se zyada
Dull and Unresponsive | Host ka interest low hai, engagement nahi, dull/low-energy jawab
User Did Not Talk | Sirf Host (female) ki awaaz hai, User bilkul nahi bola
Host Engages Properly, but Call Ends | Call 2 min se zyada, dono normal engage, koi violation nahi
Short Calls Without Host's Fault | Call 2 min se kam, dono mein se kisi ka violation nahi
Promoting Other App | Host doosre app ka zikr karti hai ya User ko doosre platform pe baat jaari rakhne kehti hai
Abusing or Indecent Behaviour (Host) | Host rude hai, gaali deti hai, ya indecent behave karti hai
Sexually Explicit | Dono explicit sexual conversation mein hain
Wrong Gender | Call pe dono awaazein male hain
Network Issue | Host ki awaaz 40 sec+ continuously toot-ti/disconnect hoti hai network se
Background Noise | Host ke side se background noise call quality ko kharab karta hai
User's Connection Issues | User ki awaaz 40 sec+ continuously toot-ti/disconnect hoti hai
Host's Voice is too Low or Unclear | Host ki awaaz bahut dheemi/unclear hai, samajhna mushkil
On Another Call / Not Responding | Host kisi aur call pe lagti hai, connected User ko theek se respond nahi karti
Working on Another Platform | Host platform se unrelated activity mein lagi hai (jaise aise gifts ka shukriya jo is platform pe possible nahi)
Host is on Mute | Call 10 sec+ hai aur Host ki awaaz bilkul absent hai
User Inappropriate Behaviour | User Host ko gaali deta hai ya explicit/indecent baat maangta hai
Call Involves Unusual Requests from User | User Host ka phone number maangta hai ya unusual/inappropriate request karta hai
Demographic Issue / Language Issue | Language difference ki wajah se ek-doosre ko samajh nahi pa rahe
Other Language | Call kisi aisi language mein hai jo review scope ke bahar hai
Host Shared Contact No | Host ne apna phone number share kiya
Host Took User's Contact No | Host ne User ka phone number maanga/liya
Video Call Service | Host video call service offer karti hai ya platform ke bahar payment maangti hai
Insta ID Shared | Host ne apni Instagram ID share ki
Host Took User's Insta ID | Host ne User ki Instagram ID maangi/li
Host Shared Other Platform ID | Host ne koi aur external platform ID share ki
Telegram ID Shared | Host ne apni Telegram ID share ki`;

/* ---------- IndexedDB (tagda storage) ---------- */
const DB_NAME = 'callqc_db', DB_VER = 1;
let db = null;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'id' });
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror = () => rej(req.error);
  });
}
function kvGet(k) {
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function kvSet(k, v) {
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
function saveJob(job) {
  return new Promise((res, rej) => {
    const tx = db.transaction('jobs', 'readwrite');
    tx.objectStore('jobs').put(job);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
function getJob(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction('jobs', 'readonly');
    const r = tx.objectStore('jobs').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
function getAllJobs() {
  return new Promise((res, rej) => {
    const tx = db.transaction('jobs', 'readonly');
    const r = tx.objectStore('jobs').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
function toast(msg, ms = 2500) {
  const t = $('toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._tm); t._tm = setTimeout(() => t.style.display = 'none', ms);
}
function log(msg, cls = 'inf') {
  const el = $('log');
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- CSV Parsing (robust, quoted-field safe) ---------- */
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row); }
  return rows;
}
function csvCell(v) {
  v = String(v ?? '');
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(rows) {
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
function findLinkCol(header, sampleRows) {
  // Pehle header naam se dhoondo
  const hdrIdx = header.findIndex(h => /record|link|url|audio/i.test(h || ''));
  if (hdrIdx >= 0) return hdrIdx;
  // Nahi to sample rows mein http link wala column
  for (let c = 0; c < (sampleRows[0]?.length || 0); c++) {
    let hits = 0;
    for (let r = 0; r < Math.min(sampleRows.length, 30); r++) {
      if (/^https?:\/\//i.test((sampleRows[r][c] || '').trim())) hits++;
    }
    if (hits >= Math.min(sampleRows.length, 30) * 0.6) return c;
  }
  return 2; // fallback (aapki sheet mein col index 2 = recordings)
}

/* ---------- Fetch with timeout ---------- */
async function fetchT(url, ms = 30000) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw new Error('Download timeout — link bahut slow hai');
    throw e;
  } finally { clearTimeout(tm); }
}

/* ---------- MPEG-TS demuxer: TS packets se raw AAC/MP3 nikalna ----------
   Section-level parsing (PAT/PMT packets ke across span ho sakti hain) ---------- */
function demuxTs(u8) {
  const PK = 188;
  if (u8.length < PK * 3) throw new Error('TS data bahut chhota hai');
  if (u8[0] !== 0x47) {
    let off = -1;
    for (let i = 0; i < Math.min(PK * 2, u8.length - PK); i++) {
      if (u8[i] === 0x47 && u8[i + PK] === 0x47) { off = i; break; }
    }
    if (off < 0) throw new Error('TS sync byte nahi mila');
    u8 = u8.subarray(off);
  }
  let pmtPid = -1, audioPid = -1, streamType = -1;
  const chunks = [];
  const npk = Math.floor(u8.length / PK);
  // Section assembler for PAT (pid 0) and PMT (once known)
  let patBuf = [], patNeed = -1, pmtBuf = [], pmtNeed = -1;
  function feedSection(bufState, byte) { bufState.push(byte); }
  function tryParsePAT() {
    if (patBuf.length < 4) return;
    if (patNeed < 0) patNeed = 3 + (((patBuf[1] & 0x0F) << 8) | patBuf[2]);
    if (patBuf.length < patNeed) return;
    const sec = patBuf;
    let j = 8; const end = 3 + (((sec[1] & 0x0F) << 8) | sec[2]) - 4;
    while (j + 4 <= end && j + 4 <= sec.length) {
      const progNum = (sec[j] << 8) | sec[j + 1];
      const ppid = ((sec[j + 2] & 0x1F) << 8) | sec[j + 3];
      if (progNum !== 0) { pmtPid = ppid; patBuf = []; patNeed = -1; return; }
      j += 4;
    }
    patBuf = []; patNeed = -1; // network PID only
  }
  function tryParsePMT() {
    if (pmtBuf.length < 4) return;
    if (pmtNeed < 0) pmtNeed = 3 + (((pmtBuf[1] & 0x0F) << 8) | pmtBuf[2]);
    if (pmtBuf.length < pmtNeed) return;
    const sec = pmtBuf;
    const pil = ((sec[10] & 0x0F) << 8) | sec[11];
    let j = 12 + pil;
    const end = Math.min(3 + (((sec[1] & 0x0F) << 8) | sec[2]) - 4, sec.length);
    while (j + 5 <= end) {
      const st = sec[j];
      const epid = ((sec[j + 1] & 0x1F) << 8) | sec[j + 2];
      const eil = ((sec[j + 3] & 0x0F) << 8) | sec[j + 4];
      if (audioPid < 0 && (st === 0x0F || st === 0x11 || st === 0x03 || st === 0x04 || st === 0x81)) {
        audioPid = epid; streamType = st;
      }
      j += 5 + eil;
    }
    pmtBuf = []; pmtNeed = -1;
  }
  for (let i = 0; i < npk; i++) {
    const p = i * PK;
    if (u8[p] !== 0x47) continue;
    const pusi = (u8[p + 1] & 0x40) !== 0;
    const pid = ((u8[p + 1] & 0x1F) << 8) | u8[p + 2];
    const afc = (u8[p + 3] >> 4) & 0x3;
    let idx = p + 4;
    if (afc === 0 || afc === 2) continue;
    if (afc === 3) { idx += 1 + u8[idx]; }
    if (idx >= p + PK) continue;
    const endP = p + PK;
    if (pid === 0) { // PAT
      let s = idx;
      if (pusi) { tryParsePAT(); patBuf = []; patNeed = -1; s = idx + 1 + u8[idx]; }
      for (; s < endP; s++) {
        if (u8[s] === 0xFF && patNeed < 0 && patBuf.length === 0) break; // stuffing
        feedSection(patBuf, u8[s]); tryParsePAT();
        if (pmtPid >= 0 && pusi) break;
      }
    } else if (pmtPid >= 0 && pid === pmtPid) { // PMT
      let s = idx;
      if (pusi) { tryParsePMT(); pmtBuf = []; pmtNeed = -1; s = idx + 1 + u8[idx]; }
      for (; s < endP; s++) {
        if (u8[s] === 0xFF && pmtNeed < 0 && pmtBuf.length === 0) break;
        feedSection(pmtBuf, u8[s]); tryParsePMT();
        if (audioPid >= 0 && pusi) break;
      }
    } else if (audioPid >= 0 && pid === audioPid) { // Audio PES
      let payload = u8.subarray(idx, endP);
      if (pusi && payload.length > 9 && payload[0] === 0 && payload[1] === 0 && payload[2] === 1) {
        payload = payload.subarray(9 + payload[8]); // PES header strip
      }
      if (payload.length) chunks.push(payload);
    }
  }
  if (audioPid < 0) throw new Error('TS mein audio stream nahi mili');
  if (!chunks.length) throw new Error('TS mein audio data nahi mila');
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  const codec = (streamType === 0x03 || streamType === 0x04) ? 'mp3' : 'aac';
  return { data: out, codec };
}

/* ---------- m3u8 → WAV (browser-native, CORS open hai) ---------- */
async function fetchAudioWav(url, onStage) {
  onStage && onStage('stream connect ho raha hai…');
  // 1) Playlist text lao
  const plResp = await fetchT(url);
  if (!plResp.ok) throw new Error('Link ne ' + plResp.status + ' diya (expired/dead link)');
  const plText = await plResp.text();
  if (!plText.includes('#EXTM3U')) throw new Error('Ye m3u8 playlist nahi hai');
  // 2) Segment URLs nikalo
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const segs = [];
  for (const line of plText.split('\n')) {
    const l = line.trim();
    if (l && !l.startsWith('#')) segs.push(/^https?:\/\//i.test(l) ? l : base + l);
  }
  if (!segs.length) throw new Error('Playlist mein koi audio segment nahi mila');
  // 3) Segments download → concat
  onStage && onStage(`${segs.length} audio segments download ho rahe hain…`);
  const bufs = [];
  for (let i = 0; i < segs.length; i++) {
    const r = await fetchT(segs[i]);
    if (!r.ok) throw new Error('Segment ' + (i + 1) + ' download fail (' + r.status + ')');
    bufs.push(new Uint8Array(await r.arrayBuffer()));
  }
  const total = bufs.reduce((a, b) => a + b.byteLength, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { merged.set(b, off); off += b.byteLength; }
  // 4) MPEG-TS demux → AAC/MP3 → decode
  onStage && onStage('audio process ho raha hai…');
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let audioBuf;
  try {
    const demuxed = demuxTs(merged);
    audioBuf = await ctx.decodeAudioData(demuxed.data.buffer.slice(0, demuxed.data.byteLength));
  } catch (e1) {
    // Fallback: shayad TS nahi, direct mp3/aac hai
    try { audioBuf = await ctx.decodeAudioData(merged.buffer.slice(0)); }
    catch (e2) {
      await ctx.close();
      throw new Error('Audio decode fail (' + (e1.message || 'demux') + ')');
    }
  }
  const dur = audioBuf.duration;
  // Lambi calls (>11 min) pe 8kHz — API size limit se bachne ke liye
  const targetSR = dur > 700 ? 8000 : 16000;
  const octx = new OfflineAudioContext(1, Math.ceil(dur * targetSR), targetSR);
  const src = octx.createBufferSource();
  src.buffer = audioBuf; src.connect(octx.destination); src.start(0);
  const rendered = await octx.startRendering();
  await ctx.close();
  const wavBlob = bufferToWav(rendered);
  return { blob: wavBlob, duration: dur };
}
function bufferToWav(audioBuffer) {
  const nCh = 1, sr = audioBuffer.sampleRate, data = audioBuffer.getChannelData(0);
  const len = data.length * 2;
  const buf = new ArrayBuffer(44 + len), v = new DataView(buf);
  const wStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wStr(0, 'RIFF'); v.setUint32(4, 36 + len, true); wStr(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true);
  v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  wStr(36, 'data'); v.setUint32(40, len, true);
  for (let i = 0; i < data.length; i++) {
    let s = Math.max(-1, Math.min(1, data[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

/* ========== MULTI-PROVIDER AI ENGINE ==========
   Jis provider ki bhi key milegi — app usi se kaam karega.
   Gemini: seedha audio sunti hai | Baaki: transcribe -> classify ---------- */
const PROVIDERS = {
  gemini:  { label:'Google Gemini', mode:'direct-audio', hint:'🔑 Free key: aistudio.google.com/apikey → login → Create API Key. Gemini seedha audio sunti hai (sabse aasan).',
             models:['gemini-2.5-flash','gemini-3.5-flash','gemini-3.8-flash'] },
  groq:    { label:'Groq', mode:'transcribe+chat', hint:'🔑 Free key: console.groq.com → API Keys. Bahut fast + free tier 2000 transcriptions/day.',
             base:'https://api.groq.com/openai/v1', stt:'whisper-large-v3-turbo', chat:'llama-3.3-70b-versatile' },
  openai:  { label:'OpenAI', mode:'transcribe+chat', hint:'🔑 Key: platform.openai.com → API keys (paid, card chahiye).',
             base:'https://api.openai.com/v1', stt:'gpt-4o-mini-transcribe', chat:'gpt-4o-mini' },
  mistral: { label:'Mistral', mode:'transcribe+chat', hint:'🔑 Key: console.mistral.ai → API keys.',
             base:'https://api.mistral.ai/v1', stt:'voxtral-mini-latest', chat:'mistral-small-latest' },
  custom:  { label:'Custom', mode:'transcribe+chat', hint:'🛠️ Koi bhi OpenAI-compatible API — base URL + model names neeche daalo.',
             base:'', stt:'whisper-large-v3-turbo', chat:'llama-3.3-70b-versatile' }
};
async function getCfg() {
  const p = (await kvGet('ai_provider')) || 'gemini';
  return {
    provider: p,
    key: (await kvGet('api_key')) || '',
    customBase: (await kvGet('custom_base')) || '',
    stt: (await kvGet('stt_model')) || '',
    chat: (await kvGet('chat_model')) || ''
  };
}

/* ---- WAV blob -> File (multipart ke liye) ---- */
function blobToFile(blob, name) { return new File([blob], name, { type: 'audio/wav' }); }

/* ---- Prompts ---- */
function directPrompt(chartText) {
  return `You are a strict call-quality moderation AI for a social calling app. Listen to this audio call recording between a Host and a User.

Classify it into EXACTLY ONE category from this chart (format: CategoryName | rule):
${chartText}

IMPORTANT RULES:
- Reply in this EXACT format, nothing else:
CATEGORY: <exact category name from chart>
CONFIDENCE: <high/medium/low>
REASON: <one short line in Hinglish explaining what you heard>
- If audio is silent/unintelligible/no voices: pick the closest matching category with low confidence.
- Match the category name EXACTLY as written in the chart.`;
}
function transcriptPrompt(chartText, transcript) {
  return `You are a strict call-quality moderation AI for a social calling app. Below is the auto-generated transcript of a call between a Host (female) and a User.

TRANSCRIPT:
"""
${transcript}
"""

Classify this call into EXACTLY ONE category from this chart (format: CategoryName | rule):
${chartText}

IMPORTANT RULES:
- Reply in this EXACT format, nothing else:
CATEGORY: <exact category name from chart>
CONFIDENCE: <high/medium/low>
REASON: <one short line in Hinglish>
- Transcript mein jo nahi sunai diya (silence/gap) ho to us hisaab se best category chuno, confidence low karo.
- Match the category name EXACTLY as written in the chart.`;
}

/* ---- Gemini: direct audio classification ---- */
async function geminiClassify(cfg, wavBlob, chartText) {
  const b64 = await blobToBase64(wavBlob);
  const candidates = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.8-flash'];
  const custom = (cfg.stt || '').trim();
  const models = custom ? [custom, ...candidates] : candidates;
  let lastErr = null;
  for (const m of models) {
    try { return await geminiCall(cfg.key, b64, chartText, m); }
    catch (e) { if (e.message === 'MODEL_NOT_FOUND') { lastErr = e; continue; } throw e; }
  }
  throw lastErr || new Error('Koi Gemini model available nahi');
}
async function geminiCall(key, wavBase64, chartText, model) {
  const body = {
    contents: [{ parts: [ { text: directPrompt(chartText) }, { inline_data: { mime_type: 'audio/wav', data: wavBase64 } } ] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
  };
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    if (resp.status === 429) throw new Error('RATE_LIMIT');
    if (resp.status === 400 && /api.?key/i.test(errTxt)) throw new Error('API key galat hai — Settings mein check karo');
    if (resp.status === 403 && /api.?key|permission|denied/i.test(errTxt)) throw new Error('API key invalid/blocked hai — Settings mein check karo');
    if (resp.status === 404) throw new Error('MODEL_NOT_FOUND');
    throw new Error('Gemini error ' + resp.status + ': ' + errTxt.slice(0, 90));
  }
  const json = await resp.json();
  const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseAIReply(txt, chartText);
}

/* ---- OpenAI-style transcription (Groq / OpenAI / Mistral / Custom) ---- */
async function oaiTranscribe(cfg, wavBlob) {
  const p = PROVIDERS[cfg.provider];
  const base = (cfg.provider === 'custom' ? cfg.customBase : p.base).replace(/\/$/, '');
  if (!base) throw new Error('Custom provider ka Base URL Settings mein daalo');
  const model = (cfg.stt || p.stt || '').trim();
  if (!model) throw new Error('Transcription model ka naam Settings mein daalo');
  const fd = new FormData();
  fd.append('file', blobToFile(wavBlob, 'recording.wav'));
  fd.append('model', model);
  const resp = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + cfg.key }, body: fd });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    if (resp.status === 429) throw new Error('RATE_LIMIT');
    if (resp.status === 401 || resp.status === 403) throw new Error('API key galat/invalid hai — Settings mein check karo');
    if (resp.status === 404) throw new Error('Transcription model nahi mila (' + model + ') — Settings mein model naam check karo');
    if (resp.status === 413) throw new Error('Audio file bahut badi hai is provider ke liye');
    throw new Error('Transcription error ' + resp.status + ': ' + errTxt.slice(0, 90));
  }
  const json = await resp.json().catch(() => ({}));
  const txt = (json.text || '').trim();
  if (!txt) throw new Error('Transcription khaali aayi — audio mein awaaz nahi ya model ne nahi suna');
  return txt;
}

/* ---- OpenAI-style chat classification ---- */
async function oaiClassify(cfg, transcript, chartText) {
  const p = PROVIDERS[cfg.provider];
  const base = (cfg.provider === 'custom' ? cfg.customBase : p.base).replace(/\/$/, '');
  const model = (cfg.chat || p.chat || '').trim();
  if (!model) throw new Error('Chat model ka naam Settings mein daalo');
  const body = {
    model,
    temperature: 0.1, max_tokens: 200,
    messages: [{ role: 'user', content: transcriptPrompt(chartText, transcript) }]
  };
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify(body) });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    if (resp.status === 429) throw new Error('RATE_LIMIT');
    if (resp.status === 401 || resp.status === 403) throw new Error('API key galat/invalid hai — Settings mein check karo');
    if (resp.status === 404) throw new Error('Chat model nahi mila (' + model + ') — Settings mein model naam check karo');
    throw new Error('Chat error ' + resp.status + ': ' + errTxt.slice(0, 90));
  }
  const json = await resp.json();
  const txt = json?.choices?.[0]?.message?.content || '';
  return parseAIReply(txt, chartText);
}

/* ---- AI reply parse + chart fuzzy-match ---- */
function parseAIReply(txt, chartText) {
  const catM = txt.match(/CATEGORY:\s*(.+)/i);
  const confM = txt.match(/CONFIDENCE:\s*(\w+)/i);
  const reaM = txt.match(/REASON:\s*(.+)/i);
  if (!catM) throw new Error('AI ka jawab samajh nahi aaya: ' + txt.slice(0, 80));
  const chartCats = chartText.split('\n').map(l => l.split('|')[0].trim()).filter(Boolean);
  let cat = catM[1].trim().replace(/[*_#"']/g, '').replace(/[.。]$/, '');
  const exact = chartCats.find(c => c.toLowerCase() === cat.toLowerCase());
  if (exact) cat = exact;
  else {
    const close = chartCats.find(c => c.toLowerCase().includes(cat.toLowerCase()) || cat.toLowerCase().includes(c.toLowerCase()));
    if (close) cat = close;
  }
  return { category: cat, confidence: (confM ? confM[1] : 'medium').toLowerCase(), reason: reaM ? reaM[1].trim() : '' };
}

/* ---- MASTER: provider ke hisaab se classify ---- */
async function classifyAny(cfg, wavBlob, chartText) {
  if (cfg.provider === 'gemini') return geminiClassify(cfg, wavBlob, chartText);
  const transcript = await oaiTranscribe(cfg, wavBlob);
  return oaiClassify(cfg, transcript, chartText);
}

/* ---------- App State ---------- */
let sheet = null;        // { name, header:[], rows:[[]], linkCol, catCol, confCol, reasonCol }
let job = null;          // { id, sheetName, startRow, endRow, items:[{row,url,status,category,confidence,reason,error}], createdAt }
let running = false, paused = false;

/* ---------- UI: Tabs ---------- */
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $(t.dataset.page).classList.add('active');
    if (t.dataset.page === 'page-results') renderResults();
  });
});

/* ---------- UI: CSV Upload ---------- */
$('dropzone').addEventListener('click', () => $('csvFile').click());
$('dropzone').addEventListener('dragover', e => { e.preventDefault(); $('dropzone').classList.add('over'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('over'));
$('dropzone').addEventListener('drop', e => {
  e.preventDefault(); $('dropzone').classList.remove('over');
  if (e.dataTransfer.files[0]) loadCSVFile(e.dataTransfer.files[0]);
});
$('csvFile').addEventListener('change', e => {
  if (e.target.files[0]) loadCSVFile(e.target.files[0]);
});

async function loadCSVFile(file) {
  toast('📄 Sheet padhi ja rahi hai…');
  const text = await file.text();
  const all = parseCSV(text);
  if (all.length < 2) { toast('❌ Sheet khaali hai ya CSV format nahi hai'); return; }
  const header = all[0];
  const dataRows = all.slice(1);
  const linkCol = findLinkCol(header, dataRows);
  sheet = { name: file.name, header, rows: dataRows, linkCol };
  await kvSet('current_sheet', sheet);
  // Category output columns ka index decide karo (existing header ke baad append)
  sheet.catCol = header.length;
  sheet.confCol = header.length + 1;
  sheet.reasonCol = header.length + 2;
  showSheetInfo();
  toast(`✅ ${dataRows.length} rows load ho gayi`);
  log(`Sheet load: ${file.name} — ${dataRows.length} rows, link column #${linkCol + 1} (${header[linkCol] || 'un-nammed'})`, 'ok');
}

function showSheetInfo() {
  if (!sheet) return;
  $('sheetInfoCard').style.display = 'block';
  $('rangeCard').style.display = 'block';
  const n = sheet.rows.length;
  $('sheetInfo').innerHTML =
    `<span class="chip">📄 ${esc(sheet.name)}</span>
     <span class="chip">🧮 ${n} data rows</span>
     <span class="chip">🔗 Links: column "${esc(sheet.header[sheet.linkCol] || ('#' + (sheet.linkCol + 1)))}"</span>`;
  $('endRow').value = Math.min(n, 200);
  $('startRow').value = 1;
  $('startRow').max = n; $('endRow').max = n;
  $('rangeHint').textContent = `Sheet mein total ${n} data rows hain (1 se ${n}). Aap jahan se jahan tak karna chahte ho wo range dalo.`;
}

/* ---------- UI: Processing ---------- */
$('startBtn').addEventListener('click', startProcessing);
$('pauseBtn').addEventListener('click', () => {
  if (running && !paused) { paused = true; $('pauseBtn').textContent = '▶️ Resume'; log('⏸️ Pause — current item finish hone ke baad rukega', 'inf'); }
  else if (running && paused) { paused = false; $('pauseBtn').textContent = '⏸️ Pause'; log('▶️ Resumed', 'inf'); }
});
$('clearLogBtn').addEventListener('click', () => { $('log').innerHTML = ''; });

async function startProcessing() {
  const cfg = await getCfg();
  if (!cfg.key) { toast('❌ Pehle Settings mein API key dalo!'); switchTab('page-settings'); return; }
  if (!sheet) { toast('❌ Pehle CSV sheet upload karo'); return; }
  const chart = (await kvGet('cat_chart')) || DEFAULT_CHART;
  const s = parseInt($('startRow').value), e = parseInt($('endRow').value);
  if (!s || !e || s < 1 || e > sheet.rows.length || s > e) {
    toast(`❌ Range sahi dalo (1 se ${sheet.rows.length} ke beech)`); return;
  }
  // Resume check: isi sheet+range ka purana job hai?
  const oldJobs = await getAllJobs();
  const existing = oldJobs.find(j => j.sheetName === sheet.name && j.startRow === s && j.endRow === e);
  if (existing && existing.items.some(i => i.status === 'pending' || i.status === 'failed')) {
    job = existing;
    // Failed items ko retry ke liye pending karo (done items ko touch nahi — API calls bachti hain)
    let retryC = 0;
    job.items.forEach(i => { if (i.status === 'failed') { i.status = 'pending'; i.error = ''; retryC++; } });
    const doneC = job.items.filter(i => i.status === 'done').length;
    log(`♻️ Purana job resume: ${doneC}/${job.items.length} pehle se done${retryC ? `, ${retryC} failed dobara try honge` : ''}`, 'ok');
  } else {
    job = {
      id: 'job_' + Date.now(), sheetName: sheet.name, startRow: s, endRow: e, createdAt: Date.now(),
      items: []
    };
    for (let r = s - 1; r < e; r++) {
      const url = (sheet.rows[r][sheet.linkCol] || '').trim();
      job.items.push({
        row: r + 1, url,
        status: /^https?:\/\//i.test(url) ? 'pending' : 'failed',
        category: '', confidence: '', reason: '',
        error: /^https?:\/\//i.test(url) ? '' : 'Link nahi hai / galat format'
      });
    }
  }
  await saveJob(job);
  running = true; paused = false;
  $('progressCard').style.display = 'block';
  $('startBtn').disabled = true;
  $('pauseBtn').textContent = '⏸️ Pause';
  log(`🚀 Processing shuru: row ${s} se ${e} tak (${job.items.length} items) — AI: ${PROVIDERS[cfg.provider].label}`, 'ok');
  processLoop(cfg, chart);
}

async function processLoop(cfg, chart) {
  const conc = parseInt((await kvGet('concurrency')) || '2');
  const pending = () => job.items.filter(i => i.status === 'pending');
  const workers = [];
  for (let w = 0; w < conc; w++) workers.push(worker(w + 1, cfg, chart));
  await Promise.all(workers);
  // Sab khatam
  running = false;
  $('startBtn').disabled = false;
  $('pauseBtn').textContent = '⏸️ Pause';
  const doneC = job.items.filter(i => i.status === 'done').length;
  const failC = job.items.filter(i => i.status === 'failed').length;
  log(`🏁 Batch complete! ✅ ${doneC} done, ❌ ${failC} failed`, doneC > 0 ? 'ok' : 'err');
  toast(`🏁 Ho gaya! ✅ ${doneC} | ❌ ${failC}`);
  updateStats();
  renderResults();
}

async function worker(wnum, cfg, chart) {
  while (true) {
    // pause handling
    while (paused && running) await sleep(500);
    if (!running) return;
    const item = job.items.find(i => i.status === 'pending');
    if (!item) return; // sab ho gaya
    item.status = 'running';
    updateStats();
    $('curItem').textContent = `🎧 Worker ${wnum}: Row ${item.row} process ho rahi hai…`;
    log(`▶️ Row ${item.row}: download shuru`, 'inf');
    try {
      const { blob, duration } = await fetchAudioWav(item.url, st => {
        $('curItem').textContent = `🎧 Worker ${wnum}: Row ${item.row} — ${st}`;
      });
      log(`   Row ${item.row}: audio mila (${duration.toFixed(0)} sec, ${(blob.size / 1024).toFixed(0)} KB)`, 'inf');
      $('curItem').textContent = `🤖 Worker ${wnum}: Row ${item.row} — AI ${cfg.provider === 'gemini' ? 'sun raha' : 'transcribe kar raha'} hai…`;
      let result = null, tries = 0;
      while (tries < 3) {
        try { result = await classifyAny(cfg, blob, chart); break; }
        catch (e) {
          if (e.message === 'RATE_LIMIT') {
            tries++;
            log(`   Row ${item.row}: rate limit — ${tries * 20} sec wait`, 'err');
            await sleep(tries * 20000);
          } else throw e;
        }
      }
      if (!result) throw new Error('Rate limit — baad mein resume karo');
      item.status = 'done';
      item.category = result.category;
      item.confidence = result.confidence;
      item.reason = result.reason;
      log(`✅ Row ${item.row}: ${result.category} (${result.confidence})`, 'ok');
    } catch (e) {
      item.status = 'failed';
      item.error = e.message || 'Unknown error';
      log(`❌ Row ${item.row}: ${e.message}`, 'err');
    }
    await saveJob(job);
    updateStats();
    await sleep(800); // gentle pacing between items
  }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function updateStats() {
  if (!job) return;
  const total = job.items.length;
  const done = job.items.filter(i => i.status === 'done').length;
  const fail = job.items.filter(i => i.status === 'failed').length;
  const left = job.items.filter(i => i.status === 'pending' || i.status === 'running').length;
  $('stTotal').textContent = total;
  $('stDone').textContent = done;
  $('stFail').textContent = fail;
  $('stLeft').textContent = left;
  const pct = total ? Math.round(((done + fail) / total) * 100) : 0;
  $('pbar').style.width = pct + '%';
  $('ptxt').textContent = pct + '% (' + (done + fail) + '/' + total + ')';
}

/* ---------- UI: Results ---------- */
function renderResults() {
  const wrap = $('resList');
  if (!job) { wrap.innerHTML = '<div class="hint">Abhi koi job nahi. Home pe jaake sheet upload karke processing shuru karo.</div>'; $('resSummary').innerHTML = ''; return; }
  const q = ($('resSearch').value || '').toLowerCase();
  const f = $('resFilter').value;
  const list = job.items.filter(i => {
    const st = i.status === 'running' ? 'pending' : i.status;
    if (f && st !== f) return false;
    if (q && !(String(i.row).includes(q) || (i.category || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const done = job.items.filter(i => i.status === 'done').length;
  const fail = job.items.filter(i => i.status === 'failed').length;
  const pend = job.items.length - done - fail;
  $('resSummary').innerHTML =
    `<span class="pill pill-done">✅ ${done} categorized</span>
     <span class="pill pill-fail">❌ ${fail} failed</span>
     <span class="pill pill-wait">⏳ ${pend} pending</span>`;
  $('resCount').textContent = `(${list.length})`;
  wrap.innerHTML = list.slice(0, 400).map(i => {
    let pill;
    if (i.status === 'done') pill = `<span class="pill pill-done">${esc(i.confidence || 'done')}</span>`;
    else if (i.status === 'failed') pill = `<span class="pill pill-fail">fail</span>`;
    else if (i.status === 'running') pill = `<span class="pill pill-run">running…</span>`;
    else pill = `<span class="pill pill-wait">wait</span>`;
    const main = i.status === 'done'
      ? `<b>${esc(i.category)}</b>${i.reason ? ' — ' + esc(i.reason) : ''}`
      : i.status === 'failed' ? `<span style="color:#ff7675">${esc(i.error)}</span>` : 'Pending…';
    return `<div class="result-row"><span class="rnum">#${i.row}</span><span class="rcat">${main}</span>${pill}</div>`;
  }).join('') || '<div class="hint">Is filter mein kuch nahi mila.</div>';
}
$('resSearch').addEventListener('input', renderResults);
$('resFilter').addEventListener('change', renderResults);

/* ---------- Downloads ---------- */
$('dlFull').addEventListener('click', () => {
  if (!job || !sheet) { toast('❌ Pehle kuch process karo'); return; }
  const header = [...sheet.header];
  while (header.length < sheet.catCol) header.push('');
  header[sheet.catCol] = 'AI Category';
  header[sheet.confCol] = 'AI Confidence';
  header[sheet.reasonCol] = 'AI Reason';
  const out = [header];
  const byRow = {};
  job.items.forEach(i => byRow[i.row] = i);
  sheet.rows.forEach((r, idx) => {
    const rowNum = idx + 1;
    const row = [...r];
    while (row.length < sheet.catCol) row.push('');
    const it = byRow[rowNum];
    if (it && it.status === 'done') {
      row[sheet.catCol] = it.category;
      row[sheet.confCol] = it.confidence;
      row[sheet.reasonCol] = it.reason;
    } else if (it && it.status === 'failed') {
      row[sheet.catCol] = 'FAILED: ' + it.error;
      row[sheet.confCol] = '';
      row[sheet.reasonCol] = '';
    }
    out.push(row);
  });
  downloadBlob(new Blob([toCSV(out)], { type: 'text/csv' }),
    sheet.name.replace(/\.csv$/i, '') + '_categorized.csv');
  toast('⬇️ Full CSV download ho gayi');
});
$('dlFailed').addEventListener('click', () => {
  if (!job) { toast('❌ Koi job nahi'); return; }
  const fails = job.items.filter(i => i.status === 'failed');
  if (!fails.length) { toast('✅ Koi failed item nahi hai!'); return; }
  const out = [['Row', 'Recording Link', 'Fail Reason']];
  fails.forEach(i => out.push([i.row, i.url, i.error]));
  downloadBlob(new Blob([toCSV(out)], { type: 'text/csv' }), 'failed_recordings.csv');
  toast('⬇️ Failed list download ho gayi');
});
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

/* ---------- Settings (Multi-Provider) ---------- */
function applyProviderUI(p) {
  const P = PROVIDERS[p];
  $('providerHint').textContent = P.hint;
  $('customFields').style.display = (p === 'custom') ? 'block' : 'none';
  // Gemini: seedha audio — sirf 1 model box. Baaki: transcribe + chat dono.
  if (P.mode === 'direct-audio') {
    $('sttLabel').textContent = 'Model (khali chhodo = auto best) — jaise gemini-2.5-flash';
    $('chatLabel').style.display = 'none'; $('chatModel').style.display = 'none';
    $('sttModel').placeholder = P.models[0];
  } else {
    $('sttLabel').textContent = 'Transcription Model (audio → text)';
    $('chatLabel').style.display = 'block'; $('chatModel').style.display = 'block';
    $('sttModel').placeholder = P.stt; $('chatModel').placeholder = P.chat;
  }
}
$('provider').addEventListener('change', () => applyProviderUI($('provider').value));

$('saveKey').addEventListener('click', async () => {
  const k = $('apiKey').value.trim();
  if (!k) { toast('❌ Key paste karo pehle'); return; }
  const p = $('provider').value;
  if (p === 'custom' && !$('customBase').value.trim()) { toast('❌ Custom provider ka Base URL daalo'); return; }
  await kvSet('ai_provider', p);
  await kvSet('api_key', k);
  await kvSet('custom_base', $('customBase').value.trim());
  await kvSet('stt_model', $('sttModel').value.trim());
  await kvSet('chat_model', $('chatModel').value.trim());
  $('keyStatus').innerHTML = '<span class="keyok">✅ Settings save ho gayi (' + PROVIDERS[p].label + ')</span>';
  toast('✅ Save ho gaya — ' + PROVIDERS[p].label);
});

$('testKey').addEventListener('click', async () => {
  // Pehle current UI values save kar lo taaki test wahi use kare
  const k = $('apiKey').value.trim() || (await kvGet('api_key')) || '';
  if (!k) { toast('❌ Pehle key dalo'); return; }
  await kvSet('ai_provider', $('provider').value);
  await kvSet('api_key', k);
  await kvSet('custom_base', $('customBase').value.trim());
  await kvSet('stt_model', $('sttModel').value.trim());
  await kvSet('chat_model', $('chatModel').value.trim());
  const cfg = await getCfg();
  $('keyStatus').innerHTML = '<span class="inf">🧪 Testing… (' + PROVIDERS[cfg.provider].label + ')</span>';
  try {
    if (cfg.provider === 'gemini') {
      let ok = false, lastCode = 0, model404 = 0;
      const custom = (cfg.stt || '').trim();
      const models = custom ? [custom, ...PROVIDERS.gemini.models] : PROVIDERS.gemini.models;
      for (const m of models) {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(k)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }], generationConfig: { maxOutputTokens: 5 } })
        });
        lastCode = resp.status;
        if (resp.ok) { ok = true; break; }
        if (resp.status === 404) { model404++; continue; }
        break;
      }
      if (ok) $('keyStatus').innerHTML = '<span class="keyok">✅ Key kaam kar rahi hai! (' + PROVIDERS.gemini.label + ')</span>';
      else if (model404 === models.length) $('keyStatus').innerHTML = '<span class="keybad">❌ Model available nahi (404) — model naam check karo</span>';
      else $('keyStatus').innerHTML = `<span class="keybad">❌ Key fail (${lastCode}) — key dobara check karo</span>`;
    } else {
      // OpenAI-style providers: chat model se test
      const p = PROVIDERS[cfg.provider];
      const base = (cfg.provider === 'custom' ? cfg.customBase : p.base).replace(/\/$/, '');
      if (!base) { $('keyStatus').innerHTML = '<span class="keybad">❌ Base URL daalo</span>'; return; }
      const model = (cfg.chat || p.chat || '').trim();
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] })
      });
      if (resp.ok) $('keyStatus').innerHTML = '<span class="keyok">✅ Key kaam kar rahi hai! (' + p.label + ')</span>';
      else {
        const t = await resp.text().catch(() => '');
        $('keyStatus').innerHTML = `<span class="keybad">❌ Fail (${resp.status}) — ${t.slice(0, 60) || 'key/model check karo'}</span>`;
      }
    }
  } catch (e) { $('keyStatus').innerHTML = '<span class="keybad">❌ Network error — internet check karo</span>'; }
});
$('concurrency').addEventListener('change', async () => {
  await kvSet('concurrency', $('concurrency').value);
  toast('⚡ Speed setting saved');
});
$('saveChart').addEventListener('click', async () => {
  const t = $('catChart').value.trim();
  if (!t) { toast('❌ Chart khaali nahi ho sakta'); return; }
  await kvSet('cat_chart', t);
  toast('💾 Category chart saved');
});
$('resetChart').addEventListener('click', async () => {
  $('catChart').value = DEFAULT_CHART;
  await kvSet('cat_chart', DEFAULT_CHART);
  toast('↩️ Default chart wapas aa gaya');
});
$('wipeBtn').addEventListener('click', async () => {
  if (!confirm('Pakka? Saari sheets aur results delete ho jayenge (API key aur chart rahenge).')) return;
  await new Promise(res => { const tx = db.transaction('jobs', 'readwrite'); tx.objectStore('jobs').clear(); tx.oncomplete = res; });
  await kvSet('current_sheet', null);
  sheet = null; job = null;
  $('sheetInfoCard').style.display = 'none';
  $('rangeCard').style.display = 'none';
  $('progressCard').style.display = 'none';
  updateStorageInfo();
  toast('🗑️ Saara data delete ho gaya');
});
function switchTab(pid) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.page === pid));
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === pid));
}
async function updateStorageInfo() {
  try {
    const est = await navigator.storage.estimate();
    $('storageInfo').textContent = `Storage use: ${((est.usage || 0) / 1024 / 1024).toFixed(1)} MB`;
  } catch (e) { $('storageInfo').textContent = ''; }
}

/* ---------- Init: restore state ---------- */
(async function init() {
  await openDB();
  // Multi-provider settings restore (purani 'gemini_key' se migrate bhi karo)
  let prov = (await kvGet('ai_provider')) || 'gemini';
  let k = (await kvGet('api_key')) || '';
  if (!k) { const old = await kvGet('gemini_key'); if (old) { k = old; await kvSet('api_key', old); } }
  $('provider').value = prov;
  applyProviderUI(prov);
  if (k) { $('apiKey').value = k; $('keyStatus').innerHTML = '<span class="keyok">✅ Key saved hai (' + PROVIDERS[prov].label + ')</span>'; }
  const cb = await kvGet('custom_base'); if (cb) $('customBase').value = cb;
  const sm = await kvGet('stt_model'); if (sm) $('sttModel').value = sm;
  const cm = await kvGet('chat_model'); if (cm) $('chatModel').value = cm;
  const ch = await kvGet('cat_chart');
  $('catChart').value = ch || DEFAULT_CHART;
  const conc = await kvGet('concurrency');
  if (conc) $('concurrency').value = conc;
  const s = await kvGet('current_sheet');
  if (s && s.rows) { sheet = s; showSheetInfo(); log('♻️ Pichli sheet restore ho gayi', 'ok'); }
  // Resume incomplete job if same sheet+range found (auto-show)
  const jobs = await getAllJobs();
  const incomplete = jobs.sort((a, b) => b.createdAt - a.createdAt)
    .find(j => j.items.some(i => i.status === 'pending' || i.status === 'running'));
  if (incomplete) {
    incomplete.items.forEach(i => { if (i.status === 'running') i.status = 'pending'; });
    await saveJob(incomplete);
    job = incomplete;
    $('progressCard').style.display = 'block';
    updateStats();
    log('📌 Ek incomplete job mili — same range se Start dabao to resume hoga', 'inf');
  }
  updateStorageInfo();
  // PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
