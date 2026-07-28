import Link from 'next/link';
import AboutNote from '@/components/AboutNote';

export default function NotFound() {
  return (
    <div className="page">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Millionaires&rsquo; Row
        </Link>
        <span className="crumb">Not found</span>
      </div>
      <div className="notfound">
        <h1>404</h1>
        <p>No record with that identifier is on the roll.</p>
        <Link href="/" className="badge">
          Back to the map
        </Link>
      </div>
      <AboutNote />
    </div>
  );
}
