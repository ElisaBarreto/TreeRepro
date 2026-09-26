import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button.tsx';
import { Textarea } from '../ui/Textarea.tsx';

type Mode = 'visual' | 'html';

// ponytail: document.execCommand is deprecated but supported by every browser
// and needs no editor library; swap for one if formatting needs outgrow it.
const COMMANDS: readonly { label: string; command: string; value?: string }[] = [
  { label: 'Bold', command: 'bold' },
  { label: 'Italic', command: 'italic' },
  { label: 'Heading', command: 'formatBlock', value: 'h3' },
  { label: 'Paragraph', command: 'formatBlock', value: 'p' },
  { label: 'Bullets', command: 'insertUnorderedList' },
  { label: 'Numbers', command: 'insertOrderedList' },
];

/**
 * Pasted HTML is only sanitised by the API on save, so before the visual area
 * renders it, drop what could run in the editor's session: active elements,
 * `on*` handlers and `javascript:`-style URLs. Parsed in an inert document,
 * where nothing loads or runs.
 */
function inert(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.body.querySelectorAll(
    'script,style,iframe,object,embed,link,meta,base,form,svg,math',
  ))
    el.remove();
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const url = [...attr.value]
        .filter((c) => c > ' ')
        .join('')
        .toLowerCase();
      if (attr.name.startsWith('on') || /^(javascript|vbscript|data):/.test(url))
        el.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}

/**
 * The editor of a help section's body (RFC-73 R7): a visual mode with a
 * small formatting toolbar, and an HTML mode showing the markup itself.
 * `onChange` receives the HTML either way.
 * @rfc RFC-73 R7
 */
export function RichTextEditor({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('visual');
  const area = useRef<HTMLDivElement>(null);

  // The visual area is uncontrolled while typing (resetting innerHTML would
  // move the caret); it is filled on mount and whenever it comes back from
  // the HTML mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refilled only on a mode switch, never per keystroke.
  useEffect(() => {
    if (mode === 'visual' && area.current) area.current.innerHTML = inert(value);
  }, [mode]);

  function run(command: string, arg?: string) {
    area.current?.focus();
    document.execCommand(command, false, arg);
    onChange(area.current?.innerHTML ?? '');
  }

  function link() {
    const url = window.prompt('Link address (https://… or /app/…)');
    if (url) run('createLink', url);
  }

  return (
    <div className="rounded-[10px] border border-canopy-700/20 bg-white">
      <div className="flex flex-wrap gap-1.5 border-b border-canopy-700/15 p-2">
        {mode === 'visual' ? (
          <>
            {COMMANDS.map((c) => (
              <Button
                key={c.label}
                type="button"
                size="sm"
                variant="secondary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(c.command, c.value)}
              >
                {c.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={link}
            >
              Link
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="ml-auto"
          aria-pressed={mode === 'html'}
          onClick={() => setMode(mode === 'visual' ? 'html' : 'visual')}
        >
          {mode === 'visual' ? 'HTML' : 'Visual'}
        </Button>
      </div>
      {mode === 'visual' ? (
        // biome-ignore lint/a11y/useSemanticElements: a rich-text area holds markup, which a textarea cannot.
        <div
          id={id}
          ref={area}
          role="textbox"
          aria-multiline="true"
          aria-label="Section text"
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          className="prose-treerepro min-h-40 p-3 focus-visible:outline-2 focus-visible:outline-pollen-500"
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
        />
      ) : (
        <Textarea
          id={id}
          aria-label="Section HTML"
          rows={12}
          className="rounded-none border-0 font-mono text-cell"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
