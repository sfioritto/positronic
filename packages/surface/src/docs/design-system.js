"use strict";
const {Fragment: _Fragment, jsx: _jsx, jsxs: _jsxs} = arguments[0];
function _createMdxContent(props) {
  const _components = {
    code: "code",
    h1: "h1",
    h2: "h2",
    h3: "h3",
    li: "li",
    ol: "ol",
    p: "p",
    pre: "pre",
    strong: "strong",
    ul: "ul",
    ...props.components
  };
  return _jsxs(_Fragment, {
    children: [_jsx(_components.h1, {
      children: "Surface Design System"
    }), "\n", _jsxs(_components.p, {
      children: ["You are generating a React component using shadcn/ui components and Tailwind CSS.\nThe component receives a typed ", _jsx(_components.code, {
        children: "data"
      }), " prop — use it to display dynamic content."]
    }), "\n", _jsx(_components.h2, {
      children: "Available Components"
    }), "\n", _jsx(_components.h3, {
      children: "Layout"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Card"
        }), " (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Tabs"
        }), " (Tabs, TabsList, TabsTrigger, TabsContent)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Accordion"
        }), " (Accordion, AccordionItem, AccordionTrigger, AccordionContent)"]
      }), "\n", _jsx(_components.li, {
        children: _jsx(_components.strong, {
          children: "Separator"
        })
      }), "\n"]
    }), "\n", _jsx(_components.h3, {
      children: "Data Display"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Table"
        }), " (Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption, TableFooter)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Badge"
        }), " — Status indicators, tags, labels"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Avatar"
        }), " (Avatar, AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Progress"
        }), " — Visual progress indicator (0-100)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Skeleton"
        }), " — Loading placeholders"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Empty"
        }), " (Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia)"]
      }), "\n"]
    }), "\n", _jsx(_components.h3, {
      children: "Forms"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Button"
        }), " — Variants: default, destructive, outline, secondary, ghost, link. Sizes: default, sm, lg, icon"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Input"
        }), " — Text input fields"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Label"
        }), " — Form field labels"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Textarea"
        }), " — Multi-line text input"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Select"
        }), " (Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Checkbox"
        }), " — Boolean toggle"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "RadioGroup"
        }), " (RadioGroup, RadioGroupItem) — Single selection from options"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Switch"
        }), " — Binary toggle"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Slider"
        }), " — Range input"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Toggle"
        }), " — Pressable toggle button"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "ToggleGroup"
        }), " (ToggleGroup, ToggleGroupItem) — Toggle between 2-5 options"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Field"
        }), " (FieldGroup, Field, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend) — Form layout"]
      }), "\n"]
    }), "\n", _jsx(_components.h3, {
      children: "Feedback"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Alert"
        }), " (Alert, AlertTitle, AlertDescription, AlertAction) — Inline messages. Variants: default, destructive"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Dialog"
        }), " (Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Tooltip"
        }), " (Tooltip, TooltipTrigger, TooltipContent)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Toaster"
        }), " — Toast notifications (from sonner)"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.strong, {
          children: "Spinner"
        }), " — Loading indicator"]
      }), "\n"]
    }), "\n", _jsx(_components.h2, {
      children: "Critical Rules"
    }), "\n", _jsx(_components.h3, {
      children: "Styling"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: ["Use semantic colors: ", _jsx(_components.code, {
          children: "bg-primary"
        }), ", ", _jsx(_components.code, {
          children: "text-muted-foreground"
        }), " — never raw values like ", _jsx(_components.code, {
          children: "bg-blue-500"
        })]
      }), "\n", _jsxs(_components.li, {
        children: ["Use built-in variants before custom styles: ", _jsx(_components.code, {
          children: "variant=\"outline\""
        }), ", ", _jsx(_components.code, {
          children: "size=\"sm\""
        })]
      }), "\n", _jsxs(_components.li, {
        children: ["Use ", _jsx(_components.code, {
          children: "className"
        }), " for layout (margins, width), not for overriding component colors"]
      }), "\n", _jsxs(_components.li, {
        children: ["Use ", _jsx(_components.code, {
          children: "gap-*"
        }), " not ", _jsx(_components.code, {
          children: "space-y-*"
        }), ". Use ", _jsx(_components.code, {
          children: "flex flex-col gap-4"
        }), " instead of ", _jsx(_components.code, {
          children: "space-y-4"
        })]
      }), "\n", _jsxs(_components.li, {
        children: ["Use ", _jsx(_components.code, {
          children: "size-*"
        }), " when width and height are equal: ", _jsx(_components.code, {
          children: "size-10"
        }), " not ", _jsx(_components.code, {
          children: "w-10 h-10"
        })]
      }), "\n", _jsxs(_components.li, {
        children: ["Use ", _jsx(_components.code, {
          children: "cn()"
        }), " for conditional classes"]
      }), "\n", _jsxs(_components.li, {
        children: ["No manual ", _jsx(_components.code, {
          children: "dark:"
        }), " color overrides — semantic tokens handle light/dark"]
      }), "\n"]
    }), "\n", _jsx(_components.h3, {
      children: "Forms"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: ["Use ", _jsx(_components.code, {
          children: "FieldGroup"
        }), " + ", _jsx(_components.code, {
          children: "Field"
        }), " for form layout, not raw divs"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.code, {
          children: "ToggleGroup"
        }), " for option sets (2-7 choices), not manually styled buttons"]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.code, {
          children: "FieldSet"
        }), " + ", _jsx(_components.code, {
          children: "FieldLegend"
        }), " for grouping related checkboxes/radios"]
      }), "\n"]
    }), "\n", _jsx(_components.h3, {
      children: "Component Composition"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: ["Items always inside their Group: ", _jsx(_components.code, {
          children: "SelectItem"
        }), " inside ", _jsx(_components.code, {
          children: "SelectGroup"
        })]
      }), "\n", _jsxs(_components.li, {
        children: ["Dialog always needs a ", _jsx(_components.code, {
          children: "DialogTitle"
        }), " (use ", _jsx(_components.code, {
          children: "className=\"sr-only\""
        }), " if hidden)"]
      }), "\n", _jsxs(_components.li, {
        children: ["Use full Card composition: ", _jsx(_components.code, {
          children: "CardHeader"
        }), "/", _jsx(_components.code, {
          children: "CardTitle"
        }), "/", _jsx(_components.code, {
          children: "CardContent"
        }), "/", _jsx(_components.code, {
          children: "CardFooter"
        })]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.code, {
          children: "TabsTrigger"
        }), " must be inside ", _jsx(_components.code, {
          children: "TabsList"
        })]
      }), "\n", _jsxs(_components.li, {
        children: [_jsx(_components.code, {
          children: "Avatar"
        }), " always needs ", _jsx(_components.code, {
          children: "AvatarFallback"
        })]
      }), "\n", _jsxs(_components.li, {
        children: ["Use ", _jsx(_components.code, {
          children: "Alert"
        }), " for callouts, ", _jsx(_components.code, {
          children: "Empty"
        }), " for empty states, ", _jsx(_components.code, {
          children: "Skeleton"
        }), " for loading, ", _jsx(_components.code, {
          children: "Badge"
        }), " for status"]
      }), "\n"]
    }), "\n", _jsx(_components.h3, {
      children: "Icons"
    }), "\n", _jsxs(_components.ul, {
      children: ["\n", _jsxs(_components.li, {
        children: ["Icons in Button use ", _jsx(_components.code, {
          children: "data-icon"
        })]
      }), "\n", _jsx(_components.li, {
        children: "No sizing classes on icons inside components — components handle icon sizing via CSS"
      }), "\n"]
    }), "\n", _jsx(_components.h2, {
      children: "Component Import"
    }), "\n", _jsxs(_components.p, {
      children: ["All components are available from ", _jsx(_components.code, {
        children: "__IMPORT_PATH__"
      }), ":"]
    }), "\n", _jsx(_components.pre, {
      children: _jsx(_components.code, {
        className: "language-tsx",
        children: "import {\n  Card,\n  CardHeader,\n  CardTitle,\n  CardContent,\n  Button,\n  Badge,\n} from '__IMPORT_PATH__';\n"
      })
    }), "\n", _jsxs(_components.p, {
      children: ["Icons are available from ", _jsx(_components.code, {
        children: "lucide-react"
      }), ":"]
    }), "\n", _jsx(_components.pre, {
      children: _jsx(_components.code, {
        className: "language-tsx",
        children: "import { ArrowRight, Check, X, MoreHorizontal } from 'lucide-react';\n"
      })
    }), "\n", _jsx(_components.h2, {
      children: "Component Structure"
    }), "\n", _jsx(_components.p, {
      children: "Your component must:"
    }), "\n", _jsxs(_components.ol, {
      children: ["\n", _jsxs(_components.li, {
        children: ["Accept a ", _jsx(_components.code, {
          children: "data"
        }), " prop with the provided TypeScript interface"]
      }), "\n", _jsx(_components.li, {
        children: "Export a default function component"
      }), "\n", _jsx(_components.li, {
        children: "Return a single root element"
      }), "\n"]
    }), "\n", _jsx(_components.pre, {
      children: _jsx(_components.code, {
        className: "language-tsx",
        children: "interface Props {\n  data: DataType;\n}\n\nexport default function Page({ data }: Props) {\n  return <div className=\"container mx-auto p-6\">{/* Your UI here */}</div>;\n}\n"
      })
    })]
  });
}
function MDXContent(props = {}) {
  const {wrapper: MDXLayout} = props.components || ({});
  return MDXLayout ? _jsx(MDXLayout, {
    ...props,
    children: _jsx(_createMdxContent, {
      ...props
    })
  }) : _createMdxContent(props);
}
return {
  default: MDXContent
};
