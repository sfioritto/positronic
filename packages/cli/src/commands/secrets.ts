import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { SecretsCreate } from '../components/secrets-create.js';
import { SecretsList } from '../components/secrets-list.js';
import { SecretsDelete } from '../components/secrets-delete.js';
import { SecretsBulk } from '../components/secrets-bulk.js';

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

export class SecretsCommand {
  list(): React.ReactElement {
    return React.createElement(SecretsList);
  }

  create({
    name,
    value,
  }: ArgumentsCamelCase<SecretCreateArgs>): React.ReactElement {
    return React.createElement(SecretsCreate, {
      name,
      value,
    });
  }

  delete({ name }: ArgumentsCamelCase<SecretDeleteArgs>): React.ReactElement {
    return React.createElement(SecretsDelete, { name });
  }

  bulk({ file }: ArgumentsCamelCase<SecretBulkArgs>): React.ReactElement {
    return React.createElement(SecretsBulk, { file });
  }
}
