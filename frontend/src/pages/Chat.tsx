import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import type { Article, ChatMessage } from '../types';

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

interface SourceCard {
  readonly title: string;
  readonly url: string;
  readonly category: string;
}

const SourceChip: React.FC<{ readonly source: SourceCard }> = ({ source }) => (
  <a
    href={source.url || '#'}
    target="_blank"
    rel="noopener noreferrer"
    className="group text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 w-[240px] shrink-0 hover:border-accent/60 transition block"
  >
    <div className="flex items-center gap-2 text-[10.5px] font-mono text-slate-500 dark:text-slate-400">
      {source.category && <Badge category={source.category} />}
    </div>
    <div className="mt-1.5 text-[12.5px] font-medium line-clamp-2 leading-snug text-slate-800 dark:text-slate-100">
      {source.title}
    </div>
  </a>
);

const SuggestionButton: React.FC<{ readonly text: string; readonly onClick: () => void }> = ({ text, onClick }) => (
  <button
    onClick={onClick}
    className="text-left px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[13.5px] text-slate-700 dark:text-slate-200 hover:border-accent/60 transition"
  >
    {text}
  </button>
);

interface WikiRef {
  readonly id: string;
  readonly label: string;
}

interface ExtendedMessage extends ChatMessage {
  readonly sources?: readonly SourceCard[];
  readonly suggestions?: readonly string[];
  readonly wiki_refs?: readonly WikiRef[];
}

const MessageBubble: React.FC<{
  readonly m: ExtendedMessage;
  readonly onSuggestion: (s: string) => void;
}> = ({ m, onSuggestion }) => {
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
        {!m.streaming && m.wiki_refs && m.wiki_refs.length > 0 && (
          <div className="mt-3">
            <div className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 mb-2">Wiki 參考</div>
            <div className="flex flex-wrap gap-1.5">
              {m.wiki_refs.map((w, i) => (
                <span key={i} className="inline-block px-2 py-1 rounded-md bg-accent/10 text-accent text-[12px] font-medium">
                  {w.label}
                </span>
              ))}
            </div>
          </div>
        )}
        {!m.streaming && m.sources && m.sources.length > 0 && (
          <div className="mt-3">
            <div className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 mb-2">來源引用 &middot; {m.sources.length}</div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {m.sources.map((s, i) => <SourceChip key={i} source={s} />)}
            </div>
          </div>
        )}
        {!m.streaming && m.suggestions && m.suggestions.length > 0 && (
          <div className="mt-3">
            <div className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 mb-2">繼續探討</div>
            <div className="grid grid-cols-1 gap-1.5">
              {m.suggestions.map((s, i) => (
                <SuggestionButton key={i} text={s} onClick={() => onSuggestion(s)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const INITIAL_SUGGESTIONS = [
  '亞太再保費率最新走勢',
  '韓國保險業監管重點',
  '比較日本三大產險 AI 理賠專案',
  '東南亞嵌入式保險市場',
];

interface ChatPageProps {
  readonly articles: readonly Article[];
  readonly openArticle: (a: Article) => void;
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export const ChatPage: React.FC<ChatPageProps> = ({ apiFetch }) => {
  const [messages, setMessages] = useState<ExtendedMessage[]>([
    {
      id: 'm0',
      role: 'ai',
      content: '你好，我是保險知識庫助手。我可以根據知識庫中的文章回答你的問題。',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setInput(''); // Clear immediately

    const userMsg: ExtendedMessage = { id: 'u' + Date.now(), role: 'user', content: text };
    const aiId = 'a' + Date.now();
    const aiMsg: ExtendedMessage = { id: aiId, role: 'ai', content: '思考中...', streaming: true };
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setBusy(true);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages(prev =>
          prev.map(m => m.id === aiId ? { ...m, content: `錯誤：${err.error || '請稍後再試'}`, streaming: false } : m),
        );
        setBusy(false);
        return;
      }

      const data = await res.json();
      setSessionId(data.session_id || null);

      setMessages(prev =>
        prev.map(m =>
          m.id === aiId
            ? {
                ...m,
                content: data.answer,
                streaming: false,
                sources: data.sources || [],
                suggestions: data.suggestions || [],
                wiki_refs: data.wiki_refs || [],
              }
            : m,
        ),
      );
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === aiId ? { ...m, content: '網路錯誤，請稍後再試。', streaming: false } : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [apiFetch, busy, sessionId]);

  const newChat = () => {
    setMessages([{ id: 'm0', role: 'ai', content: '你好，我是保險知識庫助手。我可以根據知識庫中的文章回答你的問題。' }]);
    setSessionId(null);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-slate-200 dark:border-slate-900 px-4 py-2 flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">AI Chat</span>
        <button onClick={newChat} className="text-[12px] text-accent hover:underline">新對話</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 md:px-8 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map(m => (
            <MessageBubble key={m.id} m={m} onSuggestion={send} />
          ))}
          {messages.length === 1 && (
            <div className="pt-4">
              <div className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 mb-2">建議提問</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {INITIAL_SUGGESTIONS.map(s => (
                  <SuggestionButton key={s} text={s} onClick={() => send(s)} />
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
              placeholder="向保險知識庫提問…"
              className="flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] leading-relaxed focus:outline-none"
              style={{ maxHeight: 180 }}
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-accent text-white transition ${!input.trim() || busy ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
            >
              <Icon name="send" className="w-4 h-4" />
              送出
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            按 Enter 送出 &middot; Shift+Enter 換行
          </div>
        </form>
      </div>
    </div>
  );
};
