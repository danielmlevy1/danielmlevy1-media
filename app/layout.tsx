import type { Metadata } from "next";
import TopNav from "./_components/top-nav";
import AuthHandoff from "./_components/auth-handoff";
import AgentEmbed from "./_components/agent-embed";
import "./globals.css";

export const metadata: Metadata = {
  title: "Media",
  description: "Shows, movies and books to watch and read, and how far along you are.",
};

/** Pre-paint theme: shared `suite_theme` key, dark-first. Mirrors the other apps. */
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('suite_theme');var t=s||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        <AuthHandoff />
        <TopNav />
        {children}
        <AgentEmbed scope="media" />
      </body>
    </html>
  );
}
