import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Radio, RadioGroup } from '../RadioGroup';

/**
 * These tests pin the WAI-ARIA radiogroup pattern. The app previously
 * rendered quiz options as `<button role="radio">` inside `role="radiogroup"`
 * with no arrow-key handling and no roving tabindex, so every option was its
 * own tab stop; and it swapped in the `disabled` attribute after submission,
 * which deleted the revealed correct answer from the accessibility tree.
 * Both failure modes are silent without assertions like these.
 */

const OPTIONS = ['Copper', 'Aluminium', 'Steel', 'Nichrome'];

function Fixture({
  readOnly = false,
  onValueChange,
  initial = null,
}: {
  readOnly?: boolean;
  onValueChange?: (value: string) => void;
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div>
      <button type="button">before</button>
      <RadioGroup
        aria-label="Answer options"
        value={value}
        readOnly={readOnly}
        onValueChange={(next) => {
          setValue(next);
          onValueChange?.(next);
        }}
      >
        {OPTIONS.map((option) => (
          <Radio key={option} value={option}>
            {option}
          </Radio>
        ))}
      </RadioGroup>
      <button type="button">after</button>
    </div>
  );
}

function radios() {
  return screen.getAllByRole('radio');
}

function tabIndexes() {
  return radios().map((radio) => radio.tabIndex);
}

describe('RadioGroup — structure', () => {
  it('exposes a radiogroup with an accessible name and one radio per option', () => {
    render(<Fixture />);
    const group = screen.getByRole('radiogroup', { name: 'Answer options' });
    expect(group).toHaveAttribute('aria-orientation', 'vertical');
    expect(radios()).toHaveLength(OPTIONS.length);
    for (const radio of radios()) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
  });
});

describe('RadioGroup — roving tabindex', () => {
  it('exposes exactly one tab stop, on the first option when nothing is selected', () => {
    render(<Fixture />);
    expect(tabIndexes()).toEqual([0, -1, -1, -1]);
  });

  it('moves the single tab stop onto the selected option', () => {
    render(<Fixture initial="Steel" />);
    expect(tabIndexes()).toEqual([-1, -1, 0, -1]);
  });

  it('keeps exactly one tab stop after the selection changes', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(screen.getByRole('radio', { name: /Aluminium/ }));
    expect(tabIndexes()).toEqual([-1, 0, -1, -1]);
    expect(tabIndexes().filter((index) => index === 0)).toHaveLength(1);
  });

  it('is a single Tab stop: Tab enters the group once and leaves it', async () => {
    const user = userEvent.setup();
    render(<Fixture initial="Steel" />);

    screen.getByRole('button', { name: 'before' }).focus();
    await user.tab();
    expect(screen.getByRole('radio', { name: /Steel/ })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });
});

describe('RadioGroup — arrow keys move AND select', () => {
  it('ArrowDown moves focus to the next option and selects it', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Fixture onValueChange={onValueChange} />);

    radios()[0].focus();
    await user.keyboard('{ArrowDown}');

    expect(radios()[1]).toHaveFocus();
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios()[0]).toHaveAttribute('aria-checked', 'false');
    expect(onValueChange).toHaveBeenCalledWith('Aluminium');
  });

  it('ArrowRight behaves like ArrowDown', async () => {
    const user = userEvent.setup();
    render(<Fixture initial="Copper" />);

    radios()[0].focus();
    await user.keyboard('{ArrowRight}');

    expect(radios()[1]).toHaveFocus();
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('ArrowUp and ArrowLeft move backwards and select', async () => {
    const user = userEvent.setup();
    render(<Fixture initial="Steel" />);

    radios()[2].focus();
    await user.keyboard('{ArrowUp}');
    expect(radios()[1]).toHaveFocus();
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(radios()[0]).toHaveFocus();
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('wraps from the last option to the first and back', async () => {
    const user = userEvent.setup();
    render(<Fixture initial="Nichrome" />);

    radios()[3].focus();
    await user.keyboard('{ArrowDown}');
    expect(radios()[0]).toHaveFocus();
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowUp}');
    expect(radios()[3]).toHaveFocus();
    expect(radios()[3]).toHaveAttribute('aria-checked', 'true');
  });

  it('Home and End jump to the first and last option and select them', async () => {
    const user = userEvent.setup();
    render(<Fixture initial="Aluminium" />);

    radios()[1].focus();
    await user.keyboard('{End}');
    expect(radios()[3]).toHaveFocus();
    expect(radios()[3]).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{Home}');
    expect(radios()[0]).toHaveFocus();
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('Space selects the focused option without moving focus', async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    radios()[2].focus();
    await user.keyboard(' ');

    expect(radios()[2]).toHaveFocus();
    expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores arrow keys combined with a modifier so browser shortcuts still work', async () => {
    const user = userEvent.setup();
    render(<Fixture initial="Copper" />);

    radios()[0].focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(radios()[0]).toHaveFocus();
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
  });
});

describe('RadioGroup — readOnly review mode', () => {
  it('never uses the disabled attribute, so revealed answers stay in the a11y tree', () => {
    render(
      <RadioGroup aria-label="Answer options" value="Aluminium" readOnly>
        <Radio value="Copper" state="incorrect">
          Copper
        </Radio>
        <Radio value="Aluminium" state="correct">
          Aluminium
        </Radio>
      </RadioGroup>,
    );

    const all = radios();
    expect(all).toHaveLength(2);
    for (const radio of all) {
      expect(radio).not.toBeDisabled();
      expect(radio).not.toHaveAttribute('disabled');
      expect(radio).toHaveAttribute('aria-disabled', 'true');
    }
    // The revealed state is announced, not conveyed by colour alone.
    expect(screen.getByRole('radio', { name: /Aluminium/ })).toHaveAccessibleName(
      /Correct answer/,
    );
    expect(screen.getByRole('radio', { name: /Copper/ })).toHaveAccessibleName(
      /Incorrect answer/,
    );
  });

  it('marks the group aria-readonly', () => {
    render(<Fixture readOnly initial="Steel" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
  });

  it('keeps every option focusable and reachable with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Fixture readOnly initial="Steel" />);

    radios()[2].focus();
    expect(radios()[2]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(radios()[3]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(radios()[0]).toHaveFocus();
  });

  it('does not change the answer in review mode', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Fixture readOnly initial="Steel" onValueChange={onValueChange} />);

    radios()[2].focus();
    await user.keyboard('{ArrowDown}');
    await user.click(radios()[0]);

    expect(onValueChange).not.toHaveBeenCalled();
    expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
    expect(radios()[0]).toHaveAttribute('aria-checked', 'false');
    // The tab stop stays on the locked answer.
    expect(tabIndexes()).toEqual([-1, -1, 0, -1]);
  });
});

describe('RadioGroup — per-option disabled', () => {
  it('uses aria-disabled and refuses selection, but stays focusable', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Answer options" onValueChange={onValueChange}>
        <Radio value="a">A</Radio>
        <Radio value="b" disabled>
          B
        </Radio>
      </RadioGroup>,
    );

    const [, second] = radios();
    expect(second).toHaveAttribute('aria-disabled', 'true');
    expect(second).not.toBeDisabled();

    await user.click(second);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(second).toHaveAttribute('aria-checked', 'false');
  });
});

describe('RadioGroup — uncontrolled usage', () => {
  it('tracks its own value and still reports it through onValueChange', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Answer options" defaultValue="Copper" onValueChange={onValueChange}>
        {OPTIONS.map((option) => (
          <Radio key={option} value={option}>
            {option}
          </Radio>
        ))}
      </RadioGroup>,
    );

    expect(tabIndexes()).toEqual([0, -1, -1, -1]);
    radios()[0].focus();
    await user.keyboard('{ArrowDown}');

    expect(onValueChange).toHaveBeenCalledWith('Aluminium');
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
    expect(tabIndexes()).toEqual([-1, 0, -1, -1]);
  });

  it('submits through a hidden input when given a name', () => {
    render(
      <RadioGroup aria-label="Answer options" name="answer" defaultValue="Steel">
        {OPTIONS.map((option) => (
          <Radio key={option} value={option}>
            {option}
          </Radio>
        ))}
      </RadioGroup>,
    );
    const hidden = document.querySelector('input[name="answer"]');
    expect(hidden).toHaveValue('Steel');
  });
});
