# Accessibility, modals, keyboard menus, and mobile layout

## Modal dialogs: async dismissal guard, focus restoration, and WAI-ARIA

Whenever you build or update a modal dialog or drawer that performs an asynchronous action (such as
submitting a form or saving a record):

1. **Guard all dismissal paths while an async operation is in flight.** Track `isSubmitting` (or
   `isPending`) state during the async call, and block `onOpenChange(false)`, backdrop clicks, the
   `Escape` key handler, and Cancel/close buttons whenever `isSubmitting` is `true`. Allowing a
   modal to unmount while a mutation is in flight swallows rejected promises, hides the inline
   error banner the user needs to see, and invites duplicate submissions.
2. **Capture and restore focus via `document.activeElement`.** When `open` transitions to `true`,
   record `document.activeElement as HTMLElement | null` in a `useRef`. When the modal closes (or in
   the `useEffect` cleanup when `open` becomes `false`), call `previousFocusRef.current?.focus()` so
   keyboard users return to the trigger button that opened the dialog.
3. **Declare `role="dialog"`, `aria-modal="true"`, and an accessible name** (`aria-labelledby`
   pointing to the heading ID, or `aria-label`) on the dialog container element.
4. **Set `type="button"` on every Cancel, close, or menu trigger button inside a `<form>`** so
   activating it never triggers form submission.

```tsx
const [isSubmitting, setIsSubmitting] = useState(false);
const [error, setError] = useState<string | null>(null);
const previousFocusRef = useRef<HTMLElement | null>(null);

const handleClose = () => {
  if (isSubmitting) return;
  onOpenChange(false);
};

useEffect(() => {
  if (!open) return;
  previousFocusRef.current = document.activeElement as HTMLElement | null;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !isSubmitting) {
      onOpenChange(false);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    previousFocusRef.current?.focus();
  };
}, [open, isSubmitting, onOpenChange]);
```

## Dropdown and menu arrow-key navigation: handle `currentIndex === -1`

When implementing `ArrowDown` and `ArrowUp` keyboard navigation across a list of menu item refs
(`role="menu"` / `role="menuitem"`), focus often starts on the trigger button when the menu first
opens, meaning `optionRefs.current.indexOf(document.activeElement as HTMLButtonElement)` is `-1`.

Never rely on bare modulo arithmetic `((currentIndex - 1 + length) % length)` when `currentIndex`
can be `-1`—for `-1`, `(-1 - 1 + length) % length` lands on `length - 2` instead of the last item!
**Always branch explicitly on `currentIndex === -1`** so `ArrowDown` focuses index `0` and
`ArrowUp` focuses `items.length - 1`:

```tsx
const handleMenuKeyDown = (event: React.KeyboardEvent) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (!menuOpen) {
    setMenuOpen(true);
    return;
  }
  const buttons = optionRefs.current.filter((el): el is HTMLButtonElement => el !== null);
  if (buttons.length === 0) return;

  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex =
    currentIndex === -1
      ? event.key === 'ArrowDown'
        ? 0
        : buttons.length - 1
      : event.key === 'ArrowDown'
        ? (currentIndex + 1) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;

  buttons[nextIndex]?.focus();
};
```

## Mobile-responsive layout shells and component decomposition

Whenever you update an application shell, sidebar layout, or multi-section component:

1. **Use `h-dvh` (or `h-full`) instead of `h-screen`.** On mobile browsers, `h-screen` (`100vh`)
   ignores dynamic address and navigation bars and clips bottom content. Replace `h-screen` with
   `h-dvh` on full-viewport shells.
2. **Collapse sidebars on mobile with `hidden md:flex` and a `md:hidden` overlay drawer.** Show the
   persistent sidebar only on `md+` (`hidden md:flex`), and render a toggleable mobile drawer
   overlay (`md:hidden`) controlled by boolean state in the shell. Close the mobile drawer whenever
   a navigation item is clicked (`setMobileDrawerOpen(false)`), set `aria-expanded={mobileDrawerOpen}`
   and an `aria-label` on the header toggle button, and mark the active navigation item with
   `aria-current={isActive ? 'page' : undefined}`.
3. **Never define a component function inside another component's body.** Defining a helper
   component inside a parent component creates a brand-new component type on every render,
   unmounting its DOM and losing focus and state. Move all helper components to the module top
   level and pass props explicitly.
4. **Decompose JSX section-divider comments (`{/* === ... === */}`) into top-level sub-components.**
   Section banner comments inside JSX (`{/* === Top Header Bar === */}`,
   `{/* === Left Navigation Sidebar === */}`, `{/* === Main Content Area === */}`) signal that one
   component is doing too many jobs. Whenever you edit a component that contains JSX
   section-divider comments, **delete the section-divider comments and extract those JSX blocks
   into named top-level sub-components** in the same file (or separate files if large):

```tsx
// Good: top-level sub-components, no JSX section-divider comments, h-dvh shell
function SidebarNavLink({ item, isActive, onSelect }: SidebarNavLinkProps) {
  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onSelect(item.id)}
      className={isActive ? 'bg-slate-900 text-white' : 'text-slate-700'}
    >
      {item.label}
    </button>
  );
}

function DashboardHeader({ title, isMenuOpen, onToggleMenu }: DashboardHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-4">
      <h1 className="text-base font-semibold">{title}</h1>
      <button
        type="button"
        aria-label="Toggle navigation menu"
        aria-expanded={isMenuOpen}
        onClick={onToggleMenu}
        className="md:hidden"
      >
        Menu
      </button>
    </header>
  );
}
```

## Interactive control semantics

- **Inputs and icon buttons**: every `<input>` and `<select>` needs an associated `<label>` or
  `aria-label` (never rely on `placeholder` alone); icon-only buttons require `aria-label`.
- **Composite rows and cards**: if a container row handles `onKeyDown` for `Enter` / `Space`, guard
  it with `if (e.target !== e.currentTarget) return;` so keypresses on nested buttons or checkboxes
  do not bubble up and trigger row activation. Never put `role="button"` on a `<tr>`; use
  `aria-selected={isActive}` instead.
