import { Html, Head, Main, NextScript } from 'next/document';

/**
 * _document.js
 * Renders on the SERVER before any JS runs.
 * Social crawlers (Facebook, LinkedIn, Twitter, Slack, iMessage) never
 * execute JavaScript — they read raw HTML only. Any meta tags you put
 * inside a React component's <Head> are invisible to crawlers.
 * Putting them here guarantees they're in the raw HTML response.
 */
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* ── Primary meta ── */}
        <meta charSet="utf-8" />
        <meta name="description" content="Leads respond because they think they're texting you — not talking to a chatbot." />

        {/* ── Open Graph (Facebook, LinkedIn, Slack, iMessage) ── */}
        <meta property="og:site_name"   content="Say HelloLeads" />
        <meta property="og:type"        content="website" />
        <meta property="og:url"         content="https://sayhelloleads.com" />
        <meta property="og:title"       content="Say HelloLeads — Respond to every lead in 60 seconds" />
        <meta property="og:description" content="Leads respond because they think they're texting you — not talking to a chatbot." />
        <meta property="og:image"       content="https://sayhelloleads.com/preview.png" />
        <meta property="og:image:width"  content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type"   content="image/png" />
        <meta property="og:image:alt"    content="Say HelloLeads — AI lead response for real estate agents" />

        {/* ── Twitter / X card ── */}
        <meta name="twitter:card"        content="summary_large_image" />
        <meta name="twitter:title"       content="Say HelloLeads — Respond to every lead in 60 seconds" />
        <meta name="twitter:description" content="Leads respond because they think they're texting you." />
        <meta name="twitter:image"       content="https://sayhelloleads.com/preview.png" />

        {/* ── Favicon (add your own later) ── */}
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
