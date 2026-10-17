import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Need-to-Know · Landlord" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a className="brand" href="/">Need-to-Know</a>
          <span className="role">Landlord</span>
        </header>
        {children}
      </body>
    </html>
  );
}
