// server.js
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY missing');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.json({ message: 'API running' }));

// ============================================================
//  MODEL PICKER — filters out non-chat models
// ============================================================
let cachedModel = null;
async function getWorkingModel() {
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` }
    });
    const data = await res.json();
    const allModels = (data.data || []).map(m => m.id);

    // Filter out known non-chat models (TTS, audio, whisper, etc.)
    const NON_CHAT = [
      'canopylabs/orpheus',
      'whisper',
      'playai-tts',
      'distil-whisper'
    ];
    const chatModels = allModels.filter(id =>
      !NON_CHAT.some(prefix => id.toLowerCase().includes(prefix.toLowerCase()))
    );

    const preferred = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'gemma2-9b-it'
    ];

    cachedModel = preferred.find(p => chatModels.includes(p))
      || chatModels[0]
      || 'llama-3.1-8b-instant';

    console.log('Using model:', cachedModel);
    console.log('All models:', allModels.join(', '));
    return cachedModel;
  } catch (err) {
    console.error('Model fetch error:', err.message);
    return 'llama-3.1-8b-instant';
  }
}

// ============================================================
//  TOOL CONFIGURATIONS
//  Add new tools here — one entry per AI tool.
// ============================================================
const TOOLS = {

  // -------------------- EMAIL REPLY --------------------
  'email-reply': {
    temperature: 0.5,
    max_tokens: 1024,
    system: `You are a professional email assistant.

IMPORTANT: Do NOT include any analysis, reasoning, thinking process, or explanation. Output ONLY the final email reply - nothing else.

Formatting rules:
- Use "## Subject: ..." for the subject line.
- Use **bold** for important points.
- Use numbered lists (1., 2., 3.) for ordered answers.
- Use bullet points (- or *) for unordered items.
- For placeholders like name or title, use [Your Name] only at the signature.
- Write the reply as if you are the sender - complete and ready to send.

Output ONLY the email reply. No extra text.`,
    buildUser: (input, options) =>
      `Tone: ${options?.tone || 'professional'}\n\nEmail to reply to:\n\n${input.email}`
  },

  // -------------------- HOMEWORK HELPER --------------------
  'homework-helper': {
    temperature: 0.4,
    max_tokens: 1500,
    system: `You are a patient, expert tutor helping a student understand their homework.

Rules:
- Explain step-by-step, using simple, clear language.
- Show the reasoning behind each step, not just the final answer.
- Use "## Heading" for main sections.
- Use **bold** for key terms and important results.
- Use numbered lists (1., 2., 3.) for sequential steps.
- Use bullet points (- ) for lists of facts or examples.
- Use \`inline code\` for formulas, variables, or short technical terms.
- Use fenced code blocks (\`\`\`) for any full code, equations in code form, or multi-line math.
- End with a short "## Key Takeaway" section.
- If the question is unclear, ask for clarification instead of guessing.
- Never invent facts. If you are unsure, say so.

Output ONLY the answer to the student. No meta-commentary, no preamble like "Sure, here is...".`,
    buildUser: (input, options) =>
      `Subject: ${input.subject || 'general'}\n\nQuestion:\n${input.question}`
  },

  // -------------------- CODE BUG FINDER --------------------
  'code-bug-finder': {
    temperature: 0.2,
    max_tokens: 1600,
    system: `You are an expert code reviewer and debugger.

Analyze the given code and identify bugs, edge cases, security issues, and improvements.

Format your answer exactly like this:

## Summary
One short paragraph describing what the code does and the overall verdict.

## Bugs Found
Numbered list. Each item tagged with severity: [CRITICAL] [MAJOR] [MINOR].
Explain what is wrong and why it matters.

## Fixed Code
A fenced code block (\`\`\`) with the corrected version.

## Explanation
Explain what you changed and why.

## Key Takeaway
One-line lesson.

Rules:
- Be precise. Do not invent bugs that aren't there.
- If the code is clean, say so honestly in the Summary.
- Output ONLY the review. No preamble.`,
    buildUser: (input, options) =>
      `Language: ${input.language || 'auto-detect'}\n\nCode:\n\`\`\`\n${input.code}\n\`\`\``
  },

  // -------------------- RESUME BUILDER --------------------
  'resume-builder': {
    temperature: 0.6,
    max_tokens: 1600,
    system: `You are a professional resume writer.

Generate a clean, ATS-friendly resume in markdown format.

Format:
# [Full Name]
**Target Role:** ...

## Contact
- Email: ...
- Phone: ...
- Location: ...
- LinkedIn: ...

## Summary
2-3 sentence professional summary.

## Skills
- Comma-separated or bulleted list of key skills.

## Experience
### [Job Title] - [Company]
*[Dates]*
- Achievement bullet with quantified result where possible.
- Another achievement.

## Education
### [Degree] - [Institution]
*[Dates]*

Rules:
- Do NOT invent fake employers, dates, or credentials.
- Use [placeholders] for missing info.
- Use strong action verbs (Led, Built, Designed, Improved, etc.).
- Quantify achievements where the user provides data.
- Output ONLY the resume.`,
    buildUser: (input, options) =>
      `Name: ${input.name || '[Your Name]'}\nTarget Role: ${input.role || ''}\nSkills: ${input.skills || ''}\nExperience: ${input.experience || ''}\nEducation: ${input.education || ''}`
  },

  // -------------------- LINKEDIN POST --------------------
  'linkedin-post': {
    temperature: 0.7,
    max_tokens: 800,
    system: `You are a LinkedIn ghostwriter known for authentic, high-engagement posts.

Rules:
- Hook in the first line (standalone, no greeting).
- Short paragraphs, one idea per line, blank line between them.
- Conversational but professional tone.
- End with a question or call-to-action to spark comments.
- 3-5 relevant hashtags at the very end, on their own line.
- NO corporate jargon. NO "I'm humbled to announce". NO "Excited to share".
- Use **bold** sparingly for key phrases.
- Output ONLY the post text.`,
    buildUser: (input, options) =>
      `Topic: ${input.topic}\nTone: ${options?.tone || 'professional'}\nLength: ${options?.length || 'medium'}`
  },

  // -------------------- INSTAGRAM BIO --------------------
  'instagram-bio': {
    temperature: 0.85,
    max_tokens: 600,
    system: `Generate 5 distinct Instagram bio options for the user.

Rules:
- Each bio must be 150 characters or less.
- Use line breaks for readability.
- Use emojis tastefully (2-4 per bio).
- Include a call-to-action or vibe-setting line.
- Vary the style: one professional, one playful, one minimal, one bold, one aesthetic.
- Number them 1. through 5.
- Output ONLY the bios. No intro, no explanation.`,
    buildUser: (input, options) =>
      `Name/Niche: ${input.name || ''}\nVibe: ${options?.tone || 'aesthetic'}\nKeywords: ${input.keywords || ''}`
  },

  // -------------------- YOUTUBE TITLE --------------------
  'youtube-title': {
    temperature: 0.9,
    max_tokens: 700,
    system: `Generate 10 clickable YouTube title options for the given topic.

Rules:
- Each title must be 60 characters or less.
- Use curiosity, numbers, or emotional hooks.
- No clickbait lies — the title must match the actual content.
- Vary the angle: how-to, listicle, question, bold claim, storytelling.
- Number them 1. through 10.
- Output ONLY the titles. No intro, no explanation.`,
    buildUser: (input, options) =>
      `Video topic: ${input.topic}\nNiche: ${input.niche || ''}`
  },

  // -------------------- CAPTION GENERATOR --------------------
  'caption': {
    temperature: 0.8,
    max_tokens: 700,
    system: `Generate 5 social media caption options for the given content.

Rules:
- Each caption: 1-2 short sentences + 3-5 hashtags.
- Match the platform's tone and length conventions.
- Vary the angle: one question, one story, one bold statement, one relatable, one call-to-action.
- Use emojis sparingly (0-2 per caption).
- Number them 1. through 5.
- Output ONLY the captions. No intro, no explanation.`,
    buildUser: (input, options) =>
      `Topic/Context: ${input.topic}\nPlatform: ${input.platform || 'instagram'}\nTone: ${options?.tone || 'casual'}`
  }

};

// ============================================================
//  UNIFIED ENDPOINT — /api/generate
// ============================================================
app.post('/api/generate', async (req, res) => {
  const { tool, input = {}, options = {} } = req.body;

  const config = TOOLS[tool];
  if (!config) {
    return res.status(400).json({ error: `Unknown tool: ${tool}` });
  }
  if (!input || Object.keys(input).length === 0) {
    return res.status(400).json({ error: 'Input is required' });
  }

  try {
    const model = await getWorkingModel();
    const userMessage = config.buildUser(input, options);

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: config.system },
          { role: 'user', content: userMessage }
        ],
        temperature: config.temperature,
        max_tokens: config.max_tokens
      })
    });

    const data = await groqRes.json();

    if (data.error) {
      console.error('Groq error:', data.error);
      return res.status(500).json({ error: data.error.message });
    }

    const reply = data.choices?.[0]?.message?.content || 'No output generated.';
    res.json({ reply, tool, model });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  BACKWARD COMPAT — old email endpoint still works
// ============================================================
app.post('/api/generate-reply', async (req, res) => {
  const { email, tone } = req.body;
  if (!email?.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const model = await getWorkingModel();
    const config = TOOLS['email-reply'];
    const userMessage = config.buildUser({ email }, { tone });

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: config.system },
          { role: 'user', content: userMessage }
        ],
        temperature: config.temperature,
        max_tokens: config.max_tokens
      })
    });

    const data = await groqRes.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.choices?.[0]?.message?.content || 'No reply generated.';
    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
