/**
 * /api/leads/manual
 * POST — create a lead manually (referral, open house, sign call, etc.)
 *
 * Flow (Option B):
 *   1. Save lead
 *   2. AI scores it using the agent's note as context
 *   3. AI drafts a first outreach message
 *   4. Return lead + draft to the UI — agent reviews and approves before sending
 *   5. Agent clicks "Send email" or "Send SMS" → hits /api/leads/send-outreach
 *      which calls triggerAIResponse (same pipeline as Zillow/Homes.com)
 *
 * No message is sent automatically — agent has full control.
 */
import { getServerSession }  from 'next-auth/next';
import { authOptions }       from '../../../lib/auth';
import { saveLead }          from '../../../lib/db';
import { getUserById }       from '../../../lib/users';
import { getAgentConfig }    from '../../../lib/agentConfig';
import { buildScoringPrompt, parseScoreResponse } from '../../../lib/aiPrompts';
import { validateScore }     from '../../../lib/guardrails';
import { v4 as uuidv4 }      from 'uuid';
import Anthropic             from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const agentId = session.user.id;
  const { fname, lname, email, phone, property, note, source } = req.body || {};

  if (!fname) return res.status(400).json({ error: 'First name is required' });
  if (!email && !phone) return res.status(400).json({ error: 'Email or phone is required' });

  const lead = {
    id:        uuidv4(),
    agentId,
    fname:     fname.trim(),
    lname:     (lname || '').trim(),
    email:     (email || '').toLowerCase().trim(),
    phone:     (phone || '').trim(),
    property:  (property || '').trim(),
    source:    source || 'Referral',
    manual:    true,
    outreachPending: true, // flag: agent hasn't approved outreach yet
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages:  note?.trim() ? [{ role: 'lead', text: note.trim() }] : [],
  };

  // ── AI scoring + draft ────────────────────────────────────────────────────
  let suggestedOutreach = null;
  let twilioReady = false;

  try {
    const cfg      = await getAgentConfig(agentId);
    const agent    = await getUserById(agentId);
    const agentName  = agent?.name || session.user.name || 'your agent';
    const agencyName = agent?.agencyName || '';

    twilioReady = !!(cfg.twilioSid && cfg.twilioPhone && lead.phone);

    if (cfg?.anthropicKey) {
      const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

      // 1. Score
      const scorePrompt = buildScoringPrompt({ lead });
      const scoreResp   = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system:     scorePrompt.system,
        messages:   scorePrompt.messages,
      });
      const scored = parseScoreResponse(scoreResp.content?.[0]?.text);
      if (validateScore(scored)) {
        lead.score      = scored.score;
        lead.confidence = scored.confidence;
        lead.signals    = scored.signals;
        lead.summary    = scored.summary;
        lead.nextAction = scored.nextAction;
      }

      // 2. Draft first outreach — warm, personal, from the agent
      const propertyLine = lead.property ? ` about ${lead.property}` : '';
      const noteLine     = note?.trim()  ? `\n\nAgent's context: "${note.trim()}"` : '';
      const scoreHint    = lead.score === 'HOT'
        ? 'This is a hot lead — be warm but move toward scheduling quickly.'
        : lead.score === 'COLD'
        ? 'Low urgency — keep it light and low-pressure, no push.'
        : 'Standard warm outreach — qualify gently.';

      const outreachResp = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 220,
        system: `You write short, natural first-contact messages for real estate agents to send to referral leads.
Sound warm and human — like a real person texting or emailing, not a template.
2-3 sentences max. Agent sends this from their own phone or email.
Do NOT mention AI, automation, or any platform.
End with one soft qualifying question.`,
        messages: [{
          role: 'user',
          content: `Write a first outreach message from ${agentName}${agencyName ? ` at ${agencyName}` : ''} to ${lead.fname}${propertyLine}.${noteLine}
${scoreHint}`,
        }],
      });
      suggestedOutreach = outreachResp.content?.[0]?.text?.trim() || null;
    }
  } catch (e) {
    console.error('[manual lead] AI error:', e.message);
  }

  // Default score fallback
  if (!lead.score) {
    lead.score      = 'WARM';
    lead.confidence = 'low';
    lead.summary    = `${lead.fname} was added manually. Follow up to qualify their timeline and budget.`;
    lead.nextAction = 'Reach out personally to introduce yourself.';
  }

  // Store the draft on the lead so the agent can access it from the lead card later
  if (suggestedOutreach) {
    lead.outreachDraft = suggestedOutreach;
    await saveLead(lead);
  }

  return res.status(200).json({
    lead,
    suggestedOutreach,
    twilioReady,
    hasEmail: !!lead.email,
  });
}
