import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/router';
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
  const { data: session, status } = useSession();
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

  // Human-like delay: 1s base + 20ms per char, capped at 4s
  function typingDelay(text) {
    return Math.min(1000 + (text?.length || 0) * 20, 4000);
  }
  const [scoring, setScoring] = useState(false);
  const [profile, setProfile] = useState({ name: '', agencyName: '', notifyEmail: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  // Integration credentials
  const [creds, setCreds]           = useState({});
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [credsSaving, setCredsSaving] = useState({});
  const [credsMsg, setCredsMsg]     = useState({});
  // Onboarding checklist
  const [checklist, setChecklist]   = useState({ profile: false, zillow: false, sms: false, website: false });
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
  }, [router.query?.view]);

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
    if (['setup','profile'].includes(view)) loadProfile();
    if (view === 'integrations') loadCreds();
    if (view === 'dashboard') loadChecklist();
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
      if (res.ok) setProfileMsg('✓ Profile saved');
      else setProfileMsg('Save failed — try again');
    } catch { setProfileMsg('Save failed — try again'); }
    setProfileSaving(false);
    setTimeout(() => setProfileMsg(''), 3000);
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
        zillow:  !!(c.postmarkToken?.isSet),
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
      setChatMessages(prev => [...prev, { role: 'ai', name: session?.user?.name || 'Agent', text: reply }]);
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

      // Save lead to DB
      await callAPI('/api/leads', lead);
      setCurrentLead({ ...lead });
    } catch (e) {
      setIsTyping(false);
      setChatMessages(prev => [...prev, { role: 'ai', name: session?.user?.name || 'Agent', text: "Thanks for reaching out! Tell me more — what's your timeline for moving?" }]);
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
    const systemPrompt = `You are a real estate assistant texting on behalf of ${session?.user?.name || 'the agent'} about ${currentLead.property}. Sound human and warm. Never mention AI.
Continue qualifying (budget, timeline, pre-approval). Stay warm and brief (3 sentences max). If they want a showing, offer 2-3 realistic time slots.`;

    try {
      const data = await callAPI('/api/chat', { system: systemPrompt, messages: newHistory });
      const reply = data.reply;

      // Scale typing delay to reply length — feels human
      await new Promise(r => setTimeout(r, typingDelay(reply)));
      setIsTyping(false);

      setConversationHistory(prev => [...prev, { role: 'assistant', content: reply }]);
      setChatMessages(prev => [...prev, { role: 'ai', name: session?.user?.name || 'Agent', text: reply }]);

      const finalLead = { ...updatedLead, messages: [...updatedLead.messages, { role: 'ai', text: reply }], updatedAt: new Date().toISOString() };
      setCurrentLead(finalLead);
      await callAPI('/api/leads', finalLead);

      if (finalLead.smsSent && finalLead.phone) {
        fetch('/api/send-sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: finalLead.phone, message: reply }),
        }).catch(() => {});
      }
    } catch (e) {
      setIsTyping(false);
      setChatMessages(prev => [...prev, { role: 'ai', name: session?.user?.name || 'Agent', text: "Let me look into that — can I get your best callback number?" }]);
    }
  }

  async function goToDashboard() {
    if (!currentLead) { setView('dashboard'); return; }
    setScoring(true);

    const convo = (currentLead.messages || []).map(m => (m.role === 'ai' ? 'Assistant' : 'Lead') + ': ' + m.text).join('\n');
    const scoreContent = 'Lead: ' + currentLead.fname + ' ' + currentLead.lname + '\nProperty: ' + currentLead.property + '\nSource: ' + currentLead.source + '\n\nConversation:\n' + convo + '\n\nRules: HOT = timeline within 60 days AND pre-approved or specific budget. WARM = interested but vague. COLD = browsing.\n\nRespond ONLY as valid JSON: {"score":"HOT","confidence":"high","signals":{"timeline":"30 days","budget":"$400k","preApproved":true,"alsoSelling":false,"motivation":"relocating","urgencyLevel":"high"},"summary":"2-sentence brief about the lead.","nextAction":"Specific recommended next step for the agent."}';

    try {
      const data = await callAPI('/api/chat', {
        system: 'You are a real estate lead scoring expert. Respond ONLY with valid JSON, no markdown.',
        messages: [{ role: 'user', content: scoreContent }],
        max_tokens: 400,
      });
      const clean = data.reply.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
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

    await callAPI('/api/leads', { ...currentLead, updatedAt: new Date().toISOString() });
    setScoring(false);
    setView('dashboard');
  }

  function continueConvo(lead) {
    setCurrentLead(lead);
    setConversationHistory(lead.messages.map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text,
    })));
    setChatMessages(lead.messages.map(m => ({
      role: m.role,
      name: m.role === 'ai' ? (session?.user?.name || 'Agent') : `${lead.fname} ${lead.lname}`,
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

  return (
    <>
      <Head>
        <title>Say HelloLeads — AI Lead Response</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{GLOBAL_CSS}</style>

      {/* NAV */}
      <nav>
        <div className="logo">Say <span>HelloLeads</span></div>
        <div className="nav-links">
          <a onClick={() => setView('landing')}>Home</a>
          {session && <a onClick={() => setView('dashboard')}>Dashboard</a>}
          {session ? (
            <div className="nav-avatar-wrap" ref={avatarRef}>
              <button
                className="avatar-btn"
                onClick={() => setAvatarOpen(o => !o)}
                aria-label="Account menu"
              >
                <div className="avatar-circle">
                  {(session.user?.name || session.user?.email || '?').charAt(0).toUpperCase()}
                </div>
              </button>
              {avatarOpen && (
                <div className="avatar-dropdown">
                  <div className="avatar-header">
                    <div className="avatar-circle lg">{(session.user?.name || session.user?.email || '?').charAt(0).toUpperCase()}</div>
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
            <div className="hero-badge">✦ Powered by AI · Built for real estate</div>
            <h1>Respond to every lead<br /><em>in 60 seconds.</em> Automatically.</h1>
            <p>Most agents take 15 hours to reply. By then, the buyer has moved on. Say HelloLeads responds the moment a lead comes in — qualifies every lead — and tells you exactly who to call first.</p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => router.push('/register')}>Start free — no credit card →</button>
              <button className="btn-outline" onClick={() => setView('demo')}>See live demo</button>
            </div>
            <div style={{ marginTop: '1.5rem', fontSize: '13px', color: 'var(--muted)', display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <span>✓ Setup in under 5 minutes</span>
              <span>✓ Works with Zillow, SMS, your website</span>
              <span>✓ Cancel anytime</span>
            </div>
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
                ['2', 'AI responds in under 60s', 'A warm, personalized reply goes out immediately — written in your voice, referencing the exact property.'],
                ['3', 'Lead gets qualified', 'The AI has a natural back-and-forth — learning timeline, budget, pre-approval, and motivation.'],
                ['4', 'You get the brief', '🔥 Hot leads trigger an instant alert: who they are, what they want, and what to say when you call.'],
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
              {['Zillow Premier Agent','Homes.com','Realtor.com','SMS / Text','Your Website','Zapier / Webhooks'].map(s => (
                <div className="integration-chip" key={s}><span className="dot-green" />{s}</div>
              ))}
            </div>
          </div>

          {/* ── SOCIAL PROOF ────────────────────────────────────────── */}
          <div style={{ maxWidth: '860px', margin: '4rem auto', padding: '0 2rem' }}>
            <div className="section-label">What agents say</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
              {[
                ["“I used to lose leads every weekend. Now they get a response in under a minute — whether I’m showing a home or at my kid’s soccer game.”", 'Maria C.', 'Keller Williams, Cincinnati'],
                ["“My Zillow spend was $600/mo and I was missing half the leads. In the first week using this I booked 3 showings from leads I would have lost.”", 'James T.', 'RE/MAX, Columbus'],
                ["“The AI sounds more professional than my usual texts. Leads actually think they’re talking to my assistant. That’s exactly what I wanted.”", 'Priya S.', 'Independent Agent, Dayton'],
              ].map(([quote, name, title]) => (
                <div key={name} style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.5rem' }}>
                  <div style={{ fontSize: '13px', color: 'var(--black)', lineHeight: '1.7', marginBottom: '1rem', fontStyle: 'italic' }}>{quote}</div>
                  <div style={{ fontSize: '13px', fontWeight: '600' }}>{name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{title}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── PRICING ─────────────────────────────────────────────── */}
          <div style={{ background: 'var(--cream)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '4rem 2rem' }}>
            <div style={{ maxWidth: '720px', margin: '0 auto', textAlign: 'center' }}>
              <div className="section-label">Pricing</div>
              <div className="section-title" style={{ margin: '0 auto 2rem' }}>Simple, straightforward.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {[
                  { name: 'Solo Agent', price: '$79', period: '/mo', features: ['1 agent', 'Unlimited leads', 'AI responses + scoring', 'Email alerts', 'Zillow + SMS + Website'], highlight: false },
                  { name: 'Team', price: '$199', period: '/mo', features: ['Up to 5 agents', 'Everything in Solo', 'Team dashboard', 'Priority support', 'Onboarding call'], highlight: true },
                  { name: 'Brokerage', price: '$499', period: '/mo', features: ['Unlimited agents', 'Everything in Team', 'Custom branding', 'API access', 'Dedicated support'], highlight: false },
                ].map(plan => (
                  <div key={plan.name} style={{
                    background: plan.highlight ? 'var(--sage)' : 'var(--white)',
                    border: `2px solid ${plan.highlight ? 'var(--sage)' : 'var(--border)'}`,
                    borderRadius: '16px', padding: '1.75rem',
                    color: plan.highlight ? '#fff' : 'var(--black)',
                    position: 'relative',
                  }}>
                    {plan.highlight && <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: 'var(--amber)', color: '#fff', fontSize: '11px', fontWeight: '700', padding: '3px 12px', borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>Most popular</div>}
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '.5rem', opacity: plan.highlight ? .85 : 1 }}>{plan.name}</div>
                    <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: '2.2rem', lineHeight: '1', marginBottom: '.2rem' }}>{plan.price}<span style={{ fontSize: '14px', fontWeight: '400' }}>{plan.period}</span></div>
                    <div style={{ height: '1px', background: plan.highlight ? 'rgba(255,255,255,.2)' : 'var(--border)', margin: '1rem 0' }} />
                    {plan.features.map(f => <div key={f} style={{ fontSize: '13px', marginBottom: '.4rem', opacity: plan.highlight ? .9 : .85 }}>✓ {f}</div>)}
                    <button
                      onClick={() => router.push('/register')}
                      style={{ width: '100%', marginTop: '1.25rem', background: plan.highlight ? '#fff' : 'var(--sage)', color: plan.highlight ? 'var(--sage)' : '#fff', border: 'none', borderRadius: '8px', padding: '.7rem', fontSize: '14px', fontFamily: "'DM Sans', sans-serif", fontWeight: '600', cursor: 'pointer' }}
                    >
                      Get started →
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
        <section className="fade-in" style={{ maxWidth: '560px', margin: '3rem auto', padding: '0 1.5rem 4rem' }}>
          <a className="back-link" onClick={() => setView('landing')}>← Back</a>
          <div className="demo-header">
            <h2>See it from a buyer's side</h2>
            <p>Enter a fake lead below and watch how your page responds — exactly what a real buyer would experience.</p>
          </div>
          <div className="form-card">
            <h3>Fake buyer inquiry <span className="tag">you're the agent</span></h3>
            <div className="field-row">
              <div className="field"><label>First name</label><input value={form.fname} onChange={e => setForm(f => ({...f, fname: e.target.value}))} placeholder="e.g. Maria" /></div>
              <div className="field"><label>Last name</label><input value={form.lname} onChange={e => setForm(f => ({...f, lname: e.target.value}))} placeholder="e.g. Chen" /></div>
            </div>
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="maria@email.com" /></div>
            <div className="field">
              <label>Phone (optional — for SMS demo)</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="(513) 555-0192" />
              <div className="sms-toggle">
                <input type="checkbox" id="sms-chk" checked={form.wantsSms} onChange={e => setForm(f => ({...f, wantsSms: e.target.checked}))} />
                <label htmlFor="sms-chk">Send real SMS (requires Twilio setup)</label>
              </div>
            </div>
            <div className="field"><label>Property they inquired about</label><input value={form.property} onChange={e => setForm(f => ({...f, property: e.target.value}))} placeholder="e.g. 412 Elm Street, 3BR in Hyde Park" /></div>
            <div className="field"><label>Their message</label><textarea value={form.message} onChange={e => setForm(f => ({...f, message: e.target.value}))} /></div>
            <div className="field"><label>Lead source</label>
              <select value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))}>
                {['Zillow','Homes.com','Realtor.com','Website','Referral','Sign call','Text message'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <button className="submit-btn" disabled={submitting} onClick={submitLead}>
            {submitting ? 'Connecting…' : 'See what your buyer experiences →'}
          </button>
          <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>This is a preview only. Use a fake name — you're seeing exactly what a real buyer would see on your page.</p>
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
                  {msg.text}
                </div>
              )
            ))}
            {isTyping && (
              <div className="typing">
                <span style={{ fontSize: '11px', color: 'var(--sage)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: '4px' }}>{session?.user?.name || 'Agent'}</span>
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
              onClick={() => router.push('/register')}
              style={{ background: 'var(--sage)' }}
            >
              💾 Save this lead — create a free account →
            </button>
          )}
        </section>
      )}

      {/* DASHBOARD */}
      {view === 'dashboard' && (
        <section className="fade-in">
          <div className="dash-nav">
            <h2>Agent dashboard</h2>
            <div className="dash-nav-right">
              <div className="live-badge"><div className="live-dot" /> Live</div>
              <button className="btn-outline" onClick={() => setView('profile')} style={{ fontSize: '13px', padding: '.4rem 1rem' }}>Profile &amp; setup</button>
            </div>
          </div>

          <div className="dash-body">

            {/* ONBOARDING CHECKLIST — shown until all 4 steps done */}
            {(!checklist.profile || !checklist.zillow || !checklist.sms || !checklist.website) && (
              <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: '14px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '1rem', color: 'var(--black)' }}>
                  🚀 Get set up — {[checklist.profile, checklist.zillow, checklist.sms, checklist.website].filter(Boolean).length} of 4 steps done
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  {[
                    { done: checklist.profile, label: 'Complete your profile',               dest: 'profile',       hint: 'Name + notification email' },
                    { done: checklist.zillow,   label: 'Forward leads from Zillow / Homes.com', dest: 'integrations',  hint: '2-minute email setting' },
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

            <div className="dash-kpis">
              <div className="kpi highlight"><div className="kpi-label">response time</div><div className="kpi-val">&lt;60s</div><div className="kpi-sub">vs 15hr industry avg</div></div>
              <div className="kpi"><div className="kpi-label">total leads</div><div className="kpi-val">{stats.total}</div><div className="kpi-sub">all time</div></div>
              <div className="kpi"><div className="kpi-label">hot leads</div><div className="kpi-val">{stats.hot}</div><div className="kpi-sub">need follow-up now</div></div>
              <div className="kpi"><div className="kpi-label">AI handled</div><div className="kpi-val">100%</div><div className="kpi-sub">first response</div></div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', marginBottom: '.75rem' }}>
              <div className="dash-section-title" style={{ margin: 0 }}>Active leads</div>
              <div className="filter-row">
                {[['all','All'],['HOT','🔥 Hot'],['WARM','🌤 Warm'],['COLD','❄️ Cold']].map(([f,l]) => (
                  <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{l}</button>
                ))}
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
                        <button className="action-btn green" onClick={() => continueConvo(lead)}>💬 Continue conversation</button>
                        {lead.phone && (
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
                            <div className="who">{m.role === 'ai' ? (session?.user?.name || 'Agent') : lead.fname}</div>
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
              <div className="field-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Notification email <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(where to send lead alerts)</span></label>
                  <input className="setup-input" type="email" value={profile.notifyEmail} onChange={e => setProfile(p => ({ ...p, notifyEmail: e.target.value }))} placeholder="you@yourrealty.com" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Your phone <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
                  <input className="setup-input" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} placeholder="(513) 555-0100" />
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
              <div style={{ fontWeight: '600', color: 'var(--sage)', marginBottom: '.4rem' }}>✓ Included in your subscription</div>
              <div style={{ color: 'var(--black)', display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                <span>🤖 AI lead responses</span>
                <span>📊 Lead scoring</span>
                <span>🔔 Email alerts to you</span>
                <span>💾 Lead storage</span>
              </div>
            </div>
          </div>

          {/* ── TWILIO SMS ───────────────────────────────────────────── */}
          <IntegCard
            icon="📱" title="SMS — get a Twilio number" badge="Recommended"
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

          {/* ── ZILLOW / HOMES.COM / REALTOR.COM ─────────────────────── */}
          {(() => {
            const agentId = session?.user?.id || '';
            const inboundAddr = agentId ? `${agentId}@inbound.postmarkapp.com` : '';
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
              <IntegCard icon="🏠" title="Zillow Premier Agent" badge="Email forwarding" status={false}
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
              </IntegCard>

              <IntegCard icon="🏡" title="Homes.com" badge="Email forwarding" status={false}
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
              </IntegCard>

              <IntegCard icon="🔑" title="Realtor.com" badge="Email forwarding" status={false}
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
              </IntegCard>

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
                    x-agent-id: {agentId || 'your-agent-id'}
                  </code><br/><br/>
                  Body fields: <code style={{ fontSize: '11px' }}>fname, lname, email, phone, property, message, source</code>
                </div>
                <CredField
                  label="Webhook secret (optional — adds security)" field="webhookSecret" placeholder="any random string"
                  current={creds.webhookSecret} saving={credsSaving.webhookSecret} msg={credsMsg.webhookSecret}
                  onSave={saveCred}
                />
              </IntegCard>
            </>);
          })()}

          {/* ── CUSTOM SEND-FROM EMAIL ───────────────────────────────── */}
          <IntegCard
            icon="✍️" title="Custom send-from email" badge="Optional"
            desc="By default AI replies come from noreply@sayhelloleads.com. Enter your name and email below to personalise what leads see in their inbox."
          >
            <CredField
              label="From name & email" field="emailFrom" placeholder="Jane Smith <jane@hydeparkrealty.com>"
              current={creds.emailFrom} saving={credsSaving.emailFrom} msg={credsMsg.emailFrom}
              onSave={saveCred}
            />
          </IntegCard>
        </section>
      )}
    </>
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
  const name = agentName || 'your agent';
  return `You are a real estate assistant working directly for ${name}. You are NOT an AI — you are their assistant. Never mention AI, automation, or bots.

Lead: ${fname} ${lname} | Email: ${email} | Phone: ${phone || 'not provided'} | Property: ${property} | Source: ${source}
Message: "${message}"

YOUR REPLY:
- 2-3 sentences max. Reference the EXACT property or area they mentioned.
- Ask ONE qualifying question — timeline, budget, pre-approval, or also-selling.
- Sound like a real human — warm, not scripted. No "Hi there!", no "Great!", no AI mentions.
- End naturally, no sign-off.`;
}

// ─── SETUP STEPS ─────────────────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    title: 'Deploy to Vercel',
    body: `Push to GitHub then import at <a href="https://vercel.com" target="_blank">vercel.com</a>. Vercel auto-detects Next.js.
<div class="code-block">git init && git add . && git commit -m "Initial Say HelloLeads"
git remote add origin https://github.com/YOUR/sayhelloleads.git
git push -u origin main</div>`,
  },
  {
    title: 'Set environment variables in Vercel',
    body: `Vercel Dashboard → Your Project → Settings → Environment Variables. Add everything from <code>.env.example</code>.
<br><br><strong>Required:</strong> <code>ANTHROPIC_API_KEY</code>, <code>NEXTAUTH_SECRET</code> (<code>openssl rand -base64 32</code>), <code>NEXTAUTH_URL</code>, <code>ADMIN_EMAIL</code>, <code>ADMIN_PASSWORD_HASH</code>
<br><br>Generate a bcrypt hash for your password: <a href="https://bcrypt-generator.com" target="_blank">bcrypt-generator.com</a> (use rounds=10)`,
  },
  {
    title: 'Set up Vercel KV (lead persistence)',
    body: `Vercel Dashboard → Storage → Create Database → KV. Copy the 4 env vars (<code>KV_URL</code>, <code>KV_REST_API_URL</code>, <code>KV_REST_API_TOKEN</code>, <code>KV_REST_API_READ_ONLY_TOKEN</code>) into your project environment variables. Leads will now persist across sessions.`,
  },
  {
    title: 'Set up Twilio SMS',
    body: `1. Sign up at <a href="https://twilio.com" target="_blank">twilio.com</a> (~$15 free credit)<br>
2. Buy a local number (~$1/mo)<br>
3. Set the number's <strong>Incoming Message Webhook</strong> to: <code>https://YOUR-APP.vercel.app/api/inbound-sms</code><br>
4. Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_PHONE_NUMBER</code> to Vercel env vars<br>
5. Texts to your Twilio number → AI responds within 60 seconds`,
  },
  {
    title: 'Set up Postmark email (for Zillow/Homes.com leads)',
    body: `1. Create account at <a href="https://postmarkapp.com" target="_blank">postmarkapp.com</a><br>
2. Server → Inbound → get your <code>@inbound.postmarkapp.com</code> address<br>
3. Set Inbound Webhook URL to: <code>https://YOUR-APP.vercel.app/api/inbound-email</code><br>
4. In Zillow Premier Agent: Settings → Lead notifications → forward to your Postmark address<br>
5. Add <code>POSTMARK_SERVER_TOKEN</code> to Vercel env vars`,
  },
  {
    title: 'Connect your website contact form',
    body: `Add a shared secret header for security, then POST to your Say HelloLeads endpoint:
<div class="code-block">fetch('https://YOUR-APP.vercel.app/api/new-lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'YOUR_SECRET' },
  body: JSON.stringify({ fname, lname, email, phone, property, message, source: 'Website' })
})</div>
Add <code>WEBHOOK_SECRET</code> to your Vercel env vars.`,
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
