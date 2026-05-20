import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "n8n-studio",
  description: "A free, open-source workflow inspector and tester for n8n.",
};

const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
