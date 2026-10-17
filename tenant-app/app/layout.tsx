import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Need-to-Know · Tenant" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">✓</span>Need-to-Know</a>
          <span className="role"><span className="role-dot" />Tenant workspace</span>
        </header>
        {children}
      </body>
    </html>
  );
}
