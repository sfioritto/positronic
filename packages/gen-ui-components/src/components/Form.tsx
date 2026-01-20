import type { UIComponent } from '@positronic/core';
import type { ReactNode } from 'react';
import { z } from 'zod';

export interface FormProps {
  children?: ReactNode;
  submitLabel?: string;
  action?: string;
}

const FormComponent = ({ children, submitLabel = 'Submit', action }: FormProps) => (
  <form className="flex flex-col gap-6" method="POST" action={action}>
    {children}
    <div className="mt-4 flex gap-3">
      <button type="submit" className="px-4 py-2 bg-blue-500 text-white font-medium rounded-md hover:bg-blue-600 transition-colors">
        {submitLabel}
      </button>
    </div>
  </form>
);

export const Form: UIComponent<FormProps> = {
  component: FormComponent,
  tool: {
    description: `A form container that wraps form fields and provides a submit button. Place Input, TextArea, Checkbox, Select, and other form fields inside. The form will POST data when submitted.`,
    parameters: z.object({
      submitLabel: z
        .string()
        .optional()
        .describe('Text for the submit button, defaults to "Submit"'),
    }),
  },
};
