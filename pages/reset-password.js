/**
 * pages/reset-password.js
 * Handles both:
 *  - /reset-password            → "forgot password" form (enter email)
 *  - /reset-password?token=&id= → "new password" form (set new password)
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

const sage = '#4a7c59';

const inputStyle = {
  width: '100%', padding: '.65rem .9rem',
  border: '1px solid #e0ddd8', borderRadius: '8px',
  fontSize: '14px', fontFamily: 'inherit',
  outline: 'none', background: '#fafaf8',
  transition: 'border-color .2s',
};

export default function ResetPasswordPage() {
  const router   = useRouter();
  const { token, id: userId } = router.query;

  const isSetNew = !!(token && userId);

  // Forgot form state
  const [email,    setEmail]    = useState('');
  const [sent,     setSent]     = useState(false);

  // New password form state
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [done,     setDone]     = useState(false);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleForgot(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true); // Always show success — don't leak email existence
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetNew(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords don\'t match.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed.'); setLoading(false); return; }
      setDone(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Reset password — Say HelloLeads</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; background: #f5f3ee; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        input:focus { border-color: #8aab84 !important; box-shadow: 0 0 0 3px rgba(74,124,89,.1); }
      `}</style>

      <div style={{ width: '100%', maxWidth: '400px', padding: '1.5rem' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.75rem', marginBottom: '.4rem' }}>
            Say Hello<span style={{ color: sage }}>Leads</span>
          </div>
          <p style={{ color: '#6b6b6b', fontSize: '14px' }}>
            {isSetNew ? 'Set a new password' : 'Reset your password'}
          </p>
        </div>

        <div style={{ background: '#fafaf8', border: '1px solid #e0ddd8', borderRadius: '16px', padding: '2rem' }}>

          {/* ── FORGOT: email sent ── */}
          {!isSetNew && sent && (
            <div style={{ textAlign: 'center', padding: '.5rem 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📧</div>
              <h3 style={{ marginBottom: '.5rem', fontSize: '17px' }}>Check your inbox</h3>
              <p style={{ color: '#6b6b6b', fontSize: '14px', lineHeight: 1.6 }}>
                If <strong>{email}</strong> has an account, a reset link is on its way.
                Check your spam folder if you don't see it within a minute.
              </p>
            </div>
          )}

          {/* ── FORGOT: enter email ── */}
          {!isSetNew && !sent && (
            <form onSubmit={handleForgot}>
              <p style={{ fontSize: '14px', color: '#6b6b6b', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                Enter the email address for your account and we'll send you a reset link.
              </p>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '.35rem' }}>Email address</label>
                <input
                  type="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@youragency.com"
                  style={inputStyle}
                />
              </div>
              {error && <ErrorBox msg={error} />}
              <SubmitBtn loading={loading} label="Send reset link →" />
            </form>
          )}

          {/* ── NEW PASSWORD: success ── */}
          {isSetNew && done && (
            <div style={{ textAlign: 'center', padding: '.5rem 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✅</div>
              <h3 style={{ marginBottom: '.5rem', fontSize: '17px' }}>Password updated!</h3>
              <p style={{ color: '#6b6b6b', fontSize: '14px' }}>Redirecting you to sign in…</p>
            </div>
          )}

          {/* ── NEW PASSWORD: form ── */}
          {isSetNew && !done && (
            <form onSubmit={handleSetNew}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '.35rem' }}>New password</label>
                <input
                  type="password" required minLength={8} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '.35rem' }}>Confirm new password</label>
                <input
                  type="password" required value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Same password again"
                  style={inputStyle}
                />
              </div>
              {error && <ErrorBox msg={error} />}
              <SubmitBtn loading={loading} label="Update password →" />
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '13px', color: '#6b6b6b' }}>
          Remember it?{' '}
          <Link href="/login" style={{ color: sage, textDecoration: 'none', fontWeight: 500 }}>Back to sign in</Link>
        </p>
      </div>
    </>
  );
}

function ErrorBox({ msg }) {
  return (
    <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: '8px', padding: '.65rem .9rem', fontSize: '13px', color: '#c0392b', marginBottom: '1rem' }}>
      {msg}
    </div>
  );
}

function SubmitBtn({ loading, label }) {
  return (
    <button type="submit" disabled={loading} style={{ width: '100%', background: sage, color: '#fff', border: 'none', borderRadius: '8px', padding: '.8rem', fontSize: '15px', fontFamily: 'inherit', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1 }}>
      {loading ? 'Please wait…' : label}
    </button>
  );
}
