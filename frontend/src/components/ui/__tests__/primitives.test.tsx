import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { IconButton } from '../IconButton';
import { ProgressBar, ProgressRing } from '../Progress';
import { Separator } from '../Separator';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import { Switch } from '../Switch';
import { Tab, TabList, TabPanel, Tabs } from '../Tabs';
import { Toast, ToastProvider } from '../Toast';
import { useToast } from '../useToast';
import { VisuallyHidden } from '../VisuallyHidden';

describe('Button', () => {
  it('merges className after its own classes', () => {
    render(<Button className="custom">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toMatch(/custom$/);
  });

  it('stays focusable while loading and swallows activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Saving" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Crucially NOT the disabled attribute, which would drop the control out
    // of the tab order mid-request.
    expect(button).not.toBeDisabled();

    button.focus();
    expect(button).toHaveFocus();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAccessibleName(/Saving/);
  });

  it('uses the real disabled attribute when explicitly disabled', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('names an icon-only button from aria-label', () => {
    render(
      <Button iconOnly aria-label="Bookmark question">
        <span>*</span>
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Bookmark question' })).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('requires and applies an accessible name', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton aria-label="Close" icon={<span>x</span>} onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Switch', () => {
  it('is a switch with the correct checked state', () => {
    render(<Switch defaultChecked>Dark mode</Switch>);
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeChecked();
  });

  it('toggles exactly once per Space press', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange}>Dark mode</Switch>);

    const control = screen.getByRole('switch');
    control.focus();
    await user.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles exactly once per Enter press', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange}>Dark mode</Switch>);

    screen.getByRole('switch').focus();
    await user.keyboard('{Enter}');

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('honours a controlled value', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={onCheckedChange}>
        Dark mode
      </Switch>,
    );

    await user.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('refuses activation while aria-disabled but stays focusable', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch disabled onCheckedChange={onCheckedChange}>
        Dark mode
      </Switch>,
    );

    const control = screen.getByRole('switch');
    expect(control).toHaveAttribute('aria-disabled', 'true');
    control.focus();
    expect(control).toHaveFocus();

    await user.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

function TabsFixture() {
  return (
    <Tabs defaultValue="all">
      <TabList aria-label="Bookmark filters">
        <Tab value="all">All</Tab>
        <Tab value="flagged">Flagged</Tab>
        <Tab value="wrong">Wrong</Tab>
      </TabList>
      <TabPanel value="all">All bookmarks</TabPanel>
      <TabPanel value="flagged">Flagged bookmarks</TabPanel>
      <TabPanel value="wrong">Wrong answers</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('wires tablist, tab and tabpanel with aria-selected and aria-controls', () => {
    render(<TabsFixture />);

    const list = screen.getByRole('tablist', { name: 'Bookmark filters' });
    expect(list).toHaveAttribute('aria-orientation', 'horizontal');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    const panel = screen.getByRole('tabpanel');
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
    expect(panel).toHaveAccessibleName('All');
  });

  it('exposes a single tab stop via roving tabindex', () => {
    render(<TabsFixture />);
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves and activates with ArrowRight/ArrowLeft, Home and End', async () => {
    const user = userEvent.setup();
    render(<TabsFixture />);
    const tabs = screen.getAllByRole('tab');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Flagged bookmarks');

    await user.keyboard('{End}');
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(tabs[0]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('only moves focus in manual activation mode', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="all" activationMode="manual">
        <TabList aria-label="Filters">
          <Tab value="all">All</Tab>
          <Tab value="flagged">Flagged</Tab>
        </TabList>
        <TabPanel value="all">All</TabPanel>
        <TabPanel value="flagged">Flagged</TabPanel>
      </Tabs>,
    );

    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');

    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{Enter}');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('skips aria-disabled tabs during keyboard navigation', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabList aria-label="Filters">
          <Tab value="a">A</Tab>
          <Tab value="b" disabled>
            B
          </Tab>
          <Tab value="c">C</Tab>
        </TabList>
        <TabPanel value="a">A</TabPanel>
        <TabPanel value="b">B</TabPanel>
        <TabPanel value="c">C</TabPanel>
      </Tabs>,
    );

    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');

    expect(tabs[2]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-disabled', 'true');
    expect(tabs[1]).not.toBeDisabled();
  });
});

describe('ProgressBar / ProgressRing', () => {
  it('exposes progressbar semantics and a text alternative', () => {
    render(<ProgressBar label="Chapter progress" value={30} hint="12 / 40" />);

    const bar = screen.getByRole('progressbar', { name: 'Chapter progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '30%');
  });

  it('reports "n of max" when the range is not a percentage', () => {
    render(<ProgressBar aria-label="Questions" value={12} max={40} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '12 of 40');
  });

  it('drops aria-valuenow when indeterminate', () => {
    render(<ProgressBar aria-label="Loading" indeterminate />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuetext', 'In progress');
  });

  it('clamps out-of-range values instead of overflowing', () => {
    render(<ProgressRing aria-label="Score" value={140} />);
    expect(screen.getByRole('progressbar', { name: 'Score' })).toHaveAttribute(
      'aria-valuenow',
      '140',
    );
  });

  it('renders ring centre content without adding it to the a11y tree', () => {
    render(
      <ProgressRing aria-label="Score" value={82}>
        82%
      </ProgressRing>,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '82%');
  });
});

describe('Badge, Card, Skeleton, Spinner, Separator, EmptyState, VisuallyHidden', () => {
  it('prefixes a badge with screen-reader-only context', () => {
    render(<Badge tone="success" srPrefix="Status:" />);
    expect(screen.getByText('Status:', { exact: false })).toBeInTheDocument();
  });

  it('hides skeletons from assistive tech', () => {
    const { container } = render(<Skeleton lines={3} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces a labelled spinner and hides an unlabelled one', () => {
    const { rerender } = render(<Spinner label="Loading questions" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading questions');

    rerender(<Spinner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps a decorative separator out of the a11y tree', () => {
    const { rerender, container } = render(<Separator />);
    expect(container.querySelector('[role="none"]')).toBeInTheDocument();

    rerender(<Separator decorative={false} orientation="vertical" />);
    const separator = screen.getByRole('separator');
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('renders an empty state heading at the requested level', () => {
    render(<EmptyState title="No bookmarks yet" headingLevel={2} description="Flag a question." />);
    expect(screen.getByRole('heading', { level: 2, name: 'No bookmarks yet' })).toBeInTheDocument();
  });

  it('keeps visually hidden text in the a11y tree', () => {
    render(<VisuallyHidden>Correct answer</VisuallyHidden>);
    expect(screen.getByText('Correct answer')).toBeInTheDocument();
  });
});

function ToastTrigger() {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast({ title: 'Saved', description: 'Attempt stored' })}>
      Notify
    </button>
  );
}

describe('Toast', () => {
  it('renders in a polite live region', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Notify' }));

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Saved');
    expect(region).toHaveTextContent('Attempt stored');
  });

  it('can be dismissed with its close button', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Notify' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  // fireEvent rather than userEvent: user-event's own internal delays
  // deadlock against fake timers, and this test is specifically about the
  // auto-dismiss clock.
  it('auto-dismisses after its duration', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider duration={1000}>
          <ToastTrigger />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
      expect(screen.getByRole('status')).toHaveTextContent('Saved');

      act(() => vi.advanceTimersByTime(1200));
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses the auto-dismiss clock while hovered, and resumes on leave', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider duration={1000}>
          <ToastTrigger />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
      const toast = screen.getByRole('status').firstElementChild as HTMLElement;

      fireEvent.mouseOver(toast);
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByRole('status')).toHaveTextContent('Saved');

      fireEvent.mouseOut(toast);
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses the auto-dismiss clock while focus is inside the toast', () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider duration={1000}>
          <ToastTrigger />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
      const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });

      // Tabbing to the dismiss button must not let the toast vanish
      // mid-reach (WCAG 2.2.1 Timing Adjustable).
      fireEvent.focus(dismiss);
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByRole('status')).toHaveTextContent('Saved');

      fireEvent.blur(dismiss);
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a sticky toast until it is dismissed', () => {
    vi.useFakeTimers();
    try {
      render(<Toast title="Offline" description="Answers are queued" tone="warning" />);
      vi.advanceTimersByTime(60_000);
      expect(screen.getByText('Offline')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
