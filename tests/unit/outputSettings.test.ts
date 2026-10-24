import { expect, it } from 'vitest';
import { ACESFilmicToneMapping, AgXToneMapping } from 'three/webgpu';
import { parseOutputSettings, toneMappingConstant } from '../../src/rendering/outputSettings';

it('defaults to ACES + FXAA until review picks otherwise', () => {
  expect(parseOutputSettings(new URLSearchParams())).toEqual({ toneMapping: 'aces', aa: 'fxaa' });
});
it('accepts valid ?tone= and ?aa= deep links and ignores invalid ones', () => {
  expect(parseOutputSettings(new URLSearchParams('tone=agx&aa=smaa'))).toEqual({ toneMapping: 'agx', aa: 'smaa' });
  expect(parseOutputSettings(new URLSearchParams('tone=reinhard&aa=taa'))).toEqual({ toneMapping: 'aces', aa: 'fxaa' });
  expect(parseOutputSettings(new URLSearchParams('aa=none')).aa).toBe('none');
});
it('maps tone-mapping names to Three.js operators', () => {
  expect(toneMappingConstant('aces')).toBe(ACESFilmicToneMapping);
  expect(toneMappingConstant('agx')).toBe(AgXToneMapping);
});
