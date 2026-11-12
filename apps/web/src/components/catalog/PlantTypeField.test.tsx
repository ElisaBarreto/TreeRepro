import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlantTypeField } from './PlantTypeField.tsx';

describe('RFC-65 R18 PlantTypeField', () => {
  it('shows the fixed text Tree on TreeRepro', () => {
    render(<PlantTypeField value={undefined} onChange={() => {}} platform="treerepro" />);
    const field = screen.getByLabelText('Plant type');
    expect(field).toHaveValue('Tree');
    expect(field).toHaveAttribute('readonly');
  });

  it('offers a choice on PlantRepro and shows the API error', async () => {
    const onChange = vi.fn();
    render(
      <PlantTypeField
        value={undefined}
        onChange={onChange}
        platform="plantrepro"
        error="Required"
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Plant type'), 'not_tree');
    expect(onChange).toHaveBeenCalledWith('not_tree');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});
