import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { useComposedRef } from './compose-refs';
import { cx } from './cx';
import { tabId, tabPanelId } from './tab-ids';
import styles from './Tabs.module.css';

export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsActivationMode = 'automatic' | 'manual';

interface TabsContextValue {
  value: string;
  select: (value: string) => void;
  baseId: string;
  orientation: TabsOrientation;
  activationMode: TabsActivationMode;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error(`<${component}> must be rendered inside <Tabs>.`);
  }
  return context;
}

export interface TabsBaseProps extends Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue'> {
  orientation?: TabsOrientation;
  /**
   * `automatic` (default, and what APG recommends for cheap panels) selects
   * on arrow-key focus. `manual` moves focus only; Enter/Space selects.
   */
  activationMode?: TabsActivationMode;
  children?: ReactNode;
}

/**
 * Either controlled (`value` + `onValueChange`) or uncontrolled
 * (`defaultValue`). One is required: a tablist with no selected tab has no
 * valid roving-tabindex entry point.
 */
export type TabsProps = TabsBaseProps &
  (
    | { value: string; onValueChange: (value: string) => void; defaultValue?: undefined }
    | { defaultValue: string; value?: undefined; onValueChange?: (value: string) => void }
  );

type ResolvedTabsProps = TabsBaseProps & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(props, ref) {
  const {
    value,
    defaultValue,
    onValueChange,
    orientation = 'horizontal',
    activationMode = 'automatic',
    className,
    children,
    ...rest
  } = props as ResolvedTabsProps;

  const baseId = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const currentValue = value !== undefined ? value : uncontrolledValue;

  const select = useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const contextValue = useMemo<TabsContextValue>(
    () => ({ value: currentValue, select, baseId, orientation, activationMode }),
    [activationMode, baseId, currentValue, orientation, select],
  );

  return (
    <div ref={ref} {...rest} className={cx(styles.tabs, className)}>
      <TabsContext.Provider value={contextValue}>{children}</TabsContext.Provider>
    </div>
  );
});

type NativeListProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'role' | 'aria-label' | 'aria-labelledby'
>;

export interface TabListBaseProps extends NativeListProps {
  children?: ReactNode;
}

/** A tablist must be named. */
export type TabListProps = TabListBaseProps &
  (
    | { 'aria-label': string; 'aria-labelledby'?: undefined }
    | { 'aria-labelledby': string; 'aria-label'?: undefined }
  );

type ResolvedTabListProps = TabListBaseProps & {
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

function getTabs(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
    (tab) => tab.getAttribute('aria-disabled') !== 'true',
  );
}

export const TabList = forwardRef<HTMLDivElement, TabListProps>(function TabList(
  props,
  forwardedRef,
) {
  const {
    className,
    children,
    onKeyDown,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  } = props as ResolvedTabListProps;

  const { orientation, activationMode, select } = useTabsContext('TabList');
  const listRef = useRef<HTMLDivElement | null>(null);
  const setRef = useComposedRef(forwardedRef, listRef);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const tabs = getTabs(listRef.current);
      if (tabs.length === 0) return;

      const active = document.activeElement;
      const currentIndex = tabs.findIndex((tab) => tab === active || tab.contains(active));

      const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
      const previous = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';

      let nextIndex: number;
      switch (event.key) {
        case next:
          nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length;
          break;
        case previous:
          nextIndex =
            currentIndex < 0 ? tabs.length - 1 : (currentIndex - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const target = tabs[nextIndex];
      target.focus();
      // Keep the newly focused tab inside the scroll viewport. jsdom has no
      // layout and does not implement scrollIntoView, hence the guard.
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      if (activationMode === 'automatic') {
        const nextValue = target.dataset.value;
        if (nextValue !== undefined) select(nextValue);
      }
    },
    [activationMode, onKeyDown, orientation, select],
  );

  return (
    <div
      ref={setRef}
      {...rest}
      role="tablist"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cx(styles.list, orientation === 'vertical' && styles.listVertical, className)}
    >
      {children}
    </div>
  );
});

type NativeTabProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'aria-selected' | 'aria-controls' | 'type' | 'value' | 'id' | 'disabled'
>;

export interface TabProps extends NativeTabProps {
  value: string;
  /** Rendered as `aria-disabled`; the tab stays in the accessibility tree. */
  disabled?: boolean;
  children?: ReactNode;
}

export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { value, disabled = false, className, children, onClick, ...rest },
  ref,
) {
  const { value: selectedValue, select, baseId } = useTabsContext('Tab');
  const selected = selectedValue === value;

  return (
    <button
      ref={ref}
      {...rest}
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      aria-selected={selected}
      aria-controls={tabPanelId(baseId, value)}
      aria-disabled={disabled || undefined}
      data-value={value}
      // Roving tabindex: the tablist is a single tab stop.
      tabIndex={selected ? 0 : -1}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (disabled) return;
        select(value);
      }}
      className={cx(
        styles.tab,
        selected && styles.tabSelected,
        disabled && styles.tabInert,
        className,
      )}
    >
      {children}
    </button>
  );
});

export interface TabPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'id'> {
  value: string;
  /**
   * Keep the panel mounted while hidden (preserves scroll position and form
   * state). Default false.
   */
  keepMounted?: boolean;
  children?: ReactNode;
}

export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { value, keepMounted = false, className, children, ...rest },
  ref,
) {
  const { value: selectedValue, baseId } = useTabsContext('TabPanel');
  const selected = selectedValue === value;

  if (!selected && !keepMounted) return null;

  return (
    <div
      ref={ref}
      {...rest}
      role="tabpanel"
      id={tabPanelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      hidden={!selected}
      // APG: give the panel itself a tab stop so keyboard users can reach
      // non-focusable panel content right after the tablist.
      tabIndex={0}
      className={cx(styles.panel, className)}
    >
      {children}
    </div>
  );
});
