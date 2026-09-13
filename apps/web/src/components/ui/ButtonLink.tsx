import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { type ButtonSize, type ButtonVariant, buttonClassName } from './Button.tsx';

export interface ButtonLinkProps {
  to: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
}

/**
 * A router `Link` dressed as a `Button`: navigation that sits among actions
 * (a "Manage levels" link next to a "Map" button) without being a button.
 * @rfc RFC-13 R5
 */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonLinkProps) {
  return <Link {...rest} className={`${buttonClassName({ variant, size })} ${className}`} />;
}
