/**
 * pages/agent/[slug].js
 * Public buyer-facing inquiry page for each agent.
 * URL: /agent/jane-smith  (slug = agent's name, lowercased + hyphenated)
 *
 * Buyers land here, fill out the form, and a lead is created + AI response triggered.
 * Agents share this URL directly (from profile / dashboard).
 */

import { useState } from 'react';
import Head from 'next/head';

export default function AgentPage({ agent, notFound }) {
  const [form, setForm] = useState({
    fname: '', lname: '', email: '', phone: '', property: '', message: '',
    source: 'Agent Website',
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' }}>
        <Head><title>Agent not found — Say Hello Leads</title></Head>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏠</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>Page not found</h1>
          <p style={{ color: '#666' }}>This agent link doesn't exist or may have changed.</p>
          <a href="/" style={{ color: '#4a7c59', marginTop: '1.5rem', display: 'inline-block' }}>← Back to Say Hello Leads</a>
        </div>
      </div>
    );
  }

  const agentDisplayName = agent.name || 'Your Agent';
  const agentAgency = agent.agencyName || '';

  async function submitInquiry() {
    if (!form.fname || !form.email) { setError('Please enter your name and email.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/agent/${agent.slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Contact {agentDisplayName}{agentAgency ? ` — ${agentAgency}` : ''}</title>
        <meta name="description" content={`Send a message to ${agentDisplayName}${agentAgency ? ` at ${agentAgency}` : ''}. Get an instant response about any property.`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --sage: #4a7c59;
          --sage-light: #eef4f0;
          --sage-mid: #a8c5b5;
          --black: #111;
          --white: #fff;
          --muted: #6b7280;
          --border: #e5e7eb;
          --bg: #f9fafb;
        }
        body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--black); min-height: 100vh; }
        input, textarea, select {
          width: 100%; padding: .65rem .9rem; border: 1.5px solid var(--border);
          border-radius: 10px; font-family: inherit; font-size: 14px;
          background: #fff; color: var(--black); outline: none;
          transition: border-color .15s;
        }
        input:focus, textarea:focus { border-color: var(--sage); }
        textarea { resize: vertical; min-height: 90px; }
        label { display: block; font-size: 13px; font-weight: 500; margin-bottom: .35rem; }
        .field { margin-bottom: 1rem; }
        .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
        @media (max-width: 480px) { .field-row { grid-template-columns: 1fr; } }
      `}</style>

      {/* TOP BAR */}
      <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="/" style={{ textDecoration: 'none', color: 'var(--black)', fontSize: '15px', fontWeight: '600' }}>
          Say Hello <span style={{ color: 'var(--sage)' }}>Leads</span>
        </a>
        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Instant AI response</div>
      </div>

      <main style={{ maxWidth: '560px', margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}>

        {/* AGENT HEADER */}
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%',
            background: 'var(--sage)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', fontWeight: '600', margin: '0 auto 1rem',
            fontFamily: "'Instrument Serif', serif"
          }}>
            {agentDisplayName.charAt(0).toUpperCase()}
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.75rem', marginBottom: '.25rem' }}>
            {agentDisplayName}
          </h1>
          {agentAgency && (
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>{agentAgency}</p>
          )}
          <p style={{ marginTop: '.75rem', fontSize: '14px', color: 'var(--muted)', lineHeight: '1.6' }}>
            Send me a message about any property — I'll get back to you right away.
          </p>
        </div>

        {done ? (
          /* SUCCESS STATE */
          <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: '16px', padding: '2.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✅</div>
            <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.5rem', marginBottom: '.5rem' }}>
              Message sent!
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: '1.6' }}>
              Thanks, <strong>{form.fname}</strong>! {agentDisplayName} has been notified and you'll hear back shortly.
              {form.email && ' Check your inbox for a confirmation.'}
            </p>
            <button
              onClick={() => { setDone(false); setForm({ fname: '', lname: '', email: '', phone: '', property: '', message: '', source: 'Agent Website' }); }}
              style={{ marginTop: '1.5rem', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '10px', padding: '.65rem 1.5rem', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
            >
              Send another inquiry
            </button>
          </div>
        ) : (
          /* INQUIRY FORM */
          <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: '16px', padding: '2rem' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '1.5rem', color: 'var(--black)' }}>
              Your inquiry
            </h2>

            <div className="field-row">
              <div className="field">
                <label>First name *</label>
                <input value={form.fname} onChange={e => setForm(f => ({ ...f, fname: e.target.value }))} placeholder="Maria" />
              </div>
              <div className="field">
                <label>Last name</label>
                <input value={form.lname} onChange={e => setForm(f => ({ ...f, lname: e.target.value }))} placeholder="Chen" />
              </div>
            </div>

            <div className="field">
              <label>Email *</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="maria@email.com" />
            </div>

            <div className="field">
              <label>Phone <span style={{ color: 'var(--muted)', fontWeight: '400' }}>(optional)</span></label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(513) 555-0192" />
            </div>

            <div className="field">
              <label>Property you're interested in</label>
              <input value={form.property} onChange={e => setForm(f => ({ ...f, property: e.target.value }))} placeholder="e.g. 412 Elm Street, 3BR in Hyde Park" />
            </div>

            <div className="field">
              <label>Message</label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder={`Hi ${agentDisplayName.split(' ')[0]}, I'm interested in...`}
              />
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '.75rem 1rem', fontSize: '13px', color: '#b91c1c', marginBottom: '1rem' }}>
                {error}
              </div>
            )}

            <button
              onClick={submitInquiry}
              disabled={submitting}
              style={{
                width: '100%', background: submitting ? 'var(--sage-mid)' : 'var(--sage)',
                color: '#fff', border: 'none', borderRadius: '10px',
                padding: '.8rem 1.5rem', fontSize: '15px', fontWeight: '500',
                cursor: submitting ? 'not-allowed' : 'pointer', transition: 'background .15s'
              }}
            >
              {submitting ? 'Sending…' : `Send inquiry to ${agentDisplayName.split(' ')[0]} →`}
            </button>

            <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
              Your info is only shared with {agentDisplayName}. No spam, ever.
            </p>
          </div>
        )}

        {/* POWERED BY FOOTER */}
        <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
          <a href="/" style={{ fontSize: '12px', color: 'var(--muted)', textDecoration: 'none' }}>
            Powered by <strong style={{ color: 'var(--sage)' }}>Say Hello Leads</strong>
          </a>
        </div>
      </main>
    </>
  );
}

// ─── SERVER-SIDE: resolve slug → agent ───────────────────────────────────────

export async function getServerSideProps({ params }) {
  const { slug } = params;

  try {
    // Build the lookup URL dynamically
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/agent/${slug}`);
    if (!res.ok) return { props: { notFound: true, agent: null } };
    const agent = await res.json();
    return { props: { agent, notFound: false } };
  } catch {
    return { props: { notFound: true, agent: null } };
  }
}
