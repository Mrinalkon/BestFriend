// ============================================================
//  AI Best Friend — app.js
//  Voice → Backend (Claude) → TTS → Speaker
// ============================================================

// Register Service Worker (PWA support)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// --- State ---
let profile = null;
let history = [];
let isRecording = false;
let isSpeaking = false;
let recognition = null;
let currentUtterance = null;

// --- DOM Refs ---
const onboarding   = () => document.getElementById('onboarding');
const appEl        = () => document.getElementById('app');
const orb          = () => document.getElementById('orb');
const statusLabel  = () => document.getElementById('status-label');
const messageBubble = () => document.getElementById('message-bubble');
const btnMic       = () => document.getElementById('btn-mic');
const friendNameEl = () => document.getElementById('friend-name');
const profileAvatar = () => document.getElementById('profile-avatar');
const profileLabel = () => document.getElementById('profile-label');
const msgCount     = () => document.getElementById('msg-count');
const toast        = () => document.getElementById('toast');

// ============================================================
//  ONBOARDING
// ============================================================
function startApp() {
  const name       = document.getElementById('inp-name').value.trim();
  const age        = document.getElementById('inp-age').value.trim();
  const gender     = document.getElementById('inp-gender').value;
  const friendName = document.getElementById('inp-friend').value.trim() || 'Alex';
  const apiKey     = document.getElementById('inp-apikey').value.trim();

  if (!name)   { showToast('Please enter your name 😊', 'error'); return; }
  if (!age || parseInt(age) < 5 || parseInt(age) > 99) { showToast('Please enter a valid age (5–99)', 'error'); return; }
  if (!apiKey) { showToast('Please enter your Anthropic API key 🔑', 'error'); return; }

  profile = { name, age: parseInt(age), gender, friendName };

  // Save API key to session (send to server for this session)
  window._apiKey = apiKey;

  // Update UI
  friendNameEl().textContent = friendName;
  profileAvatar().textContent = name.charAt(0).toUpperCase();
  profileLabel().textContent = `${name}, ${age}`;

  // Transition
  onboarding().classList.add('hidden');
  
  // --- iOS Sound Unlock (CRITICAL) ---
  // iOS requires a user-initiated interaction to "unlock" speech synthesis.
  // We play a tiny silent utterance now so the app has permission to speak later.
  const unlockUtterance = new SpeechSynthesisUtterance(" ");
  unlockUtterance.volume = 0;
  window.speechSynthesis.speak(unlockUtterance);

  setTimeout(() => {
    appEl().classList.add('visible');
    greetUser();
  }, 400);
}

function goBack() {
  stopSpeaking();
  appEl().classList.remove('visible');
  onboarding().classList.remove('hidden');
}

// ============================================================
//  GREETING
// ============================================================
async function greetUser() {
  const { name, age, friendName } = profile;
  let greeting = '';

  if (age <= 12)       greeting = `Hey ${name}! I'm ${friendName}! I am SO excited to finally talk to you! What's been happening?!`;
  else if (age <= 19)  greeting = `Yooo ${name}! It's ${friendName}. What's good? Spill.`;
  else if (age <= 35)  greeting = `Hey ${name}! ${friendName} here. What's going on with you today?`;
  else if (age <= 55)  greeting = `Hey ${name}, ${friendName} here. Good to hear from you. How's your day been?`;
  else                 greeting = `Hello ${name}, it's ${friendName}. So lovely to chat with you. How are you feeling today?`;

  await speakAndDisplay(greeting, true);
}

// ============================================================
//  MICROPHONE (Web Speech API)
// ============================================================
function toggleMic() {
  if (isSpeaking) {
    stopSpeaking();
    return;
  }
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
    showToast('Speech recognition not supported. Use Google Chrome.', 'error');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    setOrbState('listening');
    setStatus('Listening...', 'listening');
    btnMic().classList.add('recording');
    btnMic().textContent = '⏹️';
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map(r => r[0].transcript).join('');

    if (e.results[0].isFinal) {
      stopRecording();
      if (transcript.trim()) {
        sendMessage(transcript.trim());
      }
    }
  };

  recognition.onerror = (e) => {
    isRecording = false;
    setOrbState('idle');
    setStatus('Tap the mic to start talking');
    btnMic().classList.remove('recording');
    btnMic().textContent = '🎤';
    if (e.error !== 'aborted') showToast('Mic error: ' + e.error, 'error');
  };

  recognition.onend = () => {
    isRecording = false;
    btnMic().classList.remove('recording');
    btnMic().textContent = '🎤';
  };

  recognition.start();
}

function stopRecording() {
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
  isRecording = false;
  btnMic().classList.remove('recording');
  btnMic().textContent = '🎤';
}

// ============================================================
//  CHAT — Send to backend
// ============================================================
async function sendMessage(text) {
  setOrbState('thinking');
  setStatus('Thinking...', 'thinking');
  showBubble(`You: "${text}"`);

  history.push({ role: 'user', content: text });

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': window._apiKey || ''
      },
      body: JSON.stringify({
        message: text,
        profile,
        history: history.slice(0, -1),    // last N turns, without the latest (already included)
        apiKey: window._apiKey
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      const msg = data.message || data.error || 'Something went wrong';
      showToast(msg, 'error');
      setOrbState('idle');
      setStatus('Tap the mic to start talking');
      return;
    }

    const reply = data.reply;
    history.push({ role: 'assistant', content: reply });
    msgCount().textContent = Math.floor(history.length / 2);

    await speakAndDisplay(reply);

  } catch (err) {
    console.error(err);
    showToast('Network error. Is the server running?', 'error');
    setOrbState('idle');
    setStatus('Tap the mic to start talking');
  }
}

// ============================================================
//  TTS — Browser Web Speech Synthesis
// ============================================================
async function speakAndDisplay(text, isGreeting = false) {
  showBubble(text);
  setOrbState('speaking');
  setStatus('Speaking...', 'speaking');

  // Try ElevenLabs first if available
  if (await tryElevenLabs(text)) return;

  // Fallback: browser TTS
  browserSpeak(text);
}

function browserSpeak(text) {
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  currentUtterance = utterance;

  // Try to find a natural-sounding voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Daniel')) && v.lang.startsWith('en')
  ) || voices.find(v => v.lang.startsWith('en'));

  if (preferred) utterance.voice = preferred;

  const age = profile?.age || 25;
  utterance.rate  = age <= 12 ? 1.1 : age >= 60 ? 0.85 : 1.0;
  utterance.pitch = age <= 12 ? 1.3 : age >= 60 ? 0.9 : 1.05;
  utterance.volume = 1;

  utterance.onstart = () => { isSpeaking = true; };
  utterance.onend = () => {
    isSpeaking = false;
    currentUtterance = null;
    setOrbState('idle');
    setStatus('Tap the mic to start talking');
    btnMic().textContent = '🎤';
  };
  utterance.onerror = () => {
    isSpeaking = false;
    setOrbState('idle');
    setStatus('Tap the mic to start talking');
  };

  window.speechSynthesis.speak(utterance);
}

async function tryElevenLabs(text) {
  try {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!resp.ok) return false;

    const blob = await resp.blob();
    if (blob.size < 100) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    isSpeaking = true;
    audio.play();
    audio.onended = () => {
      isSpeaking = false;
      URL.revokeObjectURL(url);
      setOrbState('idle');
      setStatus('Tap the mic to start talking');
      btnMic().textContent = '🎤';
    };

    return true;
  } catch {
    return false;
  }
}

function stopSpeaking() {
  window.speechSynthesis.cancel();
  isSpeaking = false;
  setOrbState('idle');
  setStatus('Tap the mic to start talking');
  btnMic().textContent = '🎤';
}

// ============================================================
//  TYPE MODE
// ============================================================
let typePanelVisible = false;
function typeMode() {
  typePanelVisible = !typePanelVisible;
  const panel = document.getElementById('type-panel');
  const hint  = document.getElementById('hint-bar');
  panel.style.display = typePanelVisible ? 'flex' : 'none';
  panel.style.flexDirection = 'column';
  if (hint) hint.textContent = typePanelVisible
    ? 'Type your message above and press Send (or Enter)'
    : 'Hold Space to talk · Esc to stop';
  if (typePanelVisible) {
    setTimeout(() => document.getElementById('type-input').focus(), 100);
  }
}

function sendTyped() {
  const inp = document.getElementById('type-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  sendMessage(text);
}

// ============================================================
//  HISTORY
// ============================================================
function clearHistory() {
  history = [];
  msgCount().textContent = '0';
  hideBubble();
  showToast('Conversation cleared 🗑️', '');
  stopSpeaking();
  setOrbState('idle');
  setStatus('Tap the mic to start talking');
}

// ============================================================
//  UI HELPERS
// ============================================================
function setOrbState(state) {
  const el = orb();
  el.classList.remove('listening', 'speaking', 'thinking');
  if (state !== 'idle') el.classList.add(state);
  btnMic().textContent = state === 'recording' ? '⏹️' : state === 'speaking' ? '🔇' : '🎤';
}

function setStatus(text, cls = '') {
  const el = statusLabel();
  el.textContent = text;
  el.className = 'status-label' + (cls ? ' ' + cls : '');
}

function showBubble(text) {
  const el = messageBubble();
  el.textContent = text;
  el.classList.add('visible');
}

function hideBubble() {
  messageBubble().classList.remove('visible');
}

function showToast(msg, type = '') {
  const t = toast();
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ============================================================
//  KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
  if (!appEl().classList.contains('visible')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' && !isRecording && !isSpeaking) {
    e.preventDefault();
    startRecording();
  }
  if (e.code === 'Escape') {
    if (isRecording) stopRecording();
    if (isSpeaking)  stopSpeaking();
  }
});

// Pre-load voices (Chrome needs this trigger)
window.speechSynthesis.getVoices();
window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
