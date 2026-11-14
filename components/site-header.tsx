import Link from "next/link";
import { Brand } from "./brand";

export function SiteHeader({
  children,
  brand,
  className = "",
}: {
  children?: React.ReactNode;
  brand?: React.ComponentProps<typeof Brand>["brand"];
  className?: string;
}) {
  return (
    <header className={`min-h-16 border-b border-line bg-surface ${className}`}>
      {children ?? (
        <div className="mx-auto flex min-h-16 max-w-7xl items-center px-5 sm:px-9">
          <Link href="/">
            <Brand brand={brand} />
          </Link>
        </div>
      )}
    </header>
  );
}
