/** Keep the native scene picker and its keyboard behaviour; search only filters its options. */
export function bindSceneBrowser(mode: HTMLSelectElement, search: HTMLInputElement, previous: HTMLButtonElement, next: HTMLButtonElement, count: HTMLElement) {
  const available = () => Array.from(mode.options).filter(option => !option.hidden && !option.disabled);
  const refresh = () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const option of mode.options) option.hidden = !option.text.toLocaleLowerCase().includes(query);
    const options = available();
    count.textContent = `${options.length} scene${options.length === 1 ? '' : 's'}`;
    previous.disabled = next.disabled = mode.disabled || !options.length;
  };
  const step = (direction: number) => {
    const options = available();
    if (mode.disabled || !options.length) return;
    const current = options.findIndex(option => option.value === mode.value);
    const index = current < 0 ? (direction > 0 ? 0 : options.length - 1) : (current + direction + options.length) % options.length;
    mode.value = options[index].value;
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  };
  search.addEventListener('input', refresh);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { search.value = ''; refresh(); }
    if (event.key === 'Enter') { event.preventDefault(); step(1); }
  });
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  refresh();
  return { refresh };
}

/** Small, versioned browser preferences; optional storage never prevents startup. */
export function visualPreferences(root: HTMLElement) {
  const key = 'visualizer.visualPreferences';
  const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-persist]'));
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved && typeof saved === 'object' && 'version' in saved && saved.version === 1 && 'values' in saved && saved.values && typeof saved.values === 'object') {
      for (const control of controls) {
        const value: unknown = Reflect.get(saved.values, control.id);
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          if (typeof value === 'boolean') control.checked = value;
        } else if (control instanceof HTMLSelectElement) {
          if (typeof value === 'string' && Array.from(control.options).some(option => option.value === value)) control.value = value;
        } else if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) && Number(value) >= Number(control.min) && Number(value) <= Number(control.max)) control.value = value;
      }
    }
  } catch { /* Private browsing or malformed preferences: use defaults. */ }
  const save = () => {
    const values = Object.fromEntries(controls.map(control => [control.id, control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value]));
    try { localStorage.setItem(key, JSON.stringify({ version: 1, values })); } catch { /* Optional. */ }
  };
  controls.forEach(control => control.addEventListener('change', save));
  return { save };
}

export function bindRangeValues(root: HTMLElement) {
  const update = Array.from(root.querySelectorAll<HTMLInputElement>('input[type=range]:not(#seek-slider)')).map(input => {
    const output = document.createElement('output');
    output.htmlFor.add(input.id); output.className = 'range-value';
    input.after(output);
    const sync = () => { output.value = `${Number(input.value).toFixed(input.step === '0.05' ? 2 : 1)}${input.id.includes('timer') || input.id.includes('speed') ? 's' : ''}`; };
    input.addEventListener('input', sync);
    return sync;
  });
  const sync = () => update.forEach(updateValue => updateValue());
  sync(); return sync;
}
