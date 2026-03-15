import type maplibregl from 'maplibre-gl';
import type { IShadowLayer } from './IShadowLayer';
import { ShadeMapAdapter } from './ShadeMapAdapter';
import { LocalShadowAdapter } from './LocalShadowAdapter';

export type ShadowMode = 'api' | 'local';

export interface ShadowLayerOptions {
  /** Initial date to render at */
  date: Date;
  /** VITE_SHADEMAP_API_KEY — pass empty string to skip ShadeMap entirely */
  apiKey: string;
  /** Force a specific renderer. 'api' = ShadeMap, 'local' = suncalc fallback */
  mode?: ShadowMode;
  /** Any additional options forwarded to the ShadeMap constructor */
  [key: string]: unknown;
}

/**
 * Creates the best available shadow layer for this environment.
 *
 * Resolution order:
 *   1. ShadeMap API  — if apiKey is present AND initialises without error within 1500 ms
 *   2. LocalShadowAdapter — suncalc + MapLibre GeoJSON fill layer
 *
 * The returned object satisfies IShadowLayer regardless of which path was taken.
 * All callers use the same .setDate() / .resize() / .remove() API.
 */
export async function createShadowLayer(
  map: maplibregl.Map,
  options: ShadowLayerOptions,
): Promise<IShadowLayer> {
  // Forced local mode — skip API entirely
  if (options.mode === 'local') {
    console.info('[shadow] Local mode selected — using local renderer');
    return new LocalShadowAdapter({ date: options.date });
  }

  if (!options.apiKey) {
    console.info('[shadow] No ShadeMap key — using local renderer');
    return new LocalShadowAdapter({ date: options.date });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: ShadeMap } = (await import('mapbox-gl-shadow-simulator')) as { default: any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance: any = new ShadeMap({ map, ...options }).addTo(map);

    // Wait up to 1500 ms for a domain/auth error to surface
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1500);
      instance.on?.('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    console.info('[shadow] ShadeMap API active');
    return new ShadeMapAdapter(instance);
  } catch (err) {
    console.warn('[shadow] ShadeMap unavailable — falling back to local renderer:', err);
    return new LocalShadowAdapter({ date: options.date });
  }
}
