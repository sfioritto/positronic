import type { UIComponent } from '@positronic/core';
import type { ReactNode } from 'react';
import { z } from 'zod';

const FormPropsSchema = z.object({
  action: z.string().optional().describe('Form submission URL'),
});

export type FormProps = z.infer<typeof FormPropsSchema> & {
  children?: ReactNode;
};

const FormComponent = ({ children, action }: FormProps) => (
  <form className="flex flex-col gap-6" method="POST" action={action}>
    {children}
  </form>
);

export const Form: UIComponent<FormProps> = {
  component: FormComponent,
  description: `A form container that wraps form fields. Place Input, TextArea, Checkbox, Select, and Button components inside. Always include a Button with type="submit" for form submission.`,
  propsSchema: FormPropsSchema,
};
