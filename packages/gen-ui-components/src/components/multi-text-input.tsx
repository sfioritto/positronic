import { useState } from 'react';
import { useBoundProp, type BaseComponentProps } from '@json-render/react';
import type { MultiTextInputProps } from '../catalog.js';

const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
const buttonClass =
  'inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground';

/**
 * A list of text inputs the user can grow and shrink. The bound value is the
 * array of entries; the submit handler appends each one separately.
 */
export function MultiTextInput({
  props,
  bindings,
}: BaseComponentProps<MultiTextInputProps>) {
  const [bound, setBound] = useBoundProp<string[]>(
    props.value ?? undefined,
    bindings?.value
  );
  const [local, setLocal] = useState<string[]>([]);
  const isBound = !!bindings?.value;
  const items = (isBound ? bound : local) ?? [];
  const setItems = isBound ? setBound : setLocal;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{props.label}</label>
      {items.map((item, index) => (
        <div key={index} className="flex gap-2">
          <input
            type="text"
            name={props.name}
            className={inputClass}
            placeholder={props.placeholder ?? ''}
            value={item}
            onChange={(event) =>
              setItems(
                items.map((existing, i) =>
                  i === index ? event.target.value : existing
                )
              )
            }
          />
          <button
            type="button"
            aria-label="Remove"
            className={buttonClass}
            onClick={() => setItems(items.filter((existing, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass}
        onClick={() => setItems([...items, ''])}
      >
        {props.addLabel ?? 'Add'}
      </button>
    </div>
  );
}
