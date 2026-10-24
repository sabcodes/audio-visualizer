export type QualityPreset = 'compatibility' | 'balanced' | 'high' | 'ultra';
export const qualityPresets: readonly QualityPreset[] = ['compatibility', 'balanced', 'high', 'ultra'];

/** Internal-resolution and simulation budget for one preset; null height means native density. */
export interface QualityBudget {
  preset: QualityPreset;
  internalHeight: number | null;
  particleScale: number;
}

const budgets: Record<QualityPreset, Omit<QualityBudget, 'preset'>> = {
  compatibility: { internalHeight: 1080, particleScale: 0.5 },
  balanced: { internalHeight: 1080, particleScale: 1 },
  high: { internalHeight: 1440, particleScale: 2 },
  ultra: { internalHeight: null, particleScale: 2 },
};

export function presetBudget(preset: QualityPreset): QualityBudget {
  return { preset, ...budgets[preset] };
}

/** Pixel ratio that holds the drawing buffer near the preset's internal row count. */
export function basePixelRatio(budget: QualityBudget, cssHeight: number, dpr: number): number {
  const native = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 2);
  const ratio = budget.internalHeight === null ? native : Math.min(native, budget.internalHeight / Math.max(1, cssHeight));
  return Math.max(0.25, ratio);
}
