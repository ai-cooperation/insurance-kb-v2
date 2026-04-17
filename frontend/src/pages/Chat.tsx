import { useState } from 'react'
import { MessageCircle, Send, Bot, Crown } from 'lucide-react'
import { cn } from '../lib/utils'

interface Message {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
}

const PLACEHOLDER_MESSAGES: readonly Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'IFRS 17 對台灣壽險業有什麼影響？',
  },
  {
    id: '2',
    role: 'assistant',
    content: 'IFRS 17 對台灣壽險業的主要影響包括：\n\n1. **負債衡量方式改變**：從鎖定利率改為市場現時利率，壽險負債將隨利率波動。\n2. **資本需求增加**：預估壽險業需增提準備金約 1-2 兆元。\n3. **保單定價調整**：長年期儲蓄型保單的獲利結構將改變。\n\n此功能建置完成後，將可即時查詢知識庫中的相關分析。',
  },
]

export function Chat() {
  const [input, setInput] = useState('')

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 lg:p-6 space-y-4">
        {/* Placeholder banner */}
        <div className="mx-auto max-w-2xl rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Crown className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground">
            VIP AI Chat 功能建置中
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            AI 智能問答系統正在開發中。完成後，VIP 會員可透過自然語言查詢保險知識庫，
            獲得基於 RAG 技術的精準回答，並附上原始資料來源。
          </p>
        </div>

        {/* Sample conversation */}
        <div className="mx-auto max-w-2xl space-y-4">
          <p className="text-center text-xs text-muted-foreground">功能預覽（示範對話）</p>
          {PLACEHOLDER_MESSAGES.map(msg => (
            <div
              key={msg.id}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                )}
              >
                {msg.content.split('\n').map((line, i) => (
                  <p key={i} className={cn(i > 0 && 'mt-1.5')}>
                    {line}
                  </p>
                ))}
              </div>
              {msg.role === 'user' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <MessageCircle className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card p-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            type="text"
            placeholder="輸入保險相關問題...（功能開發中）"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled
            className={cn(
              'flex-1 rounded-lg border border-border bg-background py-2.5 px-4 text-sm',
              'placeholder:text-muted-foreground',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />
          <button
            disabled
            className={cn(
              'inline-flex items-center justify-center rounded-lg p-2.5',
              'bg-primary text-primary-foreground',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
