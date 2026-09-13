import { useEffect, useState } from 'react';

/**
 * The value as it was `ms` milliseconds ago, updated only once it has stopped
 * changing for that long. Search boxes feed it to their queries so a keystroke
 * does not become a request.
 * @rfc RFC-60 R6
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
