/**
 * Browser entry for generated pages.
 *
 * The dev server bundles this file (with React inside) into
 * .positronic/dist/components.js and uploads it to R2, where pages load it
 * as /bundle/components.js. Run `npm run build:components` to build it by
 * hand.
 */
import { mount } from '@positronic/gen-ui-components';
import { catalog } from '../src/components/index.js';
import { pageComponents } from '../src/components/browser.js';

mount(document.getElementById('root')!, { catalog, components: pageComponents });
