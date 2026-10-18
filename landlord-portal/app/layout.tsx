import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Janus · Landlord" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">✓</span>Janus</a>
          <span className="role"><span className="role-dot" />Landlord workspace</span>
        </header>
        {children}
      </body>
    </html>
  );
}
