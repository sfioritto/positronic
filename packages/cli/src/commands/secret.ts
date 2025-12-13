import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { SecretCreate } from '../components/secret-create.js';
import { SecretList } from '../components/secret-list.js';
import { SecretDelete } from '../components/secret-delete.js';
import { SecretBulk } from '../components/secret-bulk.js';

interface SecretCreateArgs {
  name: string;
  value?: string;
}

interface SecretDeleteArgs {
  name: string;
}

interface SecretBulkArgs {
  file?: string;
}

export class SecretCommand {
  list(): React.ReactElement {
    return React.createElement(SecretList);
  }

  create({
    name,
    value,
  }: ArgumentsCamelCase<SecretCreateArgs>): React.ReactElement {
    return React.createElement(SecretCreate, {
      name,
      value,
    });
  }

  delete({ name }: ArgumentsCamelCase<SecretDeleteArgs>): React.ReactElement {
    return React.createElement(SecretDelete, { name });
  }

  bulk({ file }: ArgumentsCamelCase<SecretBulkArgs>): React.ReactElement {
    return React.createElement(SecretBulk, { file });
  }
}
