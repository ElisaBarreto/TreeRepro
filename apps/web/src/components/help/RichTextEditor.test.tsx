import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichTextEditor } from './RichTextEditor.tsx';

describe('RFC-73 R7 RichTextEditor', () => {
  it('renders pasted HTML without anything that could run in the editor', () => {
    const { container } = render(
      <RichTextEditor
        id="body"
        value={
          '<p onclick="x()">Hi <a href=" JaVa\tScript:alert(1)">bad</a> <a href="/app/help">ok</a></p><img src="x" onerror="alert(1)"><script>alert(1)</script>'
        }
        onChange={() => {}}
      />,
    );
    const area = container.querySelector('[contenteditable]');
    expect(area?.innerHTML).toBe('<p>Hi <a>bad</a> <a href="/app/help">ok</a></p><img src="x">');
  });
});
