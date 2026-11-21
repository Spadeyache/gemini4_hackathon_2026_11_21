import { useEffect, useState } from "react";
import { useTypewriter } from "../../state/useTypewriter";

interface HostNoteBubbleProps {
  hostName: string;
  note: string;
}

export function HostNoteBubble({ hostName, note }: HostNoteBubbleProps) {
  const { displayed, isTyping } = useTypewriter(note, 24);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!note) return;
    setPulse(true);
    const timeout = window.setTimeout(() => setPulse(false), 900);
    return () => window.clearTimeout(timeout);
  }, [note]);

  if (!note && !displayed) return null;

  return (
    <aside
      className={`host-note-bubble ${pulse ? "pulse" : ""}`}
      aria-live="polite"
    >
      <div className="host-note-label">
        <span className="host-note-dot" />
        AI · in {hostName}&apos;s voice
      </div>
      <p className="host-note-text">
        {displayed}
        {isTyping && <span className="typing-caret">▍</span>}
      </p>
    </aside>
  );
}
