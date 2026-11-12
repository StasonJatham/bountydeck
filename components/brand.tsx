import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Image
        src="/brand/icon.svg"
        width={32}
        height={32}
        alt=""
        className="size-8 shrink-0"
        unoptimized
      />
      {!compact && (
        <span className="text-[1.06rem] font-bold tracking-[-0.045em]">
          BountyDeck
        </span>
      )}
    </span>
  );
}
