/**
 * components/Footer.jsx
 * Site-wide footer. Import and drop in wherever needed.
 * Matches the index.js design system: DM Sans, sage green, cream palette.
 */

export default function Footer({ onHowItWorks }) {
  const year = new Date().getFullYear();

  return (
    <footer style={{
      borderTop: '1px solid #e0ddd8',
      background: '#f5f3ee',
      padding: '3rem 2rem 2rem',
      marginTop: 'auto',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        maxWidth: '1000px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '2.5rem',
        marginBottom: '2.5rem',
      }}>

        {/* ── Column 1: Brand ── */}
        <div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#0a0a0a', marginBottom: '.4rem', letterSpacing: '-.3px' }}>
            Say <span style={{ color: '#4a6741' }}>HelloLeads</span>
          </div>
          <p style={{ fontSize: '13px', color: '#6b6b6b', lineHeight: '1.6', margin: '0' }}>
            Respond to every lead in 60 seconds.<br />Know who to call first.
          </p>
        </div>

        {/* ── Column 2: Product ── */}
        <div style={{ background: 'transparent' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#4a6741', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.85rem' }}>
            Product
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <FooterLink href="/">Home</FooterLink>
            {onHowItWorks
              ? <button onClick={onHowItWorks} style={linkBtnStyle}>How it works</button>
              : <FooterLink href="/">How it works</FooterLink>
            }
            <FooterLink href="/register">Sign up free</FooterLink>
            <FooterLink href="/login">Sign in</FooterLink>
          </nav>
        </div>

        {/* ── Column 3: Legal ── */}
        <div style={{ background: 'transparent' }}>
          <div style={{ fontSize: '11px', fontWeight: '600', color: '#4a6741', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '.85rem' }}>
            Legal & Support
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            <FooterLink href="/privacy">Privacy policy</FooterLink>
            <FooterLink href="/terms">Terms of service</FooterLink>
            <FooterLink href="mailto:hello@sayhelloleads.com">Contact us</FooterLink>
          </nav>
        </div>

      </div>

      {/* Bottom bar */}
      <div style={{
        borderTop: '1px solid #e0ddd8',
        paddingTop: '1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '.5rem',
      }}>
        <span style={{ fontSize: '12px', color: '#6b6b6b' }}>
          © {year} Say HelloLeads. All rights reserved.
        </span>
        <span style={{ fontSize: '12px', color: '#6b6b6b' }}>
          Built for real estate agents who move fast.
        </span>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }) {
  return (
    <a href={href} style={{
      fontSize: '14px',
      color: '#3d3d3a',
      textDecoration: 'none',
      transition: 'color .15s',
      fontWeight: '400',
    }}
    onMouseEnter={e => e.target.style.color = '#4a6741'}
    onMouseLeave={e => e.target.style.color = '#3d3d3a'}
    >
      {children}
    </a>
  );
}

const linkBtnStyle = {
  fontSize: '14px',
  color: '#3d3d3a',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontFamily: "'DM Sans', sans-serif",
  textAlign: 'left',
  fontWeight: '400',
};
