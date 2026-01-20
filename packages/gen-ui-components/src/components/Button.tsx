import type { UIComponent } from '@positronic/core';
import { z } from 'zod';

export interface ButtonProps {
  label: string;
  type?: 'submit' | 'button';
  variant?: 'primary' | 'secondary' | 'danger';
}

const variantClasses = {
  primary: 'bg-blue-500 text-white hover:bg-blue-600',
  secondary: 'bg-gray-200 text-gray-700 hover:bg-gray-300',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

const ButtonComponent = ({
  label,
  type = 'button',
  variant = 'primary',
}: ButtonProps) => (
  <button type={type} className={`px-4 py-2 font-medium rounded-md transition-colors ${variantClasses[variant]}`}>
    {label}
  </button>
);

export const Button: UIComponent<ButtonProps> = {
  component: ButtonComponent,
  tool: {
    description: `A clickable button. Use type="submit" for form submission buttons. Use variants to indicate importance: primary for main actions, secondary for alternatives, danger for destructive actions.`,
    parameters: z.object({
      label: z.string().describe('Text displayed on the button'),
      type: z
        .enum(['submit', 'button'])
        .optional()
        .describe('Button type - submit for form submission, button for other actions'),
      variant: z
        .enum(['primary', 'secondary', 'danger'])
        .optional()
        .describe('Visual style - primary (main action), secondary (alternative), danger (destructive)'),
    }),
  },
};
