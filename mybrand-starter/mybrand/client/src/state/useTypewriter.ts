import { useEffect, useRef, useState } from "react";

export interface TypewriterState {
  displayed: string;
  isTyping: boolean;
}

/**
 * Displays initial text immediately, then animates any subsequent text updates
 * with a crisp progressive typing effect.
 */
export function useTypewriter(
  text: string,
  charIntervalMs = 24
): TypewriterState {
  const [displayed, setDisplayed] = useState(text);
  const [isTyping, setIsTyping] = useState(false);
  const lastCommittedRef = useRef(text);

  useEffect(() => {
    if (text === lastCommittedRef.current) {
      return;
    }
    lastCommittedRef.current = text;

    if (!text) {
      setDisplayed("");
      setIsTyping(false);
      return;
    }

    setDisplayed("");
    setIsTyping(true);

    const effectiveStepMs = Math.max(
      12,
      Math.min(charIntervalMs, Math.floor(1100 / Math.max(1, text.length)))
    );

    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      if (index >= text.length) {
        setDisplayed(text);
        setIsTyping(false);
        window.clearInterval(timer);
      } else {
        setDisplayed(text.slice(0, index));
      }
    }, effectiveStepMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [text, charIntervalMs]);

  return { displayed, isTyping };
}
