/**
 * lib/agentConfig.js
 *
 * Resolves config for an agent.
 *
 * BUSINESS MODEL RULES:
 *   - ANTHROPIC_API_KEY and RESEND_API_KEY are ALWAYS from env vars (owner's keys).
 *     Agents never set these — AI and email alerts are included in their subscription.
 *   - Twilio, Postmark, emailFrom, webhookSecret come from the agent's own saved
 *     credentials (set via the Integrations page), since each agent needs their own
 *     phone number and optional custom email domain.
 */

import { getAgentCredentials } from '../pages/api/credentials';

export async function getAgentConfig(agentId) {
  let creds = {};
  try {
    if (agentId) creds = await getAgentCredentials(agentId);
  } catch (e) {
    console.error('getAgentConfig error:', e);
  }

  return {
    // ── Owner-level keys (subscription-included, never agent-settable) ──
    anthropicKey:  process.env.ANTHROPIC_API_KEY  || '',
    resendKey:     process.env.RESEND_API_KEY      || '',

    // ── Agent-level credentials (set per agent in Integrations page) ──
    twilioSid:     creds.twilioSid     || process.env.TWILIO_ACCOUNT_SID   || '',
    twilioToken:   creds.twilioToken   || process.env.TWILIO_AUTH_TOKEN    || '',
    twilioPhone:   creds.twilioPhone   || process.env.TWILIO_PHONE_NUMBER  || '',
    postmarkToken: creds.postmarkToken || process.env.POSTMARK_SERVER_TOKEN || '',
    emailFrom:     creds.emailFrom     || process.env.EMAIL_FROM           || 'Say HelloLeads <noreply@sayhelloleads.com>',
    webhookSecret: creds.webhookSecret || process.env.WEBHOOK_SECRET       || '',
    calendlyUrl:   creds.calendlyUrl   || process.env.CALENDLY_URL         || '',
  };
}
