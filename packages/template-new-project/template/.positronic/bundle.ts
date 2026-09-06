/**
 * Browser entry for generated pages. Built by ./vite.config.mjs into
 * .positronic/dist/components.js (this file, React included) and
 * .positronic/dist/components.css (the stylesheet import below).
 */
import './styles.css';
import { mount } from '@positronic/gen-ui-components';
import { catalog } from '../src/components/index.js';
import { pageComponents } from '../src/components/browser.js';

mount(document.getElementById('root')!, { catalog, components: pageComponents });
