import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { Btn } from '../components/Button';
import { CHAT_HISTORY_SEED } from '../data';
import type { Article, ChatMessage } from '../types';

const AI_REPLY = `根據知識庫中最新的 482 篇亞太區文章，我整理出三點觀察：

1. 東南亞數位保險滲透率在 2026 年 4 月首次突破 15%，印尼與越南是主要驅動市場，嵌入式保險與微保險保費合計年增 38%。

2. 日本車險業者進入 AI 理賠技術競賽期。東京海上本月推出新一代 AI 理賠平台，預計 90 秒內完成初步定損。MS&AD 與 Sompo 亦宣布類似時程。

3. 亞太再保費率在 1/4 續約週期平均上漲 2–4%，巨災層級漲幅最高，主要反映 2025 年颱風與洪水損失。

如需特定子市場的深入分析，可以告訴我想聚焦的國家或條線。`;

const Avatar: React.FC<{ readonly role: 'user' | 'ai' }> = ({ role }) => {
  if (role === 'user') {
    return (
      <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
        <Icon name="user" className="w-3.5 h-3.5" />
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center shrink-0">
      <Icon name="sparkle" className="w-4 h-4" />
    </div>
  );
};

const CitationChip: React.FC<{ readonly article: Article; readonly onOpen: (a: Article) => void }> = ({ article, onOpen }) => (
  <button
    onClick={() => onOpen(article)}
    className="group text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 w-[240px] shrink-0 hover:border-accent/60 transition"
  >
    <div className="flex items-center gap-2 text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
      <Badge category={article.category} />
    </div>
    <div className="mt-1.5 text-[12.5px] font-medium line-clamp-2 leading-snug text-slate-800 dark:text-slate-100">
      {article.title_zh}
    </div>
    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
      <span>{article.source}</span>
      <Icon name="ext" className="w-3 h-3 opacity-0 group-hover:opacity-100 transition" />
    </div>
  </button>
);

const MessageBubble: React.FC<{ readonly m: ChatMessage; readonly articles: readonly Article[]; readonly openArticle: (a: Article) => void }> = ({ m, articles, openArticle }) => {
  if (m.role === 'user') {
    return (
      <div className="flex gap-3 justify-end anim-in">
        <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2.5 text-[14.5px] leading-relaxed">
          {m.content}
        </div>
        <Avatar role="user" />
      </div>
    );
  }
  return (
    <div className="flex gap-3 anim-in">
      <Avatar role="ai" />
      <div className="max-w-[82%]">
        <div className="rounded-2xl rounded-tl-sm bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-4 py-3 text-[14.5px] leading-[1.7] whitespace-pre-wrap text-pretty">
          <span className={m.streaming ? 'caret' : ''}>{m.content}</span>
        </div>
        {!m.streaming && m.citations && m.citations.length > 0 && (
          <div className="mt-3">
            <div className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 mb-2">來源引用 &middot; {m.citations.length}</div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {m.citations.map(cid => {
                const a = articles.find(x => x.id === cid);
                return a ? <CitationChip key={cid} article={a} onOpen={openArticle} /> : null;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SUGGESTIONS = [
  '亞太再保費率 1/4 續約走勢？',
  '香港 ESG 新規重點摘要',
  '比較日本三大產險 AI 理賠專案',
  '東南亞嵌入式保險市場規模',
];

interface ChatPageProps {
  readonly articles: readonly Article[];
  readonly openArticle: (a: Article) => void;
}

export const ChatPage: React.FC<ChatPageProps> = ({ articles, openArticle }) => {
  const [activeChat, setActiveChat] = useState('c1');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm0',
      role: 'ai',
      content: '你好，我是保險知識庫助手。我可以根據 12,596 篇文章回答你的問題。',
      citations: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback((text: string) => {
    if (!text.trim() || busy) return;
    const userMsg: ChatMessage = { id: 'u' + Date.now(), role: 'user', content: text };
    const aiId = 'a' + Date.now();
    const demoCitations = articles.slice(0, 3).map(a => a.id);
    const aiMsg: ChatMessage = { id: aiId, role: 'ai', content: '', streaming: true, citations: demoCitations };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    setBusy(true);

    const full = AI_REPLY;
    let i = 0;
    const step = () => {
      i += Math.max(1, Math.round(Math.random() * 3));
      if (i >= full.length) {
        setMessages((prev) => prev.map(m => m.id === aiId ? { ...m, content: full, streaming: false } : m));
        setBusy(false);
        return;
      }
      setMessages((prev) => prev.map(m => m.id === aiId ? { ...m, content: full.slice(0, i) } : m));
      setTimeout(step, 18 + Math.random() * 22);
    };
    setTimeout(step, 350);
  }, [articles, busy]);

  const newChat = () => {
    setMessages([{ id: 'm0', role: 'ai', content: '你好，我是保險知識庫助手。我可以根據 12,596 篇文章回答你的問題。', citations: [] }]);
    setActiveChat('new');
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Chat list sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-slate-200 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-950/50">
        <div className="p-3">
          <Btn variant="outline" className="w-full justify-center" onClick={newChat}>
            <Icon name="plus" className="w-4 h-4" /> 新對話
          </Btn>
        </div>
        <div className="px-3 pb-2 text-[10.5px] font-mono uppercase tracking-wider text-slate-500">歷史對話</div>
        <div className="flex-1 overflow-auto px-2 pb-4 space-y-0.5">
          {CHAT_HISTORY_SEED.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveChat(c.id)}
              className={`w-full text-left px-2.5 py-2 rounded-md transition ${activeChat === c.id ? 'bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800' : 'hover:bg-white/60 dark:hover:bg-slate-900/50'}`}
            >
              <div className="text-[13px] font-medium truncate text-slate-800 dark:text-slate-100">{c.title}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{c.date}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-slate-200 dark:border-slate-900 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Icon name="star" className="w-3.5 h-3.5 text-accent" />
          <span>今日用量 12 / 50</span>
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 md:px-8 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map(m => <MessageBubble key={m.id} m={m} articles={articles} openArticle={openArticle} />)}
            {messages.length === 1 && (
              <div className="pt-4">
                <div className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 mb-2">建議提問</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[13.5px] text-slate-700 dark:text-slate-200 hover:border-accent/60 transition"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 dark:border-slate-900 bg-white/80 dark:bg-slate-950/80 backdrop-blur px-4 md:px-8 py-4">
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="max-w-3xl mx-auto"
          >
            <div className="flex gap-2 items-end rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-accent transition p-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                rows={1}
                placeholder="向 12,596 篇文章提問…"
                className="flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] leading-relaxed focus:outline-none"
                style={{ maxHeight: 180 }}
              />
              <Btn type="submit" disabled={!input.trim() || busy} className={!input.trim() || busy ? 'opacity-50 cursor-not-allowed' : ''}>
                <Icon name="send" className="w-4 h-4" />
                送出
              </Btn>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>按 Enter 送出 &middot; Shift+Enter 換行</span>
              <span className="font-mono">knowledge-chat-v2 &middot; VIP</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
