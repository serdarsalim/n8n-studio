import Link from "next/link";

export const metadata = {
  title: "Privacy · n8n studio",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--panel)]">
      <header className="pl-10 pr-6 py-3 border-b border-[var(--border)] flex items-center gap-4 sticky top-0 bg-[var(--panel)] z-10">
        <Link
          href="/"
          className="text-[12px] text-[var(--muted)] hover:text-[var(--text)] no-underline"
        >
          ← Back
        </Link>
        <div className="flex-1" />
        <Link
          href="/"
          title="Close"
          aria-label="Close"
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] no-underline text-[16px] leading-none"
        >
          ✕
        </Link>
      </header>

      <div className="max-w-[720px] mx-auto px-6 pt-10 pb-[30vh] text-[14px] leading-relaxed text-[var(--text)]">
        <h1 className="m-0 mb-2 text-[28px] font-semibold tracking-[-0.02em]">Privacy</h1>
        <p className="text-[var(--muted)] mb-8">
          n8n studio runs entirely in your browser. There is no account to
          create and no server of ours that holds your data.
        </p>

        <Section title="Your n8n credentials stay with you">
          <p>
            Your n8n URL and API key live in your browser&apos;s local storage.
            They are never sent to us, because there is nowhere to send them. The
            app&apos;s API routes only proxy requests from your browser straight
            to the n8n instance you pointed at, using the key you typed. They
            exist to keep your key out of the browser network tab and to avoid
            CORS, nothing else.
          </p>
          <p>
            Your workflows and execution results are fetched live from your own
            n8n and rendered on screen. We do not keep a copy.
          </p>
        </Section>

        <Section title="What we never see">
          <ul className="list-disc pl-5 space-y-1">
            <li>No account, no login, no database.</li>
            <li>
              We never see, store, or share your n8n keys, your workflows, or
              your execution data. None of it reaches us.
            </li>
            <li>No error reporting. We do not collect crash logs or anything tied to you.</li>
          </ul>
        </Section>

        <Section title="Anonymous analytics">
          <p>
            The hosted version uses Vercel&apos;s privacy-friendly analytics to
            count page views. It is cookieless, collects no personal data, and
            does no cross-site tracking. It tells us how many people open the
            app, nothing about you or your n8n. Self-host the app to opt out of
            even that.
          </p>
        </Section>

        <Section title="Want even more certainty?">
          <p>
            Run it locally or self-host it. The source is open (MIT) on{" "}
            <a
              href="https://github.com/serdarsalim/n8n-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--n8n)] hover:underline"
            >
              GitHub
            </a>
            , so you can read exactly what it does and run your own copy.
          </p>
        </Section>

        <p className="text-[12px] text-[var(--muted-2)] mt-10">
          n8n studio is an independent tool and is not affiliated with n8n.io.
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="m-0 mb-2 text-[15px] font-semibold text-[var(--text)]">{title}</h2>
      <div className="text-[var(--muted)] space-y-2">{children}</div>
    </section>
  );
}
