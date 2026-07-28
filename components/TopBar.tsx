import Link from 'next/link';

export default function TopBar({ crumb }: { crumb?: string }) {
  return (
    <div className="topbar">
      <Link href="/" className="wordmark">
        Millionaires&rsquo; Row
      </Link>
      {crumb && <span className="crumb">{crumb}</span>}
      <span style={{ marginLeft: 'auto' }} className="crumb">
        NYC DOF 2027 supplemental roll
      </span>
    </div>
  );
}
