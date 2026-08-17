import type { ReactNode } from 'react';

export function StatCard({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-copy">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {note ? <div className="stat-note">{note}</div> : null}
      </div>
    </article>
  );
}
