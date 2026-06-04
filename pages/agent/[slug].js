/**
 * pages/agent/[slug].js
 * Buyer-facing page. Matches the demo chat style exactly.
 * Form → chat transition. No AI mentions anywhere.
 */

import { useState, useEffect, useRef } from 'react';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import Head from 'next/head';

const SOURCES = ['Agent Website', 'Zillow', 'Homes.com', 'Realtor.com', 'Redfin', 'Friend/Referral', 'Social Media', 'Other'];

export default function AgentPage({ agent, notFound }) {
  const [step, setStep]         = useState('form');
  const [form, setForm]         = useState({ fname: '', lname: '', email: '', phone: '', property: '', message: '', source: 'Agent Website' });
  const [leadId, setLeadId]     = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError]       = useState('');
  const chatRef  = useRef(null);
  const inputRef = useRef(null);

  const agentName   = agent?.name || 'Your Agent';
  const agentFirst  = agentName.split(' ')[0];
  const agentAgency = agent?.agencyName || '';

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, sending]);

  // Human-like typing delay: ~1s base + 20ms per char, capped at 4s
  function typingDelay(text) {
    return Math.min(1000 + (text?.length || 0) * 20, 4000);
  }

  async function startChat() {
    if (!form.fname || !form.email) { setError('Please enter your name and email.'); return; }
    setSubmitting(true); setError('');
    try {
      const userMessage = form.message.trim() || `Hi ${agentFirst}, I'm interested in ${form.property || 'a property'}.`;

      // Fire the API call immediately in background
      const fetchPromise = fetch(`/api/agent/${agent.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, message: userMessage }),
      });

      // Show connecting screen while API runs
      setSubmitting(false);
      setConnecting(true);

      // Step 1: "Connecting you with [agent]..." — 1.5s
      await new Promise(r => setTimeout(r, 1500));

      const res  = await fetchPromise;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');

      setLeadId(data.id);
      const firstReply = data.firstReply || `Hi ${form.fname}! Thanks for reaching out — what's your timeline for moving?`;

      // Step 2: Show buyer message, transition to chat with typing indicator
      setConnecting(false);
      setMessages([{ role: 'lead', name: `${form.fname} ${form.lname}`.trim(), text: userMessage }]);
      setStep('chat');
      setSending(true);

      // Step 3: Delay before agent reply scales with reply length
      await new Promise(r => setTimeout(r, typingDelay(firstReply)));
      setSending(false);
      setMessages(m => [...m, { role: 'ai', name: agentName, text: firstReply }]);

      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (e) {
      setConnecting(false);
      setSubmitting(false);
      setError(e.message);
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setMessages(m => [...m, { role: 'lead', name: `${form.fname} ${form.lname}`.trim(), text }]);
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, agentSlug: agent.slug, message: text }),
      });
      const data = await res.json();
      if (data.reply) {
        // Scale delay to reply length — feels like someone actually typing
        await new Promise(r => setTimeout(r, typingDelay(data.reply)));
        setMessages(m => [...m, { role: 'ai', name: agentName, text: data.reply }]);
      }
    } catch {
      setMessages(m => [...m, { role: 'ai', name: agentName, text: "Sorry, could you send that again?" }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  if (notFound) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <Head><title>Page not found — Say HelloLeads</title></Head>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏠</div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>Page not found</h1>
        <p style={{ color: '#666' }}>This agent link doesn't exist or may have changed.</p>
      </div>
    </div>
  );

  return (
    <>
      <Head>
        <title>{agentName}{agentAgency ? ` — ${agentAgency}` : ''}</title>
        <meta name="description" content={`Message ${agentName} directly about any property.`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --sage: #4a7c59; --sage-light: #eef4f0; --sage-mid: #a8c5b5;
          --black: #111; --white: #fff; --muted: #6b7280;
          --border: #e5e7eb; --bg: #f9fafb; --cream: #faf9f7;
          --radius: 10px;
        }
        html, body { height: 100%; font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--black); }
        input, textarea, select {
          width: 100%; padding: .65rem .9rem; border: 1.5px solid var(--border);
          border-radius: var(--radius); font-family: inherit; font-size: 14px;
          background: #fff; color: var(--black); outline: none; transition: border-color .15s;
        }
        input:focus, textarea:focus, select:focus { border-color: var(--sage); }
        textarea { resize: vertical; }
        label { display: block; font-size: 13px; font-weight: 500; margin-bottom: .35rem; }
        .field { margin-bottom: .9rem; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
        @media (max-width: 500px) { .field-row { grid-template-columns: 1fr; } }

        /* ── Chat window — matches demo exactly ── */
        .chat-window {
          background: var(--cream); border: 1px solid var(--border);
          border-radius: 16px; padding: 1.5rem;
          display: flex; flex-direction: column; gap: 1rem;
          min-height: 260px; max-height: 460px; overflow-y: auto;
          margin-bottom: 1rem;
        }
        .msg {
          max-width: 82%; padding: .75rem 1rem; border-radius: 14px;
          font-size: 14px; line-height: 1.6;
          animation: msgIn .25s ease;
        }
        .msg.ai {
          background: var(--white); border: 1px solid var(--border);
          align-self: flex-start; border-radius: 4px 14px 14px 14px;
        }
        .msg.lead {
          background: var(--sage); color: #fff;
          align-self: flex-end; border-radius: 14px 4px 14px 14px;
        }
        .msg-label {
          font-size: 11px; font-weight: 600; text-transform: uppercase;
          letter-spacing: .04em; margin-bottom: .3rem;
        }
        .msg.ai .msg-label  { color: var(--sage); }
        .msg.lead .msg-label { color: rgba(255,255,255,.7); }
        .typing {
          display: flex; align-items: center; gap: 5px;
          align-self: flex-start; padding: .5rem 0;
        }
        .dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--sage-mid); animation: blink 1.2s infinite;
        }
        .dot:nth-child(2) { animation-delay: .2s; }
        .dot:nth-child(3) { animation-delay: .4s; }
        .reply-row { display: flex; gap: .75rem; align-items: flex-end; }
        .reply-row input {
          flex: 1; padding: .65rem 1rem; border: 1px solid var(--border);
          border-radius: var(--radius); font-size: 14px; font-family: 'DM Sans', sans-serif;
          outline: none; background: var(--white); transition: border-color .2s;
        }
        .reply-row input:focus { border-color: var(--sage-mid); box-shadow: 0 0 0 3px rgba(74,103,65,.1); }
        .reply-row button {
          background: var(--sage); color: #fff; border: none;
          border-radius: var(--radius); padding: .65rem 1.25rem;
          font-size: 14px; cursor: pointer; font-family: 'DM Sans', sans-serif;
          font-weight: 500; transition: background .2s; white-space: nowrap;
        }
        .reply-row button:hover { background: #3d5836; }
        .reply-row button:disabled { background: var(--muted); cursor: not-allowed; }
        @keyframes msgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes blink { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }
      `}</style>

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: '600', fontSize: '15px' }}>{agentName}</span>
        {agentAgency && <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{agentAgency}</span>}
      </div>

      <main style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>

        {/* ── AGENT HEADER ───────────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'var(--sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: '600', margin: '0 auto 1rem', fontFamily: "'Instrument Serif', serif" }}>
            {agentName.charAt(0).toUpperCase()}
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.75rem', marginBottom: '.2rem' }}>{agentName}</h1>
          {agentAgency && <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '.4rem' }}>{agentAgency}</p>}
          <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.6' }}>Say hi — I'll reply right away.</p>
        </div>

        {/* ── FORM ───────────────────────────────────────────────────────────── */}
        {step === 'form' && (
          <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: '16px', padding: '1.75rem' }}>
            <div className="field-row">
              <div className="field">
                <label>First name *</label>
                <input value={form.fname} onChange={e => setForm(f => ({...f, fname: e.target.value}))} placeholder="Maria" />
              </div>
              <div className="field">
                <label>Last name</label>
                <input value={form.lname} onChange={e => setForm(f => ({...f, lname: e.target.value}))} placeholder="Chen" />
              </div>
            </div>
            <div className="field">
              <label>Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="maria@email.com" />
            </div>
            <div className="field">
              <label>Phone <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="(513) 555-0192" />
            </div>
            <div className="field">
              <label>Property you're interested in</label>
              <AddressAutocomplete
                value={form.property}
                onChange={val => setForm(f => ({...f, property: val}))}
                placeholder="e.g. 412 Elm St, 3BR in Hyde Park, or just the area"
              />
            </div>
            <div className="field">
              <label>Your message</label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({...f, message: e.target.value}))}
                placeholder={`Hi ${agentFirst}, I'm interested in…`}
                rows={3}
              />
            </div>
            <div className="field">
              <label>How did you hear about {agentFirst}?</label>
              <select value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))}>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '.65rem .9rem', fontSize: '13px', color: '#b91c1c', marginBottom: '.85rem' }}>{error}</div>}

            <button
              onClick={startChat}
              disabled={submitting}
              style={{ width: '100%', background: submitting ? 'var(--sage-mid)' : 'var(--sage)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '.8rem', fontSize: '15px', fontWeight: '500', cursor: submitting ? 'not-allowed' : 'pointer', transition: 'background .15s', marginTop: '.25rem' }}
            >
              {submitting ? 'Connecting…' : `Message ${agentFirst} →`}
            </button>
            <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', marginTop: '.65rem' }}>
              Your info is only shared with {agentName}. No spam, ever.
            </p>
          </div>
        )}

        {/* ── CHAT ───────────────────────────────────────────────────────────── */}
        {step === 'chat' && (
          <>
            {/* Header — matches demo convo-header style */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.6rem', marginBottom: '.25rem' }}>
                Conversation with {agentFirst}
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px' }}>{agentAgency || agentName} · {form.property || 'property inquiry'}</p>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem', flexWrap: 'wrap' }}>
                <span style={{ background: 'var(--sage-light)', color: 'var(--sage)', fontSize: '12px', fontWeight: '500', padding: '3px 10px', borderRadius: '20px' }}>{form.source}</span>
                {form.property && <span style={{ background: '#fef3c7', color: '#92400e', fontSize: '12px', fontWeight: '500', padding: '3px 10px', borderRadius: '20px' }}>{form.property}</span>}
                {form.phone && <span style={{ background: 'var(--sage-light)', color: 'var(--sage)', fontSize: '12px', fontWeight: '500', padding: '3px 10px', borderRadius: '20px' }}>{form.phone}</span>}
              </div>
            </div>

            {/* Chat window — exact same classes as demo */}
            <div className="chat-window" ref={chatRef}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role === 'ai' ? 'ai' : 'lead'}`}>
                  <div className="msg-label">{m.name}</div>
                  {m.text}
                </div>
              ))}
              {sending && (
                <div className="typing">
                  <span style={{ fontSize: '11px', color: 'var(--sage)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: '4px' }}>{agentName}</span>
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
              )}
            </div>

            {/* Reply bar — exact same classes as demo */}
            <div className="reply-row">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder={`Reply to ${agentFirst}…`}
                disabled={sending}
              />
              <button onClick={sendMessage} disabled={sending || !input.trim()}>Send</button>
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <a href="/" style={{ fontSize: '11px', color: 'var(--muted)', textDecoration: 'none' }}>Powered by <strong>Say HelloLeads</strong></a>
        </div>
      </main>
    </>
  );
}

export async function getServerSideProps({ params }) {
  const { slug } = params;
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/agent/${slug}`);
    if (!res.ok) return { props: { notFound: true, agent: null } };
    const agent = await res.json();
    return { props: { agent, notFound: false } };
  } catch {
    return { props: { notFound: true, agent: null } };
  }
}
