import { useState, useEffect, useRef } from 'react';
import Footer from '../components/Footer';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
import AddressAutocomplete from '../components/AddressAutocomplete';
import Head from 'next/head';
import { v4 as uuidv4 } from 'uuid';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

async function callAPI(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────

export default function App() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const [view, setView] = useState('landing'); // landing | demo | conversation | dashboard | setup
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({ total: 0, hot: 0 });
  const [currentLead, setCurrentLead] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [filter, setFilter] = useState('all');
  const [openDetailId, setOpenDetailId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoConnecting, setDemoConnecting] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)

  // Human-like delay: 1s base + 20ms per char, capped at 4s
  function typingDelay(text) {
    return Math.min(1000 + (text?.length || 0) * 20, 4000);
  }
  const [scoring, setScoring] = useState(false);
  const [demoLead, setDemoLead] = useState(null);
  const [profile, setProfile] = useState({ name: '', agencyName: '', notifyEmail: '', phone: '', agentNotifyPhone: '', zillowDone: false, homesDone: false, realtorDone: false, redfinDone: false, facebookDone: false, photoUrl: '', displayName: '' });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoMsg, setPhotoMsg] = useState('');
  const photoInputRef = useRef(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  // Integration credentials
  const [creds, setCreds]           = useState({});
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [credsSaving, setCredsSaving] = useState({});
  const [credsMsg, setCredsMsg]     = useState({});
  // Onboarding checklist
  const [checklist, setChecklist]   = useState({ profile: false, zillow: false, sms: false, website: false });
  // AI usage meter
  const [aiUsage, setAiUsage]       = useState({ used: 0, cap: 100, month: '' });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeInterestSent, setUpgradeInterestSent] = useState(false);
  // Waitlist modal for Team / Brokerage plans
  const [waitlistPlan, setWaitlistPlan]   = useState(null); // 'team' | 'brokerage'
  const [waitlistForm, setWaitlistForm]   = useState({ name: '', email: '', agencyName: '' });
  const [waitlistSent, setWaitlistSent]   = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  // Manual lead entry
  const [showManualLead, setShowManualLead]     = useState(false);
  const [manualForm, setManualForm]             = useState({ fname: '', lname: '', email: '', phone: '', property: '', note: '', source: 'Referral' });
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualResult, setManualResult]         = useState(null); // { lead, suggestedOutreach }
  const [pendingOutreachLead, setPendingOutreachLead] = useState(null); // lead card → reopen outreach modal
  const [upgradeInterestLoading, setUpgradeInterestLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  // Derived — true only when all three Twilio fields are saved
  const twilioConfigured = !!(creds.twilioSid?.isSet && creds.twilioToken?.isSet && creds.twilioPhone?.isSet);
  const chatRef = useRef(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef(null);

  // Demo form state
  const [form, setForm] = useState({
    fname: '', lname: '', email: '', phone: '',
    property: '', message: "Hi, I'm interested in this property. Can I schedule a showing?",
    source: 'Zillow', wantsSms: false,
  });

  // Redirect to login only for protected views
  useEffect(() => {
    if (status === 'unauthenticated' && ['dashboard','setup','profile','integrations'].includes(view)) {
      router.push('/login');
    }
  }, [status, view, router]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages, isTyping]);

  // Sync URL with view state
  useEffect(() => {
    const viewToPath = {
      landing:      '/',
      demo:         '/?view=demo',
      dashboard:    '/?view=dashboard',
      profile:      '/?view=profile',
      integrations: '/?view=integrations',
      conversation: null, // don't push URL for transient conversation view
    };
    const path = viewToPath[view];
    if (path && typeof window !== 'undefined' && window.location.search !== (path.includes('?') ? '?' + path.split('?')[1] : '')) {
      router.push(path, undefined, { shallow: true });
    }
  }, [view]);

  // Restore view from URL on load
  useEffect(() => {
    const qv = router.query?.view;
    const allowed = ['demo','dashboard','profile','integrations'];
    if (qv && allowed.includes(qv)) setView(qv);
    // Show welcome banner for new users arriving from email verification
    if (router.query?.welcome === '1') {
      setShowWelcome(true);
      const t = setTimeout(() => setShowWelcome(false), 8000);
      // Clean the param from URL without reload
      router.replace('/?view=dashboard', undefined, { shallow: true });
      return () => clearTimeout(t);
    }
  }, [router.query?.view, router.query?.welcome]);

  // Close avatar dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (avatarRef.current && !avatarRef.current.contains(e.target)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load leads whenever dashboard is shown
  useEffect(() => {
    if (view === 'dashboard') loadLeads();
    if (['setup','profile','integrations'].includes(view)) loadProfile();
    if (['integrations','dashboard'].includes(view)) loadCreds();
    if (view === 'dashboard') loadChecklist();
    if (view === 'dashboard') loadAiUsage();
  }, [view]);

  // Auto-refresh leads every 30 seconds while on dashboard so email/SMS
  // replies from buyers appear without the agent needing to manually refresh
  useEffect(() => {
    if (view !== 'dashboard') return;
    const interval = setInterval(() => loadLeads(), 30000);
    return () => clearInterval(interval);
  }, [view]);

  async function loadProfile() {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        setProfile({
          name: data.profile.name || '',
          agencyName: data.profile.agencyName || '',
          notifyEmail: data.profile.notifyEmail || data.profile.email || '',
          phone: data.profile.phone || '',
          agentNotifyPhone: data.profile.agentNotifyPhone || '',
          zillowDone:   !!(data.profile.zillowDone),
          homesDone:    !!(data.profile.homesDone),
          realtorDone:  !!(data.profile.realtorDone),
          redfinDone:   !!(data.profile.redfinDone),
          facebookDone: !!(data.profile.facebookDone),
          photoUrl:     data.profile.photoUrl || '',
          displayName:  data.profile.displayName || '',
        });
      }
    } catch (e) { console.error('loadProfile error:', e); }
  }


  async function saveProfile() {
    setProfileSaving(true);
    setProfileMsg('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (res.ok) {
        setProfileMsg('✓ Profile saved');
        // Refresh JWT so session.user.name stays in sync with the shareable link
        await updateSession({ name: profile.name });
      } else {
        setProfileMsg('Save failed — try again');
      }
    } catch { setProfileMsg('Save failed — try again'); }
    setProfileSaving(false);
    setTimeout(() => setProfileMsg(''), 3000);
  }

  async function uploadPhoto(file) {
    if (!file) return;
    setPhotoUploading(true);
    setPhotoMsg('');
    try {
      // Client-side resize/compress using canvas
      const dataUrl = await compressImage(file, 400, 0.82);
      const sizeKB = Math.round((dataUrl.length * 0.75) / 1024);
      if (sizeKB > 600) {
        setPhotoMsg('Photo too large — try a smaller image');
        setPhotoUploading(false);
        return;
      }
      const res = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: dataUrl }),
      });
      if (res.ok) {
        setProfile(p => ({ ...p, photoUrl: dataUrl }));
        setPhotoMsg('✓ Photo saved');
      } else {
        const err = await res.json();
        setPhotoMsg(err.error || 'Upload failed');
      }
    } catch (e) {
      setPhotoMsg('Upload failed — try again');
    }
    setPhotoUploading(false);
    setTimeout(() => setPhotoMsg(''), 3000);
  }

  function compressImage(file, maxPx, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new window.Image();
        img.onload = () => {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadCreds() {
    try {
      const res = await fetch('/api/credentials');
      if (res.ok) {
        const data = await res.json();
        setCreds(data.credentials || {});
        setCredsLoaded(true);
      }
    } catch (e) { console.error('loadCreds error:', e); }
  }

  async function saveCred(field, value) {
    setCredsSaving(s => ({ ...s, [field]: true }));
    setCredsMsg(m => ({ ...m, [field]: '' }));
    try {
      const res = await fetch('/api/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const ok = res.ok;
      setCredsMsg(m => ({ ...m, [field]: ok ? '✓ Saved' : 'Save failed' }));
      if (ok) {
        setCreds(c => ({ ...c, [field]: { isSet: !!value, masked: value ? value.slice(0,4)+'••••••••'+value.slice(-3) : '' } }));
        loadChecklist();
      }
    } catch { setCredsMsg(m => ({ ...m, [field]: 'Save failed' })); }
    setCredsSaving(s => ({ ...s, [field]: false }));
    setTimeout(() => setCredsMsg(m => ({ ...m, [field]: '' })), 3000);
  }

  async function loadAiUsage() {
    try {
      const res = await fetch('/api/ai-usage');
      if (res.ok) {
        const data = await res.json();
        setAiUsage({ used: data.used || 0, cap: data.cap || 100, month: data.month || '' });
      }
    } catch (e) { console.error('loadAiUsage:', e); }
  }

  async function submitManualLead() {
    if (!manualForm.fname) return;
    if (!manualForm.email && !manualForm.phone) return;
    setManualSubmitting(true);
    setManualResult(null);
    try {
      const res = await fetch('/api/leads/manual', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(manualForm),
      });
      const data = await res.json();
      if (res.ok) {
        setManualResult(data);
        // Reload leads so new lead appears in dashboard
        loadLeads();
        loadChecklist();
      } else {
        console.error('Manual lead error:', data.error);
      }
    } catch (e) { console.error('submitManualLead:', e); }
    setManualSubmitting(false);
  }

  async function submitWaitlist() {
    if (!waitlistForm.email) return;
    setWaitlistLoading(true);
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: waitlistPlan, ...waitlistForm }),
      });
      setWaitlistSent(true);
    } catch (e) { console.error('waitlist error:', e); }
    setWaitlistLoading(false);
  }

  async function submitUpgradeInterest() {
    setUpgradeInterestLoading(true);
    try {
      await fetch('/api/upgrade-interest', { method: 'POST' });
      setUpgradeInterestSent(true);
    } catch (e) { console.error('upgradeInterest:', e); }
    setUpgradeInterestLoading(false);
  }

  async function loadChecklist() {
    try {
      const [profRes, credsRes] = await Promise.all([
        fetch('/api/profile'),
        fetch('/api/credentials'),
      ]);
      const profData  = profRes.ok  ? await profRes.json()  : {};
      const credsData = credsRes.ok ? await credsRes.json() : {};
      const p   = profData.profile || {};
      const c   = credsData.credentials || {};
      setChecklist({
        profile: !!(p.name && p.notifyEmail),
        zillow:  !!(p.zillowDone || p.homesDone || p.realtorDone || p.redfinDone),
        sms:     !!(c.twilioSid?.isSet && c.twilioPhone?.isSet),
        website: !!(c.webhookSecret?.isSet),
      });
    } catch (e) { console.error('loadChecklist:', e); }
  }

  async function loadLeads() {
    try {
      const url = filter === 'all' ? '/api/leads' : `/api/leads?filter=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      setLeads(data.leads || []);

      const statsRes = await fetch('/api/leads?stats=true');
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (e) {
      console.error('Failed to load leads:', e);
    }
  }

  // Re-filter when filter changes
  useEffect(() => {
    if (view === 'dashboard') loadLeads();
  }, [filter]);

  async function deleteLead(leadId) {
    if (!confirm('Delete this lead? This cannot be undone.')) return;
    try {
      await fetch(`/api/leads/${leadId}`, { method: 'DELETE' });
      setLeads(prev => prev.filter(l => l.id !== leadId));
      setOpenDetailId(null);
    } catch (e) { alert('Delete failed — try again'); }
  }

  async function submitLead() {
    const fname = form.fname || 'Alex';
    const lname = form.lname || 'Johnson';
    const email = form.email || 'alex@example.com';
    const { phone, property, message, source, wantsSms } = form;
    const propText = property || '3BR home in Hyde Park';
    const msgText = message || "Hi, I'm interested in this property. Can I schedule a showing?";

    const lead = {
      id: uuidv4(),
      fname, lname, email, phone,
      property: propText,
      source,
      messages: [{ role: 'lead', text: msgText }],
      score: null,
      summary: '',
      smsSent: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCurrentLead(lead);
    const initHistory = [{ role: 'user', content: msgText }];
    setConversationHistory(initHistory);

    // Show connecting screen before switching to conversation view
    setDemoConnecting(true);
    setSubmitting(true);

    const systemPrompt = buildSystemPrompt(fname, lname, email, phone, propText, source, msgText, session?.user?.name);

    try {
      // Fire API call immediately in background
      const apiPromise = callAPI('/api/chat', { system: systemPrompt, messages: initHistory });

      // Hold connecting screen for 1.5s
      await new Promise(r => setTimeout(r, 1500));
      setDemoConnecting(false);

      // Now show chat with buyer message + typing indicator
      setChatMessages([{ role: 'lead', name: `${fname} ${lname}`, text: msgText }]);
      setView('conversation');
      setIsTyping(true);

      const data = await apiPromise;
      const reply = data.reply;

      // Scale delay to reply length
      await new Promise(r => setTimeout(r, typingDelay(reply)));
      setIsTyping(false);

      const newHistory = [...initHistory, { role: 'assistant', content: reply }];
      setConversationHistory(newHistory);
      setChatMessages(prev => [...prev, { role: 'ai', name: session?.user?.name || 'Anna Williams', text: reply }]);
      lead.messages.push({ role: 'ai', text: reply });

      // Send real SMS if requested
      if (phone && wantsSms) {
        try {
          const smsRes = await fetch('/api/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: phone, message: reply }),
          });
          if (smsRes.ok) {
            lead.smsSent = true;
            setChatMessages(prev => [...prev, { role: 'system', text: `📱 Real SMS sent to ${phone}` }]);
          }
        } catch (e) { console.error('SMS error:', e); }
      }

      // Save lead separately — never let a failed save pollute the chat UI
      callAPI('/api/leads', lead).catch(e => console.error('Lead save error (submitLead):', e));
      setCurrentLead({ ...lead });
    } catch (e) {
      // Only fires if the AI API call itself fails
      console.error('submitLead AI error:', e);
      setIsTyping(false);
    }
    setSubmitting(false);
  }

  async function sendReply() {
    if (!replyText.trim() || !currentLead) return;
    const text = replyText.trim();
    setReplyText('');

    const newHistory = [...conversationHistory, { role: 'user', content: text }];
    setConversationHistory(newHistory);
    setChatMessages(prev => [...prev, { role: 'lead', name: `${currentLead.fname} ${currentLead.lname}`, text }]);

    const updatedLead = { ...currentLead, messages: [...currentLead.messages, { role: 'lead', text }] };
    setCurrentLead(updatedLead);

    setIsTyping(true);

     //    const systemPrompt = `You are a real estate assistant texting on behalf of ${session?.user?.name || 'the agent'} about ${currentLead.property}. Sound human and warm. Never mention AI.
    //Continue qualifying (budget, timeline, pre-approval). Stay warm and brief (3 sentences max). If they want a showing, offer 2-3 realistic time slots.`;

    // Build a full qualifying system prompt — same rules as the live agent path
    const agentDisplayName = session?.user?.name || 'the agent';

    // Extract what's already been established from prior messages
    const allLeadMessages = updatedLead.messages.filter(m => m.role === 'lead').map(m => m.text);
    const allAiMessages   = updatedLead.messages.filter(m => m.role === 'ai').map(m => m.text);

    // Build explicit "already asked / already answered" context
    const askedQuestions  = allAiMessages.join(' ');
    const leadAnswers     = allLeadMessages.join(' ');
    const timelineAsked   = /timeline|moving|when|how soon/i.test(askedQuestions);
    const budgetAsked     = /budget|price range|afford|spend/i.test(askedQuestions);
    const preApprovalAsked = /pre.?approv|lender|financ/i.test(askedQuestions);
    const phoneAsked      = /callback|phone|number|call you/i.test(askedQuestions);

    const knownFacts = [];
    if (/\b\d+\s*day/i.test(leadAnswers) || /\b\d+\s*month/i.test(leadAnswers) || /\bASAP\b|immediately|right away/i.test(leadAnswers))
      knownFacts.push('timeline: already provided by lead');
    if (/\$[\d,]+|\d+k\b|budget|afford/i.test(leadAnswers))
      knownFacts.push('budget: already provided by lead');
    if (phoneAsked || /\d{10}|\d{3}[-.\s]\d{3}/i.test(leadAnswers))
      knownFacts.push('phone/callback: already collected');
    const knownBlock = knownFacts.length > 0
      ? `\nALREADY COLLECTED (DO NOT ASK AGAIN):\n${knownFacts.map(f => `- ${f}`).join('\n')}`
      : '';

    // Detect if showing has been confirmed — conversation is complete
    const demoShowingConfirmed = (
      /\b(see you|sounds good|that works|works for me|confirmed|done deal|perfect|i'll be there|see you then|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/i.test(leadAnswers) &&
      /\b(10am|11am|12pm|1pm|2pm|3pm|4pm|5pm|morning|afternoon|evening|weekend|\d+(am|pm))\b/i.test(leadAnswers + askedQuestions) &&
      /\b(showing|schedule|book|lock in|appointment|visit|see the|tour)\b/i.test(askedQuestions)
    );

    const conversationSystemPrompt = `You are ${agentDisplayName}, a real estate agent, texting directly with a lead about ${currentLead.property}.

IDENTITY: You are NOT an AI — you ARE the agent. Never refer to yourself as "the agent" or say "our agent will". Never mention AI, bots, or automation. If asked if you're a bot, deflect naturally: "Nope, just me!"
${knownBlock}
${demoShowingConfirmed ? `CONVERSATION COMPLETE:
A showing has been scheduled and the lead confirmed a time. Send ONE warm closing message — confirm the day/time, say you're looking forward to it, wish them well. Do NOT ask any more questions. The conversation is done.` : `CORE RULES:
- Sound like a real human texting — warm, natural, conversational
- 2–3 sentences max per reply
- ONE question at a time — never ask two things
- Always acknowledge what they just said before moving on
- NEVER repeat a question you already asked in this conversation
- NEVER ask for something you already have

ANTI-REPETITION (CRITICAL):
Before you reply, mentally check: "Did I already ask this? Did they already answer this?"
If yes → skip it entirely and ask the NEXT unknown thing or move toward scheduling.

QUALIFY IN THIS ORDER (skip any already answered):
${timelineAsked ? '✓ Timeline — DONE' : '1. Timeline — when are they looking to move?'}
${budgetAsked   ? '✓ Budget — DONE'   : '2. Budget — do they have a price range?'}
${preApprovalAsked ? '✓ Pre-approval — DONE' : '3. Pre-approval — have they been pre-approved?'}
4. If timeline is short (≤60 days) and budget known → move toward scheduling a showing or call

PROGRESSION — every reply should do ONE of:
- Acknowledge what they said + move to the next unknown
- Move toward a showing or call with ${agentDisplayName}

NEVER: bullet points, formal tone, sign-offs, or mention AI.`}`;
    try {
      const data = await callAPI('/api/chat', { system: conversationSystemPrompt, messages: newHistory });
      const reply = data.reply;

      // Scale typing delay to reply length — feels human
      await new Promise(r => setTimeout(r, typingDelay(reply)));
      setIsTyping(false);

      setConversationHistory(prev => [...prev, { role: 'assistant', content: reply }]);
      setChatMessages(prev => [...prev, { role: 'ai', name: session?.user?.name || 'Anna Williams', text: reply }]);

      const finalLead = { ...updatedLead, messages: [...updatedLead.messages, { role: 'ai', text: reply }], updatedAt: new Date().toISOString() };
      setCurrentLead(finalLead);

      // Save lead separately — never let a failed save pollute the chat UI
      callAPI('/api/leads', finalLead).catch(e => console.error('Lead save error:', e));

      if (finalLead.smsSent && finalLead.phone) {
        fetch('/api/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: finalLead.phone, message: reply }),
        }).catch(() => {});
      }
    } catch (e) {
      // Only fires if the AI API call itself fails — not for save errors
      console.error('sendReply AI error:', e);
      setIsTyping(false);
      // Don't show a fake message — just clear the typing indicator silently
    }
  }

  async function goToDashboard() {
    if (!currentLead) { setView(session ? 'dashboard' : 'demo-dashboard'); return; }
    setScoring(true);

    const convo = (currentLead.messages || []).map(m => (m.role === 'ai' ? 'Assistant' : 'Lead') + ': ' + m.text).join('\n');
    const messageCount = (currentLead.messages || []).filter(m => m.role === 'lead').length;

    try {
      const data = await callAPI('/api/chat', {
        system: 'You are a real estate lead scoring expert. Respond ONLY with valid JSON — no markdown, no backticks, no explanation.',
        messages: [{ role: 'user', content: `Analyze this real estate lead.\n\nName: ${currentLead.fname} ${currentLead.lname}\nProperty: ${currentLead.property}\nSource: ${currentLead.source}\nMessages from lead: ${messageCount}\n\nConversation:\n${convo}\n\nSCORING RULES (strict):\nHOT = ANY: timeline ≤60 days, specific budget, pre-approved, cash buyer, asks to schedule showing, asks to make offer, urgency language\nWARM = Interested and responsive but timeline/budget unclear\nCOLD = Just browsing, no urgency, no budget, vague\n\nRespond with ONLY this JSON:\n{"score":"HOT"|"WARM"|"COLD","confidence":"high"|"medium"|"low","signals":{"timeline":"string or null","budget":"string or null","preApproved":true|false|null,"alsoSelling":true|false|null,"motivation":"string or null","urgencyLevel":"high"|"medium"|"low"},"summary":"2-sentence brief about who they are and what they want.","nextAction":"Specific recommended next step with timing."}` }],
        max_tokens: 400,
      });
      const clean = data.reply.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd   = clean.lastIndexOf('}');
      const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
      currentLead.score      = ['HOT','WARM','COLD'].includes(parsed.score) ? parsed.score : 'WARM';
      currentLead.confidence = parsed.confidence || 'medium';
      currentLead.signals    = parsed.signals    || {};
      currentLead.summary    = parsed.summary    || '';
      currentLead.nextAction = parsed.nextAction || 'Follow up to schedule a showing.';
    } catch {
      currentLead.score      = 'WARM';
      currentLead.confidence = 'low';
      currentLead.signals    = {};
      currentLead.summary    = currentLead.fname + ' inquired about ' + currentLead.property + '. Follow up.';
      currentLead.nextAction = 'Follow up to qualify.';
    }

    if (session) {
      // Logged in — save to DB and go to real dashboard
      await callAPI('/api/leads', { ...currentLead, updatedAt: new Date().toISOString() });
      setScoring(false);
      setView('dashboard');
    } else {
      // Not logged in — show demo dashboard with scored lead
      setDemoLead({ ...currentLead, updatedAt: new Date().toISOString() });
      setScoring(false);
      setView('demo-dashboard');
    }
  }

  function continueConvo(lead) {
    setCurrentLead(lead);
    setConversationHistory(lead.messages.map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text,
    })));
    setChatMessages(lead.messages.map(m => ({
      role: m.role,
      name: m.role === 'ai' ? (session?.user?.name || 'Anna Williams') : `${lead.fname} ${lead.lname}`,
      text: m.text,
    })));
    setView('conversation');
  }

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div style={{ color: '#666' }}>Loading…</div>
      </div>
    );
  }

  // Declared at component scope so all JSX sections can reference them
  const agentId = session?.user?.id || '';
  const inboundAddr = agentId ? `${agentId}@inbound.sayhelloleads.com` : '';

  return (
    <>
      <Head>
        <title>Say HelloLeads — AI Lead Response</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Leads respond because they think they're texting you — not talking to a chatbot." />
        <meta property="og:title" content="Say HelloLeads — Respond to every lead in 60 seconds." />
        <meta property="og:description" content="Leads respond because they think they're texting you" />
        <meta property="og:image" content="https://sayhelloleads.com/preview.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:url" content="https://sayhelloleads.com" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Say HelloLeads" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Say HelloLeads — Respond to every lead in 60 seconds" />
        <meta name="twitter:description" content="Leads respond because they think they're texting you." />
        <meta name="twitter:image" content="https://sayhelloleads.com/preview.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{GLOBAL_CSS}</style>

      {/* NAV */}
      <nav>
        <div className="logo">Say <span>HelloLeads</span></div>
        <div className="nav-links">
          <a onClick={() => setView('landing')}>Home</a>
          {!session && <a onClick={() => setHowItWorksOpen(true)} style={{ cursor: 'pointer' }}>How it works</a>}
          {session && <a onClick={() => setView('dashboard')}>Dashboard</a>}
          {session ? (
            <div className="nav-avatar-wrap" ref={avatarRef}>
              <button
                className="avatar-btn"
                onClick={() => setAvatarOpen(o => !o)}
                aria-label="Account menu"
              >
                <div className="avatar-circle" style={{ overflow: 'hidden', padding: 0 }}>
                  {profile.photoUrl
                    ? <img src={profile.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : (session.user?.name || session.user?.email || '?').charAt(0).toUpperCase()
                  }
                </div>
              </button>
              {avatarOpen && (
                <div className="avatar-dropdown">
                  <div className="avatar-header">
                    <div className="avatar-circle lg" style={{ overflow: 'hidden', padding: 0 }}>
                      {profile.photoUrl
                        ? <img src={profile.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                        : (session.user?.name || session.user?.email || '?').charAt(0).toUpperCase()
                      }
                    </div>
                    <div>
                      <div className="avatar-name">{session.user?.name || 'Agent'}</div>
                      <div className="avatar-email">{session.user?.email}</div>
                    </div>
                  </div>
                  <div className="avatar-menu">
                    <button className="avatar-item" onClick={() => { setView('profile'); setAvatarOpen(false); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      Profile
                    </button>
                    <button className="avatar-item" onClick={() => { setView('integrations'); setAvatarOpen(false); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M12 2a10 10 0 0 1 7.07 2.93M4.93 4.93a10 10 0 0 0 0 14.14M12 22a10 10 0 0 1-7.07-2.93"/></svg>
                      Integrations
                    </button>
                    <button className="avatar-item" onClick={() => { setHowItWorksOpen(true); setAvatarOpen(false); }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
                    </svg>
                    How it works
                    </button>
                    <div className="avatar-divider" />
                    <a className="avatar-item" href="mailto:support@sayhelloleads.com" onClick={() => setAvatarOpen(false)}
                      style={{ textDecoration: 'none', color: 'var(--black)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      Get support
                    </a>
                    <div className="avatar-divider" />
                    <button className="avatar-item danger" onClick={() => { setAvatarOpen(false); signOut({ callbackUrl: '/' }); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <a href="/login" style={{ background: 'var(--sage)', color: '#fff', padding: '.45rem 1.1rem', borderRadius: '8px', fontSize: '14px', fontWeight: '500', textDecoration: 'none' }}>Sign in</a>
          )}
        </div>
      </nav>

      {/* LANDING */}
      {view === 'landing' && (
        <section className="fade-in">

          {/* ── HERO ────────────────────────────────────────────────── */}
          <div className="hero">
            <div className="hero-badge">✦ AI-powered · Built for real estate agents</div>
            <h1>Respond to every lead in 60 seconds.<br /><em>Know who to call first.</em></h1>
            <p>Say HelloLeads responds to every inquiry in under 60 seconds, qualifies the conversation, and tells you exactly who's worth calling — so you spend your time closing, not chasing.</p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => router.push('/register')}>Start free — no credit card →</button>
              <button className="btn-outline" onClick={() => setView('demo')}>See live demo</button>
            </div>
            <div style={{ marginTop: '1.5rem', fontSize: '13px', color: 'var(--muted)', display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <span>✓ Setup in under 5 minutes</span>
              <span>✓ Works with Zillow, Homes.com, Realtor.com + more</span>
              <span>✓ Cancel anytime</span>
            </div>
          </div>

          {/* ── NOT A BOT BANNER ────────────────────────────────────── */}
          <div style={{ background: 'var(--black)', color: 'var(--white)', padding: '1.1rem 2rem', textAlign: 'center', fontSize: '14px' }}>
            <span style={{ opacity: .7, marginRight: '.5rem' }}>💬</span>
            <strong>Sounds like you, not a bot.</strong>
            <span style={{ color: 'rgba(255,255,255,.6)', marginLeft: '.75rem' }}>Leads respond because they think they're texting you — not talking to a chatbot.</span>
          </div>

          {/* ── PAIN STATS ──────────────────────────────────────────── */}
          <div className="stats-bar">
            {[
              ['15 hrs', 'avg agent response time'],
              ['41%',    'of leads never contacted'],
              ['5×',     'more conversions with <5min reply'],
              ['$14k+',  'avg monthly revenue left on table'],
            ].map(([n,l]) => (
              <div className="stat-item" key={l}>
                <div className="stat-num">{n}</div>
                <div className="stat-label">{l}</div>
              </div>
            ))}
          </div>

          {/* ── SPEED TO LEAD ───────────────────────────────────────── */}
          <div style={{ background: 'var(--cream)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '4rem 2rem' }}>
            <div style={{ maxWidth: '860px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3rem', alignItems: 'center' }}>
              <div>
                <div className="section-label">Speed-to-lead is everything</div>
                <div className="section-title" style={{ marginBottom: '1rem' }}>The first agent to reply wins the deal.</div>
                <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '1.25rem' }}>
                  Buyers contact multiple agents at once. Whoever replies first — and sounds the most human — earns the trust. The industry average is 15 hours. Say HelloLeads replies in under 60 seconds, every time, day or night.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  {[
                    ['🏆', 'First to reply wins', '78% of buyers choose the agent who responds first'],
                    ['⏱️', 'Speed drops fast', 'A 5-minute reply is 21× more effective than a 30-minute one'],
                    ['😴', "Leads don't wait", "Most inquiries happen evenings and weekends — when you're offline"],
                  ].map(([icon, title, desc]) => (
                    <div key={title} style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '1.1rem', marginTop: '.1rem' }}>{icon}</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--black)' }}>{title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '16px', padding: '2rem' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '1.25rem' }}>Without Say HelloLeads</div>
                {[
                  ['Lead submits inquiry', '12:00 pm', 'var(--muted)', ''],
                  ['You finish showing a home', '2:30 pm', 'var(--muted)', ''],
                  ['You see the notification', '4:15 pm', 'var(--muted)', ''],
                  ['You reply to the lead', '4:22 pm', '#c0392b', '4+ hours later'],
                  ['Lead already signed with someone else', '4:23 pm', '#c0392b', '💸'],
                ].map(([event, time, color, tag]) => (
                  <div key={event} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem', fontSize: '13px' }}>
                    <span style={{ color: 'var(--muted)', width: '52px', flexShrink: 0, fontSize: '12px' }}>{time}</span>
                    <span style={{ color }}>{event}</span>
                    {tag && <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: '600', color: '#c0392b', whiteSpace: 'nowrap' }}>{tag}</span>}
                  </div>
                ))}
                <div style={{ height: '1px', background: 'var(--border)', margin: '1.25rem 0' }} />
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '1rem' }}>With Say HelloLeads</div>
                {[
                  ['Lead submits inquiry', '12:00 pm', 'var(--muted)', ''],
                  ['AI responds instantly', '12:00 pm', 'var(--sage)', '< 60 seconds ✓'],
                  ['AI qualifies the lead', '12:02 pm', 'var(--sage)', 'budget, timeline, pre-approval'],
                  ['You get a 🔥 HOT alert', '12:03 pm', 'var(--sage)', 'call now'],
                ].map(([event, time, color, tag]) => (
                  <div key={event} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem', fontSize: '13px' }}>
                    <span style={{ color: 'var(--muted)', width: '52px', flexShrink: 0, fontSize: '12px' }}>{time}</span>
                    <span style={{ color }}>{event}</span>
                    {tag && <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: '600', color: 'var(--sage)', whiteSpace: 'nowrap' }}>{tag}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── PROBLEM → SOLUTION ──────────────────────────────────── */}
          <div style={{ maxWidth: '860px', margin: '4rem auto', padding: '0 2rem' }}>
            <div className="section-label">The problem</div>
            <div className="section-title">You work hard to get leads.<br />Then life gets in the way.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '3rem' }}>
              {[
                ['😰', "You're showing a home when a Zillow lead texts in.", "They don't hear back for 6 hours. They've already booked with someone else."],
                ['😤', "You follow up once. They don't reply.", "44% of agents give up after one contact. It takes 5+ to close."],
                ['😓', "You pay $500/mo for Zillow leads.", "Almost half are never contacted. That's money straight in the trash."],
              ].map(([emoji, prob, pain]) => (
                <div key={prob} style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.5rem' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '.75rem' }}>{emoji}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '.4rem', color: 'var(--black)' }}>{prob}</div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6' }}>{pain}</div>
                </div>
              ))}
            </div>

            <div className="section-label">The solution</div>
            <div className="section-title">Say HelloLeads works while you sleep.</div>
            <div className="steps">
              {[
                ['1', 'Lead comes in — any source', 'Zillow, Homes.com, Realtor.com, a text, or your website. Any time, day or night.'],
                ["2", "AI responds in under 60s", "A warm, human reply goes out immediately — written in your voice, referencing the exact property. Leads think they're texting your assistant."],
                ["3", "Lead gets qualified", "The AI has a natural back-and-forth — uncovering timeline, budget, pre-approval status, and motivation without ever feeling like a script."],
                ['4', 'You get the brief', '🔥 Hot leads trigger an instant alert with everything you need: who they are, what they want, and exactly what to say when you call.'],
              ].map(([n,h,p]) => (
                <div className="step" key={n}><div className="step-num">{n}</div><h3>{h}</h3><p>{p}</p></div>
              ))}
            </div>
          </div>

          {/* ── LEAD SCORE EXPLAINER ────────────────────────────────── */}
          <div style={{ background: 'var(--cream)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '4rem 2rem' }}>
            <div style={{ maxWidth: '860px', margin: '0 auto' }}>
              <div className="section-label">AI lead scoring</div>
              <div className="section-title">Know exactly who to call first.</div>
              <p style={{ fontSize: '14px', color: 'var(--muted)', maxWidth: '540px', lineHeight: '1.8', marginBottom: '2rem' }}>
                After every conversation the AI scores the lead automatically. No guesswork — just a clear signal on where to spend your time.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <div style={{ background: '#fde8e8', border: '1.5px solid #f5c6c6', borderRadius: '14px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🔥</span>
                    <span style={{ fontWeight: '700', color: 'var(--red)', fontSize: '15px' }}>HOT</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--black)', lineHeight: '1.7' }}>
                    Ready to buy within <strong>30 days</strong>. Has a budget. Pre-approved or cash buyer. Asking about specific properties, not just browsing.
                  </div>
                  <div style={{ marginTop: '.75rem', fontSize: '12px', color: 'var(--red)', fontWeight: '600' }}>→ Call within 5 minutes</div>
                </div>
                <div style={{ background: 'var(--amber-light)', border: '1.5px solid #f0d9b5', borderRadius: '14px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🌤️</span>
                    <span style={{ fontWeight: '700', color: 'var(--amber)', fontSize: '15px' }}>WARM</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--black)', lineHeight: '1.7' }}>
                    Interested but timeline is <strong>vague</strong>. May not be pre-approved yet. Exploring options. Responds to follow-up.
                  </div>
                  <div style={{ marginTop: '.75rem', fontSize: '12px', color: 'var(--amber)', fontWeight: '600' }}>→ Nurture with weekly check-ins</div>
                </div>
                <div style={{ background: '#e8eef8', border: '1.5px solid #c5d0e8', borderRadius: '14px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>❄️</span>
                    <span style={{ fontWeight: '700', color: '#5470a0', fontSize: '15px' }}>COLD</span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--black)', lineHeight: '1.7' }}>
                    <strong>Just browsing</strong>. No timeline, no budget clarity, very early research stage. Low urgency or potentially not a real buyer.
                  </div>
                  <div style={{ marginTop: '.75rem', fontSize: '12px', color: '#5470a0', fontWeight: '600' }}>→ Add to long-term drip</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── INTEGRATIONS ────────────────────────────────────────── */}
          <div className="integration-bar">
            <h3>Works with every lead source <em>automatically</em></h3>
            <div className="integrations">
              {['Zillow Premier Agent','Homes.com','Realtor.com','Redfin','Facebook & Instagram Ads','SMS / Text','Your Website','Zapier / Webhooks'].map(s => (
                <div className="integration-chip" key={s}><span className="dot-green" />{s}</div>
              ))}
            </div>
          </div>

          {/* ── SOCIAL PROOF ────────────────────────────────────────── */}
          <div style={{ maxWidth: '860px', margin: '4rem auto', padding: '0 2rem' }}>
            <div className="section-label">What agents say</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
              {[
                ['“I used to lose leads every weekend. Now they get a response in under a minute — whether I’m showing a home or at my kid’s soccer game.”', 'Maria C.', 'Keller Williams, Cincinnati'],
                ['“My Zillow spend was $600/mo and I was missing half the leads. In the first week using this I booked 3 showings from leads I would have lost.”', 'James T.', 'RE/MAX, Columbus'],
                ['“The AI sounds more professional than my usual texts. Leads actually think they’re talking to my assistant. That’s exactly what I wanted.”', 'Priya S.', 'Independent Agent, Dayton'],
              ].map(([quote, name, title]) => (
                <div key={name} style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.5rem' }}>
                  <div style={{ fontSize: '13px', color: 'var(--black)', lineHeight: '1.7', marginBottom: '1rem', fontStyle: 'italic' }}>{quote}</div>
                  <div style={{ fontSize: '13px', fontWeight: '600' }}>{name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{title}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── FAQ ─────────────────────────────────────────────────── */}
          <div style={{ background: 'var(--cream)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '4rem 2rem' }}>
            <div style={{ maxWidth: '680px', margin: '0 auto' }}>
              <div className="section-label">Common questions</div>
              <div className="section-title">Straight answers.</div>
              {[
                ["Does it sound like a bot?", "No. The AI is trained to sound like a real person texting — warm, natural, and specific to the property the lead asked about. We hear this a lot: agents' leads think they're talking to their assistant."],
                ["What happens when I'm available?", "The AI handles the first response and qualifies the lead. When a lead is HOT you get an instant alert with everything you need to take over the conversation. You decide when to step in."],
                ["Do leads know it's AI?", "No — and that's intentional. The AI never identifies itself as a bot. It replies in your name and voice. Leads engage because it feels like a real person reaching out."],
                ['Which lead sources does it work with?', 'Zillow, Homes.com, Realtor.com, Redfin, Facebook Lead Ads, SMS, your website contact form, and any source that can send an email or a webhook — including Zapier.'],
                ["How long does setup take?", "Under 5 minutes for most agents. You forward your Zillow (or Homes.com, Realtor.com) lead notification emails to your unique address and you're live. No developer needed."],
                ["What if a lead asks a question the AI can't answer?", "If the AI doesn't know a specific detail — like a listing price or square footage — it says it'll confirm and follow up. It never invents answers."],
              ].map(([q, a], i) => (
                <FAQItem key={i} question={q} answer={a} />
              ))}
            </div>
          </div>

          {/* ── PRICING ─────────────────────────────────────────────── */}
          <div style={{ padding: '4rem 2rem' }}>
            <div style={{ maxWidth: '720px', margin: '0 auto', textAlign: 'center' }}>
              <div className="section-label">Pricing</div>
              <div className="section-title" style={{ margin: '0 auto 2rem' }}>Simple, straightforward.</div>
              <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: '2rem' }}>Start with Solo. Team & Brokerage plans launching soon.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {[
                  { 
                    name: 'Solo Agent', 
                    price: '$79', 
                    period: '/mo', 
                    features: ['1 agent', 'Unlimited leads', 'AI responses + scoring', 'Email alerts', 'Zillow + SMS + Website'], 
                    highlight: true,
                    comingSoon: false
                  },
                  { 
                    name: 'Team', 
                    price: '$299', 
                    period: '/mo', 
                    features: ['Up to 5 agents', 'Everything in Solo', 'Team dashboard', 'Priority support', 'Onboarding call'], 
                    highlight: false,
                    comingSoon: true
                  },
                  { 
                    name: 'Brokerage', 
                    price: '$999', 
                    period: '/mo', 
                    features: ['Up to 20 agents', 'Everything in Team', 'Custom branding', 'API access', 'Dedicated support'], 
                    highlight: false,
                    comingSoon: true
                  },
                ].map(plan => (
                  <div key={plan.name} style={{
                    background: plan.highlight ? 'var(--sage)' : 'var(--white)',
                    border: `2px solid ${plan.highlight ? 'var(--sage)' : 'var(--border)'}`,
                    borderRadius: '16px',
                    padding: '1.75rem',
                    color: plan.highlight ? '#fff' : 'var(--black)',
                    position: 'relative',
                    opacity: plan.comingSoon ? 0.75 : 1,
                    transform: plan.highlight ? 'scale(1.03)' : 'scale(1)',
                    transition: 'all 0.2s ease'
                  }}>
                
                    {/* BADGES */}
                    {plan.highlight && !plan.comingSoon && (
                      <div style={{
                        position: 'absolute',
                        top: '-12px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'var(--amber)',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: '700',
                        padding: '3px 12px',
                        borderRadius: '20px',
                        textTransform: 'uppercase',
                        letterSpacing: '.05em'
                      }}>
                        Start Here
                      </div>
                    )}
                
                    {plan.comingSoon && (
                      <div style={{
                        position: 'absolute',
                        top: '-12px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: '#999',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: '700',
                        padding: '3px 12px',
                        borderRadius: '20px',
                        textTransform: 'uppercase',
                        letterSpacing: '.05em'
                      }}>
                        Coming soon
                      </div>
                    )}
                
                    {/* NAME */}
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '.5rem', opacity: plan.highlight ? .9 : 1 }}>
                      {plan.name}
                    </div>
                
                    {/* PRICE */}
                    <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: '2.2rem', lineHeight: '1', marginBottom: '.2rem' }}>
                      {plan.price}
                      <span style={{ fontSize: '14px', fontWeight: '400' }}>{plan.period}</span>
                    </div>
                
                    <div style={{
                      height: '1px',
                      background: plan.highlight ? 'rgba(255,255,255,.2)' : 'var(--border)',
                      margin: '1rem 0'
                    }} />
                
                    {/* FEATURES */}
                    {plan.features.map(f => (
                      <div key={f} style={{ fontSize: '13px', marginBottom: '.4rem', opacity: plan.highlight ? .9 : .85 }}>
                        ✓ {f}
                      </div>
                    ))}
                
                    {/* BUTTON */}
                    <button
                      onClick={() => {
                        if (plan.comingSoon) {
                          setWaitlistPlan(plan.name.toLowerCase());
                          setWaitlistSent(false);
                          setWaitlistForm({ name: '', email: '', agencyName: '' });
                        } else {
                          router.push('/register');
                        }
                      }}
                      style={{
                        width: '100%',
                        marginTop: '1.25rem',
                        background: plan.comingSoon
                          ? 'var(--sage)'
                          : (plan.highlight ? '#fff' : 'var(--sage)'),
                        color: plan.comingSoon
                          ? '#fff'
                          : (plan.highlight ? 'var(--sage)' : '#fff'),
                        border: 'none',
                        borderRadius: '8px',
                        padding: '.7rem',
                        fontSize: '14px',
                        fontFamily: "'DM Sans', sans-serif",
                        fontWeight: '600',
                        cursor: 'pointer',
                        opacity: 1,
                      }}
                    >
                      {plan.comingSoon ? 'Join waitlist →' : 'Get started →'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── FINAL CTA ───────────────────────────────────────────── */}
          <div className="demo-cta-block">
            <h2>See it work on a <em>real lead</em> right now</h2>
            <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={() => setView('demo')}>Try the live demo →</button>
              <button onClick={() => router.push('/register')} style={{ background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.4)', borderRadius: 'var(--radius)', padding: '.75rem 1.75rem', fontSize: '15px', fontFamily: "'DM Sans', sans-serif", fontWeight: '500', cursor: 'pointer' }}>Create free account</button>
            </div>
          </div>

        </section>
      )}

      {/* DEMO FORM */}
      {view === 'demo' && (
        <section className="fade-in" style={{ background: 'var(--bg, #f9fafb)', minHeight: '100vh' }}>

          {/* Demo top bar — matches agent page style */}
          <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: '600', fontSize: '15px' }}>Anna Williams</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>TeamAnna</span>
              <span style={{ background: 'var(--sage)', color: '#fff', fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', letterSpacing: '.04em' }}>DEMO</span>
            </div>
          </div>

          <div style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>

            {/* Agent header — matches agent page exactly */}
            <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
              <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'var(--sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: '600', margin: '0 auto 1rem', fontFamily: "'Instrument Serif', serif" }}>
                A
              </div>
              <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.75rem', marginBottom: '.2rem' }}>Anna Williams</h1>
              <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '.4rem' }}>TeamAnna</p>
              <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.6' }}>Say hi — I'll reply right away.</p>
              {/* Demo badge */}
              <div style={{ display: 'inline-block', marginTop: '.75rem', background: '#fff8e6', border: '1px solid #f0d080', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', color: '#8a6800' }}>
                🎭 This is a demo — enter a fake buyer inquiry below and see exactly what a real buyer experiences
              </div>
            </div>

            {/* Form card — matches agent page style */}
            <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: '16px', padding: '1.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.9rem' }}>
                <div><label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>First name *</label><input value={form.fname} onChange={e => setForm(f => ({...f, fname: e.target.value}))} placeholder="e.g. Maria" style={{ width: '100%', padding: '.65rem .9rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} /></div>
                <div><label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Last name</label><input value={form.lname} onChange={e => setForm(f => ({...f, lname: e.target.value}))} placeholder="e.g. Chen" style={{ width: '100%', padding: '.65rem .9rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} /></div>
              </div>
              <div style={{ marginBottom: '.9rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Email *</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="maria@email.com" style={{ width: '100%', padding: '.65rem .9rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
              </div>
              <div style={{ marginBottom: '.9rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Phone <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
                <input type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="(513) 555-0192" style={{ width: '100%', padding: '.65rem .9rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
              </div>
              <div style={{ marginBottom: '.9rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Property you're interested in</label>
                <AddressAutocomplete value={form.property} onChange={val => setForm(f => ({...f, property: val}))} placeholder="e.g. 412 Elm Street, 3BR in Hyde Park" className="setup-input" />
              </div>
              <div style={{ marginBottom: '.9rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Your message</label>
                <textarea value={form.message} onChange={e => setForm(f => ({...f, message: e.target.value}))} placeholder={`Hi Anna, I'm interested in...`} rows={3} style={{ width: '100%', padding: '.65rem .9rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: '14px', outline: 'none', resize: 'vertical' }} />
              </div>
              <div style={{ marginBottom: '.5rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>How did you hear about Anna?</label>
                <select value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))} style={{ width: '100%', padding: '.65rem .9rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'inherit', fontSize: '14px', outline: 'none', background: '#fff' }}>
                  {['Agent Website','Zillow','Homes.com','Realtor.com','Website','Referral','Sign call','Text message'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <button className="submit-btn" disabled={submitting} onClick={submitLead} style={{ marginTop: '1.25rem' }}>
              {submitting ? 'Connecting…' : 'Message Anna →'}
            </button>
            <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
              Your info is only shared with Anna Williams · TeamAnna. No spam, ever.
            </p>
            <p style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', marginTop: '.35rem' }}>
              <a onClick={() => setView('landing')} style={{ color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}>← Back to Say HelloLeads</a>
            </p>
          </div>
        </section>
      )}

      {/* CONVERSATION */}
      {/* ── DEMO CONNECTING SCREEN ──────────────────────────────────────────── */}
      {demoConnecting && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '360px', gap: '1.5rem' }}>
          <div style={{ width: '68px', height: '68px', borderRadius: '50%', background: 'var(--sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: '600', fontFamily: "'Instrument Serif', serif" }}>
            {(session?.user?.name || 'A').charAt(0).toUpperCase()}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '.4rem' }}>Connecting you with {session?.user?.name?.split(' ')[0] || 'the agent'}</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        </div>
      )}

      {view === 'conversation' && currentLead && (
        <section className="fade-in" style={{ maxWidth: '640px', margin: '3rem auto', padding: '0 1.5rem 4rem' }}>
          <div className="convo-header">
            <h2>Conversation with {currentLead.fname} {currentLead.lname}</h2>
            <p>{currentLead.source} lead · {currentLead.property}</p>
            <div className="lead-info">
              <span className="pill">{currentLead.source}</span>
              <span className="pill amber">{currentLead.property}</span>
              {currentLead.phone && <span className="pill">{currentLead.phone}</span>}
              {currentLead.smsSent && <span className="pill sms">📱 SMS active</span>}
            </div>
          </div>

          <div className="chat-window" ref={chatRef}>
            {chatMessages.map((msg, i) => (
              msg.role === 'system' ? (
                <div key={i} className="msg system-note">{msg.text}</div>
              ) : (
                <div key={i} className={`msg ${msg.role === 'ai' ? 'ai' : 'lead'}`}>
                  <div className="msg-label">{msg.name}</div>
                  <DemoMessageWithBooking text={msg.text} />
                </div>
              )
            ))}
            {isTyping && (
              <div className="typing">
                <span style={{ fontSize: '11px', color: 'var(--sage)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: '4px' }}>{session?.user?.name || 'Anna Williams'}</span>
                <div className="dot" /><div className="dot" /><div className="dot" />
              </div>
            )}
          </div>

          <div className="reply-row">
            <input
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendReply()}
              placeholder="Reply as the lead..."
              disabled={isTyping}
            />
            <button onClick={sendReply} disabled={isTyping || !replyText.trim()}>Send</button>
          </div>

          {session ? (
            <button
              className="go-dashboard-btn"
              onClick={goToDashboard}
              disabled={scoring}
            >
              {scoring ? 'Scoring lead with AI…' : 'Finish & view in agent dashboard →'}
            </button>
          ) : (
            <button
              className="go-dashboard-btn"
              onClick={goToDashboard}
              disabled={scoring}
              style={{ background: 'var(--sage)' }}
            >
              {scoring ? 'Scoring your lead…' : '💾 Save this lead — see it in your dashboard →'}
            </button>
          )}
        </section>
      )}

      {/* ── DEMO DASHBOARD ─────────────────────────────────────────────────── */}
      {view === 'demo-dashboard' && demoLead && (() => {
        const lead = demoLead;
        const scoreColors = { HOT: 'score-hot', WARM: 'score-warm', COLD: 'score-cold' };
        return (
          <section className="fade-in">
            {/* Sticky CTA banner */}
            <div style={{ background: 'var(--sage)', color: '#fff', padding: '.85rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', position: 'sticky', top: 0, zIndex: 50 }}>
              <div>
                <span style={{ fontWeight: '600', fontSize: '14px' }}>You're viewing Anna Williams' demo dashboard</span>
                <span style={{ fontSize: '13px', opacity: .85, marginLeft: '.75rem' }}>Your real leads will appear here once you sign up.</span>
              </div>
              <button
                onClick={() => router.push('/register')}
                style={{ background: '#fff', color: 'var(--sage)', border: 'none', borderRadius: '8px', padding: '.5rem 1.25rem', fontSize: '13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Create free account →
              </button>
            </div>

            <div className="dash-nav">
              <div>
                <h2 style={{ display: 'inline' }}>Anna Williams <span style={{ fontFamily: 'DM Sans, sans-serif', fontWeight: '400', fontSize: '15px', color: 'var(--muted)' }}>· TeamAnna</span></h2>
                <span style={{ fontSize: '12px', fontWeight: '400', color: 'var(--muted)', marginLeft: '.5rem' }}>— demo dashboard</span>
              </div>
              <div className="dash-nav-right">
                <div className="live-badge"><div className="live-dot" /> Live</div>
                {/* Blurred locked buttons */}
                <div style={{ filter: 'blur(2px)', pointerEvents: 'none', opacity: .5 }}>
                  <button className="btn-outline" style={{ fontSize: '13px', padding: '.4rem 1rem' }}>Profile &amp; setup</button>
                </div>
              </div>
            </div>

            <div className="dash-body">

              {/* KPI cards — real response time, demo counts */}
              <div className="dash-kpis">
                <div className="kpi highlight"><div className="kpi-label">response time</div><div className="kpi-val">&lt;60s</div><div className="kpi-sub">vs 15hr industry avg</div></div>
                <div className="kpi"><div className="kpi-label">total leads</div><div className="kpi-val">1</div><div className="kpi-sub">demo lead</div></div>
                <div className="kpi"><div className="kpi-label">hot leads</div><div className="kpi-val">{lead.score === 'HOT' ? 1 : 0}</div><div className="kpi-sub">need follow-up now</div></div>
                <div className="kpi"><div className="kpi-label">handled</div><div className="kpi-val">100%</div><div className="kpi-sub">first response</div></div>
              </div>

              {/* Blurred shareable link — shows concept */}
              <div style={{ position: 'relative', marginBottom: '2rem' }}>
                <div style={{ filter: 'blur(4px)', pointerEvents: 'none', background: 'var(--sage-light)', border: '1.5px solid var(--sage-mid)', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Your public inquiry page</div>
                  <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>https://sayhelloleads.com/agent/your-name</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '.2rem' }}>Share this link — buyers fill out the form and leads come straight to you.</div>
                </div>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '14px', background: 'rgba(249,250,251,.7)' }}>
                  <button onClick={() => router.push('/register')} style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.55rem 1.25rem', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                    🔓 Sign up to get your link
                  </button>
                </div>
              </div>

              {/* Lead section title */}
              <div className="dash-section-title" style={{ marginBottom: '.75rem' }}>Active leads</div>

              {/* The actual demo lead — fully visible, scored */}
              <div className="lead-cards">
                <div className={`lead-card ${lead.score === 'HOT' ? 'hot-lead' : 'new-lead'}`}
                  onClick={() => setOpenDetailId(openDetailId === lead.id ? null : lead.id)}>
                  <div className="lead-avatar">{(lead.fname?.[0] || '') + (lead.lname?.[0] || '')}</div>
                  <div className="lead-main">
                    <div className="lead-name">{lead.fname} {lead.lname}</div>
                    <div className="lead-preview">{(lead.summary || lead.messages?.slice(-1)[0]?.text || '').slice(0, 100)}</div>
                    <div className="lead-meta">
                      <span className={`score-badge ${scoreColors[lead.score] || 'score-warm'}`}>{lead.score || 'WARM'}</span>
                      <span>{lead.source}</span>
                      <span>{lead.property}</span>
                      <span className="lead-time">Just now</span>
                    </div>
                  </div>
                </div>

                {openDetailId === lead.id && (
                  <div className="lead-detail-panel open">
                    {lead.summary && <div className="detail-summary"><strong>AI brief:</strong> {lead.summary}</div>}

                    {lead.nextAction && (
                      <div style={{ background: lead.score === 'HOT' ? '#fde8e8' : 'var(--sage-light)', border: '1px solid ' + (lead.score === 'HOT' ? '#f5c6c6' : 'var(--sage-mid)'), borderRadius: '10px', padding: '.75rem 1rem', marginBottom: '1rem', fontSize: '13px' }}>
                        <span style={{ fontWeight: '600', color: lead.score === 'HOT' ? '#c0392b' : 'var(--sage)' }}>{lead.score === 'HOT' ? '🔥 Next: ' : '→ Next: '}</span>
                        {lead.nextAction}
                      </div>
                    )}

                    {lead.signals && Object.keys(lead.signals || {}).length > 0 && (
                      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        {lead.signals.timeline && lead.signals.timeline !== 'unknown' && <span style={{ background: '#e8f4fd', color: '#2471a3', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>📅 {lead.signals.timeline}</span>}
                        {lead.signals.budget && lead.signals.budget !== 'unknown' && <span style={{ background: '#e8f4fd', color: '#2471a3', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>💰 {lead.signals.budget}</span>}
                        {lead.signals.preApproved === true && <span style={{ background: '#e8f8ee', color: '#1e8449', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>✓ Pre-approved</span>}
                        {lead.signals.preApproved === false && <span style={{ background: '#fde8e8', color: '#c0392b', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>✗ Not pre-approved</span>}
                        {lead.signals.alsoSelling === true && <span style={{ background: '#fef9e7', color: '#d68910', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>🏠 Also selling</span>}
                        {lead.signals.motivation && lead.signals.motivation !== 'unknown' && <span style={{ background: 'var(--cream)', color: 'var(--muted)', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px' }}>📌 {lead.signals.motivation}</span>}
                      </div>
                    )}

                    <div className="detail-tags">
                      {lead.email && <span className="pill">{lead.email}</span>}
                      {lead.phone && <span className="pill">{lead.phone}</span>}
                      <span className="pill amber">{lead.property}</span>
                      <span className="pill">{lead.source}</span>
                    </div>

                    {/* Conversation preview */}
                    <div style={{ marginTop: '1rem' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.75rem' }}>Conversation</div>
                      <div className="chat-window" style={{ maxHeight: '220px' }}>
                        {lead.messages.map((m, i) => (
                          <div key={i} className={`msg ${m.role === 'ai' ? 'ai' : 'lead'}`}>
                            <div className="msg-label">{m.role === 'ai' ? 'Agent' : `${lead.fname} ${lead.lname}`}</div>
                            {m.text}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* CTA inside lead detail */}
                    <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'var(--sage-light)', borderRadius: '10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '.4rem' }}>Ready to work real leads like this?</div>
                      <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '.85rem' }}>Sign up free — your first real lead could be waiting.</div>
                      <button onClick={() => router.push('/register')} style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.65rem 1.5rem', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                        Create free account →
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Blurred additional leads — shows what more would look like */}
              <div style={{ position: 'relative', marginTop: '.75rem' }}>
                <div style={{ filter: 'blur(5px)', pointerEvents: 'none' }}>
                  {[
                    { initials: 'TK', name: 'Tom Kim', summary: 'Interested in 2BR condo downtown. Pre-approved at $320k.', score: 'HOT', source: 'Zillow', property: '320 Oak Ave' },
                    { initials: 'SR', name: 'Sarah R.', summary: 'Browsing 3BR homes in the suburbs. No timeline yet.', score: 'WARM', source: 'Homes.com', property: 'Hyde Park area' },
                  ].map((l, i) => (
                    <div key={i} className={`lead-card ${l.score === 'HOT' ? 'hot-lead' : 'new-lead'}`} style={{ marginBottom: '.75rem' }}>
                      <div className="lead-avatar">{l.initials}</div>
                      <div className="lead-main">
                        <div className="lead-name">{l.name}</div>
                        <div className="lead-preview">{l.summary}</div>
                        <div className="lead-meta">
                          <span className={`score-badge ${l.score === 'HOT' ? 'score-hot' : 'score-warm'}`}>{l.score}</span>
                          <span>{l.source}</span>
                          <span>{l.property}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '14px', background: 'rgba(249,250,251,.6)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '.5rem' }}>More leads coming in all the time</div>
                    <button onClick={() => router.push('/register')} style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.6rem 1.5rem', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                      Sign up to see them all →
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </section>
        );
      })()}

      {/* DASHBOARD */}
      {view === 'dashboard' && (
        <section className="fade-in">
          <div className="dash-nav">
          <h2>
          {profile?.name?.split(' ')[0] || session?.user?.name?.split(' ')[0] || 'Agent'}’s Dashboard
          {profile?.agencyName && (
            <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>
              • {profile.agencyName}
            </span>
          )}
          </h2>
            <div className="dash-nav-right">
              <div className="live-badge"><div className="live-dot" /> Live</div>
              <button className="btn-outline" onClick={() => setView('profile')} style={{ fontSize: '13px', padding: '.4rem 1rem' }}>Profile &amp; setup</button>
            </div>
          </div>

          <div className="dash-body">

            {/* WELCOME BANNER — shown once for new users after email verification */}
            {showWelcome && (
              <div style={{ background: 'linear-gradient(135deg, #3d6b4a 0%, #2e5239 100%)', borderRadius: '14px', padding: '1.5rem 1.75rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', position: 'relative', animation: 'fadeUp .4s ease' }}>
                <div style={{ fontSize: '2rem', flexShrink: 0 }}>🎉</div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff', marginBottom: '.25rem' }}>
                    Welcome to Say HelloLeads, {session?.user?.name?.split(' ')[0] || 'there'}!
                  </div>
                  <div style={{ fontSize: '13px', color: 'rgba(255,255,255,.8)', lineHeight: '1.5' }}>
                    Your AI lead assistant is ready. Complete the setup steps below to start capturing and responding to leads automatically.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '.75rem', flexShrink: 0 }}>
                  <button onClick={() => setView('integrations')} style={{ background: '#fff', color: '#3d6b4a', border: 'none', borderRadius: '8px', padding: '.5rem 1.1rem', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                    Connect leads →
                  </button>
                  <button onClick={() => setShowWelcome(false)} style={{ background: 'transparent', color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.3)', borderRadius: '8px', padding: '.5rem .75rem', fontSize: '13px', cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              </div>
            )}
            {(!checklist.profile || !checklist.zillow) && (
              <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '1rem', color: 'var(--black)' }}>
                  🚀 Get set up — {[checklist.profile, checklist.zillow].filter(Boolean).length} of 2 steps done — <span style={{fontWeight:'400',color:'var(--muted)'}}>SMS + website optional</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  {[
                    { done: checklist.profile, label: 'Complete your profile',               dest: 'profile',       hint: 'Name + notification email' },
                    { done: checklist.zillow,   label: 'Forward leads from Zillow, Homes.com, Realtor.com, or Redfin', dest: 'integrations',  hint: '2-minute email setting' },
                    { done: checklist.sms,      label: 'Connect Twilio for SMS replies',        dest: 'integrations',  hint: 'AI responds via text' },
                    { done: checklist.website,  label: 'Connect your website or Zapier',        dest: 'integrations',  hint: 'Optional — any lead source' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', cursor: item.done ? 'default' : 'pointer' }}
                      onClick={() => !item.done && setView(item.dest)}>
                      <div style={{ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: item.done ? 'var(--sage)' : 'var(--border)', color: '#fff', fontSize: '11px', fontWeight: '700' }}>
                        {item.done ? '✓' : i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '13px', fontWeight: '500', textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--muted)' : 'var(--black)' }}>{item.label}</span>
                        {!item.done && <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '.5rem' }}>{item.hint}</span>}
                      </div>
                      {!item.done && <span style={{ fontSize: '12px', color: 'var(--sage)', fontWeight: '500' }}>Set up →</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SHAREABLE LINK BANNER */}
            {session && (() => {
              const slug = session.user?.name
                ? session.user.name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-')
                : null;
              const shareUrl = slug ? `${typeof window !== 'undefined' ? window.location.origin : ''}/agent/${slug}` : null;
              return shareUrl ? (
                <div style={{ background: 'var(--sage-light)', border: '1.5px solid var(--sage-mid)', borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.2rem' }}>Your public inquiry page</div>
                    <div style={{ fontSize: '14px', color: 'var(--black)', fontFamily: 'monospace' }}>{shareUrl}</div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '.2rem' }}>Share this link — buyers fill out the form and leads come straight to you.</div>
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(shareUrl); }}
                    style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.5rem 1.1rem', fontSize: '13px', fontWeight: '500', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Copy link
                  </button>
                </div>
              ) : null;
            })()}

            {/* AI USAGE METER */}
            {(() => {
              const { used, cap } = aiUsage;
              const pct     = Math.min((used / cap) * 100, 100);
              const isOver  = used >= cap;
              const isWarn  = !isOver && pct >= 80;
              const barColor = isOver ? '#c0392b' : isWarn ? '#e67e22' : '#4a7c59';
              if (used === 0) return null; // hide until they have at least 1 response
              return (
                <div style={{ background: '#fff', border: `1.5px solid ${isOver ? '#f5c6c2' : isWarn ? '#fde8cc' : 'var(--border)'}`, borderRadius: '14px', padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--black)' }}>
                        {isOver ? '🚨 AI limit reached' : isWarn ? '⚠️ AI responses running low' : '🤖 AI responses this month'}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: '500' }}>{used} / {cap}</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--border)', borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '99px', transition: 'width .4s ease' }} />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '.4rem' }}>
                      {isOver
                        ? 'New leads are saved and you\'re still notified — AI replies are paused until next month.'
                        : isWarn
                        ? `${cap - used} responses remaining. Upgrade to Pro for unlimited AI replies.`
                        : `Resets on the 1st of next month.`}
                    </div>
                  </div>
                  {(isOver || isWarn) && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      style={{ background: barColor, color: '#fff', border: 'none', borderRadius: '8px', padding: '.5rem 1.1rem', fontSize: '13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      Upgrade to Pro →
                    </button>
                  )}
                </div>
              );
            })()}

            <div className="dash-kpis">
              <div className="kpi highlight"><div className="kpi-label">response time</div><div className="kpi-val">&lt;60s</div><div className="kpi-sub">vs 15hr industry avg</div></div>
              <div className="kpi"><div className="kpi-label">total leads</div><div className="kpi-val">{stats.total}</div><div className="kpi-sub">all time</div></div>
              <div className="kpi"><div className="kpi-label">hot leads</div><div className="kpi-val">{stats.hot}</div><div className="kpi-sub">need follow-up now</div></div>
              <div className="kpi"><div className="kpi-label">AI handled</div><div className="kpi-val">100%</div><div className="kpi-sub">first response</div></div>
            </div>

            {/* UPGRADE MODAL */}
            {showUpgradeModal && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                onClick={e => { if (e.target === e.currentTarget) setShowUpgradeModal(false); }}>
                <div style={{ background: '#fff', borderRadius: '18px', padding: '2rem', maxWidth: '440px', width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}>
                  <div style={{ fontSize: '28px', marginBottom: '.5rem' }}>🚀</div>
                  <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '.5rem', color: 'var(--black)' }}>Say HelloLeads Pro</div>
                  <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                    You're getting real value out of your AI lead assistant. Upgrade to Pro and never worry about limits again.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', marginBottom: '1.75rem' }}>
                    {[
                      '✅ Unlimited AI responses every month',
                      '✅ HOT / WARM / COLD scoring on every lead',
                      '✅ Instant SMS + email alerts',
                      '✅ Priority support',
                      '🔜 Team seats & multi-agent dashboard',
                      '🔜 CRM integrations',
                    ].map((f, i) => (
                      <div key={i} style={{ fontSize: '14px', color: i < 4 ? 'var(--black)' : 'var(--muted)' }}>{f}</div>
                    ))}
                  </div>
                  {upgradeInterestSent ? (
                    <div style={{ background: '#eef4f0', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', marginBottom: '.25rem' }}>🎉</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--sage)' }}>You're on the list!</div>
                      <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '.25rem' }}>We'll reach out personally as soon as Pro launches.</div>
                    </div>
                  ) : (
                    <button
                      onClick={submitUpgradeInterest}
                      disabled={upgradeInterestLoading}
                      style={{ width: '100%', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.85rem', fontSize: '15px', fontWeight: '700', cursor: upgradeInterestLoading ? 'default' : 'pointer', opacity: upgradeInterestLoading ? .7 : 1 }}
                    >
                      {upgradeInterestLoading ? 'Saving…' : "I'm Interested in Pro →"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    style={{ width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: '13px', marginTop: '.75rem', cursor: 'pointer', padding: '.25rem' }}
                  >
                    Maybe later
                  </button>
                </div>
              </div>
            )}


            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', marginBottom: '.75rem' }}>
              <div className="dash-section-title" style={{ margin: 0 }}>
                Active leads
                <span style={{ marginLeft: '.6rem', fontSize: '10px', fontWeight: '600', color: '#4a6741', background: '#e8efe7', border: '1px solid #c5d9c2', borderRadius: '20px', padding: '2px 8px', verticalAlign: 'middle', letterSpacing: '.04em' }}>
                  ● LIVE · refreshes every 30s
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                <button
                  onClick={() => { setShowManualLead(true); setManualResult(null); setManualForm({ fname: '', lname: '', email: '', phone: '', property: '', note: '', source: 'Referral' }); }}
                  style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.4rem 1rem', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.4rem' }}
                >
                  + Add lead
                </button>
                <div className="filter-row">
                  {[['all','All'],['HOT','🔥 Hot'],['WARM','🌤 Warm'],['COLD','❄️ Cold']].map(([f,l]) => (
                    <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="lead-cards">
              {leads.length === 0 ? (
                <div className="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <p>No leads yet — <a onClick={() => setView('demo')} style={{ color: 'var(--sage)', cursor: 'pointer' }}>try the demo</a> to create your first lead.</p>
                </div>
              ) : leads.map(lead => (
                <div key={lead.id}>
                  <div className={`lead-card ${lead.score === 'HOT' ? 'hot-lead' : 'new-lead'}`} onClick={() => setOpenDetailId(openDetailId === lead.id ? null : lead.id)}>
                    <div className="lead-avatar">{(lead.fname?.[0] || '') + (lead.lname?.[0] || '')}</div>
                    <div className="lead-main">
                      <div className="lead-name">
                        {lead.fname} {lead.lname}
                        {lead.smsSent && <span style={{ fontSize: '11px', color: '#2980b9', fontWeight: '400', marginLeft: '.4rem' }}>📱 SMS</span>}
                      </div>
                      <div className="lead-preview">{(lead.summary || lead.messages?.slice(-1)[0]?.text || '').slice(0, 100)}</div>
                      <div className="lead-meta">
                        <span className={`score-badge ${lead.score === 'HOT' ? 'score-hot' : lead.score === 'COLD' ? 'score-cold' : 'score-warm'}`}>{lead.score || '…'}</span>
                        <span>{lead.source}</span>
                        <span>{lead.property}</span>
                        <span className="lead-time">{formatTime(lead.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {openDetailId === lead.id && (
                    <div className="lead-detail-panel open">
                      {lead.summary && <div className="detail-summary"><strong>AI brief:</strong> {lead.summary}</div>}

                      {lead.nextAction && (
                        <div style={{ background: lead.score === 'HOT' ? '#fde8e8' : 'var(--sage-light)', border: '1px solid ' + (lead.score === 'HOT' ? '#f5c6c6' : 'var(--sage-mid)'), borderRadius: '10px', padding: '.75rem 1rem', marginBottom: '1rem', fontSize: '13px' }}>
                          <span style={{ fontWeight: '600', color: lead.score === 'HOT' ? 'var(--red)' : 'var(--sage)' }}>{lead.score === 'HOT' ? '🔥 Next: ' : '→ Next: '}</span>
                          {lead.nextAction}
                        </div>
                      )}

                      {lead.signals && Object.keys(lead.signals || {}).length > 0 && (
                        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                          {lead.signals.timeline && lead.signals.timeline !== 'unknown' && <span style={{ background: '#e8f4fd', color: '#2471a3', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>📅 {lead.signals.timeline}</span>}
                          {lead.signals.budget && lead.signals.budget !== 'unknown' && <span style={{ background: '#e8f4fd', color: '#2471a3', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>💰 {lead.signals.budget}</span>}
                          {lead.signals.preApproved === true && <span style={{ background: '#e8f8ee', color: '#1e8449', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>✓ Pre-approved</span>}
                          {lead.signals.preApproved === false && <span style={{ background: '#fde8e8', color: 'var(--red)', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>✗ Not pre-approved</span>}
                          {lead.signals.alsoSelling === true && <span style={{ background: 'var(--amber-light)', color: 'var(--amber)', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px', fontWeight: '500' }}>🏠 Also selling</span>}
                          {lead.signals.motivation && lead.signals.motivation !== 'unknown' && <span style={{ background: 'var(--cream)', color: 'var(--muted)', borderRadius: '20px', padding: '.2rem .7rem', fontSize: '12px' }}>📌 {lead.signals.motivation}</span>}
                        </div>
                      )}

                      <div className="detail-tags">
                        {lead.email && <span className="pill">{lead.email}</span>}
                        {lead.phone && <span className="pill">{lead.phone}</span>}
                        <span className="pill amber">{lead.property}</span>
                        <span className="pill">{lead.source}</span>
                      </div>
                      <div className="detail-actions">
                        {lead.outreachPending && lead.outreachDraft && (
                          <button
                            className="action-btn green"
                            onClick={e => { e.stopPropagation(); setPendingOutreachLead(lead); }}
                            style={{ background: '#e67e22', borderColor: '#e67e22' }}
                          >
                            ✉️ Send first message
                          </button>
                        )}
                        <button className="action-btn green" onClick={() => continueConvo(lead)}>💬 Continue conversation</button>
                        {lead.phone && twilioConfigured && (
                          <button className="action-btn" onClick={async () => {
                            const res = await fetch('/api/send-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: lead.phone, message: `Hi ${lead.fname}, just following up on ${lead.property}. Are you still interested in scheduling a showing?` }) });
                            alert(res.ok ? `SMS sent to ${lead.phone}!` : 'SMS failed — check Twilio setup.');
                          }}>📱 Send SMS</button>
                        )}
                        <button className="action-btn red" onClick={() => deleteLead(lead.id)}>🗑 Delete</button>
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: '.5rem' }}>
                        Conversation ({lead.messages?.length || 0} messages)
                      </div>
                      <div className="detail-convo">
                        {(lead.messages || []).map((m, i) => (
                          <div key={i} className={`mini-msg ${m.role}`}>
                            <div className="who">{m.role === 'ai' ? (session?.user?.name || 'Anna Williams') : lead.fname}</div>
                            {m.text}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* SETUP */}
      {/* ── PROFILE VIEW ────────────────────────────────────────── */}
      {view === 'profile' && (
        <section className="fade-in" style={{ maxWidth: '700px', margin: '3rem auto', padding: '0 1.5rem 5rem' }}>
          <a className="back-link" onClick={() => setView('dashboard')}>← Dashboard</a>

          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '2rem', marginBottom: '.25rem' }}>Profile</h2>
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Your name, agency, and notification preferences.</p>
          </div>

          {/* PROFILE CARD */}
          <div style={{ marginBottom: '2.5rem' }}>
            <div className="section-label">Your profile</div>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.75rem' }}>

              {/* ── PHOTO UPLOAD ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
                <div
                  onClick={() => photoInputRef.current?.click()}
                  style={{ width: '80px', height: '80px', borderRadius: '50%', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', background: 'var(--sage-light)', border: '2px solid var(--sage-mid)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
                >
                  {profile.photoUrl
                    ? <img src={profile.photoUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '1.8rem', fontFamily: "'Instrument Serif', serif", color: 'var(--sage)', fontWeight: '600' }}>
                        {(profile.name || session?.user?.name || '?').charAt(0).toUpperCase()}
                      </span>
                  }
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity .2s', borderRadius: '50%' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 1}
                    onMouseLeave={e => e.currentTarget.style.opacity = 0}
                  >
                    <span style={{ color: '#fff', fontSize: '11px', fontWeight: '600' }}>Change</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '.25rem' }}>Profile photo</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '.5rem', lineHeight: '1.5' }}>
                    Shown on your public agent page.<br />JPG or PNG, under 5MB.
                  </div>
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoUploading}
                    style={{ fontSize: '12px', background: 'none', border: '1px solid var(--sage-mid)', color: 'var(--sage)', borderRadius: '7px', padding: '.35rem .85rem', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: '500' }}
                  >
                    {photoUploading ? 'Uploading…' : profile.photoUrl ? 'Change photo' : 'Upload photo'}
                  </button>
                  {photoMsg && <div style={{ fontSize: '12px', marginTop: '.35rem', color: photoMsg.startsWith('✓') ? 'var(--sage)' : '#dc2626', fontWeight: '500' }}>{photoMsg}</div>}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0]); e.target.value = ''; }}
                />
              </div>

              <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Full name</label>
                  <input className="setup-input" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} placeholder="Maria Chen" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Agency name</label>
                  <input className="setup-input" value={profile.agencyName} onChange={e => setProfile(p => ({ ...p, agencyName: e.target.value }))} placeholder="Hyde Park Realty" />
                </div>
              </div>

              {/* Display name — what leads see as the email sender */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>
                  Your name as leads see it <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(sender name in their inbox)</span>
                </label>
                <input
                  className="setup-input"
                  value={profile.displayName}
                  onChange={e => setProfile(p => ({ ...p, displayName: e.target.value }))}
                  placeholder="Jane Smith"
                  style={{ maxWidth: '320px' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '.35rem' }}>
                  Leads will see this as the sender — e.g. <strong>Jane Smith</strong> instead of a long email address. Keeps you out of spam.
                </div>
              </div>
              <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Notification email <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(where to send lead alerts)</span></label>
                  <input className="setup-input" type="email" value={profile.notifyEmail} onChange={e => setProfile(p => ({ ...p, notifyEmail: e.target.value }))} placeholder="you@yourrealty.com" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Your mobile <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(for lead SMS alerts)</span></label>
                  <input className="setup-input" type="tel" value={profile.agentNotifyPhone} onChange={e => setProfile(p => ({ ...p, agentNotifyPhone: e.target.value }))} placeholder="+15135550100" />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button className="btn-primary" onClick={saveProfile} disabled={profileSaving} style={{ opacity: profileSaving ? .7 : 1 }}>
                  {profileSaving ? 'Saving…' : 'Save profile'}
                </button>
                {profileMsg && <span style={{ fontSize: '13px', color: 'var(--sage)', fontWeight: '500' }}>{profileMsg}</span>}
              </div>
            </div>
          </div>

          {/* LINK TO INTEGRATIONS */}
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '.2rem' }}>Ready to connect SMS, email &amp; lead sources?</div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Follow the step-by-step integration guide to go live.</div>
            </div>
            <button className="btn-primary" onClick={() => setView('integrations')} style={{ whiteSpace: 'nowrap' }}>Integration guide →</button>
          </div>
        </section>
      )}

      {/* ── INTEGRATIONS VIEW ────────────────────────────────────── */}
      {view === 'integrations' && (
        <section className="fade-in" style={{ maxWidth: '720px', margin: '3rem auto', padding: '0 1.5rem 5rem' }}>
          <a className="back-link" onClick={() => setView('profile')}>← Profile</a>
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '2rem', marginBottom: '.25rem' }}>Connect your lead sources</h2>
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Instant responses and lead alerts are handled for you — just connect where your leads come from.</p>
          </div>

          {/* ── WHAT'S INCLUDED BANNER ───────────────────────────────── */}
          <div style={{ background: 'var(--sage-light)', border: '1.5px solid var(--sage-mid)', borderRadius: '14px', padding: '1.1rem 1.35rem', marginBottom: '1.75rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px' }}>
              <div style={{ fontWeight: '600', color: 'var(--sage)', marginBottom: '.4rem' }}>✓ Included in your subscription — no extra setup needed</div>
              <div style={{ color: 'var(--black)', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                <span>🤖 AI lead responses</span>
                <span>📊 Lead scoring</span>
                <span>🔔 Email alerts to you</span>
                <span>💾 Lead storage</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '.5rem' }}>Just connect your lead sources below — everything else runs automatically.</div>
            </div>
          </div>

          {/* ── RECOMMENDED SECTION ───────────────────────────── */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.6rem' }}>
              <span style={{ fontSize: '1.1rem' }}>🚀</span>
              <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--black)' }}>Start here — Recommended</span>
            </div>
            <div style={{ background: 'var(--sage-light)', border: '1.5px solid var(--sage-mid)', borderRadius: '10px', padding: '.75rem 1.25rem', fontSize: '13px', color: 'var(--sage)', fontWeight: '500' }}>
              ⚡ Takes 2 minutes per platform. No extra accounts or API keys needed — just a one-time email setting change.
            </div>
          </div>


                    {/* ── REFERRAL / PERSONAL TEXT FORWARD TIP ────────────────── */}
                    <div style={{ background: '#fff8e6', border: '1.5px solid #f0d080', borderRadius: '14px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '1.5rem', flexShrink: 0 }}>📨</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '700', fontSize: '14px', color: '#5a4400', marginBottom: '.35rem' }}>
                            Got a referral via text or personal email?
                          </div>
                          <div style={{ fontSize: '13px', color: '#5a4400', lineHeight: '1.7', marginBottom: '.75rem' }}>
                            Forward it to your Say HelloLeads inbound address below and we'll automatically parse it, create the lead, score it with AI, and add it to your dashboard — no manual entry needed.
                            <br />Works with: personal text forwards, referral emails, any message someone sends you directly.
                          </div>
                          {inboundAddr ? (
                            <div style={{ background: 'rgba(255,255,255,.7)', border: '1px solid #f0d080', borderRadius: '8px', padding: '.75rem 1rem', display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                              <code style={{ fontSize: '13px', flex: 1, wordBreak: 'break-all', color: '#5a4400' }}>{inboundAddr}</code>
                              <button onClick={() => navigator.clipboard.writeText(inboundAddr)}
                                style={{ fontSize: '12px', background: '#8a6800', color: '#fff', border: 'none', borderRadius: '7px', padding: '.4rem .85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Copy address
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontSize: '13px', color: '#8a6800' }}>Your inbound address will appear here once your account is set up.</div>
                          )}
                          <div style={{ fontSize: '12px', color: '#8a6800', marginTop: '.5rem' }}>
                            💡 Tip: Save this address in your phone contacts as "Say HelloLeads" so you can forward texts in 2 taps.
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── ZILLOW / HOMES.COM / REALTOR.COM ─────────────────────── */}
          {(() => {
            const ForwardingAddress = ({ addr }) => addr ? (
              <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '8px', padding: '.85rem 1rem', marginTop: '.75rem' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.4rem' }}>Your unique forwarding address</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                  <code style={{ fontSize: '13px', flex: 1, wordBreak: 'break-all' }}>{addr}</code>
                  <button onClick={() => navigator.clipboard.writeText(addr)}
                    style={{ fontSize: '12px', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '7px', padding: '.4rem .85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Copy
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '.4rem' }}>Add this as an additional recipient in your lead notification settings.</div>
              </div>
            ) : null;

            return (<>
              <IntegCard icon="🏠" title="Zillow Premier Agent" badge="Email forwarding" status={!!profile.zillowDone}
                desc="Forward your Zillow lead notification emails to Say HelloLeads — no API key needed, just a one-time setting change."
                link="https://premieragent.zillow.com" linkLabel="Open Zillow Premier Agent →"
              >
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.5rem' }}>
                  <strong style={{ color: 'var(--black)' }}>Steps:</strong><br/>
                  1. Log into Zillow Premier Agent<br/>
                  2. Settings → Contact preferences → Lead notification email<br/>
                  3. Add your forwarding address as an <em>additional</em> recipient
                </div>
                <ForwardingAddress addr={inboundAddr} />
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <input
                    type="checkbox"
                    id="zillow-done"
                    checked={!!profile['zillowDone']}
                    onChange={async e => {
                      const val = e.target.checked;
                      setProfile(p => ({ ...p, zillowDone: val }));
                      await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zillowDone: val }) });
                      loadChecklist();
                    }}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--sage)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="zillow-done" style={{ fontSize: '13px', fontWeight: '500', cursor: 'pointer', color: profile['zillowDone'] ? 'var(--sage)' : 'var(--black)' }}>
                    {profile['zillowDone'] ? "✓ Done — forwarding is set up" : "Mark as done once you've added the forwarding address"}
                  </label>
                </div>
              </IntegCard>

              <IntegCard icon="🏡" title="Homes.com" badge="Email forwarding" status={!!profile.homesDone}
                desc="Same process — forward Homes.com lead emails to your unique address."
                link="https://homes.com" linkLabel="Open Homes.com portal →"
              >
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.5rem' }}>
                  <strong style={{ color: 'var(--black)' }}>Steps:</strong><br/>
                  1. Log into Homes.com agent portal<br/>
                  2. Account Settings → Notifications → Lead notification email<br/>
                  3. Add your forwarding address as an additional recipient
                </div>
                <ForwardingAddress addr={inboundAddr} />
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <input
                    type="checkbox"
                    id="homes-done"
                    checked={!!profile['homesDone']}
                    onChange={async e => {
                      const val = e.target.checked;
                      setProfile(p => ({ ...p, homesDone: val }));
                      await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homesDone: val }) });
                      loadChecklist();
                    }}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--sage)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="homes-done" style={{ fontSize: '13px', fontWeight: '500', cursor: 'pointer', color: profile['homesDone'] ? 'var(--sage)' : 'var(--black)' }}>
                    {profile['homesDone'] ? "✓ Done — forwarding is set up" : "Mark as done once you've added the forwarding address"}
                  </label>
                </div>
              </IntegCard>

              <IntegCard icon="🔑" title="Realtor.com" badge="Email forwarding" status={!!profile.realtorDone}
                desc="Forward Realtor.com lead alerts to your Say HelloLeads address."
                link="https://realtorpro.realtor.com" linkLabel="Open Realtor.com Pro →"
              >
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.5rem' }}>
                  <strong style={{ color: 'var(--black)' }}>Steps:</strong><br/>
                  1. Log into Realtor.com Pro<br/>
                  2. My Account → Notifications → Email for new leads<br/>
                  3. Add your forwarding address as an additional notification email
                </div>
                <ForwardingAddress addr={inboundAddr} />
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <input
                    type="checkbox"
                    id="realtor-done"
                    checked={!!profile['realtorDone']}
                    onChange={async e => {
                      const val = e.target.checked;
                      setProfile(p => ({ ...p, realtorDone: val }));
                      await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ realtorDone: val }) });
                      loadChecklist();
                    }}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--sage)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="realtor-done" style={{ fontSize: '13px', fontWeight: '500', cursor: 'pointer', color: profile['realtorDone'] ? 'var(--sage)' : 'var(--black)' }}>
                    {profile['realtorDone'] ? "✓ Done — forwarding is set up" : "Mark as done once you've added the forwarding address"}
                  </label>
                </div>
              </IntegCard>

              <IntegCard icon="🏘️" title="Redfin" badge="Email forwarding" status={!!profile.redfinDone}
                desc="Forward Redfin lead notification emails to Say HelloLeads — same simple process as Zillow and Homes.com."
                link="https://redfin.com/agents" linkLabel="Open Redfin Partner Dashboard →"
              >
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.5rem' }}>
                  <strong style={{ color: 'var(--black)' }}>Steps:</strong><br/>
                  1. Log into your Redfin Partner Dashboard<br/>
                  2. Account → Notifications → Lead alert email<br/>
                  3. Add your forwarding address as an additional recipient
                </div>
                <ForwardingAddress addr={inboundAddr} />
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <input
                    type="checkbox"
                    id="redfin-done"
                    checked={!!profile['redfinDone']}
                    onChange={async e => {
                      const val = e.target.checked;
                      setProfile(p => ({ ...p, redfinDone: val }));
                      await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redfinDone: val }) });
                      loadChecklist();
                    }}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--sage)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="redfin-done" style={{ fontSize: '13px', fontWeight: '500', cursor: 'pointer', color: profile['redfinDone'] ? 'var(--sage)' : 'var(--black)' }}>
                    {profile['redfinDone'] ? "✓ Done — forwarding is set up" : "Mark as done once you've added the forwarding address"}
                  </label>
                </div>
              </IntegCard>

              <IntegCard icon="📘" title="Facebook & Instagram Ads" badge="Via Zapier" status={!!profile.facebookDone}
                desc="Capture leads directly from your Facebook and Instagram ad campaigns — no manual checking required."
                link="https://zapier.com/apps/facebook-lead-ads/integrations" linkLabel="Open Zapier → Facebook Lead Ads →"
              >
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.5rem' }}>
                  <strong style={{ color: 'var(--black)' }}>Steps:</strong><br/>
                  1. Sign up at <a href="https://zapier.com" target="_blank" style={{ color: 'var(--sage)' }}>zapier.com</a> (free plan works)<br/>
                  2. Create a new Zap → Trigger: <strong>Facebook Lead Ads → New Lead</strong><br/>
                  3. Connect your Facebook ad account and select your lead form<br/>
                  4. Action: <strong>Webhooks by Zapier → POST</strong><br/>
                  5. Set the URL to:
                </div>
                <code style={{ fontSize: '12px', background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', display: 'block', marginBottom: '.75rem', wordBreak: 'break-all' }}>
                  POST https://www.sayhelloleads.com/api/new-lead
                </code>
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.5rem' }}>
                  6. Add this header:
                </div>
                <code style={{ fontSize: '12px', background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', display: 'block', marginBottom: '.75rem' }}>
                  x-agent-id: {agentId || 'your-agent-id'}
                </code>
                <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.75rem' }}>
                  7. Map your Facebook form fields to the body:<br/>
                  <code style={{ fontSize: '11px' }}>fname, lname, email, phone, property, message</code> — set <code style={{ fontSize: '11px' }}>source</code> to <code style={{ fontSize: '11px' }}>Facebook</code>
                </div>
                <div style={{ background: 'var(--sage-light)', borderRadius: '8px', padding: '.75rem 1rem', fontSize: '13px', color: 'var(--sage)', fontWeight: '500' }}>
                  ✓ Once live, every Facebook or Instagram lead form submission triggers an instant AI response and shows up in your dashboard automatically.
                </div>
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <input
                    type="checkbox"
                    id="facebook-done"
                    checked={!!profile['facebookDone']}
                    onChange={async e => {
                      const val = e.target.checked;
                      setProfile(p => ({ ...p, facebookDone: val }));
                      await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facebookDone: val }) });
                      loadChecklist();
                    }}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--sage)', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="facebook-done" style={{ fontSize: '13px', fontWeight: '500', cursor: 'pointer', color: profile['facebookDone'] ? 'var(--sage)' : 'var(--black)' }}>
                    {profile['facebookDone'] ? "✓ Done — Facebook & Instagram Ads connected via Zapier" : "I've connected Facebook Lead Ads via Zapier"}
                  </label>
                </div>
              </IntegCard>

            </>);
          })()}

          {/* ── OPTIONAL SECTION ─────────────────────────────── */}
          <div style={{ margin: '2rem 0 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.6rem' }}>
              <span style={{ fontSize: '1.1rem' }}>⚙️</span>
              <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--black)' }}>Optional — connect even more lead sources</span>
            </div>
            <div style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderRadius: '10px', padding: '.75rem 1.25rem', fontSize: '13px', color: 'var(--muted)' }}>
              Already set up the essentials? These add even more ways for leads to find you — connect whichever ones you use.
            </div>
          </div>

          <IntegCard icon="⚡" title="Your website or Zapier" badge="Any source"
            desc="Connect any lead source via a simple webhook POST. Works with Zapier, your own contact form, or any CRM."
            link="https://zapier.com" linkLabel="Open Zapier →"
          >
            <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginBottom: '.75rem' }}>
              <strong style={{ color: 'var(--black)' }}>Webhook URL:</strong><br/>
              <code style={{ fontSize: '12px', background: '#f3f4f6', padding: '3px 8px', borderRadius: '4px', display: 'inline-block', marginTop: '4px', wordBreak: 'break-all' }}>
                POST https://www.sayhelloleads.com/api/new-lead
              </code><br/><br/>
              <strong style={{ color: 'var(--black)' }}>Required header:</strong><br/>
              <code style={{ fontSize: '12px', background: '#f3f4f6', padding: '3px 8px', borderRadius: '4px', display: 'inline-block', marginTop: '4px' }}>
                x-agent-id: {session?.user?.id || 'your-agent-id'}
              </code><br/><br/>
              Body fields: <code style={{ fontSize: '11px' }}>fname, lname, email, phone, property, message, source</code>
            </div>
            <CredField
              label="Webhook secret (optional — adds security)" field="webhookSecret" placeholder="any random string"
              current={creds.webhookSecret} saving={credsSaving.webhookSecret} msg={credsMsg.webhookSecret}
              onSave={saveCred}
            />
          </IntegCard>

          {/* ── CALENDLY ─────────────────────────────────────────────── */}
          <IntegCard
            icon="📅" title="Calendly — automatic booking link" badge="Optional"
            status={creds.calendlyUrl?.isSet}
            desc={<>Once a lead's timeline and budget are confirmed, the AI naturally offers your Calendly link so they can book a showing directly — no back-and-forth on times needed.<br /><br /><strong>Without Calendly:</strong> the AI proposes 2–3 time slots in the conversation and notes the agreed time in the lead summary. Nothing breaks — this is purely additive.<br /><br /><strong>Steps:</strong><br />1. Sign up at <a href="https://calendly.com" target="_blank" style={{color:'var(--sage)'}}>calendly.com</a> — free plan is fine<br />2. Create an event type (e.g. "Property Showing — 30 min")<br />3. Copy your scheduling link and paste it below</>}
            link="https://calendly.com" linkLabel="Open Calendly →"
          >
            <CredField
              label="Your Calendly URL" field="calendlyUrl" placeholder="https://calendly.com/yourname/showing"
              current={creds.calendlyUrl} saving={credsSaving.calendlyUrl} msg={credsMsg.calendlyUrl}
              onSave={saveCred}
            />
            {creds.calendlyUrl?.isSet && (
              <div style={{ marginTop: '.75rem', background: 'var(--sage-light)', borderRadius: '8px', padding: '.75rem 1rem', fontSize: '13px', color: 'var(--sage)' }}>
                ✓ Once leads qualify, the AI will offer your booking link automatically. It also renders as a <strong>📅 Book a showing →</strong> button in the chat UI.
              </div>
            )}
          </IntegCard>

          {/* ── TWILIO SMS ───────────────────────────────────────────── */}
          <IntegCard
            icon="📱" title="SMS — get a Twilio number" badge="Optional"
            status={creds.twilioPhone?.isSet}
            desc={<>Leads can text a real phone number and the AI responds instantly by SMS. Each agent needs their own number (~$1/mo on Twilio).<br/><br/><strong>Steps:</strong><br/>1. Sign up at <a href="https://twilio.com" target="_blank" style={{color:'var(--sage)'}}>twilio.com</a> — free trial includes credit<br/>2. Buy a local number (search your area code)<br/>3. Go to that number → Messaging → Incoming messages webhook → set to:<br/><code style={{fontSize:'12px',background:'#f3f4f6',padding:'2px 6px',borderRadius:'4px',display:'inline-block',marginTop:'4px'}}>https://www.sayhelloleads.com/api/inbound-sms</code><br/>4. Paste your credentials below</>}
            link="https://console.twilio.com" linkLabel="Open Twilio console →"
          >
            <CredField
              label="Account SID" field="twilioSid" placeholder="AC..."
              current={creds.twilioSid} saving={credsSaving.twilioSid} msg={credsMsg.twilioSid}
              onSave={saveCred}
            />
            <CredField
              label="Auth Token" field="twilioToken" placeholder="your auth token"
              current={creds.twilioToken} saving={credsSaving.twilioToken} msg={credsMsg.twilioToken}
              onSave={saveCred}
            />
            <CredField
              label="Your Twilio phone number" field="twilioPhone" placeholder="+15131234567"
              current={creds.twilioPhone} saving={credsSaving.twilioPhone} msg={credsMsg.twilioPhone}
              onSave={saveCred}
            />
            {creds.twilioPhone?.isSet && (
              <div style={{ marginTop: '.75rem', background: 'var(--sage-light)', borderRadius: '8px', padding: '.75rem 1rem', fontSize: '13px', color: 'var(--sage)' }}>
                ✓ Leads who text <strong>{creds.twilioPhone.masked}</strong> will get an instant AI reply.
              </div>
            )}
          </IntegCard>

        </section>
      )}

      {/* PENDING OUTREACH MODAL — reopened from lead card */}
      {pendingOutreachLead && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setPendingOutreachLead(null); }}>
          <div style={{ background: '#fff', borderRadius: '18px', padding: '1.75rem', maxWidth: '500px', width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.18)', maxHeight: '90vh', overflowY: 'auto' }}>
            <ManualLeadResult
              result={{
                lead:              pendingOutreachLead,
                suggestedOutreach: pendingOutreachLead.outreachDraft || '',
                twilioReady:       !!(twilioConfigured && pendingOutreachLead.phone),
                hasEmail:          !!pendingOutreachLead.email,
              }}
              onSendOutreach={async (leadId, message, channel) => {
                const res = await fetch('/api/leads/send-outreach', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify({ leadId, message, channel }),
                });
                const data = await res.json();
                if (res.ok) loadLeads(); // refresh dashboard
                return data;
              }}
              onAddAnother={() => { setPendingOutreachLead(null); setShowManualLead(true); setManualResult(null); setManualForm({ fname: '', lname: '', email: '', phone: '', property: '', note: '', source: 'Referral' }); }}
              onDone={() => { setPendingOutreachLead(null); loadLeads(); }}
              onGoToIntegrations={() => { setPendingOutreachLead(null); setView('integrations'); }}
            />
          </div>
        </div>
      )}

      {/* HOW IT WORKS MODAL */}
      {howItWorksOpen && <HowItWorksModal onClose={() => setHowItWorksOpen(false)} />}

      {/* MANUAL LEAD ENTRY MODAL */}
      {showManualLead && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget && !manualSubmitting) { setShowManualLead(false); setManualResult(null); } }}>
          <div style={{ background: '#fff', borderRadius: '18px', padding: '1.75rem', maxWidth: '500px', width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.18)', maxHeight: '90vh', overflowY: 'auto' }}>

            {manualResult ? (
              /* ── SUCCESS STATE — OPTION B: agent reviews + approves outreach ── */
              <ManualLeadResult
                result={manualResult}
                onSendOutreach={async (leadId, message, channel) => {
                  const res = await fetch('/api/leads/send-outreach', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ leadId, message, channel }),
                  });
                  return res.json();
                }}
                onAddAnother={() => {
                  setManualResult(null);
                  setManualForm({ fname: '', lname: '', email: '', phone: '', property: '', note: '', source: 'Referral' });
                }}
                onDone={() => { setShowManualLead(false); setManualResult(null); }}
                onGoToIntegrations={() => { setShowManualLead(false); setView('integrations'); }}
              />
            ) : (
              /* ── FORM STATE ── */
              <div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '18px', fontWeight: '700', marginBottom: '.25rem' }}>Add lead manually</div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.5' }}>
                    Referral, open house, sign call, or any lead that came in outside your automated channels.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>First name *</label>
                    <input value={manualForm.fname} onChange={e => setManualForm(f => ({...f, fname: e.target.value}))} placeholder="Maria" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>Last name</label>
                    <input value={manualForm.lname} onChange={e => setManualForm(f => ({...f, lname: e.target.value}))} placeholder="Chen" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>Email</label>
                    <input type="email" value={manualForm.email} onChange={e => setManualForm(f => ({...f, email: e.target.value}))} placeholder="maria@email.com" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>Phone</label>
                    <input type="tel" value={manualForm.phone} onChange={e => setManualForm(f => ({...f, phone: e.target.value}))} placeholder="(513) 555-0192" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '-.5rem', marginBottom: '.75rem' }}>* Email or phone required</p>

                <div style={{ marginBottom: '.75rem' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>Property interested in</label>
                  <AddressAutocomplete
                    value={manualForm.property}
                    onChange={val => setManualForm(f => ({...f, property: val}))}
                    placeholder="412 Elm St, Hyde Park — or just an area"
                    style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }}
                  />
                </div>

                <div style={{ marginBottom: '.75rem' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>Source</label>
                  <select value={manualForm.source} onChange={e => setManualForm(f => ({...f, source: e.target.value}))} style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none', background: '#fff' }}>
                    {['Referral', 'Open house', 'Sign call', 'Personal text', 'Personal email', 'Social media', 'Networking', 'Other'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '.3rem' }}>
                    Notes <span style={{ fontWeight: 400 }}>(referred by, budget, what they said — AI uses this to score)</span>
                  </label>
                  <textarea
                    value={manualForm.note}
                    onChange={e => setManualForm(f => ({...f, note: e.target.value}))}
                    placeholder="e.g. Referred by John Smith. Looking in Hyde Park, budget around $400k, wants to move in 60 days."
                    rows={3}
                    style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none', resize: 'vertical' }}
                  />
                </div>

                <button
                  onClick={submitManualLead}
                  disabled={manualSubmitting || !manualForm.fname || (!manualForm.email && !manualForm.phone)}
                  style={{ width: '100%', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.85rem', fontSize: '15px', fontWeight: '700', cursor: manualSubmitting || !manualForm.fname || (!manualForm.email && !manualForm.phone) ? 'default' : 'pointer', opacity: manualSubmitting || !manualForm.fname || (!manualForm.email && !manualForm.phone) ? .6 : 1, marginBottom: '.65rem' }}
                >
                  {manualSubmitting ? '🤖 Scoring with AI…' : 'Add & score lead →'}
                </button>
                <button
                  onClick={() => setShowManualLead(false)}
                  style={{ width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: '13px', cursor: 'pointer', padding: '.25rem' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WAITLIST MODAL */}
      {waitlistPlan && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={e => { if (e.target === e.currentTarget) { setWaitlistPlan(null); } }}>
          <div style={{ background: '#fff', borderRadius: '18px', padding: '2rem', maxWidth: '420px', width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.18)' }}>
            {waitlistSent ? (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🎉</div>
                <div style={{ fontSize: '18px', fontWeight: '700', marginBottom: '.5rem' }}>You're on the list!</div>
                <div style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                  We'll reach out personally when the {waitlistPlan.charAt(0).toUpperCase() + waitlistPlan.slice(1)} plan launches. Expect to hear from us soon.
                </div>
                <button onClick={() => setWaitlistPlan(null)} style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.75rem 2rem', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--sage)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.4rem' }}>
                    {waitlistPlan?.charAt(0).toUpperCase()}{waitlistPlan?.slice(1)} Plan — Coming Soon
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '.4rem' }}>Join the waitlist</div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6' }}>
                    Be first to know when it launches. We'll reach out personally with early access and founding member pricing.
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginBottom: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '.3rem', color: 'var(--muted)' }}>Your name</label>
                    <input value={waitlistForm.name} onChange={e => setWaitlistForm(f => ({...f, name: e.target.value}))} placeholder="Maria Chen" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '.3rem', color: 'var(--muted)' }}>Email *</label>
                    <input type="email" value={waitlistForm.email} onChange={e => setWaitlistForm(f => ({...f, email: e.target.value}))} placeholder="maria@yourrealty.com" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '.3rem', color: 'var(--muted)' }}>Brokerage or agency name</label>
                    <input value={waitlistForm.agencyName} onChange={e => setWaitlistForm(f => ({...f, agencyName: e.target.value}))} placeholder="Hyde Park Realty" style={{ width: '100%', padding: '.6rem .9rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontFamily: 'inherit', fontSize: '14px', outline: 'none' }} />
                  </div>
                </div>
                <button
                  onClick={submitWaitlist}
                  disabled={waitlistLoading || !waitlistForm.email}
                  style={{ width: '100%', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.85rem', fontSize: '15px', fontWeight: '700', cursor: !waitlistForm.email || waitlistLoading ? 'default' : 'pointer', opacity: !waitlistForm.email || waitlistLoading ? .6 : 1 }}
                >
                  {waitlistLoading ? 'Saving…' : 'Count me in →'}
                </button>
                <button onClick={() => setWaitlistPlan(null)} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontSize: '13px', marginTop: '.65rem', cursor: 'pointer', padding: '.25rem' }}>
                  Maybe later
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* FOOTER — shown on landing, login, register, and public views */}
      {['landing', 'demo'].includes(view) && (
        <Footer onHowItWorks={() => setHowItWorksOpen(true)} />
      )}

   </>
  );
}

// ─── HOW IT WORKS MODAL ───────────────────────────────────────────────────────

// ── Renders demo chat messages with Calendly URL as a tappable button ────────
function DemoMessageWithBooking({ text }) {
  if (!text) return null;
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlPattern);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        if (urlPattern.test(part)) {
          return part.includes('calendly.com') ? (
            <span key={i} style={{ display: 'block', marginTop: '.5rem' }}>
              <a href={part} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', background: '#4a6741', color: '#fff', padding: '.55rem 1.1rem', borderRadius: '8px', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}>
                📅 Book a showing →
              </a>
            </span>
          ) : (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer"
              style={{ color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' }}>{part}</a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ─── MANUAL LEAD RESULT — Option B approval UI ───────────────────────────────

function ManualLeadResult({ result, onSendOutreach, onAddAnother, onDone, onGoToIntegrations }) {
  const { lead, suggestedOutreach, twilioReady, hasEmail } = result;
  const [draft, setDraft]         = useState(suggestedOutreach || '');
  const [sending, setSending]     = useState(false);
  const [sentResult, setSentResult] = useState(null); // { emailSent, smsSent, errors }
  const scoreColor = lead.score === 'HOT' ? '#c0392b' : lead.score === 'COLD' ? '#2980b9' : '#e67e22';
  const scoreEmoji = lead.score === 'HOT' ? '🔥' : lead.score === 'COLD' ? '❄️' : '🌤️';

  async function send(channel) {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const data = await onSendOutreach(lead.id, draft.trim(), channel);
      setSentResult(data);
    } catch (e) { console.error('send-outreach error:', e); }
    setSending(false);
  }

  if (sentResult) {
    return (
      <div>
        <div style={{ textAlign: 'center', padding: '1rem 0 1.25rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>
            {sentResult.emailSent || sentResult.smsSent ? '✅' : '⚠️'}
          </div>
          <div style={{ fontSize: '16px', fontWeight: '700', marginBottom: '.35rem' }}>
            {sentResult.emailSent && sentResult.smsSent ? 'Email & SMS sent!'
              : sentResult.emailSent ? 'Email sent!'
              : sentResult.smsSent  ? 'SMS sent!'
              : 'Message saved — send manually'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6' }}>
            {sentResult.emailSent || sentResult.smsSent
              ? `${lead.fname} is now in your active leads. The AI will continue the conversation automatically.`
              : `${lead.fname} has been added to your dashboard. Use the message below to reach out.`}
          </div>
        </div>

        {sentResult.errors?.length > 0 && (
          <div style={{ background: '#fff8e6', border: '1px solid #f0d080', borderRadius: '8px', padding: '.75rem 1rem', marginBottom: '1rem', fontSize: '13px', color: '#5a4400' }}>
            {sentResult.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', gap: '.75rem' }}>
          <button onClick={onAddAnother} style={{ flex: 1, background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.75rem', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            Add another
          </button>
          <button onClick={onDone} style={{ flex: 1, background: 'none', border: '1.5px solid var(--border)', borderRadius: '10px', padding: '.75rem', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Score header */}
      <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Step 1: AI scored your lead</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.75rem' }}>{scoreEmoji}</div>
        <div>
          <div style={{ fontSize: '16px', fontWeight: '700' }}>{lead.fname} {lead.lname} — scored</div>
          <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
            <strong style={{ color: scoreColor }}>{lead.score}</strong> · {lead.source}
          </div>
        </div>
      </div>

      {/* AI brief */}
      {lead.summary && (
        <div style={{ background: 'var(--sage-light)', border: '1px solid var(--sage-mid)', borderRadius: '10px', padding: '.85rem 1rem', fontSize: '13px', lineHeight: '1.6', marginBottom: '1rem' }}>
          <div style={{ fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--sage)', marginBottom: '.3rem' }}>AI brief</div>
          {lead.summary}
        </div>
      )}

      {/* Next action */}
      {lead.nextAction && (
        <div style={{ background: lead.score === 'HOT' ? '#fff0ee' : '#f7f7f4', border: `1px solid ${lead.score === 'HOT' ? '#f5c6c2' : 'var(--border)'}`, borderRadius: '10px', padding: '.85rem 1rem', fontSize: '13px', lineHeight: '1.6', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em', color: lead.score === 'HOT' ? '#c0392b' : 'var(--muted)', marginBottom: '.3rem' }}>→ Recommended next step</div>
          {lead.nextAction}
        </div>
      )}

      {/* Draft message editor */}
      {suggestedOutreach && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '.5rem' }}>
            Step 2: Edit if needed, then choose how to send
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '.75rem 1rem', border: '1.5px solid var(--border)', borderRadius: '10px', fontFamily: 'inherit', fontSize: '14px', lineHeight: '1.6', outline: 'none', resize: 'vertical' }}
          />
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '.3rem' }}>
            This goes out in your name — edit freely to match your voice.
          </div>
        </div>
      )}

      {/* Send buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', marginBottom: '1rem' }}>
        {hasEmail && (
          <button
            onClick={() => send('email')}
            disabled={sending || !draft.trim()}
            style={{ background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.8rem', fontSize: '14px', fontWeight: '600', cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? .6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}
          >
            {sending ? 'Sending…' : '📧 Send via email — AI continues conversation'}
          </button>
        )}
        <button
          onClick={() => send('sms')}
          disabled={sending || !draft.trim() || !twilioReady}
          style={{ background: twilioReady ? 'var(--sage)' : '#e5e5e5', color: twilioReady ? '#fff' : '#888', border: 'none', borderRadius: '10px', padding: '.8rem', fontSize: '14px', fontWeight: '600', cursor: !twilioReady || sending || !draft.trim() ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}
          title={!twilioReady ? 'Twilio not configured — set up SMS in Integrations' : ''}
        >
          📱 Send via SMS — AI continues conversation
          {!twilioReady && <span style={{ fontSize: '11px', fontWeight: '400' }}> (Twilio required)</span>}
        </button>
        {hasEmail && lead.phone && twilioReady && (
          <button
            onClick={() => send('both')}
            disabled={sending || !draft.trim()}
            style={{ background: '#fff', color: 'var(--sage)', border: '1.5px solid var(--sage)', borderRadius: '10px', padding: '.8rem', fontSize: '14px', fontWeight: '600', cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? .6 : 1 }}
          >
            Send both email &amp; SMS
          </button>
        )}
        <button
          onClick={() => { navigator.clipboard.writeText(draft); }}
          style={{ background: '#f7f7f4', color: 'var(--black)', border: '1.5px solid var(--border)', borderRadius: '10px', padding: '.8rem', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
        >
          📋 Copy message — I'll send it myself
        </button>
      </div>

      {!twilioReady && lead.phone && (
        <div style={{ background: '#fff8e6', border: '1px solid #f0d080', borderRadius: '8px', padding: '.65rem .9rem', fontSize: '12px', color: '#5a4400', marginBottom: '.75rem' }}>
          💡 <strong>Want to send SMS?</strong> <a onClick={onGoToIntegrations} style={{ color: '#8a6800', cursor: 'pointer', textDecoration: 'underline' }}>Set up Twilio in Integrations →</a>
        </div>
      )}

      <div style={{ display: 'flex', gap: '.75rem' }}>
        <button onClick={onAddAnother} style={{ flex: 1, background: 'none', border: '1.5px solid var(--border)', borderRadius: '10px', padding: '.65rem', fontSize: '13px', cursor: 'pointer' }}>
          Add another
        </button>
        <button onClick={onDone} style={{ flex: 1, background: 'none', border: '1.5px solid var(--border)', borderRadius: '10px', padding: '.65rem', fontSize: '13px', cursor: 'pointer' }}>
          Done
        </button>
      </div>
    </div>
  );
}

// ─── HOW IT WORKS MODAL ───────────────────────────────────────────────────────

function HowItWorksModal({ onClose }) {
  const [tab, setTab] = useState('overview');
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'sources',  label: 'Your lead sources' },
    { id: 'scores',   label: 'Lead scores' },
    { id: 'you',      label: 'What you do' },
  ];
  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem',animation:'fadeIn .15s ease' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'var(--white)',borderRadius:'16px',border:'1px solid var(--border)',width:'100%',maxWidth:'580px',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.18)' }}>
        <div style={{ padding:'1.5rem 1.5rem 0',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'1rem' }}>
          <div>
            <div style={{ fontSize:'18px',fontWeight:'600',color:'var(--black)',marginBottom:'.25rem' }}>How Say HelloLeads works</div>
            <div style={{ fontSize:'13px',color:'var(--muted)' }}>Everything that happens automatically — so you can focus on closing.</div>
          </div>
          <button onClick={onClose} style={{ background:'none',border:'1px solid var(--border)',borderRadius:'8px',width:'30px',height:'30px',cursor:'pointer',fontSize:'16px',color:'var(--muted)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center' }} aria-label="Close">×</button>
        </div>
        <div style={{ display:'flex',gap:'2px',padding:'1rem 1.5rem 0',borderBottom:'1px solid var(--border)',overflowX:'auto' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background:'none',border:'none',cursor:'pointer',padding:'.5rem .85rem',fontSize:'13px',fontWeight:'500',fontFamily:"'DM Sans', sans-serif",whiteSpace:'nowrap',color:tab===t.id?'var(--sage)':'var(--muted)',borderBottom:`2px solid ${tab===t.id?'var(--sage)':'transparent'}`,marginBottom:'-1px' }}>{t.label}</button>
          ))}
        </div>
        <div style={{ padding:'1.5rem' }}>
          {tab === 'overview' && (
            <div style={{ display:'flex',flexDirection:'column',gap:0 }}>
              {[
                { icon:'👤',color:'#e8efe7',label:'A buyer reaches out',desc:"Someone inquires through Zillow, your website, a text, Facebook, or any source you've connected. Day or night, you're covered." },
                { icon:'⚡',color:'#e8efe7',label:'They get a reply in under 60 seconds',desc:"A warm, personal message goes out immediately — mentioning the exact property. It sounds like your assistant, not software." },
                { icon:'💬',color:'#e8efe7',label:'The conversation qualifies the lead',desc:"The AI naturally uncovers their timeline, budget, and pre-approval status — without them feeling like they're filling out a form." },
                { icon:'🔔',color:'#fdf3e7',label:'You get a notification',desc:"An alert lands in your email (and by text if you've set that up) with the buyer's name, what they want, and the full conversation." },
                { icon:'🔥',color:'#fdf3e7',label:'Your dashboard tells you who to call first',desc:"Every lead gets scored HOT, WARM, or COLD. Hot leads are ready to buy — you'll know their budget, timeline, and the best next step." },
              ].map((item,i,arr) => (
                <div key={i} style={{ display:'flex',gap:'14px',paddingBottom:'14px',borderBottom:i<arr.length-1?'1px solid var(--border)':'none',paddingTop:i>0?'14px':0 }}>
                  <div style={{ display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0,width:'32px' }}>
                    <div style={{ width:'32px',height:'32px',borderRadius:'50%',background:item.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px' }}>{item.icon}</div>
                    {i<arr.length-1&&<div style={{ width:'1px',flex:1,minHeight:'16px',marginTop:'4px',background:'var(--border)' }} />}
                  </div>
                  <div style={{ flex:1,paddingTop:'5px' }}>
                    <div style={{ fontSize:'14px',fontWeight:'600',color:'var(--black)',marginBottom:'3px' }}>{item.label}</div>
                    <div style={{ fontSize:'13px',color:'var(--muted)',lineHeight:'1.6' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'sources' && (
            <>
              <div style={{ fontSize:'13px',color:'var(--muted)',marginBottom:'14px',lineHeight:'1.6' }}>Every source flows into the same dashboard. Set each one up once — after that it runs itself.</div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'16px' }}>
                {[
                  { emoji:'🏠',title:'Zillow, Homes.com, Realtor.com',desc:"Add your unique email as an extra recipient in each portal's notification settings." },
                  { emoji:'📱',title:'Text message',desc:"Buyers text your dedicated number. The AI texts back immediately from that same number." },
                  { emoji:'📘',title:'Facebook & Instagram ads',desc:"Lead ad forms route automatically to your dashboard via Zapier. One-time setup." },
                  { emoji:'🌐',title:'Your website',desc:"Any contact form can connect here. Leads arrive the same way as every other source." },
                ].map((s,i) => (
                  <div key={i} style={{ border:'1px solid var(--border)',borderRadius:'10px',padding:'12px 14px' }}>
                    <div style={{ fontSize:'14px',marginBottom:'4px' }}>{s.emoji} <span style={{fontWeight:'600',fontSize:'13px',color:'var(--black)'}}>{s.title}</span></div>
                    <div style={{ fontSize:'12px',color:'var(--muted)',lineHeight:'1.5' }}>{s.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{ background:'var(--sage-light)',borderRadius:'10px',padding:'12px 14px',display:'flex',gap:'10px',alignItems:'flex-start' }}>
                <span style={{fontSize:'14px'}}>💡</span>
                <div style={{ fontSize:'13px',color:'var(--sage)',lineHeight:'1.6' }}>You don't need all of them. Start with Zillow or your busiest source and add others whenever you're ready. Each one takes 2–5 minutes.</div>
              </div>
            </>
          )}
          {tab === 'scores' && (
            <>
              <div style={{ fontSize:'13px',color:'var(--muted)',marginBottom:'14px',lineHeight:'1.6' }}>After every conversation, your dashboard automatically scores the lead.</div>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'8px',marginBottom:'16px' }}>
                {[
                  { bg:'#fde8e8',border:'#f5c6c6',label:'🔥 HOT',labelColor:'var(--red)',desc:'Ready to buy soon. Has a budget. Asking specific questions.',action:'Call within the hour.' },
                  { bg:'var(--amber-light)',border:'#f0d9b5',label:'🌤 WARM',labelColor:'var(--amber)',desc:'Interested but still exploring. No firm timeline yet.',action:'Follow up weekly.' },
                  { bg:'#e8eef8',border:'#c5d0e8',label:'❄️ COLD',labelColor:'#5470a0',desc:'Just browsing. Early stage, no urgency.',action:'Stay in touch over time.' },
                ].map((s,i) => (
                  <div key={i} style={{ background:s.bg,border:`1px solid ${s.border}`,borderRadius:'10px',padding:'12px' }}>
                    <div style={{ fontSize:'13px',fontWeight:'600',color:s.labelColor,marginBottom:'6px' }}>{s.label}</div>
                    <div style={{ fontSize:'12px',color:'var(--black)',lineHeight:'1.5',marginBottom:'8px' }}>{s.desc}</div>
                    <div style={{ fontSize:'11px',fontWeight:'600',color:s.labelColor }}>{s.action}</div>
                  </div>
                ))}
              </div>
              <div style={{ background:'var(--sage-light)',borderRadius:'10px',padding:'12px 14px',display:'flex',gap:'10px',alignItems:'flex-start' }}>
                <span style={{fontSize:'14px'}}>💡</span>
                <div style={{ fontSize:'13px',color:'var(--sage)',lineHeight:'1.6' }}>Each scored lead also shows the buyer's timeline, budget, whether they're pre-approved, and a suggested next step.</div>
              </div>
            </>
          )}
          {tab === 'you' && (
            <div style={{ display:'flex',flexDirection:'column',gap:0 }}>
              {[
                { icon:'✅',color:'#e8efe7',label:'Set it up once',desc:"Add your name and photo, forward your Zillow lead emails, and optionally connect a text number. Most agents are live in under 10 minutes." },
                { icon:'🔥',color:'#fdf3e7',label:'Call your HOT leads',desc:"When you get a HOT alert, the hard work is done — you already know their budget, timeline, and pre-approval status. Just call." },
                { icon:'💬',color:'#e8efe7',label:'Jump in whenever you want',desc:"Every conversation is saved in your dashboard. Read it, continue it yourself, or send a follow-up text." },
                { icon:'🙌',color:'#e8efe7',label:'Everything else is handled',desc:"First replies, qualifying questions, lead scoring, notifications — all automatic. You'll never lose a lead to a slow response again." },
              ].map((item,i,arr) => (
                <div key={i} style={{ display:'flex',gap:'14px',paddingBottom:'14px',borderBottom:i<arr.length-1?'1px solid var(--border)':'none',paddingTop:i>0?'14px':0 }}>
                  <div style={{ display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0,width:'32px' }}>
                    <div style={{ width:'32px',height:'32px',borderRadius:'50%',background:item.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px' }}>{item.icon}</div>
                    {i<arr.length-1&&<div style={{ width:'1px',flex:1,minHeight:'16px',marginTop:'4px',background:'var(--border)' }} />}
                  </div>
                  <div style={{ flex:1,paddingTop:'5px' }}>
                    <div style={{ fontSize:'14px',fontWeight:'600',color:'var(--black)',marginBottom:'3px' }}>{item.label}</div>
                    <div style={{ fontSize:'13px',color:'var(--muted)',lineHeight:'1.6' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FAQ ITEM ────────────────────────────────────────────────────────────────────────────────

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '1.1rem 0' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: '1rem' }}
      >
        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--black)', lineHeight: '1.5' }}>{question}</div>
        <span style={{ fontSize: '18px', color: 'var(--sage)', flexShrink: 0, display: 'inline-block', transition: 'transform .2s', transform: open ? 'rotate(45deg)' : 'none', fontWeight: '300', lineHeight: 1 }}>+</span>
      </div>
      {open && (
        <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.8', marginTop: '.75rem', animation: 'fadeIn .2s ease' }}>
          {answer}
        </div>
      )}
    </div>
  );
}

// ─── INTEG CARD ───────────────────────────────────────────────────────────────

function IntegCard({ icon, title, badge, status, desc, link, linkLabel, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: '#fff', border: `1.5px solid ${status ? 'var(--sage-mid)' : 'var(--border)'}`, borderRadius: '14px', marginBottom: '1rem', overflow: 'hidden' }}>
      <div style={{ padding: '1.1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '.85rem', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: '1.3rem' }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '600' }}>{title}</span>
            {badge && <span style={{ fontSize: '11px', background: 'var(--sage-light)', color: 'var(--sage)', padding: '1px 7px', borderRadius: '20px', fontWeight: '500' }}>{badge}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          {status
            ? <span style={{ fontSize: '12px', color: 'var(--sage)', fontWeight: '600' }}>✓ Connected</span>
            : <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Not set up</span>}
          <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'inline-block', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid var(--border)' }}>
          {desc && <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', margin: '1rem 0 .75rem' }}>{desc}</p>}
          {link && <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: 'var(--sage)', fontWeight: '500', display: 'inline-block', marginBottom: '1rem' }}>{linkLabel}</a>}
          {children}
        </div>
      )}
    </div>
  );
}

// ─── CRED FIELD ───────────────────────────────────────────────────────────────

function CredField({ label, field, placeholder, current, saving, msg, onSave }) {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  return (
    <div style={{ marginBottom: '.85rem' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '.3rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>
      {current?.isSet && !editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <div style={{ flex: 1, padding: '.55rem .85rem', background: 'var(--sage-light)', border: '1px solid var(--sage-mid)', borderRadius: '8px', fontSize: '13px', color: 'var(--sage)', fontFamily: 'monospace' }}>
            {current.masked}
          </div>
          <button onClick={() => setEditing(true)} style={{ fontSize: '12px', color: 'var(--sage)', background: 'none', border: '1px solid var(--sage-mid)', borderRadius: '7px', padding: '.45rem .85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>Update</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
          <input
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
            style={{ flex: 1, padding: '.55rem .85rem', border: '1.5px solid var(--border)', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = 'var(--sage)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
            onKeyDown={e => { if (e.key === 'Enter' && value) { onSave(field, value); setValue(''); setEditing(false); } }}
          />
          <button
            onClick={() => { if (value) { onSave(field, value); setValue(''); setEditing(false); } }}
            disabled={!value || saving}
            style={{ background: (!value || saving) ? 'var(--sage-mid)' : 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.55rem 1rem', fontSize: '13px', fontWeight: '500', cursor: (!value || saving) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {editing && (
            <button onClick={() => { setEditing(false); setValue(''); }} style={{ fontSize: '12px', color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', borderRadius: '7px', padding: '.45rem .75rem', cursor: 'pointer' }}>Cancel</button>
          )}
        </div>
      )}
      {msg && <div style={{ fontSize: '12px', color: msg.startsWith('✓') ? 'var(--sage)' : '#dc2626', marginTop: '.3rem', fontWeight: '500' }}>{msg}</div>}
    </div>
  );
}

// ─── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────

function buildSystemPrompt(fname, lname, email, phone, property, source, message, agentName) {
  const name = agentName || 'Anna Williams';
  return `You are ${name}, a real estate agent. You are texting directly with a lead. You are NOT an AI — you ARE the agent. Never refer to yourself in third person. Never say "our agent" or "the agent will" — you ARE that person.

Lead: ${fname} ${lname} | Email: ${email} | Phone: ${phone || 'not provided'} | Property: ${property} | Source: ${source}
Message: "${message}"

YOUR REPLY:
- 2-3 sentences max. Reference the EXACT property or area they mentioned.
- Ask ONE qualifying question — timeline, budget, pre-approval, or also-selling.
- Sound like a real human texting — warm, not scripted. No "Hi there!", no "Great!", no AI mentions.
- Never refer to yourself as "the agent" or "our agent" — you ARE the agent.
- End naturally, no sign-off.`;
}

// ─── SETUP STEPS ─────────────────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    title: 'Deploy to Vercel',
    body: `Push to GitHub then import at <a href="https://vercel.com" target="_blank">vercel.com</a>. Vercel auto-detects Next.js and deploys automatically on every push.`,
  },
  {
    title: 'Add required environment variables',
    body: `Vercel → Your Project → Settings → Environment Variables. Add these four:<br><br>
<code>ANTHROPIC_API_KEY</code> — get at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> → API Keys<br>
<code>NEXTAUTH_SECRET</code> — run <code>openssl rand -base64 32</code> in your terminal<br>
<code>NEXTAUTH_URL</code> — your live domain e.g. <code>https://www.sayhelloleads.com</code><br>
<code>RESEND_API_KEY</code> — free at <a href="https://resend.com" target="_blank">resend.com</a> → API Keys (3,000 emails/mo free)<br><br>
<strong>Note:</strong> <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code> are injected automatically in the next step.`,
  },
  {
    title: 'Create Upstash Redis (lead + user storage)',
    body: `Vercel Dashboard → Storage → Create Database → <strong>Upstash for Redis</strong>.<br>
Vercel automatically injects <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code>. All lead data, agent accounts, and credentials are stored here.`,
  },
  {
    title: 'Set up Postmark for email forwarding (one-time owner step)',
    body: `<strong>You do this once — agents never touch Postmark directly.</strong><br><br>
1. Create a free account at <a href="https://postmarkapp.com" target="_blank">postmarkapp.com</a><br>
2. Create a Server → click the <strong>Inbound</strong> tab<br>
3. Set <strong>Inbound Webhook URL</strong> to: <code>https://www.sayhelloleads.com/api/inbound-email</code><br>
4. Click Save.<br><br>
That's it. Each agent now automatically gets a unique forwarding address (<code>{agentId}@inbound.sayhelloleads.com</code>) shown on their Integrations page. They paste it into Zillow/Homes.com — no further Postmark work needed by anyone.`,
  },
];

// ─── STYLES ───────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --black: #0a0a0a; --white: #fafaf8; --cream: #f5f3ee;
    --sage: #4a6741; --sage-light: #e8efe7; --sage-mid: #8aab84;
    --amber: #c9873a; --amber-light: #fdf3e7; --red: #c0392b;
    --muted: #6b6b6b; --border: #e0ddd8; --radius: 10px;
  }
  body { font-family: 'DM Sans', sans-serif; background: var(--white); color: var(--black); min-height: 100vh; font-size: 15px; line-height: 1.6; }
  .fade-in { animation: fadeIn .4s ease; }
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }

  nav { display:flex; align-items:center; justify-content:space-between; padding:1.1rem 2.5rem; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--white); z-index:100; flex-wrap:wrap; gap:.75rem; }
  .logo { font-family:'Instrument Serif',serif; font-size:1.5rem; letter-spacing:-.01em; }
  .logo span { color:var(--sage); }
  .nav-links { display:flex; gap:1.5rem; align-items:center; flex-wrap:wrap; }
  .nav-links a { color:var(--muted); text-decoration:none; font-size:14px; cursor:pointer; transition:color .2s; }
  .nav-links a:hover { color:var(--black); }
  .nav-avatar-wrap { position:relative; }
  .avatar-btn { background:none; border:none; padding:0; cursor:pointer; display:flex; align-items:center; }
  .avatar-circle { width:34px; height:34px; border-radius:50%; background:var(--sage); color:#fff; font-size:14px; font-weight:600; display:flex; align-items:center; justify-content:center; transition:opacity .15s; font-family:'Instrument Serif',serif; }
  .avatar-circle.lg { width:40px; height:40px; font-size:16px; flex-shrink:0; }
  .avatar-btn:hover .avatar-circle { opacity:.85; }
  .avatar-dropdown { position:absolute; top:calc(100% + 10px); right:0; background:#fff; border:1.5px solid var(--border); border-radius:14px; min-width:220px; box-shadow:0 8px 24px rgba(0,0,0,.1); z-index:100; overflow:hidden; animation:fadeIn .12s ease; }
  .avatar-header { display:flex; align-items:center; gap:.75rem; padding:1rem 1rem .75rem; border-bottom:1px solid var(--border); }
  .avatar-name { font-size:14px; font-weight:600; color:var(--black); line-height:1.3; }
  .avatar-email { font-size:12px; color:var(--muted); }
  .avatar-menu { padding:.4rem; }
  .avatar-item { display:flex; align-items:center; gap:.6rem; width:100%; background:none; border:none; padding:.6rem .75rem; border-radius:8px; font-size:14px; font-family:'DM Sans',sans-serif; color:var(--black); cursor:pointer; text-align:left; transition:background .12s; }
  .avatar-item:hover { background:var(--bg); }
  .avatar-item.danger { color:#dc2626; }
  .avatar-item.danger:hover { background:#fef2f2; }
  .avatar-item svg { flex-shrink:0; opacity:.6; }
  .avatar-divider { height:1px; background:var(--border); margin:.3rem .4rem; }

  .btn-primary { background:var(--sage); color:#fff; border:none; border-radius:var(--radius); padding:.55rem 1.25rem; font-size:14px; font-family:'DM Sans',sans-serif; font-weight:500; cursor:pointer; transition:background .2s; }
  .btn-primary:hover { background:#3d5836; }
  .btn-outline { background:transparent; color:var(--sage); border:1.5px solid var(--sage); border-radius:var(--radius); padding:.55rem 1.25rem; font-size:14px; font-family:'DM Sans',sans-serif; font-weight:500; cursor:pointer; transition:all .2s; }
  .btn-outline:hover { background:var(--sage-light); }

  .hero { max-width:780px; margin:0 auto; padding:5rem 2rem 4rem; text-align:center; }
  .hero-badge { display:inline-block; background:var(--sage-light); color:var(--sage); font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; padding:.3rem .9rem; border-radius:20px; margin-bottom:1.5rem; }
  .hero h1 { font-family:'Instrument Serif',serif; font-size:clamp(2.4rem,5vw,3.8rem); line-height:1.15; letter-spacing:-.02em; margin-bottom:1.25rem; }
  .hero h1 em { color:var(--sage); font-style:italic; }
  .hero p { font-size:1.05rem; color:var(--muted); max-width:520px; margin:0 auto 2rem; line-height:1.7; }
  .hero-cta { display:flex; gap:.75rem; justify-content:center; flex-wrap:wrap; }
  .hero-cta .btn-primary, .hero-cta .btn-outline { padding:.75rem 2rem; font-size:15px; }

  .stats-bar { display:flex; justify-content:center; gap:3rem; flex-wrap:wrap; padding:2.5rem 2rem; border-top:1px solid var(--border); border-bottom:1px solid var(--border); background:var(--cream); }
  .stat-item { text-align:center; }
  .stat-num { font-family:'Instrument Serif',serif; font-size:2.2rem; color:var(--black); line-height:1; margin-bottom:.2rem; }
  .stat-label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }

  .integration-bar { background:var(--black); color:var(--white); padding:3rem 2rem; text-align:center; }
  .integration-bar h3 { font-family:'Instrument Serif',serif; font-size:1.6rem; margin-bottom:1.5rem; }
  .integration-bar h3 em { color:var(--sage-mid); font-style:italic; }
  .integrations { display:flex; justify-content:center; gap:2rem; flex-wrap:wrap; align-items:center; }
  .integration-chip { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:.6rem 1.25rem; font-size:14px; font-weight:500; display:flex; align-items:center; gap:.5rem; }
  .dot-green { width:7px; height:7px; background:#4ade80; border-radius:50%; flex-shrink:0; }

  .how-it-works { max-width:860px; margin:4rem auto; padding:0 2rem; }
  .section-label { font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.1em; color:var(--sage); margin-bottom:.75rem; }
  .section-title { font-family:'Instrument Serif',serif; font-size:clamp(1.7rem,3vw,2.4rem); letter-spacing:-.02em; margin-bottom:2.5rem; max-width:500px; }
  .steps { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:1.5rem; }
  .step { padding:1.5rem; border:1px solid var(--border); border-radius:14px; background:var(--white); transition:border-color .2s,box-shadow .2s; }
  .step:hover { border-color:var(--sage-mid); box-shadow:0 4px 16px rgba(74,103,65,.08); }
  .step-num { width:32px; height:32px; background:var(--sage-light); color:var(--sage); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:13px; margin-bottom:1rem; }
  .step h3 { font-size:15px; font-weight:600; margin-bottom:.4rem; }
  .step p { font-size:13px; color:var(--muted); line-height:1.6; }

  .demo-cta-block { background:var(--black); color:var(--white); border-radius:20px; padding:3rem 2.5rem; max-width:860px; margin:3rem auto 5rem; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1.5rem; }
  .demo-cta-block h2 { font-family:'Instrument Serif',serif; font-size:1.9rem; line-height:1.2; max-width:380px; }
  .demo-cta-block h2 em { color:var(--sage-mid); font-style:italic; }
  .demo-cta-block .btn-primary { background:var(--sage); font-size:15px; padding:.75rem 1.75rem; }

  .back-link { display:inline-flex; align-items:center; gap:.4rem; color:var(--muted); font-size:13px; cursor:pointer; margin-bottom:2rem; text-decoration:none; transition:color .2s; }
  .back-link:hover { color:var(--black); }
  .demo-header { margin-bottom:2rem; }
  .demo-header h2 { font-family:'Instrument Serif',serif; font-size:2rem; margin-bottom:.4rem; }
  .demo-header p { color:var(--muted); font-size:14px; }

  .form-card { background:var(--cream); border:1px solid var(--border); border-radius:16px; padding:2rem; margin-bottom:1.5rem; }
  .form-card h3 { font-size:15px; font-weight:600; margin-bottom:1.25rem; display:flex; align-items:center; gap:.5rem; }
  .tag { background:var(--amber-light); color:var(--amber); font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; text-transform:uppercase; letter-spacing:.04em; }
  .field { margin-bottom:1rem; }
  .field label { display:block; font-size:13px; font-weight:500; margin-bottom:.35rem; }
  .field input, .field select, .field textarea { width:100%; padding:.6rem .85rem; border:1px solid var(--border); border-radius:8px; font-size:14px; font-family:'DM Sans',sans-serif; background:var(--white); color:var(--black); transition:border-color .2s; outline:none; appearance:none; }
  .field input:focus, .field select:focus, .field textarea:focus { border-color:var(--sage-mid); box-shadow:0 0 0 3px rgba(74,103,65,.1); }
  .field textarea { resize:vertical; min-height:80px; }
  .field-row { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }
  .sms-toggle { display:flex; align-items:center; gap:.6rem; margin-top:.5rem; font-size:13px; color:var(--muted); }
  .sms-toggle input[type=checkbox] { width:16px; height:16px; accent-color:var(--sage); cursor:pointer; }
  .submit-btn { width:100%; background:var(--sage); color:#fff; border:none; border-radius:var(--radius); padding:.85rem; font-size:15px; font-family:'DM Sans',sans-serif; font-weight:600; cursor:pointer; transition:background .2s; }
  .submit-btn:hover { background:#3d5836; }
  .submit-btn:disabled { background:var(--muted); cursor:not-allowed; }

  .convo-header { margin-bottom:2rem; }
  .convo-header h2 { font-family:'Instrument Serif',serif; font-size:1.6rem; margin-bottom:.25rem; }
  .convo-header p { color:var(--muted); font-size:13px; }
  .lead-info { display:flex; gap:.6rem; flex-wrap:wrap; margin-top:.75rem; }
  .pill { background:var(--sage-light); color:var(--sage); border-radius:20px; padding:.25rem .75rem; font-size:12px; font-weight:500; }
  .pill.amber { background:var(--amber-light); color:var(--amber); }
  .pill.sms { background:#e8f4fd; color:#2980b9; }

  .chat-window { background:var(--cream); border:1px solid var(--border); border-radius:16px; padding:1.5rem; display:flex; flex-direction:column; gap:1rem; min-height:200px; margin-bottom:1rem; max-height:480px; overflow-y:auto; }
  .msg { max-width:82%; padding:.75rem 1rem; border-radius:14px; font-size:14px; line-height:1.6; animation:msgIn .25s ease; }
  @keyframes msgIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  .msg.ai { background:var(--white); border:1px solid var(--border); align-self:flex-start; border-radius:4px 14px 14px 14px; }
  .msg.lead { background:var(--sage); color:#fff; align-self:flex-end; border-radius:14px 4px 14px 14px; }
  .msg.system-note { background:var(--amber-light); border:1px solid #f0d9b5; align-self:center; border-radius:10px; font-size:12px; color:var(--amber); text-align:center; padding:.4rem .9rem; max-width:100%; }
  .msg-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; margin-bottom:.3rem; }
  .msg.ai .msg-label { color:var(--sage); }
  .msg.lead .msg-label { color:rgba(255,255,255,.7); }
  .typing { align-self:flex-start; background:var(--white); border:1px solid var(--border); border-radius:4px 14px 14px 14px; padding:.75rem 1rem; font-size:13px; color:var(--muted); display:flex; align-items:center; gap:.4rem; }
  .dot { width:6px; height:6px; background:var(--muted); border-radius:50%; animation:bounce .8s infinite; }
  .dot:nth-child(2) { animation-delay:.15s; }
  .dot:nth-child(3) { animation-delay:.3s; }
  @keyframes bounce { 0%,80%,100% { transform:translateY(0); } 40% { transform:translateY(-5px); } }

  .reply-row { display:flex; gap:.75rem; align-items:flex-end; }
  .reply-row input { flex:1; padding:.65rem 1rem; border:1px solid var(--border); border-radius:var(--radius); font-size:14px; font-family:'DM Sans',sans-serif; outline:none; background:var(--white); transition:border-color .2s; }
  .reply-row input:focus { border-color:var(--sage-mid); box-shadow:0 0 0 3px rgba(74,103,65,.1); }
  .reply-row button { background:var(--sage); color:#fff; border:none; border-radius:var(--radius); padding:.65rem 1.1rem; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; font-weight:500; transition:background .2s; white-space:nowrap; }
  .reply-row button:hover { background:#3d5836; }
  .reply-row button:disabled { background:var(--muted); cursor:not-allowed; }
  .go-dashboard-btn { display:block; width:100%; text-align:center; margin-top:1.25rem; background:var(--black); color:#fff; border:none; border-radius:var(--radius); padding:.8rem; font-size:14px; font-family:'DM Sans',sans-serif; font-weight:500; cursor:pointer; transition:background .2s; }
  .go-dashboard-btn:hover { background:#222; }
  .go-dashboard-btn:disabled { background:var(--muted); cursor:not-allowed; }

  .dash-nav { padding:1rem 2rem; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.75rem; }
  .dash-nav h2 { font-size:15px; font-weight:600; }
  .dash-nav-right { display:flex; align-items:center; gap:.75rem; }
  .live-badge { display:flex; align-items:center; gap:.4rem; font-size:12px; color:var(--sage); font-weight:600; }
  .live-dot { width:7px; height:7px; background:var(--sage); border-radius:50%; animation:pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }

  .dash-body { max-width:960px; margin:0 auto; padding:2rem 1.5rem 5rem; }
  .dash-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1rem; margin-bottom:2.5rem; }
  .kpi { background:var(--cream); border:1px solid var(--border); border-radius:12px; padding:1.1rem 1.25rem; }
  .kpi-label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:.35rem; }
  .kpi-val { font-family:'Instrument Serif',serif; font-size:2rem; color:var(--black); line-height:1; }
  .kpi-sub { font-size:12px; color:var(--sage); margin-top:.25rem; font-weight:500; }
  .kpi.highlight { background:var(--sage); border-color:var(--sage); }
  .kpi.highlight .kpi-label { color:rgba(255,255,255,.7); }
  .kpi.highlight .kpi-val { color:#fff; }
  .kpi.highlight .kpi-sub { color:rgba(255,255,255,.8); }

  .dash-section-title { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:1rem; }
  .filter-row { display:flex; gap:.5rem; flex-wrap:wrap; }
  .filter-btn { background:var(--cream); border:1px solid var(--border); border-radius:20px; padding:.3rem .85rem; font-size:13px; cursor:pointer; font-family:'DM Sans',sans-serif; transition:all .2s; }
  .filter-btn.active, .filter-btn:hover { background:var(--sage); color:#fff; border-color:var(--sage); }

  .lead-cards { display:flex; flex-direction:column; gap:.75rem; }
  .lead-card { background:var(--white); border:1px solid var(--border); border-radius:14px; padding:1.25rem 1.5rem; display:flex; align-items:flex-start; gap:1rem; cursor:pointer; transition:border-color .2s,box-shadow .2s; }
  .lead-card:hover { border-color:var(--sage-mid); box-shadow:0 4px 16px rgba(74,103,65,.07); }
  .lead-card.new-lead { border-left:3px solid var(--sage); }
  .lead-card.hot-lead { border-left:3px solid var(--red); }
  .lead-avatar { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:14px; flex-shrink:0; background:var(--sage-light); color:var(--sage); }
  .lead-main { flex:1; min-width:0; }
  .lead-name { font-weight:600; font-size:14px; margin-bottom:.2rem; }
  .lead-preview { font-size:13px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lead-meta { font-size:11px; color:var(--muted); margin-top:.35rem; display:flex; gap:.75rem; align-items:center; flex-wrap:wrap; }
  .score-badge { padding:.2rem .6rem; border-radius:20px; font-size:11px; font-weight:600; }
  .score-hot { background:#fde8e8; color:var(--red); }
  .score-warm { background:var(--amber-light); color:var(--amber); }
  .score-cold { background:#e8eef8; color:#5470a0; }
  .lead-time { margin-left:auto; font-size:12px; color:var(--muted); flex-shrink:0; }

  .lead-detail-panel { background:var(--cream); border:1px solid var(--border); border-radius:16px; padding:1.5rem; margin-top:.5rem; animation:fadeIn .25s ease; }
  .detail-summary { font-size:14px; line-height:1.7; margin-bottom:1rem; }
  .detail-tags { display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:1rem; }
  .detail-actions { display:flex; gap:.6rem; margin-bottom:1rem; flex-wrap:wrap; }
  .action-btn { background:var(--white); border:1px solid var(--border); border-radius:8px; padding:.45rem 1rem; font-size:13px; cursor:pointer; font-family:'DM Sans',sans-serif; font-weight:500; transition:all .2s; display:flex; align-items:center; gap:.4rem; }
  .action-btn:hover { border-color:var(--sage-mid); color:var(--sage); }
  .action-btn.green { background:var(--sage); color:#fff; border-color:var(--sage); }
  .action-btn.green:hover { background:#3d5836; }
  .action-btn.red { background:#fde8e8; color:var(--red); border-color:#f5c6c6; }
  .action-btn.red:hover { background:#f5c6c6; }
  .setup-input { width:100%; padding:.6rem .85rem; border:1px solid var(--border); border-radius:8px; font-size:14px; font-family:'DM Sans',sans-serif; background:var(--white); color:var(--black); outline:none; transition:border-color .2s; }
  .setup-input:focus { border-color:var(--sage-mid); box-shadow:0 0 0 3px rgba(74,103,65,.1); }
  .detail-convo { background:var(--white); border:1px solid var(--border); border-radius:10px; padding:1rem; max-height:260px; overflow-y:auto; }
  .mini-msg { font-size:13px; padding:.5rem .75rem; border-radius:10px; margin-bottom:.5rem; line-height:1.5; }
  .mini-msg.ai { background:var(--sage-light); color:var(--black); }
  .mini-msg.lead { background:var(--black); color:#fff; text-align:right; }
  .mini-msg .who { font-size:11px; font-weight:600; margin-bottom:.2rem; opacity:.7; text-transform:uppercase; letter-spacing:.04em; }

  .empty-state { text-align:center; padding:3rem 1rem; color:var(--muted); }
  .empty-state svg { margin-bottom:1rem; opacity:.3; }
  .empty-state p { font-size:14px; }

  .setup-step { border:1px solid var(--border); border-radius:14px; padding:1.5rem; margin-bottom:1rem; background:var(--white); }
  .step-header { display:flex; align-items:center; gap:.75rem; margin-bottom:1rem; }
  .setup-step .step-num { width:28px; height:28px; background:var(--sage-light); color:var(--sage); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex-shrink:0; }
  .setup-step h3 { font-size:15px; font-weight:600; }
  .step-body { font-size:14px; color:var(--muted); line-height:1.7; }
  .step-body a { color:var(--sage); }
  .step-body code { background:var(--cream); padding:.1rem .4rem; border-radius:4px; font-size:13px; }
  .code-block { background:var(--black); color:#e0e0e0; border-radius:10px; padding:1rem 1.25rem; font-family:'Courier New',monospace; font-size:13px; margin:.75rem 0; overflow-x:auto; line-height:1.6; white-space:pre; }
`;

export async function getServerSideProps(context) {
  const { getSession } = await import('next-auth/react');
  // We check on client side via useSession, server props just pass through
  return { props: {} };
}
