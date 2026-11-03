import React from 'react';
import {ArrowRight} from 'lucide-react';

export type MiniCardProps = {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'amber' | 'green' | 'violet';
  children?: React.ReactNode; action?: {label: string; onClick: () => void};
  /** Marks a card whose data source does not exist yet. */
  placeholder?: string;
};

export function MiniCard({label, value, sub, tone, children, action, placeholder}: MiniCardProps) {
  return <section className={`ins-card ins-mini${placeholder ? ' placeholder' : ''}`} aria-label={label}>
    <div className="ins-mini-top"><span>{label}</span>{placeholder && <span className="ins-chip grey">{placeholder}</span>}</div>
    <div className={`ins-mini-val ins-num${tone ? ' ' + tone : ''}`}>{value}</div>
    {sub && <small className="ins-mini-sub">{sub}</small>}
    {children}
    {action && <button type="button" className="ins-ghost" onClick={action.onClick}>{action.label} <ArrowRight size={14} aria-hidden="true" /></button>}
  </section>;
}
