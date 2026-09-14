import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Alert,
  Badge,
  Button,
  buttonClassName,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Table,
  Tbody,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
} from './index.ts';

describe('RFC-13 R5 UI kit renders with classes only', () => {
  it('Button: pending disables and announces busy; variants differ by class', () => {
    const { rerender } = render(<Button pending>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveAttribute('style');
    rerender(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('red');
  });

  it('buttonClassName returns the Button dress for a variant and size', () => {
    const { container } = render(
      <Button variant="secondary" size="sm">
        Same
      </Button>,
    );
    expect(buttonClassName({ variant: 'secondary', size: 'sm' }).trim()).toBe(
      container.querySelector('button')?.className.trim(),
    );
    expect(buttonClassName()).toBe(buttonClassName({ variant: 'primary', size: 'md' }));
  });

  it('Field wires label, hint and error to the input', () => {
    render(
      <Field id="email" label="Email" hint="Work address" error="Invalid email address">
        <Input id="email" invalid />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Invalid email address'));
    expect(screen.getByText('Work address')).toBeInTheDocument();
  });

  it('Field merges an existing aria-describedby instead of replacing it', () => {
    render(
      <Field id="x" label="X" hint="Some hint">
        <Input id="x" aria-describedby="extra" />
      </Field>,
    );
    const describedBy = screen.getByLabelText('X').getAttribute('aria-describedby');
    expect(describedBy).toContain('extra');
    expect(describedBy).toContain('x-hint');
  });

  it('Field keeps the control as its described child when a trailing action sits beside it', () => {
    render(
      <Field
        id="family"
        label="Family"
        error="Pick one"
        trailing={<button type="button">New family</button>}
      >
        <Input id="family" invalid />
      </Field>,
    );
    const input = screen.getByLabelText('Family');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Pick one');
    expect(screen.getByRole('button', { name: 'New family' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('Alert has role alert for errors and status otherwise', () => {
    render(
      <>
        <Alert tone="error">Nope</Alert>
        <Alert tone="success">Saved</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('Dialog opens as a modal and closes through its button', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Dialog closes once on a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('dialog', { name: 'Confirm' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Dialog does not close on a click inside its content', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Dialog does not re-invoke onClose when the parent reacts to a close by setting open=false', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <Dialog open={false} title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Dialog closes once when Escape reaches the browser and fires the native close event', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    fireEvent(screen.getByRole('dialog', { name: 'Confirm' }), new Event('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Dialog with closeDisabled ignores a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose} closeDisabled>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('Dialog with closeDisabled prevents the default on a cancel event (Escape)', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose} closeDisabled>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    const ok = fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(ok).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Dialog with closeDisabled reopens immediately if the browser closes it anyway, without calling onClose', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose} closeDisabled>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Confirm' }) as HTMLDialogElement;
    dialog.close();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('Table, Badge, PageHeader and EmptyState render their content', () => {
    render(
      <>
        <PageHeader title="Users" description="Everyone" actions={<Button>Invite</Button>} />
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th>
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td>Ada</Td>
            </Tr>
          </Tbody>
        </Table>
        <Badge tone="green">active</Badge>
        <EmptyState title="Nothing yet" description="Invite someone." />
      </>,
    );
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });
});

describe('RFC-13 R5 UI kit — workspace pattern additions', () => {
  it('Button: the small size is a distinct class set', () => {
    const { rerender } = render(<Button>Save</Button>);
    const large = screen.getByRole('button', { name: 'Save' }).className;
    rerender(<Button size="sm">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).not.toBe(large);
  });

  it('Select renders its options, reports changes and marks invalid', async () => {
    const onChange = vi.fn();
    render(
      <Field id="family" label="Family" error="Pick one">
        <Select id="family" invalid value="" onChange={onChange}>
          <option value="">Any</option>
          <option value="f1">Fabaceae</option>
        </Select>
      </Field>,
    );
    const select = screen.getByLabelText('Family');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Pick one');
    await userEvent.selectOptions(select, 'f1');
    expect(onChange).toHaveBeenCalled();
  });

  it('Section is a labelled region with its heading and description', () => {
    render(
      <Section id="profile" title="Profile" description="What curators see.">
        <p>Body</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'Profile' });
    expect(region).toContainElement(screen.getByText('What curators see.'));
    expect(region).toContainElement(screen.getByText('Body'));
    expect(screen.getByRole('heading', { name: 'Profile' })).toHaveAttribute(
      'id',
      'profile-heading',
    );
  });

  it('Th and Td keep the caller className next to their own', () => {
    render(
      <Table>
        <Thead>
          <Tr>
            <Th className="text-right">N</Th>
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td className="tabular-nums">1</Td>
          </Tr>
        </Tbody>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: 'N' }).className).toContain('text-right');
    expect(screen.getByRole('cell', { name: '1' }).className).toContain('tabular-nums');
  });

  it('Alert keeps its text as the accessible content next to a decorative icon', () => {
    render(<Alert tone="info">Heads up</Alert>);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Heads up');
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('RFC-13 R5 Select and Textarea', () => {
  it('Select renders a native select with its options and the invalid state', () => {
    render(
      <Select aria-label="Level" invalid>
        <option value="a">a</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Level' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('option', { name: 'a' })).toBeInTheDocument();
  });

  it('Textarea renders a textarea and forwards attributes', () => {
    render(<Textarea aria-label="Note" maxLength={2000} />);
    const area = screen.getByRole('textbox', { name: 'Note' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAttribute('maxlength', '2000');
    expect(area).not.toHaveAttribute('aria-invalid');
  });
});

describe('RFC-13 R10 ConfirmDialog', () => {
  it('shows title, message and error; confirm calls back; pending disables both buttons', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        title="Suspend Bea?"
        message="Bea loses access at once."
        confirmLabel="Suspend"
        danger
        pending={false}
        error="Nope."
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Suspend Bea?' });
    expect(within(dialog).getByText('Bea loses access at once.')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Nope.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <ConfirmDialog
        title="Suspend Bea?"
        message="Bea loses access at once."
        confirmLabel="Suspend"
        danger
        pending
        error={null}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeDisabled();
  });
});
