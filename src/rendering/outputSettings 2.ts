import { ACESFilmicToneMapping, AgXToneMapping, type ToneMapping } from 'three/webgpu';

export type ToneMappingName = 'aces' | 'agx';
export type AntialiasingName = 'fxaa' | 'smaa' | 'none';
export interface OutputSettings { toneMapping: ToneMappingName; aa: AntialiasingName }

export const toneMappings: readonly ToneMappingName[] = ['aces', 'agx'];
export const antialiasingModes: readonly AntialiasingName[] = ['fxaa', 'smaa', 'none'];
export const defaultOutput: Readonly<OutputSettings> = { toneMapping: 'aces', aa: 'fxaa' };

/** Reads ?tone= and ?aa= deep links, falling back to the reviewed defaults for anything unknown. */
export function parseOutputSettings(params: URLSearchParams): OutputSettings {
  const tone = params.get('tone') as ToneMappingName;
  const aa = params.get('aa') as AntialiasingName;
  return { toneMapping: toneMappings.includes(tone) ? tone : defaultOutput.toneMapping, aa: antialiasingModes.includes(aa) ? aa : defaultOutput.aa };
}

export function toneMappingConstant(name: ToneMappingName): ToneMapping {
  return name === 'agx' ? AgXToneMapping : ACESFilmicToneMapping;
}
