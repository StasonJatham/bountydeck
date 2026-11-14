import Image from "next/image";

export function Brand({
  compact = false,
  brand = { name: "BountyDeck", logo: "/brand/icon.svg" },
}: {
  compact?: boolean;
  brand?: { name: string; logo: string };
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Image
        src={brand.logo}
        width={32}
        height={32}
        alt=""
        className="size-8 shrink-0 object-contain"
        unoptimized
      />
      {!compact && (
        <span className="min-w-0 truncate text-[1.06rem] font-bold tracking-[-0.045em]">
          {brand.name}
        </span>
      )}
    </span>
  );
}
