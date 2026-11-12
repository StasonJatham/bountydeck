import type { ReactNode } from "react";
import "./style.css";

export const metadata = {
  title: "Bossob",
  description: "Internal vulnerability reporting",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
