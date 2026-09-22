# Shared Layouts

Reusable layout components for the Orgii application.

## Components

### AppLayout

The main application shell used by all routes under `/orgii/*`. Provides:

- Global application chrome
- Dynamic sidebar slot
- Floating sidebar (hover-triggered when collapsed)
- Built-in chat panel (for session/editor views)
- Global modals

```tsx
import { AppLayout } from "@src/scaffold/AppLayout";

<AppLayout
  sidebar={<MySidebar />}
  floatingSidebar={<MyFloatingSidebar />}
  viewportWidth={viewportWidth}
  chatPosition="right"
>
  {children}
</AppLayout>;
```

### SplitViewLayout

Two-panel layout with resizable left panel. Used for list/detail views like Settings, Inbox, Usage pages.

```tsx
import SplitViewLayout from "@src/scaffold/layouts/SplitViewLayout";

<SplitViewLayout
  listContent={<ItemList />}
  mainContent={<ItemDetail />}
  listWidth={320}
/>;
```

### GlobalModals

Renders app-wide modals (ComponentIssue). Used internally by AppLayout.

## Pages NOT Using These Layouts

| Route          | Component | Reason                  |
| -------------- | --------- | ----------------------- |
| `/orgii/login` | LoginPage | Custom auth design      |
| `/error-page`  | ErrorPage | Must work independently |

## Architecture

```
AppShell (src/modules/index.tsx)
└── AppLayout
    ├── Application chrome
    ├── HoverSidebar.Trigger
    ├── Sidebar slot (dynamic per route)
    ├── FloatingSidebar (hover container)
    ├── Main content (CSS-contained)
    │   ├── Content (via Outlet)
    │   └── ChatPanel (session/editor)
    └── GlobalModals
```
