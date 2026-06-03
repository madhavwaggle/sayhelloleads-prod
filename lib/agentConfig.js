/**
 * lib/agentConfig.js
 *
 * Returns resolved config for an agent, merging:
 *   1. Per-agent credentials stored in Redis (set via the Integrations UI)
 *   2. Global environment variable fallbacks
 *
 * This means the app works out-of-the-box with env vars, but each agent
 * can override with their own API keys stored in their account.
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
    anthropicKey:  creds.anthropicKey  || process.env.ANTHROPIC_API_KEY  || '',
    resendKey:     creds.resendKey     || process.env.RESEND_API_KEY      || '',
    twilioSid:     creds.twilioSid     || process.env.TWILIO_ACCOUNT_SID  || '',
    twilioToken:   creds.twilioToken   || process.env.TWILIO_AUTH_TOKEN   || '',
    twilioPhone:   creds.twilioPhone   || process.env.TWILIO_PHONE_NUMBER || '',
    postmarkToken: creds.postmarkToken || process.env.POSTMARK_SERVER_TOKEN || '',
    emailFrom:     creds.emailFrom     || process.env.EMAIL_FROM          || `Say Hello Leads <noreply@sayhelloleads.com>`,
    webhookSecret: creds.webhookSecret || process.env.WEBHOOK_SECRET      || '',
  };
}
