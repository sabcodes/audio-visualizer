import { expect, it } from 'vitest';
import { formatTime } from '../../src/ui/ControlPanel';

it('formats local audio timestamps including tracks longer than an hour', () => {
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(65.9)).toBe('1:05');
  expect(formatTime(3661)).toBe('1:01:01');
  expect(formatTime(NaN)).toBe('0:00');
  expect(formatTime(Infinity)).toBe('0:00');
  expect(formatTime(-1)).toBe('0:00');
});
