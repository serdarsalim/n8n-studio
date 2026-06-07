import Link from "next/link";

export const metadata = {
  title: "Terms · n8n studio",
};

export default function TermsPage() {
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
        <h1 className="m-0 mb-2 text-[28px] font-semibold tracking-[-0.02em]">Terms</h1>
        <p className="text-[var(--muted)] mb-8">
          The short version: this is a free, open-source tool provided as is. Use
          it at your own risk.
        </p>

        <Section title="No warranty">
          <p>
            n8n studio is provided &quot;as is&quot;, without warranty of any
            kind. We do not guarantee it is free of bugs or that it fits any
            particular purpose. To the fullest extent allowed by law, we are not
            liable for any loss or damage that comes from using it.
          </p>
        </Section>

        <Section title="You run your own workflows">
          <p>
            When you hit Run, the workflow executes in your own n8n instance,
            with real side effects. n8n studio only sends the input you gave it
            and reads back what your n8n did. You are responsible for what your
            workflows do. We are not responsible if a run sends, charges,
            deletes, or changes something, or if your n8n behaves in a way you
            did not expect.
          </p>
        </Section>

        <Section title="Your keys and data are yours">
          <p>
            Your n8n URL and API key stay in your browser&apos;s local storage.
            We do not collect, store, or transmit them, your workflows, or your
            execution data. See the{" "}
            <Link href="/privacy" className="text-[var(--n8n)] hover:underline">
              Privacy
            </Link>{" "}
            page for details.
          </p>
        </Section>

        <Section title="Not affiliated with n8n">
          <p>
            n8n studio is an independent tool. It is not affiliated with,
            endorsed by, or connected to n8n.io. &quot;n8n&quot; is a trademark
            of its respective owner.
          </p>
        </Section>

        <Section title="License">
          <p>
            The source is{" "}
            <a
              href="https://github.com/serdarsalim/n8n-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--n8n)] hover:underline"
            >
              MIT licensed
            </a>
            . You are free to use, modify, and self-host it.
          </p>
        </Section>
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
