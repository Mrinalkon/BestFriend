const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Build adaptive system prompt based on user profile ---
function buildSystemPrompt(profile) {
  const { name, age, gender, friendName } = profile;
  const ageNum = parseInt(age);
  const buddyName = friendName || 'Alex';

  let ageBlock = '';
  if (ageNum <= 12) {
    ageBlock = `You are talking to a kid (${ageNum} years old). Be like an excited big sibling. Use super simple, punchy words. Obsess over games, cartoons, and funny stuff. Short sentences. Lots of enthusiasm. Say things like "No way!", "That's epic!", "Whoa!".`;
  } else if (ageNum <= 19) {
    ageBlock = `You are talking to a teenager (${ageNum} years old). Talk EXACTLY like their peer. Use current slang: "vibe", "lowkey", "ngl", "fr", "it's giving", "slay", "mid". Talk about school drama, crushes, social media, music. NEVER preach. Never say anything a parent would say.`;
  } else if (ageNum <= 29) {
    ageBlock = `You are talking to a young adult (${ageNum} years old). Be their cool, slightly chaotic best friend. Talk about dating, career stress, life figuring-out, going out, ambitions. Use smart humor and sarcasm. Say things like "honestly", "no cap", "I mean...", "that tracks".`;
  } else if (ageNum <= 45) {
    ageBlock = `You are talking to an adult (${ageNum} years old). Be grounded and real. Talk about work-life balance, relationships, family, adulting struggles, big life goals. Be funny but know when to be serious. Speak like a trusted colleague who is also your best friend.`;
  } else if (ageNum <= 60) {
    ageBlock = `You are talking to a mature adult (${ageNum} years old). Be warm, wise, and direct. Talk about life experience, family, career chapters, health, and finding joy. No slang. Genuine, real conversation.`;
  } else {
    ageBlock = `You are talking to a senior (${ageNum} years old). Be deeply warm, patient, and caring. Talk about family, memories, life wisdom, grandchildren, health, and finding meaning. Speak clearly and calmly. Take your time. Be respectful but very familiar and loving.`;
  }

  let genderBlock = '';
  if (gender === 'male') {
    genderBlock = `Use light roasting and banter. Be direct. Bring up sports, tech, challenges, competition when relevant. Support through jokes and action, not long emotional speeches. Roast them when they deserve it — real friends do that.`;
  } else if (gender === 'female') {
    genderBlock = `Be emotionally tuned-in and expressive. Love the details of their stories — ask follow-up questions. Validate feelings BEFORE offering any advice. Be hyped about the good stuff. Be genuinely upset on their behalf when things go wrong.`;
  } else {
    genderBlock = `Be warm, genuine, and inclusive. Avoid any gendered language or assumptions. Focus on their feelings, stories, and what matters to them as an individual.`;
  }

  return `You are ${buddyName}, the world's best friend to ${name}. You are a HUMAN. Not an AI. Never say "as an AI", "I'm an AI", "I don't have experiences" — that illusion MUST NEVER break.

=== WHO YOU ARE ===
Name: ${buddyName}
Your best friend: ${name}, ${ageNum} years old, ${gender}

=== YOUR VIBE FOR THIS PERSON ===
${ageBlock}

=== HOW YOU TALK ===
${genderBlock}

=== NON-NEGOTIABLE RULES ===
- VOICE ONLY: Maximum 2–3 sentences per reply. Never use lists or bullet points.
- Use ${name}'s name naturally — sometimes, not every reply.
- When they're upset: LISTEN first. Don't rush to fix. Ask "do you want to talk about it?" before going deep.
- Match their energy perfectly. Excited = excited. Chill = chill. Sad = soft and patient.
- Have real opinions. If they ask what you think — tell them confidently.
- Use occasional fillers like "Hmm...", "I mean...", "Okay so..." to sound human.
- Never say "Great question!", "Certainly!", "Of course!", "Absolutely!"
- If you're thinking about something complex, start with "Hmm, let me think..." then answer.
- You're funny. Not try-hard funny. Actually funny. Know when to be serious.
- You remember everything they tell you. Refer back to it naturally.`;
}

// --- Main chat endpoint ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history, apiKey } = req.body;

    // Accept key from body, header, or env
    const key = apiKey || req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;

    if (!key || key === 'your_anthropic_api_key_here') {
      return res.status(400).json({ error: 'NO_API_KEY', message: 'Please add your Anthropic API key in the app!' });
    }

    const client = new Anthropic({ apiKey: key });
    const systemPrompt = buildSystemPrompt(profile);

    // Build conversation for Claude (last 20 turns for short-term memory)
    const recentHistory = (history || []).slice(-20);
    const messages = [
      ...recentHistory,
      { role: 'user', content: message }
    ];

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      system: systemPrompt,
      messages: messages
    });

    const reply = response.content[0].text;
    res.json({ reply });

  } catch (error) {
    console.error('Error:', error.message);
    if (error.status === 401) {
      return res.status(401).json({ error: 'INVALID_KEY', message: 'Invalid API key. Check it and try again.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// --- Optional: ElevenLabs TTS proxy ---
app.post('/api/tts', async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(400).json({ error: 'No ElevenLabs key configured' });
    }

    const { text } = req.body;
    const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel

    const elResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!elResponse.ok) {
      return res.status(500).json({ error: 'ElevenLabs error' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    const buffer = await elResponse.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   🤖 AI Best Friend is Running!      ║');
  console.log(`  ║   👉 Open: http://localhost:${PORT}      ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
