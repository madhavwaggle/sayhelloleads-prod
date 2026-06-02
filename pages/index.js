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
  const [scoring, setScoring] = useState(false);
  const [profile, setProfile] = useState({ name: '', agencyName: '', notifyEmail: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [twilioPhone, setTwilioPhone] = useState('');
  const [twilioSaving, setTwilioSaving] = useState(false);
  const [twilioMsg, setTwilioMsg] = useState('');
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
    if (status === 'unauthenticated' && ['dashboard','setup'].includes(view)) {
      router.push('/login');
    }
  }, [status, view, router]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages, isTyping]);

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
    if (view === 'setup') loadProfile();
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

  async function saveTwilioPhone() {
    setTwilioSaving(true); setTwilioMsg('');
    try {
      const res = await fetch('/api/phone-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: twilioPhone.trim() || null }) });
      const data = await res.json();
      setTwilioMsg(res.ok ? '✓ Number saved' : (data.error || 'Save failed'));
    } catch { setTwilioMsg('Save failed'); }
    setTwilioSaving(false);
    setTimeout(() => setTwilioMsg(''), 3000);
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
    setChatMessages([{ role: 'lead', name: `${fname} ${lname}`, text: msgText }]);
    setView('conversation');
    setSubmitting(true);

    const systemPrompt = buildSystemPrompt(fname, lname, email, phone, propText, source, msgText, session?.user?.name);
    setIsTyping(true);

    try {
      const data = await callAPI('/api/chat', { system: systemPrompt, messages: initHistory });
      const reply = data.reply;
      setIsTyping(false);

      const newHistory = [...initHistory, { role: 'assistant', content: reply }];
      setConversationHistory(newHistory);
      setChatMessages(prev => [...prev, { role: 'ai', name: 'Say Hello Leads AI', text: reply }]);
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
      setChatMessages(prev => [...prev, { role: 'ai', name: 'Say Hello Leads AI', text: "Thanks for reaching out! I'll have the agent contact you very soon. What's your timeline for moving?" }]);
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
    const systemPrompt = `You are a Say Hello Leads AI real estate lead assistant. You're texting with ${currentLead.fname} about ${currentLead.property}.
Continue qualifying (budget, timeline, pre-approval). Stay warm and brief (3 sentences max). If they want a showing, offer 2-3 realistic time slots.`;

    try {
      const data = await callAPI('/api/chat', { system: systemPrompt, messages: newHistory });
      const reply = data.reply;
      setIsTyping(false);

      setConversationHistory(prev => [...prev, { role: 'assistant', content: reply }]);
      setChatMessages(prev => [...prev, { role: 'ai', name: 'Say Hello Leads AI', text: reply }]);

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
      setChatMessages(prev => [...prev, { role: 'ai', name: 'Say Hello Leads AI', text: "Great point! Let me check on that for you — can I get your best callback number?" }]);
    }
  }

  async function goToDashboard() {
    if (!currentLead) { setView('dashboard'); return; }
    setScoring(true);

    const scorePrompt = `Score this real estate lead. HOT = ready <30 days / has budget. WARM = interested but vague. COLD = browsing.

Lead: ${currentLead.fname} ${currentLead.lname} | Property: ${currentLead.property} | Source: ${currentLead.source}
Conversation:
${currentLead.messages.map(m => `${m.role === 'ai' ? 'AI' : 'Lead'}: ${m.text}`).join('\n')}

Respond ONLY as JSON (no markdown): {"score":"HOT","summary":"2-sentence agent briefing with name, what they want, and recommended next action."}`;

    try {
      const data = await callAPI('/api/chat', {
        system: 'You are a lead scoring assistant. Respond only with JSON.',
        messages: [{ role: 'user', content: scorePrompt }],
        max_tokens: 200,
      });
      const clean = data.reply.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      currentLead.score = parsed.score || 'WARM';
      currentLead.summary = parsed.summary || '';
    } catch {
      currentLead.score = 'WARM';
      currentLead.summary = `${currentLead.fname} inquired about ${currentLead.property}. Follow up to schedule a showing.`;
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
      name: m.role === 'ai' ? 'Say Hello Leads AI' : `${lead.fname} ${lead.lname}`,
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
        <title>Say Hello Leads — AI Lead Response</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{GLOBAL_CSS}</style>

      {/* NAV */}
      <nav>
        <div className="logo">Say Hello <span>Leads</span></div>
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
                    <button className="avatar-item" onClick={() => { setView('setup'); setAvatarOpen(false); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M12 2a10 10 0 0 1 7.07 2.93M4.93 4.93a10 10 0 0 0 0 14.14M12 22a10 10 0 0 1-7.07-2.93"/></svg>
                      Setup &amp; integrations
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
          <div className="hero">
            <div className="hero-badge">✦ AI-powered lead response</div>
            <h1>Never lose a lead to<br /><em>slow response</em> again</h1>
            <p>Say Hello Leads connects to Zillow, Homes.com, Realtor.com and your phone — responds to every lead in under 60 seconds — qualifies them overnight — and delivers hot-lead briefings right to your dashboard.</p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => setView('demo')}>Try the agent demo →</button>
              <button className="btn-outline" onClick={() => session ? setView('dashboard') : router.push('/login')}>View agent dashboard</button>
            </div>
          </div>

          <div className="stats-bar">
            {[['15 hrs','avg agent response time'],['41%','leads never contacted'],['<60s','Say Hello Leads response time'],['$14k+','avg monthly revenue left on table']].map(([n,l]) => (
              <div className="stat-item" key={l}><div className="stat-num">{n}</div><div className="stat-label">{l}</div></div>
            ))}
          </div>

          <div className="integration-bar">
            <h3>Connects to every lead source <em>automatically</em></h3>
            <div className="integrations">
              {['Zillow','Homes.com','Realtor.com','SMS / Text','Your Website','Referrals'].map(s => (
                <div className="integration-chip" key={s}><span className="dot-green" />{s}</div>
              ))}
            </div>
          </div>

          <div className="how-it-works">
            <div className="section-label">How it works</div>
            <div className="section-title">From inquiry to booked showing — automatically</div>
            <div className="steps">
              {[
                ['1','Lead comes in','From Zillow, Homes.com, Realtor.com, text, or your site — any source, any time.'],
                ['2','AI responds instantly','A personalized reply goes out within 60 seconds — while you\'re showing homes or asleep.'],
                ['3','Lead gets qualified','The AI learns their timeline, budget, and pre-approval through natural conversation.'],
                ['4','You get the brief','Hot leads get a push alert: name, score, summary, and full conversation.'],
              ].map(([n,h,p]) => (
                <div className="step" key={n}><div className="step-num">{n}</div><h3>{h}</h3><p>{p}</p></div>
              ))}
            </div>
          </div>

          <div className="demo-cta-block">
            <h2>See exactly how your leads experience <em>instant AI response</em></h2>
            <button className="btn-primary" onClick={() => setView('demo')}>Try the agent demo →</button>
          </div>
        </section>
      )}

      {/* DEMO FORM */}
      {view === 'demo' && (
        <section className="fade-in" style={{ maxWidth: '560px', margin: '3rem auto', padding: '0 1.5rem 4rem' }}>
          <a className="back-link" onClick={() => setView('landing')}>← Back</a>
          <div className="demo-header">
            <h2>Agent demo tool</h2>
            <p>Simulate a buyer inquiry to preview exactly how Say Hello Leads responds on your behalf — in real time.</p>
          </div>
          <div className="form-card">
            <h3>Simulated buyer inquiry <span className="tag">agent preview</span></h3>
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
            {submitting ? 'Processing…' : 'Simulate lead & see AI response →'}
          </button>
          <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>This is your agent demo. Try realistic scenarios — budget, timeline, objections — to see how the AI handles them.</p>
        </section>
      )}

      {/* CONVERSATION */}
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
                <span style={{ fontSize: '11px', color: 'var(--sage)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: '4px' }}>Say Hello Leads AI</span>
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
              <button className="btn-outline" onClick={() => setView('setup')} style={{ fontSize: '13px', padding: '.4rem 1rem' }}>Setup integrations</button>
            </div>
          </div>

          <div className="dash-body">

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
                            <div className="who">{m.role === 'ai' ? 'Say Hello Leads AI' : lead.fname}</div>
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
      {view === 'setup' && (
        <section className="fade-in" style={{ maxWidth: '700px', margin: '3rem auto', padding: '0 1.5rem 5rem' }}>
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
          {/* TWILIO ROUTING CARD */}
          <div style={{ marginBottom: '2.5rem' }}>
            <div className="section-label">SMS routing</div>
            <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.75rem' }}>
              <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '1rem', lineHeight: '1.6' }}>Assign a Twilio phone number to your account. Leads who text this number go to your dashboard only.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.75rem', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Your Twilio number</label>
                  <input className="setup-input" value={twilioPhone} onChange={e => setTwilioPhone(e.target.value)} placeholder="+15131110001" />
                </div>
                <button className="btn-primary" onClick={saveTwilioPhone} disabled={twilioSaving} style={{ opacity: twilioSaving ? .7 : 1, whiteSpace: 'nowrap' }}>{twilioSaving ? 'Saving…' : 'Save number'}</button>
              </div>
              {twilioMsg && <div style={{ fontSize: '13px', color: 'var(--sage)', fontWeight: '500', marginTop: '.75rem' }}>{twilioMsg}</div>}
              {twilioPhone && <div style={{ marginTop: '1rem', background: 'var(--sage-light)', borderRadius: '8px', padding: '.75rem 1rem', fontSize: '13px', color: 'var(--sage)' }}>✓ Leads texting <strong>{twilioPhone}</strong> route to your dashboard.</div>}
            </div>
          </div>

          <a className="back-link" onClick={() => setView('landing')}>← Back</a>
          <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '2rem', marginBottom: '.5rem' }}>Integration Setup Guide</h2>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '2.5rem' }}>Follow these steps to deploy Say Hello Leads with real SMS, email, and lead persistence.</p>

          {SETUP_STEPS.map((s, i) => (
            <div className="setup-step" key={i}>
              <div className="step-header"><div className="step-num">{i + 1}</div><h3>{s.title}</h3></div>
              <div className="step-body" dangerouslySetInnerHTML={{ __html: s.body }} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

// ─── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────

function buildSystemPrompt(fname, lname, email, phone, property, source, message, agentName) {
  return `You are a Say Hello Leads AI real estate lead assistant working on behalf of ${agentName || 'your agent'}. A new lead just came in.

Lead: ${fname} ${lname} | Email: ${email} | Phone: ${phone || 'not provided'} | Property: ${property} | Source: ${source}
Their message: "${message}"

Respond warmly and professionally. Reference the specific property. Ask ONE qualifying question (timeline, budget, pre-approval, or if they're also selling). Under 4 sentences. Sound like a real, helpful person. Sign off as "Say Hello Leads AI, on behalf of your agent".`;
}

// ─── SETUP STEPS ─────────────────────────────────────────────────────────────

const SETUP_STEPS = [
  {
    title: 'Deploy to Vercel',
    body: `Push to GitHub then import at <a href="https://vercel.com" target="_blank">vercel.com</a>. Vercel auto-detects Next.js.
<div class="code-block">git init && git add . && git commit -m "Initial Say Hello Leads"
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
    body: `Add a shared secret header for security, then POST to your Say Hello Leads endpoint:
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
