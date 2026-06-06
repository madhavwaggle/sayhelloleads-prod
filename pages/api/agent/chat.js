/**
 * /api/agent/chat
 * Handles follow-up messages from the buyer chat UI on /agent/[slug].
 * Continues the conversation naturally, qualifies the lead,
 * and re-scores after every 2nd buyer message.
 */

import { getLead, saveLead } from '../../../lib/db';
import { getUserById } from '../../../lib/users';
import { getAgentConfig } from '../../../lib/agentConfig';
import { buildConversationPrompt, buildScoringPrompt, parseScoreResponse } from '../../../lib/aiPrompts';
import { processReply, fallbackReply, validateScore } from '../../../lib/guardrails';
import { notifyAgentNewLead } from '../../../lib/notify';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { leadId, agentSlug, message } = req.body;
  if (!leadId || !message) return res.status(400).json({ error: 'leadId and message required' });

  const lead = await getLead(leadId).catch(() => null);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const agent = await getUserById(lead.agentId).catch(() => null);
  const cfg   = await getAgentConfig(lead.agentId);

  if (!cfg.anthropicKey) {
    return res.status(200).json({ reply: "Thanks for that! I'll have someone reach out to you shortly." });
  }

  const agentName = agent?.name || 'the agent';
  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  // Add the buyer's new message to history
  lead.messages.push({ role: 'lead', text: message });
  lead.updatedAt = new Date().toISOString();

  // Build conversation history in the format Claude expects
  const conversationHistory = lead.messages.map(m => ({
    role:    m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  // Get AI reply
  const prompt = buildConversationPrompt({ agentName, lead, conversationHistory });
  const resp = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 250,
    system:     prompt.system,
    messages:   prompt.messages,
  }).catch(() => null);

  const rawReply = resp?.content?.[0]?.text || '';
  const { text: cleanedReply, safe, flags } = processReply(rawReply);

  if (flags.length > 0) {
    console.warn(`[guardrails] agent/chat reply flags for lead ${leadId}:`, flags);
  }

  const reply = safe
    ? (cleanedReply || fallbackReply(agentName))
    : fallbackReply(agentName);

  if (!safe) {
    console.warn(`[guardrails] agent/chat reply FAILED for lead ${leadId} — using fallback. Flags:`, flags);
  }

  lead.messages.push({ role: 'ai', text: reply });

  // Score on first message, then re-score every 2 after that
  const buyerMessageCount = lead.messages.filter(m => m.role === 'lead').length;
  if (buyerMessageCount === 1 || (buyerMessageCount >= 2 && buyerMessageCount % 2 === 0)) {
    try {
      const scorePrompt = buildScoringPrompt({ lead });
      const scoreResp = await anthropic.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 500,
        system:     scorePrompt.system,
        messages:   scorePrompt.messages,
      });
      const scored = parseScoreResponse(scoreResp.content?.[0]?.text);
      if (validateScore(scored)) {
        lead.score              = scored.score;
        lead.confidence         = scored.confidence;
        lead.signals            = scored.signals;
        lead.summary            = scored.summary || lead.summary;
        lead.nextAction         = scored.nextAction || lead.nextAction;
        if (scored.signals?.triggerWords)       lead.triggerWords       = scored.signals.triggerWords;
        if (scored.signals?.responseEngagement) lead.responseEngagement = scored.signals.responseEngagement;
      } else {
        console.warn(`[guardrails] invalid score for lead ${leadId} — keeping existing score`);
      }

      // Notify on first message, again if score becomes HOT
      if (buyerMessageCount === 1 || scored.score === 'HOT') {
        const agentEmail = agent?.notifyEmail || agent?.email;
        if (agent?.agentNotifyPhone) lead.agentNotifyPhone = agent.agentNotifyPhone;
        if (agentEmail) {
          await notifyAgentNewLead(lead, agentEmail, agentName, cfg.resendKey)
            .catch(e => console.error('chat notify error:', e.message));
        }
      }
    } catch (e) { console.error('chat scoring error:', e.message); }
  }

  await saveLead(lead);
  return res.status(200).json({ reply });
}

export const config = { maxDuration: 30 };
