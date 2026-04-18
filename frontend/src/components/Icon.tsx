import React from 'react';

interface IconProps {
  readonly name: string;
  readonly className?: string;
  readonly strokeWidth?: number;
}

const paths: Record<string, React.ReactNode> = {
  menu:    <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  home:    <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></>,
  cards:   <><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/></>,
  book:    <><path d="M4 4h10a4 4 0 0 1 4 4v13H8a4 4 0 0 1-4-4V4z"/><path d="M4 17h14"/></>,
  chat:    <><path d="M4 5h16v11H9l-4 4v-4H4z"/></>,
  sparkle: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.9 2.4L22 17l-2.1.6L19 20l-.9-2.4L16 17l2.1-.6z"/></>,
  search:  <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/></>,
  filter:  <><path d="M4 5h16l-6 8v5l-4 2v-7z"/></>,
  x:       <><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></>,
  chevL:   <><polyline points="15 6 9 12 15 18"/></>,
  chevR:   <><polyline points="9 6 15 12 9 18"/></>,
  chevD:   <><polyline points="6 9 12 15 18 9"/></>,
  sun:     <><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/></>,
  moon:    <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></>,
  ext:     <><path d="M14 4h6v6"/><line x1="10" y1="14" x2="20" y2="4"/><path d="M20 14v6H4V4h6"/></>,
  send:    <><path d="M4 12l16-8-6 16-2-7-8-1z"/></>,
  plus:    <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  lock:    <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  star:    <><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 18l-5.9 3.1 1.2-6.6L2.5 9.9 9.1 9z"/></>,
  user:    <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></>,
  google:  <><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 4v5h-5"/></>,
  slider:  <><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.2"/></>,
  glove:   <><path d="M4 8h16v12H4z"/><path d="M8 8V4h8v4"/></>,
  globe:   <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></>,
};

export const Icon: React.FC<IconProps> = ({ name, className = 'w-4 h-4', strokeWidth = 1.75 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
       strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {paths[name] || null}
  </svg>
);
