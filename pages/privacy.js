import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/Footer';

const EFFECTIVE_DATE = 'June 1, 2025';
const CONTACT_EMAIL  = 'hello@sayhelloleads.com';

export default function PrivacyPage() {
  return (
    <>
      <Head>
        <title>Privacy Policy — Say HelloLeads</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #fafaf8; color: #0a0a0a; font-family: 'DM Sans', sans-serif; min-height: 100vh; display: flex; flex-direction: column; }
        a { color: #4a6741; }
        a:hover { text-decoration: underline; }
        ul { padding-left: 1.25rem; display: flex; flex-direction: column; gap: .35rem; }
        li { font-size: 14px; color: #3a3a3a; line-height: 1.75; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: .5rem; }
        th { text-align: left; padding: .5rem .75rem; background: #f0f0ec; color: #6b6b6b; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; border: 1px solid #e0ddd8; }
        td { padding: .6rem .75rem; border: 1px solid #e0ddd8; color: #3a3a3a; vertical-align: top; line-height: 1.5; }
        tr:hover td { background: #f7f7f4; }
      `}</style>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid #e0ddd8', padding: '.9rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafaf8' }}>
        <Link href="/" style={{ fontSize: '17px', fontWeight: '700', color: '#0a0a0a', textDecoration: 'none', letterSpacing: '-.3px' }}>
          Say <span style={{ color: '#4a6741' }}>HelloLeads</span>
        </Link>
        <Link href="/" style={{ fontSize: '13px', color: '#6b6b6b', textDecoration: 'none' }}>← Back to home</Link>
      </nav>

      {/* Content */}
      <main style={{ flex: 1, maxWidth: '720px', margin: '0 auto', padding: '3rem 2rem' }}>

        <div style={{ marginBottom: '2.5rem' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', letterSpacing: '-.4px', marginBottom: '.5rem' }}>Privacy Policy</h1>
          <p style={{ fontSize: '13px', color: '#6b6b6b' }}>Effective date: {EFFECTIVE_DATE}</p>
        </div>

        <Section title="1. Who we are">
          Say HelloLeads ("we", "us", or "our") is a real estate lead response platform that helps agents respond to buyer inquiries automatically using artificial intelligence. Our website is sayhelloleads.com.
        </Section>

        <Section title="2. What information we collect">
          <SubHead>Information you give us</SubHead>
          <ul>
            <li>Account information: your name, email address, phone number, agency name, and password when you register.</li>
            <li>Profile and configuration: notification preferences, integration settings, and credentials for connected services (Twilio, Postmark).</li>
          </ul>

          <SubHead>Information from lead conversations</SubHead>
          <ul>
            <li>Buyer inquiry data forwarded from Zillow, Homes.com, Realtor.com, Redfin, Facebook, or your website — including names, email addresses, phone numbers, and property interests.</li>
            <li>Conversation transcripts generated between our AI and buyers on your behalf.</li>
            <li>Lead scoring signals such as purchase timeline, budget range, and pre-approval status extracted from conversations.</li>
          </ul>

          <SubHead>Automatically collected information</SubHead>
          <ul>
            <li>Basic usage data such as pages visited and features used, for improving the product.</li>
            <li>IP address and browser type for security and fraud prevention.</li>
          </ul>
        </Section>

        <Section title="3. How we use your information">
          <ul>
            <li>To operate the platform: routing leads, generating AI responses, sending notifications, and populating your dashboard.</li>
            <li>To communicate with you: account verification emails, password resets, and product updates.</li>
            <li>To improve the product: understanding how agents use features so we can make them better.</li>
            <li>To prevent abuse: detecting unusual activity and protecting the security of accounts.</li>
          </ul>
          We do not sell your personal information or your leads' personal information to any third party.
        </Section>

        <Section title="4. Third-party services we use">
          To deliver the platform, we share data with the following services. Each has its own privacy policy.
          <table>
            <thead>
              <tr><th>Service</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              <tr><td><a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener">Anthropic</a></td><td>AI language model powering lead responses and scoring</td></tr>
              <tr><td><a href="https://upstash.com/privacy" target="_blank" rel="noopener">Upstash</a></td><td>Database storage for leads, profiles, and credentials</td></tr>
              <tr><td><a href="https://resend.com/privacy" target="_blank" rel="noopener">Resend</a></td><td>Transactional email delivery (notifications, welcome emails)</td></tr>
              <tr><td><a href="https://www.twilio.com/legal/privacy" target="_blank" rel="noopener">Twilio</a></td><td>SMS delivery for lead conversations (if configured)</td></tr>
              <tr><td><a href="https://postmarkapp.com/privacy-policy" target="_blank" rel="noopener">Postmark</a></td><td>Email reply delivery to leads (if configured)</td></tr>
              <tr><td><a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener">Vercel</a></td><td>Platform hosting and deployment</td></tr>
            </tbody>
          </table>
          Lead conversation data sent to Anthropic is used solely to generate responses and is not used to train their models under our API agreement.
        </Section>

        <Section title="5. Data retention">
          <ul>
            <li>Account data is retained for as long as your account is active.</li>
            <li>Lead data is retained to populate your dashboard and may be deleted by you at any time from within the app.</li>
            <li>If you delete your account, we will remove your personal data within 30 days, except where retention is required by law.</li>
          </ul>
        </Section>

        <Section title="6. Your rights">
          Depending on where you are located, you may have the right to:
          <ul>
            <li>Access the personal data we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data.</li>
            <li>Object to or restrict how we process your data.</li>
            <li>Receive your data in a portable format.</li>
          </ul>
          To exercise any of these rights, email us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond within 30 days.
        </Section>

        <Section title="7. Cookies">
          We use a session cookie to keep you signed in. We do not use advertising or tracking cookies. We do not use third-party analytics services that track you across sites.
        </Section>

        <Section title="8. Children's privacy">
          Say HelloLeads is not directed at children under 13. We do not knowingly collect personal information from anyone under 13. If you believe we have inadvertently collected such information, please contact us and we will delete it promptly.
        </Section>

        <Section title="9. Changes to this policy">
          We may update this policy from time to time. When we do, we will update the effective date at the top of this page and, for material changes, notify registered users by email. Continued use of the platform after changes constitutes acceptance.
        </Section>

        <Section title="10. Contact us" last>
          Questions about this policy or your data? We're happy to help.
          <div style={{ marginTop: '1rem', padding: '1rem 1.25rem', background: '#f0f0ec', borderRadius: '10px', fontSize: '14px' }}>
            📧 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </div>
        </Section>

      </main>

      <Footer />
    </>
  );
}

function Section({ title, children, last }) {
  return (
    <section style={{ marginBottom: last ? 0 : '2.25rem' }}>
      <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0a0a0a', marginBottom: '.75rem', paddingBottom: '.5rem', borderBottom: '1px solid #e0ddd8' }}>
        {title}
      </h2>
      <div style={{ fontSize: '14px', color: '#3a3a3a', lineHeight: '1.75', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {children}
      </div>
    </section>
  );
}

function SubHead({ children }) {
  return <p style={{ fontWeight: '600', color: '#0a0a0a', marginTop: '.25rem', marginBottom: '.1rem' }}>{children}</p>;
}
