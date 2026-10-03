import { Color, ShaderMaterial, Vector2, type Texture } from 'three'
import type { ScreenFit } from '@/core/schema/project'

/**
 * Unlit screen shader:
 * - rounded-corner mask via an SDF with derivative-based anti-aliasing
 * - cover / contain / fill fitting plus a 2D zoom & pan (for "content zoom" shots)
 * - NOT tone-mapped: the user's app colours reach the video exactly as captured
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform bool hasMap;
  uniform vec2 size;        // screen size, world units
  uniform float radius;     // corner radius, world units
  uniform vec2 uvScale;     // fit
  uniform vec2 uvOffset;
  uniform bool letterbox;   // contain mode: paint outside content
  uniform float zoom;
  uniform vec2 pan;
  uniform vec3 emptyColor;
  uniform float brightness;
  varying vec2 vUv;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 p = (vUv - 0.5) * size;
    float d = sdRoundBox(p, size * 0.5, radius);
    float aa = fwidth(d);
    float alpha = 1.0 - smoothstep(-aa, aa, d);
    if (alpha <= 0.0) discard;

    vec3 color = emptyColor;
    if (hasMap) {
      vec2 uv = (vUv - 0.5) / zoom + 0.5 + vec2(pan.x, -pan.y);
      uv = uv * uvScale + uvOffset;
      bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
      vec2 c = clamp(uv, 0.0, 1.0);
      if (inside || !letterbox) color = texture2D(map, vec2(c.x, 1.0 - c.y)).rgb; // textures are top-down
      else color = vec3(0.0);
    }
    gl_FragColor = vec4(color * brightness, alpha);
    #include <colorspace_fragment>
  }
`

export class ScreenMaterial extends ShaderMaterial {
  constructor(width: number, height: number, radius: number) {
    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      toneMapped: false,
      uniforms: {
        map: { value: null },
        hasMap: { value: false },
        size: { value: new Vector2(width, height) },
        radius: { value: radius },
        uvScale: { value: new Vector2(1, 1) },
        uvOffset: { value: new Vector2(0, 0) },
        letterbox: { value: false },
        zoom: { value: 1 },
        pan: { value: new Vector2(0, 0) },
        emptyColor: { value: new Color('#0b0b0f') },
        brightness: { value: 1 },
      },
    })
  }

  setContent(texture: Texture | null, contentW: number, contentH: number, fit: ScreenFit) {
    const u = this.uniforms
    u.map.value = texture
    u.hasMap.value = !!texture
    const size = u.size.value as Vector2
    const screenAspect = size.x / size.y
    const contentAspect = contentW > 0 && contentH > 0 ? contentW / contentH : screenAspect
    let sx = 1, sy = 1
    if (fit === 'cover') {
      if (contentAspect > screenAspect) sx = screenAspect / contentAspect
      else sy = contentAspect / screenAspect
    } else if (fit === 'contain') {
      if (contentAspect > screenAspect) sy = contentAspect / screenAspect
      else sx = screenAspect / contentAspect
    }
    ;(u.uvScale.value as Vector2).set(sx, sy)
    ;(u.uvOffset.value as Vector2).set((1 - sx) / 2, (1 - sy) / 2)
    u.letterbox.value = fit === 'contain'
  }

  setView(zoom: number, panX: number, panY: number) {
    this.uniforms.zoom.value = Math.max(0.05, zoom)
    ;(this.uniforms.pan.value as Vector2).set(panX, panY)
  }
}
