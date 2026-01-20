import type { UIComponent } from '@positronic/core';
import type { ReactNode } from 'react';
import { z } from 'zod';

export interface FormProps {
  children?: ReactNode;
  action?: string;
}

const FormComponent = ({ children, action }: FormProps) => (
  <form className="flex flex-col gap-6" method="POST" action={action}>
    {children}
  </form>
);

export const Form: UIComponent<FormProps> = {
  component: FormComponent,
  tool: {
    description: `A form container that wraps form fields. Place Input, TextArea, Checkbox, Select, and Button components inside. Always include a Button with type="submit" for form submission.`,
    parameters: z.object({}),
  },
};
