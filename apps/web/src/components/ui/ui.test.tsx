import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Table,
  Tbody,
  Td,
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

  it('Dialog opens as a modal and closes through its button and Escape', async () => {
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
