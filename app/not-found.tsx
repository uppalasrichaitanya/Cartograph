import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found">
      <p className="eyebrow">NOT FOUND</p>
      <h1>This map is unavailable.</h1>
      <p>It may have been removed, or the share link is incomplete.</p>
      <Link href="/" className="button">Analyze a repository</Link>
    </main>
  );
}
