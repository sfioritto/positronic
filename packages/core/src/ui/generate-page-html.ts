import type { Placement } from './types.js';

/**
 * Options for generating the page HTML.
 */
export interface GeneratePageHtmlOptions {
  /** The placements array representing the component tree */
  placements: Placement[];
  /** The ID of the root placement */
  rootId: string;
  /** Data to be passed to components for data binding resolution */
  data: Record<string, unknown>;
  /** The component bundle JavaScript (contents of dist/components.js) */
  componentBundle: string;
  /** Page title */
  title?: string;
  /** Form action URL for form submission */
  formAction?: string;
}

/**
 * Bootstrap runtime that builds and renders the React tree from placements.
 * This is inlined into the generated page.
 */
const bootstrapRuntime = `
(function() {
  const components = window.PositronicComponents;
  const data = window.__POSITRONIC_DATA__;
  const tree = window.__POSITRONIC_TREE__;
  const rootId = window.__POSITRONIC_ROOT__;
  const formAction = window.__POSITRONIC_FORM_ACTION__;

  if (!components) {
    console.error('PositronicComponents not loaded');
    return;
  }

  /**
   * Resolve a binding path against a data context.
   * e.g., "email.subject" against { email: { subject: "Hello" } } -> "Hello"
   */
  function resolveBinding(path, ctx) {
    return path.split('.').reduce(function(obj, key) {
      return obj && obj[key];
    }, ctx);
  }

  /**
   * Resolve a prop value - either return the literal or look up the binding.
   */
  function resolveProp(value, ctx) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      var path = value.slice(2, -2).trim();
      return resolveBinding(path, ctx);
    }
    return value;
  }

  /**
   * Build a React element from a placement.
   */
  function buildElement(placementId, ctx) {
    var placement = tree.find(function(p) { return p.id === placementId; });
    if (!placement) {
      console.error('Placement not found:', placementId);
      return null;
    }

    var Component = components[placement.component];
    if (!Component) {
      console.error('Component not found:', placement.component);
      return null;
    }

    // Resolve props
    var props = {};
    for (var key in placement.props) {
      props[key] = resolveProp(placement.props[key], ctx);
    }

    // Handle List component specially - it creates a loop context
    if (placement.component === 'List') {
      var items = props.items || [];
      var itemVarName = props.as || 'item';

      // Find direct children of this List
      var childIds = tree
        .filter(function(p) { return p.parentId === placementId; })
        .map(function(p) { return p.id; });

      var listItems = items.map(function(item, index) {
        // Create new context with loop variable
        var itemCtx = Object.assign({}, ctx);
        itemCtx[itemVarName] = item;
        itemCtx[itemVarName + 'Index'] = index;

        var children = childIds.map(function(childId) {
          return buildElement(childId, itemCtx);
        });

        return React.createElement('div', { key: index, className: 'list-item' }, children);
      });

      return React.createElement('div', { className: 'list' }, listItems);
    }

    // Handle Form component - inject action URL
    if (placement.component === 'Form' && formAction) {
      props.action = formAction;
    }

    // Find direct children
    var childIds = tree
      .filter(function(p) { return p.parentId === placementId; })
      .map(function(p) { return p.id; });

    var children = childIds.map(function(childId) {
      return buildElement(childId, ctx);
    });

    return React.createElement(Component, props, children.length > 0 ? children : undefined);
  }

  // Render the tree
  var root = document.getElementById('root');
  if (root && rootId) {
    var element = buildElement(rootId, data);
    ReactDOM.render(element, root);
  }
})();
`;

/**
 * Generate a complete HTML page from placements.
 *
 * The generated page includes:
 * - React and ReactDOM from CDN
 * - Tailwind CSS from CDN
 * - The pre-bundled component library
 * - Data and placements embedded as JSON
 * - Bootstrap runtime that builds and renders the React tree
 *
 * @example
 * ```typescript
 * const html = generatePageHtml({
 *   placements: result.placements,
 *   rootId: result.rootId,
 *   data: brainState,
 *   componentBundle: fs.readFileSync('dist/components.js', 'utf-8'),
 *   title: 'My Generated Page',
 *   formAction: '/api/submit',
 * });
 * ```
 */
export function generatePageHtml(options: GeneratePageHtmlOptions): string {
  const {
    placements,
    rootId,
    data,
    componentBundle,
    title = 'Generated Page',
    formAction,
  } = options;

  // Escape for embedding in HTML
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // Serialize data safely for embedding in script tag
  const safeJsonStringify = (obj: unknown) =>
    JSON.stringify(obj)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="root" class="max-w-4xl mx-auto p-6"></div>

  <!-- Pre-bundled components -->
  <script>
${componentBundle}
  </script>

  <!-- Data and placements -->
  <script>
    window.__POSITRONIC_DATA__ = ${safeJsonStringify(data)};
    window.__POSITRONIC_TREE__ = ${safeJsonStringify(placements)};
    window.__POSITRONIC_ROOT__ = ${safeJsonStringify(rootId)};
    window.__POSITRONIC_FORM_ACTION__ = ${formAction ? safeJsonStringify(formAction) : 'null'};
  </script>

  <!-- Bootstrap runtime -->
  <script>
${bootstrapRuntime}
  </script>
</body>
</html>`;
}
