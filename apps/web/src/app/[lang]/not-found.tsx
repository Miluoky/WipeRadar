import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto my-16 max-w-lg space-y-4 rivets p-8 text-center plate">
      <div className="mx-auto h-2 w-24 hazard" aria-hidden />
      <p className="font-display text-6xl font-bold text-rust-2">404</p>
      <p className="text-ash">Nothing here but scrap. / Здесь только металлолом.</p>
      <Link href="/" className="inline-block bg-rust px-4 py-2 font-display text-sm text-white hover:bg-rust-2">
        WipeRadar
      </Link>
    </div>
  );
}
