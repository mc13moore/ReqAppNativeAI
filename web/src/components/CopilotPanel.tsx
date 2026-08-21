import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import type { AssistantIntent, AssistantReply } from '../lib/types';
import { IconClose, IconSend, IconSparkles } from './Icons';

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text?: string;
  reply?: AssistantReply;
}

const QUICK_PROMPTS: { intent: AssistantIntent; label: string; needsRecord: boolean }[] = [
  { intent: 'summarize', label: 'Summarize this requisition', needsRecord: true },
  { intent: 'similar', label: 'Find similar requisitions', needsRecord: true },
  { intent: 'spend-profile', label: 'Show the spend profile', needsRecord: false },
  { intent: 'outliers', label: 'Highlight unusual spend', needsRecord: false },
];

export interface CopilotContext {
  company?: string;
  requisitionNumber?: string;
  label?: string;
}

/**
 * AI assistant side panel.
 *
 * The responses come from a server endpoint that composes answers out of the
 * same records shown on screen -- no model is called yet. The panel is built
 * against the shape a real model integration would return, so swapping the
 * mock for Claude is a change on the server only.
 */
export function CopilotPanel({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context: CopilotContext;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ask = async (prompt: string, intent: AssistantIntent) => {
    setBusy(true);
    setTurns((prev) => [...prev, { id: nextId.current++, role: 'user', text: prompt }]);
    setInput('');

    try {
      const reply = await api.ask({
        prompt,
        intent,
        company: context.company,
        requisitionNumber: context.requisitionNumber,
      });
      setTurns((prev) => [...prev, { id: nextId.current++, role: 'assistant', reply }]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: 'assistant',
          reply: {
            intent,
            headline: 'The assistant is unavailable',
            body: [err instanceof Error ? err.message : String(err)],
            facts: [],
            suggestions: [],
            groundedOn: [],
          },
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void ask(text, 'freeform');
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="copilot-backdrop"
        onClick={onClose}
        aria-label="Close assistant"
      />
      <aside className="copilot" role="dialog" aria-label="AI assistant">
        <header className="copilot__head">
          <span className="copilot__mark">
            <IconSparkles size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: '0.9375rem' }}>AI Copilot</div>
            <div className="tiny dim">
              {context.label ? `Context: ${context.label}` : 'Procurement assistant · preview'}
            </div>
          </div>
          <button type="button" className="btn btn--subtle btn--icon" onClick={onClose} aria-label="Close">
            <IconClose size={16} />
          </button>
        </header>

        <div className="copilot__body" ref={bodyRef}>
          {turns.length === 0 && (
            <>
              <div className="bubble bubble--ai">
                <div className="bubble__headline">How can I help with procurement?</div>
                <p>
                  I can read requisition headers, lines and spend patterns from Dynamics 365.
                  Pick a starting point or ask anything.
                </p>
                <div className="bubble__grounded">
                  Preview — answers are composed from the Dynamics 365 records on screen, not
                  from a language model.
                </div>
              </div>

              <div className="prompt-grid">
                {QUICK_PROMPTS.filter((p) => !p.needsRecord || context.requisitionNumber).map(
                  (prompt) => (
                    <button
                      key={prompt.intent}
                      type="button"
                      className="prompt-btn"
                      onClick={() => void ask(prompt.label, prompt.intent)}
                    >
                      {prompt.label}
                    </button>
                  ),
                )}
              </div>
            </>
          )}

          {turns.map((turn) =>
            turn.role === 'user' ? (
              <div className="bubble bubble--user" key={turn.id}>
                {turn.text}
              </div>
            ) : (
              <div className="bubble bubble--ai" key={turn.id}>
                {turn.reply && (
                  <>
                    <div className="bubble__headline">{turn.reply.headline}</div>
                    {turn.reply.body.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}

                    {turn.reply.facts.length > 0 && (
                      <div className="bubble__facts">
                        {turn.reply.facts.map((fact) => (
                          <span className="fact" key={fact.label + fact.value}>
                            <span className="fact__label">{fact.label}</span>
                            <span className="fact__value">{fact.value}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {turn.reply.suggestions.length > 0 && (
                      <div className="prompt-grid" style={{ marginTop: '0.7rem' }}>
                        {turn.reply.suggestions.map((suggestion) => {
                          const match = QUICK_PROMPTS.find((p) => p.label === suggestion);
                          return (
                            <button
                              key={suggestion}
                              type="button"
                              className="prompt-btn"
                              onClick={() => void ask(suggestion, match?.intent ?? 'freeform')}
                            >
                              {suggestion}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {turn.reply.groundedOn.length > 0 && (
                      <div className="bubble__grounded">
                        Grounded on: {turn.reply.groundedOn.join(' · ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            ),
          )}

          {busy && (
            <div className="bubble bubble--ai" style={{ width: 'fit-content' }}>
              <span className="typing" aria-label="Thinking">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
        </div>

        <form className="copilot__foot" onSubmit={submit}>
          <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
            <input
              className="field__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about requisitions or spend…"
              disabled={busy}
              aria-label="Ask the assistant"
            />
            <button
              type="submit"
              className="btn btn--primary btn--icon"
              disabled={busy || !input.trim()}
              aria-label="Send"
            >
              <IconSend size={15} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
