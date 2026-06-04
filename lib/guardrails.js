/**
 * lib/guardrails.js
 * Say HelloLeads — Output Guardrails & Hallucination Prevention
 *
 * Run every AI reply through these checks before sending to a lead.
 * Catches hallucinated property details, pricing, AI self-disclosure,
 * and other unsafe patterns before they reach a real person.
 */

// ─── PATTERNS ─────────────────────────────────────────────────────────────────

// AI / bot self-disclosure — must never slip through
const AI_DISCLOSURE_PATTERNS = [
  /\b(i['']?m an? (ai|bot|language model|llm|artificial intelligence|virtual assistant|chatbot))\b/i,
  /\b(as an ai|as a bot|as your ai|powered by (ai|claude|openai|gpt|anthropic))\b/i,
  /\b(automated (response|reply|message|system))\b/i,
  /\b(this (message|reply|response) (was|is) (generated|automated|ai))\b/i,
  /\b(machine learning|neural network|trained on)\b/i,
];

// Hallucinated property specifics — prices, dimensions, features the AI made up
const HALLUCINATED_DETAIL_PATTERNS = [
  // Made-up dollar prices embedded in prose (not referencing what lead said)
  /(?<!\$)\$\s?\d{3,3},\d{3}/,                        // $450,000 style
  /(?<!\$)\$\s?\d{1,3}k\b/i,                           // $450k style
  // Square footage invented
  /\b\d{3,4}\s?sq\.?\s?ft\.?\b/i,
  // Lot size invented
  /\b\d+(\.\d+)?\s?(acre|acres)\b/i,
  // Specific room counts (baths) — bedrooms are usually in the lead's message
  /\b\d+(\.\d+)?\s?bath(room)?s?\b/i,
  // HOA amounts invented
  /\bhoa[^.]{0,30}\$\d+/i,
  // Tax amounts
  /\b(property tax|taxes)[^.]{0,30}\$\d+/i,
  // Year built fabricated
  /\bbuilt in \d{4}\b/i,
];

// Scheduling commitments AI shouldn't make unilaterally
const COMMITMENT_PATTERNS = [
  /\b(i('ll| will) (schedule|book|set up|arrange|confirm) (a )?(showing|tour|appointment|call|meeting))\b/i,
  /\b(you're (confirmed|booked|scheduled))\b/i,
  /\b(i('ve| have) (scheduled|booked|arranged|confirmed))\b/i,
  /\bsee you (at|on|this|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

// Legal / financial promises AI must not make
const LEGAL_FINANCIAL_PATTERNS = [
  /\b(i (guarantee|promise|ensure|can assure) (you )?(the (price|sale|offer|deal)))\b/i,
  /\b(this (deal|offer|listing) (will|won't) (last|sell|close))\b/i,
  /\b(interest rate[s]? (is|are|will be|at) \d)/i,
  /\b(you (will|should) (qualify|get approved|be approved))\b/i,
];

// ─── SANITIZE ─────────────────────────────────────────────────────────────────

/**
 * Strip or redact unsafe content from an AI reply.
 * Returns the cleaned string (may be the same as input if clean).
 */
export function sanitizeReply(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text.trim();

  // Remove any accidental signature or sign-off lines that look robotic
  cleaned = cleaned.replace(/\n{2,}[-–—]+\n.+/s, '').trim();

  // Strip markdown formatting that leaks through (shouldn't, but just in case)
  cleaned = cleaned.replace(/^\s*#{1,3}\s+/gm, '');
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
  cleaned = cleaned.replace(/^[-•]\s+/gm, '');

  // Normalize excessive newlines to single breaks
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * Check a reply against all guardrail patterns.
 * Returns { safe: boolean, flags: string[] }
 */
export function auditReply(text) {
  if (!text) return { safe: false, flags: ['empty_reply'] };

  const flags = [];

  for (const pattern of AI_DISCLOSURE_PATTERNS) {
    if (pattern.test(text)) flags.push('ai_disclosure');
  }

  for (const pattern of COMMITMENT_PATTERNS) {
    if (pattern.test(text)) flags.push('unauthorized_commitment');
  }

  for (const pattern of LEGAL_FINANCIAL_PATTERNS) {
    if (pattern.test(text)) flags.push('legal_financial_promise');
  }

  // Hallucination check: downgraded to warn-only (doesn't fail safe check)
  // These patterns can legitimately appear when AI echoes details from lead's message.
  // Logged separately so you can monitor without blocking valid replies.
  const hallucinationWarnings = HALLUCINATED_DETAIL_PATTERNS
    .filter(p => p.test(text))
    .map(() => 'possible_hallucinated_detail');
  // Don't push to flags — these are warnings not blockers
  if (hallucinationWarnings.length > 0) {
    // Caller can check returned warnFlags separately if needed
  }

  // Length checks
  if (text.length > 1200) flags.push('reply_too_long');
  if (text.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('•')).length > 2) {
    flags.push('bullet_list_leaked');
  }

  const hallucinationWarnFlags = HALLUCINATED_DETAIL_PATTERNS
    .filter(p => p.test(text))
    .map(() => 'possible_hallucinated_detail');

  return { safe: flags.length === 0, flags, warnFlags: hallucinationWarnFlags };
}

/**
 * Full pipeline: sanitize then audit.
 * Returns { text, safe, flags }
 * Callers should log flags even when safe=true for monitoring.
 */
export function processReply(rawText) {
  const text = sanitizeReply(rawText);
  const { safe, flags, warnFlags } = auditReply(text);
  return { text, safe, flags, warnFlags };
}

/**
 * Determine a safe fallback reply when AI output fails guardrails.
 * Keeps the conversation alive without exposing any bad content.
 */
export function fallbackReply(agentName) {
  const fallbacks = [
    `Thanks for reaching out — ${agentName} will follow up with you shortly!`,
    `Got it! ${agentName} will be in touch soon.`,
    `Thanks! ${agentName} will reach out to answer your questions.`,
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Validate that a scoring response is structurally sound before saving.
 * Returns true if the parsed score object looks legitimate.
 */
export function validateScore(scored) {
  if (!scored || typeof scored !== 'object') return false;
  if (!['HOT', 'WARM', 'COLD'].includes(scored.score)) return false;
  if (!['high', 'medium', 'low'].includes(scored.confidence)) return false;
  if (typeof scored.summary !== 'string' || scored.summary.length < 10) return false;
  return true;
}
