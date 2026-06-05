import { useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function LoginPage() {
  const router = useRouter();
  const { query } = useRouter();
  const [email, setEmail] = useState(query?.email || '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [mode, setMode] = useState('password'); // 'password' | 'magic'

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (mode === 'magic') {
      const res = await signIn('email', { email, redirect: false });
      setLoading(false);
      if (res?.error) setError('Could not send magic link. Check email config.');
      else setMagicSent(true);
      return;
    }

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError('That email and password combination doesn\'t match our records. Please try again or reset your password below.');
    } else {
      router.push('/');
    }
  }

  return (
    <>
      <Head>
        <title>Sign in — Say HelloLeads</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --black: #0a0a0a; --white: #fafaf8; --cream: #f5f3ee;
          --sage: #4a6741; --sage-light: #e8efe7; --border: #e0ddd8;
          --muted: #6b6b6b; --red: #c0392b;
        }
        body { font-family: 'DM Sans', sans-serif; background: var(--cream); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      `}</style>

      <div style={{ width: '100%', maxWidth: '400px', padding: '1.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.75rem', marginBottom: '.5rem' }}>
            Say Hello<span style={{ color: 'var(--sage)' }}>Leads</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Sign in to your agent dashboard</p>
        </div>

        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '16px', padding: '2rem' }}>
          {magicSent ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📧</div>
              <h3 style={{ marginBottom: '.5rem' }}>Check your email</h3>
              <p style={{ color: 'var(--muted)', fontSize: '14px' }}>We sent a sign-in link to <strong>{email}</strong></p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '.35rem' }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="agent@youragency.com"
                  style={{ width: '100%', padding: '.65rem .9rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', outline: 'none', background: 'var(--cream)' }}
                />
              </div>

              {mode === 'password' && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', margin: 0 }}>Password</label>
                    <a href="/reset-password" style={{ fontSize: '12px', color: 'var(--sage)', textDecoration: 'none' }}>Forgot password?</a>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    style={{ width: '100%', padding: '.65rem .9rem', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', outline: 'none', background: 'var(--cream)' }}
                  />
                </div>
              )}

              {error && (
                <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: '8px', padding: '.65rem .9rem', fontSize: '13px', color: 'var(--red)', marginBottom: '1rem' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{ width: '100%', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.8rem', fontSize: '15px', fontFamily: 'inherit', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1 }}
              >
                {loading ? 'Signing in…' : mode === 'magic' ? 'Send magic link →' : 'Sign in →'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => { setMode(mode === 'password' ? 'magic' : 'password'); setError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--sage)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {mode === 'password' ? 'Use magic link instead' : 'Use password instead'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '13px', color: 'var(--muted)' }}>
          Don&apos;t have an account?{' '}
          <a href="/register" style={{ color: 'var(--sage)', textDecoration: 'none', fontWeight: '500' }}>Create one free</a>
        </p>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const session = await getSession(context);
  if (session) return { redirect: { destination: '/', permanent: false } };
  return { props: {} };
}
