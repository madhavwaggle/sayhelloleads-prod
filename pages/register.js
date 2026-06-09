import { useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', agencyName: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Something went wrong.');
      setLoading(false);
      return;
    }

    // Auto-login after registration
    const login = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    setLoading(false);
    if (login?.error) {
      router.push('/verify-email');
    } else {
      router.push('/');
    }
  }

  return (
    <>
      <Head>
        <title>Create account — Say HelloLeads</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --black: #0a0a0a; --white: #fafaf8; --cream: #f5f3ee;
          --sage: #4a6741; --sage-light: #e8efe7; --border: #e0ddd8;
          --muted: #6b6b6b; --red: #c0392b;
        }
        body { font-family: 'DM Sans', sans-serif; background: var(--cream); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        input { width: 100%; padding: .65rem .9rem; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; font-family: inherit; outline: none; background: var(--white); transition: border-color .2s; }
        input:focus { border-color: #8aab84; box-shadow: 0 0 0 3px rgba(74,103,65,.1); }
        label { display: block; font-size: 13px; font-weight: 500; margin-bottom: .35rem; }
      `}</style>

      <div style={{ width: '100%', maxWidth: '420px', padding: '1.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: '1.75rem', marginBottom: '.4rem' }}>
            Say<span style={{ color: 'var(--sage)' }}> HelloLeads</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Create your agent account</p>
        </div>

        <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: '16px', padding: '2rem' }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '1rem' }}>
              <div>
                <label>First &amp; last name</label>
                <input value={form.name} onChange={set('name')} required placeholder="Maria Chen" autoComplete="name" />
              </div>
              <div>
                <label>Agency name <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
                <input value={form.agencyName} onChange={set('agencyName')} placeholder="Hyde Park Realty" />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label>Email</label>
              <input type="email" value={form.email} onChange={set('email')} required placeholder="maria@yourrealty.com" autoComplete="email" />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label>Password <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(min 8 chars)</span></label>
              <input type="password" value={form.password} onChange={set('password')} required minLength={8} placeholder="••••••••" autoComplete="new-password" />
            </div>

            {error && (
              <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: '8px', padding: '.65rem .9rem', fontSize: '13px', color: 'var(--red)', marginBottom: '1rem' }}>
                {error}
                {error.toLowerCase().includes('already exists') && (
                  <div style={{ marginTop: '.5rem', paddingTop: '.5rem', borderTop: '1px solid #f5c6c6' }}>
                    <a href={`/login?email=${encodeURIComponent(form.email)}`} style={{ color: 'var(--red)', fontWeight: 600, textDecoration: 'underline' }}>
                      Sign in to your existing account →
                    </a>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: '8px', padding: '.8rem', fontSize: '15px', fontFamily: 'inherit', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1 }}
            >
              {loading ? 'Creating account…' : 'Create account →'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '13px', color: 'var(--muted)' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: 'var(--sage)', textDecoration: 'none', fontWeight: '500' }}>Sign in</a>
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
