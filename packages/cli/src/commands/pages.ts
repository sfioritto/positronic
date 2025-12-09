import type { ArgumentsCamelCase } from 'yargs';
import React from 'react';
import { PagesList } from '../components/pages-list.js';
import { PageDelete } from '../components/page-delete.js';

interface PagesListArgs {
  // No args needed for list
}

interface PageDeleteArgs {
  slug: string;
  force: boolean;
}

export class PagesCommand {
  constructor() {}

  list(_args: ArgumentsCamelCase<PagesListArgs>): React.ReactElement {
    return React.createElement(PagesList, {});
  }

  delete({ slug, force }: ArgumentsCamelCase<PageDeleteArgs>): React.ReactElement {
    return React.createElement(PageDelete, {
      slug,
      force,
    });
  }
}
