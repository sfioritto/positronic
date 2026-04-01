// Utility
export { cn } from './lib/utils.js';

// Components
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './components/ui/accordion.js';

export {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from './components/ui/alert.js';

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
} from './components/ui/avatar.js';

export { Badge, badgeVariants } from './components/ui/badge.js';

export { Button, buttonVariants } from './components/ui/button.js';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from './components/ui/card.js';

export { Checkbox } from './components/ui/checkbox.js';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog.js';

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from './components/ui/empty.js';

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
} from './components/ui/field.js';

export { Input } from './components/ui/input.js';

export { Label } from './components/ui/label.js';

export { Progress } from './components/ui/progress.js';

export { RadioGroup, RadioGroupItem } from './components/ui/radio-group.js';

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/ui/select.js';

export { Separator } from './components/ui/separator.js';

export { Skeleton } from './components/ui/skeleton.js';

export { Slider } from './components/ui/slider.js';

export { Toaster } from './components/ui/sonner.js';

export { Spinner } from './components/ui/spinner.js';

export { Switch } from './components/ui/switch.js';

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './components/ui/table.js';

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  tabsListVariants,
} from './components/ui/tabs.js';

export { Textarea } from './components/ui/textarea.js';

export { Toggle, toggleVariants } from './components/ui/toggle.js';

export { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group.js';

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './components/ui/tooltip.js';

// Design system document for LLM system prompts
export { DESIGN_SYSTEM_DOC, buildDesignSystemDoc } from './design-system.js';

// shadcn skill docs for LLM system prompts
export {
  SHADCN_SKILL,
  SHADCN_RULES_STYLING,
  SHADCN_RULES_COMPOSITION,
  SHADCN_RULES_FORMS,
  SHADCN_RULES_ICONS,
  SHADCN_CUSTOMIZATION,
  ALL_SKILL_DOCS,
} from './skills-generated.js';
