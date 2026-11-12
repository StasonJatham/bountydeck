import Link from "next/link";
import { Shield } from "lucide-react";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-8 py-16">
      <div className="mb-10 flex items-center gap-3 text-lg font-semibold">
        <Shield aria-hidden size={23} /> Bossob
      </div>
      <h1 className="text-5xl font-semibold tracking-tight">
        Internal bug bounty
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-neutral-600">
        Find eligible programs, report security vulnerabilities, and track your
        submissions.
      </p>
      <Link
        className="mt-8 w-fit rounded-md bg-neutral-900 px-5 py-3 font-medium text-white"
        href="/dashboard"
      >
        Sign in
      </Link>
    </main>
  );
}
