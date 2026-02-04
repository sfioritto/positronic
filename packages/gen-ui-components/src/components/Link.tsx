import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

const LinkPropsSchema = z.object({
  href: z.string().describe('URL to navigate to (absolute or relative)'),
  label: z.string().describe('Text displayed in the link'),
  variant: z
    .enum(['default', 'muted'])
    .optional()
    .describe('Visual style - default (blue underline), muted (subtle gray)'),
  external: z
    .boolean()
    .optional()
    .describe('If true, opens in new tab and adds security attributes (noopener, noreferrer)'),
});

export type LinkProps = z.infer<typeof LinkPropsSchema>;

const variantClasses = {
  default: 'text-blue-600 hover:text-blue-800 underline hover:no-underline',
  muted: 'text-gray-500 hover:text-gray-700 underline',
};

const LinkComponent = ({
  href,
  label,
  variant = 'default',
  external = false,
}: LinkProps) => (
  <a
    href={href}
    className={`transition-colors ${variantClasses[variant]}`}
    {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
  >
    {label}
  </a>
);

export const Link: UIComponent<LinkProps> = {
  component: LinkComponent,
  description: `A hyperlink for navigation. Use for linking to external resources, documentation, or other pages. Set external=true for links that should open in a new tab (automatically adds security attributes). Use variant="muted" for less prominent links.`,
  propsSchema: LinkPropsSchema,
};
