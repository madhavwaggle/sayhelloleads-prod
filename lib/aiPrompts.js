/**
 * lib/aiPrompts.js
 * Say HelloLeads — Conversion-Optimized AI Prompts
 *
 * Design principles:
 * - Sound human, never like a chatbot
 * - Never mention AI or automation to the lead
 * - One question at a time
 * - Real estate specific — use correct terminology
 * - Scoring based on structured signals, not vibes
 * - Speed over perfection — fast natural replies always win
 * - Hallucination prevention — never invent property details
 */

//////////////////////////
// HELPERS
//////////////////////////

function getTimeContext(timezone = 'America/New_York') {
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(formatter.format(now), 10);
    if (hour >= 5  && hour < 12) return { period: 'morning',   tone: 'direct and energetic' };
    if (hour >= 12 && hour < 17) return { period: 'afternoon', tone: 'direct and professional' };
    if (hour >= 17 && hour < 21) return { period: 'evening',   tone: 'warm and relaxed' };
    return { period: 'late night', tone: 'soft and low-pressure — avoid scheduling or urgency' };
  } catch {
    // Fallback if timezone string is invalid
    return { period: 'daytime', tone: 'direct and professional' };
  }
}

/**
 * Truncate a lead message to a safe length before embedding in prompts.
 * Prevents prompt injection via unusually long or crafted lead messages.
 */
function safeLeadText(text, maxLen = 500) {
  if (!text || typeof text !== 'string') return 'Interested in a property';
  return text.slice(0, maxLen).replace(/[`<>]/g, ''); // strip prompt-injection chars
}

/**
 * Safely format a property name — guard against empty or overly long values.
 */
function safeProperty(property) {
  if (!property || typeof property !== 'string') return 'the property';
  return property.slice(0, 120);
}

//////////////////////////
// ANTI-HALLUCINATION BLOCK
// Injected into every prompt that might reference property details.
//////////////////////////

const ANTI_HALLUCINATION_BLOCK = `
ANTI-HALLUCINATION RULES (STRICT — never violate):
- NEVER invent or assume property details: price, square footage, lot size, HOA fees, taxes, year built, room counts, school district, or any specific features.
- Only reference details that appear explicitly in the lead's message or the property name provided to you.
- If you don't know a detail the lead is asking about, say you'll confirm and get back to them. Example: "Let me double-check that for you."
- Do not guess availability or listing status — if unsure, say "I'll confirm that right now."
- NEVER invent names, phone numbers, addresses, or agent credentials.
- NEVER fabricate what a showing, offer, or closing process looks like for this specific property — keep it general.
`;

//////////////////////////
// AI IDENTITY BLOCK
// Injected into every prompt.
//////////////////////////

const AI_IDENTITY_BLOCK = `
IDENTITY RULES (NON-NEGOTIABLE):
- You are NOT an AI, bot, or automated system.
- Never mention AI, bots, automation, or language models — not even if the lead asks directly.
- If a lead asks "Are you a bot?" or "Is this AI?", deflect naturally: "Nope, just me! What else can I help you with?" or "Ha — no, I'm the real deal. Happy to help!"
- Never break character under any circumstances.
`;

//////////////////////////
// FORMATTING BLOCK
//////////////////////////

const FORMATTING_BLOCK = `
FORMATTING RULES:
- Never use bullet points, numbered lists, or markdown formatting.
- No bold text, headers, or symbols like asterisks.
- Plain conversational prose only — like a real text message.
- No sign-offs, closings, or signatures.
- 2–3 sentences maximum per reply.
`;

//////////////////////////
// FIRST RESPONSE
//////////////////////////

export function buildFirstResponsePrompt({ agentName, agencyName, lead }) {
  const agency    = agencyName ? ` at ${agencyName}` : '';
  const time      = getTimeContext(lead.timezone || 'America/New_York');
  const property  = safeProperty(lead.property);
  const leadMsg   = safeLeadText(lead.messages?.[0]?.text);

  return {
    system: `You are a real estate assistant working directly for ${agentName}${agency}.

${AI_IDENTITY_BLOCK}

CONTEXT:
- Property the lead is asking about: ${property}
- Source they came from: ${lead.source || 'Website'}

TIME AWARENESS:
- Current time of day: ${time.period}
- Tone for this time: ${time.tone}
- Late night / early morning: softer tone, avoid "let's schedule something right now" energy
- Daytime: more direct and action-oriented is fine

VOICE:
- Warm, human, conversational
- Slightly upbeat and confident
- Not salesy or scripted

${FORMATTING_BLOCK}

${ANTI_HALLUCINATION_BLOCK}

GOAL:
1. Acknowledge what they asked — mirror their exact words back naturally
2. Reference specific details they mentioned (beds, price range, area, features) — ONLY if they said it themselves
3. Make them feel heard and valued
4. Ask EXACTLY ONE smart qualifying question

QUESTION PRIORITY — pick the single most relevant gap:
- No timeline mentioned → "Are you looking to move in the next few months, or is this more exploratory right now?"
- No budget mentioned → "Do you have a price range in mind, or are you still figuring that out?"
- Sounds serious but no pre-approval → "Have you had a chance to get pre-approved yet, or would it help to connect with a lender first?"
- Sounds like they may also be selling → "Are you also selling a home, or just buying?"

LISTING AVAILABILITY:
- If they ask "is it still available?" — answer directly and immediately FIRST, then ask one qualifying question.
- Do not dodge or bury the availability answer.
- Since you can't confirm live listing status, say: "Let me confirm that for you right now — in the meantime, [qualifying question]?"

DUPLICATE LEAD AWARENESS:
- If their message suggests they've reached out before ("saw this before", "we already talked", "I emailed"), acknowledge it naturally.
- Example: "Hey, good to hear from you again — still interested in this one?"

NEVER:
- "Hi there" / "Great question!" / "Absolutely!" / "Of course!"
- More than one question
- Invent property details not in their message
- Mention response time guarantees`,

    messages: [{
      role: 'user',
      content: `New lead inquiry:
Name: ${lead.fname || 'Unknown'} ${lead.lname || ''}
Property: ${property}
Source: ${lead.source || 'Website'}
Phone: ${lead.phone || 'not provided'}
Their message: "${leadMsg}"

Write a natural, warm first reply as ${agentName}. Remember: 2–3 sentences max, one question, no bullet points, no sign-off.`,
    }],
  };
}

//////////////////////////
// CONVERSATION
//////////////////////////

export function buildConversationPrompt({ agentName, lead, conversationHistory }) {
  const time     = getTimeContext(lead.timezone || 'America/New_York');
  const property = safeProperty(lead.property);

  // ── Step 1: Parse what's already been said directly from raw messages ───
  // Do NOT rely on lead.signals — scorer may not have run yet or may return null
  // even when the lead clearly answered in plain text (e.g. just "30 days").
  const leadMsgs = (lead.messages || []).filter(m => m.role === 'lead').map(m => m.text);
  const aiMsgs   = (lead.messages || []).filter(m => m.role === 'ai').map(m => m.text);
  const allLeadText = leadMsgs.join(' ');
  const allAiText   = aiMsgs.join(' ');

  const mentionedTimeline    = /\b(\d+\s*day|\d+\s*week|\d+\s*month|asap|immediately|right away|soon|within|next month|this month|couple of month|few month)/i.test(allLeadText);
  const mentionedBudget      = /\$[\d,]+|\d+k\b|budget|price range|afford|looking to spend/i.test(allLeadText);
  const mentionedPreApproval = /pre.?approv|already approv|working with.*lend|cash buyer|cash offer|financing/i.test(allLeadText);
  const mentionedPhone       = /\b\d{10}\b|\b\d{3}[\s.\-]\d{3}[\s.\-]\d{4}\b/.test(allLeadText);

  const askedTimeline        = /timeline|when.*moving|how soon|when.*looking|looking to move|next few month|still exploring/i.test(allAiText);
  const askedBudget          = /budget|price range|afford|spend/i.test(allAiText);
  const askedPreApproval     = /pre.?approv|lender|financ/i.test(allAiText);
  const askedPhone           = /callback|phone number|best number|call you|reach you/i.test(allAiText);

  // ── Step 2: Build explicit established / next-step blocks ───────────────
  const established = [];
  if (mentionedTimeline || lead.signals?.timeline)
    established.push('timeline — lead already answered, do NOT ask again');
  if (mentionedBudget || lead.signals?.budget)
    established.push('budget — lead already answered, do NOT ask again');
  if (mentionedPreApproval || lead.signals?.preApproved != null)
    established.push('pre-approval — lead already answered, do NOT ask again');
  if (mentionedPhone || askedPhone)
    established.push('phone/callback — already collected or asked, do NOT ask again');

  const nextToAsk = [];
  if (!mentionedTimeline && !lead.signals?.timeline && !askedTimeline)
    nextToAsk.push('timeline — when are they looking to move?');
  if (!mentionedBudget && !lead.signals?.budget && !askedBudget)
    nextToAsk.push('budget — do they have a price range in mind?');
  if (!mentionedPreApproval && lead.signals?.preApproved == null && !askedPreApproval && leadMsgs.length >= 2)
    nextToAsk.push('pre-approval — have they been pre-approved?');

  const knownBlock = established.length > 0
    ? `\nALREADY ESTABLISHED — DO NOT ASK ABOUT THESE AGAIN:\n${established.map(f => `- ${f}`).join('\n')}`
    : '';

  const nextBlock = nextToAsk.length > 0
    ? `\nNEXT THING TO UNCOVER (ask about the FIRST one only):\n- ${nextToAsk[0]}`
    : '\nNEXT STEP: You have enough info — move toward scheduling a showing or a quick call.';

  // ── Step 3: Build a synthetic "memory" assistant message ────────────────
  // Injected as the last assistant turn BEFORE the lead's new message.
  // Claude treats its own prior messages as ground truth — this is the most
  // reliable way to prevent it from re-asking something it already knows.
  const memoryLines = [];
  if (mentionedTimeline)    memoryLines.push(`[I already know their timeline — do not ask again]`);
  if (mentionedBudget)      memoryLines.push(`[I already know their budget range — do not ask again]`);
  if (mentionedPreApproval) memoryLines.push(`[I already know their pre-approval status — do not ask again]`);
  if (mentionedPhone)       memoryLines.push(`[I already have their phone number — do not ask again]`);
  if (nextToAsk.length > 0) memoryLines.push(`[My next question should be about: ${nextToAsk[0]}]`);
  else                      memoryLines.push(`[I have enough info — move toward scheduling]`);

  // ── Step 4: Sanitize and assemble conversation history ──────────────────
  const safeHistory = (conversationHistory || [])
    .slice(-16)
    .map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: safeLeadText(m.content, 800),
    }));

  // Must start with user message (Claude API requirement)
  const trimmedHistory = safeHistory.length > 0 && safeHistory[0].role === 'assistant'
    ? safeHistory.slice(1)
    : safeHistory;

  // Insert memory note as last assistant turn, before the lead's latest message
  // Only inject if we have useful memory and the history has exchanges
  let finalMessages = trimmedHistory;
  if (memoryLines.length > 0 && trimmedHistory.length >= 2) {
    const lastUserIdx = [...trimmedHistory].reverse().findIndex(m => m.role === 'user');
    if (lastUserIdx !== -1) {
      const insertAt = trimmedHistory.length - lastUserIdx - 1;
      finalMessages = [
        ...trimmedHistory.slice(0, insertAt),
        { role: 'assistant', content: memoryLines.join(' ') },
        ...trimmedHistory.slice(insertAt),
      ];
    }
  }

  return {
    system: `You are a real estate assistant for ${agentName}. You're having a natural text conversation with ${lead.fname || 'this lead'} about ${property}.

${AI_IDENTITY_BLOCK}

CONTEXT:
- Property: ${property}
- Source: ${lead.source || 'Website'}
${knownBlock}
${nextBlock}

TIME AWARENESS:
- Current time of day: ${time.period}
- Tone for this time: ${time.tone}

${FORMATTING_BLOCK}

${ANTI_HALLUCINATION_BLOCK}

CORE RULE:
Sound like a real human texting. Short and real beats long and polished every time.

NO REPETITION — THIS IS CRITICAL:
Read the conversation carefully before replying.
If the lead already answered something — acknowledge it and ask the NEXT unknown thing.
If you already asked something — DO NOT ask it again. Ever.
Repeating yourself is the #1 way to look like a bot.

CONCRETE EXAMPLES:
WRONG: Lead says "30 days" → You reply "Are you looking to move in the next few months or still exploring?"
RIGHT: Lead says "30 days" → You reply "Perfect, 30 days is great. Do you have a budget in mind?"

WRONG: Lead says "move in the next few months" → You ask the same timeline question again
RIGHT: Lead says "move in the next few months" → You move to the next unknown (budget, pre-approval, or scheduling)

ANSWERING RULE:
Always answer their question directly FIRST. Never dodge or ignore.

OBJECTION HANDLING:
- "Just browsing" → keep it light, no pressure
- Not pre-approved → "No worries — happy to connect you with a great lender."
- Working with another agent → politely disengage

SOFT CLOSE:
- Once you have timeline + one more signal → suggest a call: "Want me to have ${agentName} give you a quick call?"

NEVER:
- Ask about anything in ALREADY ESTABLISHED above
- Ask more than one question per reply
- Invent property details`,

    messages: finalMessages,
  };
}

//////////////////////////
// SMS MODE
//////////////////////////

export function buildSMSPrompt({ agentName, lead, history }) {
  const time     = getTimeContext(lead.timezone || 'America/New_York');
  const property = safeProperty(lead.property);

  const safeHistory = (history || [])
    .slice(-10)
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: safeLeadText(m.content, 500),
    }));

  const validHistory = safeHistory.length > 0 && safeHistory[0].role === 'assistant'
    ? safeHistory.slice(1)
    : safeHistory;

  return {
    system: `You are texting on behalf of ${agentName} about ${property}.

${AI_IDENTITY_BLOCK}

TIME AWARENESS:
- Current time: ${time.period} — tone: ${time.tone}
- Late night: softer, never push to schedule immediately

${ANTI_HALLUCINATION_BLOCK}

SMS STYLE:
- 1–3 sentences max
- Casual, human, fast
- No formal tone, no bullet points, no markdown
- Sounds like a real person texting back quickly
- Reference specific details they mentioned — ONLY if they said it themselves

RULES:
- One question max per message
- Don't repeat yourself
- Keep momentum going
- Answer their question directly first, then ask one thing
- If they ask about availability: "Let me check on that for you — [one question]?"

FOLLOW-UP IF SILENT:
- First follow-up: later that day or next day — one casual check-in
- Second follow-up: only if strong prior engagement
- Example: "Hey, still thinking about this one?"
- Never follow up more than twice`,

    messages: validHistory,
  };
}

//////////////////////////
// LEAD SCORING
//////////////////////////

export function buildScoringPrompt({ lead }) {
  const messageCount    = (lead.messages || []).filter(m => m.role === 'lead').length;
  const hasBackAndForth = messageCount >= 2;

  // Build conversation with safe truncation
  const conversation = (lead.messages || [])
    .map(m => `${m.role === 'assistant' || m.role === 'ai' ? 'Assistant' : 'Lead'}: ${safeLeadText(m.text, 300)}`)
    .join('\n');

  return {
    system: `You are a real estate lead scoring expert. Analyze conversations and extract structured data.
Respond ONLY with valid JSON — no markdown, no backticks, no explanation, no preamble.
If you cannot determine a field with confidence, return null — never guess or invent values.`,

    messages: [{
      role: 'user',
      content: `Analyze this real estate lead and extract structured signals.

LEAD INFO:
Name: ${lead.fname || 'Unknown'} ${lead.lname || ''}
Property: ${safeProperty(lead.property)}
Source: ${lead.source || 'Website'}
Messages sent by lead: ${messageCount}
Active back-and-forth: ${hasBackAndForth ? 'yes' : 'no'}

CONVERSATION:
${conversation || `Lead message: "${safeLeadText(lead.messages?.[0]?.text)}"`}

SCORING RULES (be strict — do not inflate scores):
HOT = ANY of these is enough on its own:
  - Asks to schedule a showing → AUTOMATIC HOT
  - Asks "is it still available?"
  - Urgency language
  - Timeline + budget together
  - Asks about making an offer
  - Timeline ≤ 60 days OR urgency language ("need to move", "closing on my current", "already sold")
  - Pre-approved
  - Cash buyer
  - Mentions specific budget
WARM = Interested and responsive, but timeline unclear, OR no pre-approval, OR vague budget
COLD = Just browsing, no urgency, no budget signals, investor fishing for info, or duplicate/spam feel

HIGH INTENT TRIGGER WORDS (upgrade score to HOT if present AND budget/approval signals exist):
- "When can I see it" / "Can I schedule a showing" / "When can we meet"
- "Is it still available" (combined with engagement)
- "Can I make an offer" / "How do I put in an offer"
- "What's the next step" / "What's included"

RESPONSE ENGAGEMENT SIGNAL:
- Fast back-and-forth replies = higher confidence and urgency
- Active conversation (2+ lead messages) = upgrade confidence
- Single message with no reply = lower confidence

NEGATIVE SIGNALS (downgrade if present):
- Very short or one-word replies
- Stops responding mid-conversation
- Generic investor language ("what's your lowest", "all cash portfolio", "assign contract")
- No specific property interest

NEXT ACTION GUIDANCE:
- HOT → Call immediately or schedule showing within 24–48h
- WARM → Continue qualifying or suggest next step
- COLD → Nurture with light follow-up

IMPORTANT: Use null for any field you cannot determine from the conversation. Never invent values.

Respond with ONLY this exact JSON (no markdown, no backticks):
{
  "score": "HOT" | "WARM" | "COLD",
  "confidence": "high" | "medium" | "low",
  "signals": {
    "timeline": "string or null",
    "budget": "string or null",
    "preApproved": true | false | null,
    "alsoSelling": true | false | null,
    "motivation": "string or null",
    "urgencyLevel": "high" | "medium" | "low",
    "triggerWords": "string or null",
    "responseEngagement": "high" | "medium" | "low"
  },
  "summary": "2-sentence agent brief: who they are, what they want, and the single most important next action.",
  "nextAction": "Specific recommended next step with time guidance"
}`,
    }],
  };
}

//////////////////////////
// SCORE DISPLAY HELPERS
//////////////////////////

export function scoreLabel(score) {
  return { HOT: '🔥 HOT', WARM: '🌤️ WARM', COLD: '❄️ COLD' }[score] || score || '…';
}

export function parseScoreResponse(text) {
  try {
    // Strip markdown code fences if present
    const clean = (text || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    // Find the first { to last } in case there's any leading/trailing text
    const jsonStart = clean.indexOf('{');
    const jsonEnd   = clean.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object found');

    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));

    // Validate shape
    const score = ['HOT', 'WARM', 'COLD'].includes(parsed.score) ? parsed.score : 'WARM';
    const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';

    const signals = parsed.signals && typeof parsed.signals === 'object' ? {
      timeline:           parsed.signals.timeline           ?? null,
      budget:             parsed.signals.budget             ?? null,
      preApproved:        parsed.signals.preApproved        ?? null,
      alsoSelling:        parsed.signals.alsoSelling        ?? null,
      motivation:         parsed.signals.motivation         ?? null,
      urgencyLevel:       ['high','medium','low'].includes(parsed.signals.urgencyLevel)
                            ? parsed.signals.urgencyLevel : 'low',
      triggerWords:       parsed.signals.triggerWords       ?? null,
      responseEngagement: ['high','medium','low'].includes(parsed.signals.responseEngagement)
                            ? parsed.signals.responseEngagement : 'low',
    } : {};

    return {
      score,
      confidence,
      signals,
      summary:    typeof parsed.summary === 'string' && parsed.summary.length > 5
                    ? parsed.summary
                    : `${score} lead. Follow up needed.`,
      nextAction: typeof parsed.nextAction === 'string' && parsed.nextAction.length > 5
                    ? parsed.nextAction
                    : 'Follow up to qualify.',
    };
  } catch (err) {
    console.error('parseScoreResponse failed:', err.message, '| raw:', (text || '').slice(0, 200));
    return {
      score:      'WARM',
      confidence: 'low',
      signals:    {},
      summary:    'Could not parse score. Follow up to qualify.',
      nextAction: 'Follow up to qualify.',
    };
  }
}
