import * as React from 'react';

import { cn } from '../lib/utils.js';

type FormConfig = {
  action: string;
  method: string;
  token?: string;
};

function readFormConfig(): FormConfig | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __POSITRONIC_FORM_CONFIG__?: FormConfig })
    .__POSITRONIC_FORM_CONFIG__;
}

function Form({ className, children, ...props }: React.ComponentProps<'form'>) {
  const config = readFormConfig();
  const action = config?.action ?? props.action;
  const method = config?.method ?? props.method ?? 'POST';

  return (
    <form
      data-slot="form"
      className={cn(className)}
      {...props}
      action={action}
      method={method}
    >
      {config?.token ? (
        <input type="hidden" name="__token" value={config.token} />
      ) : null}
      {children}
    </form>
  );
}

export { Form };
