import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BAND_COLORS } from '../config/bandColors';

const MAX_BANDS = 36;

type Props = {
  pointer01: { x: number; y: number; down: boolean };
  countdownProgress?: number;
};

function makePaletteArray() {
  const arr = new Float32Array(MAX_BANDS * 3);
  BAND_COLORS.forEach((c, i) => {
    arr[i * 3 + 0] = c.rgb[0] / 255;
    arr[i * 3 + 1] = c.rgb[1] / 255;
    arr[i * 3 + 2] = c.rgb[2] / 255;
  });
  return arr;
}

// Fullscreen quad vertex (clipspace)
const FSQ_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * SIMULATION PASS
 * - previous frame is slightly advected by a curl field (smoke drift)
 * - small spark-like brush injects intensity around the fingertip
 * - we store:
 *    r: intensity
 *    g: y01 for material mode (water/smoke/fire)
 *    b: x01 for band color
 */
const SIM_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uPrev;
  uniform vec2  uPointer;   // 0..1
  uniform float uDown;      // 0/1
  uniform vec2  uRes;       // px
  uniform float uTime;

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // --- CURL FLOW FIELD (smoke drift) ---
    float t = uTime * 0.25;
    float sx = sin((uv.y + t) * 6.0) + sin((uv.x - t * 1.3) * 4.0);
    float sy = cos((uv.x - t * 0.8) * 5.0) - cos((uv.y + t * 1.1) * 7.0);
    vec2 flow = vec2(sx, sy) * 0.0025;

    // slight upward pull (smoke rise)
    flow.y += 0.0015;

    vec4 prev = texture2D(uPrev, uv - flow);

    // --- FADE ---
    float fade = 0.992;
    prev.r *= fade;
    if (prev.r < 0.001) prev.r = 0.0;

    // --- BRUSH INJECTION ---
    if (uDown > 0.5) {
      // aspect-correct distance from pointer
      vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
      vec2 dp = (uv - uPointer) * aspect;
      float d = length(dp);

      // very small gaussian-like spark
      float radius = 0.028;
      float brush = exp(-pow(d / radius, 2.0) * 2.5); // 1 at center, quick falloff

      float add = brush * 0.9;
      if (add > 0.001) {
        prev.r = clamp(prev.r + add, 0.0, 1.0);
        prev.g = mix(prev.g, uPointer.y, 0.35);
        prev.b = uPointer.x;
        prev.a = 1.0;
      }
    }

    gl_FragColor = prev;
  }
`;

/**
 * RENDER PASS
 * - samples the simulation texture with a small blur to get soft volumes
 * - colors using X→band palette, Y→material (water/smoke/fire)
 * - adds a subtle fingertip glow as a visual locator
 */
const RENDER_FRAG = /* glsl */ `
  precision highp float;

  #define MAX_BANDS 36

  uniform sampler2D uTex;
  uniform vec2  uPointer;   // 0..1
  uniform float uDown;      // 0/1
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uCountdown;
  uniform float uPalette[MAX_BANDS * 3];

  varying vec2 vUv;

  vec3 bandColor(float x01) {
    float b = clamp(floor(x01 * float(MAX_BANDS)), 0.0, float(MAX_BANDS - 1.0));
    int i = int(b) * 3;
    return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
  }

  vec3 materialize(vec3 base, float y01) {
    // water -> smoke -> fire
    if (y01 < 0.33) {
      // water: cool, glassy
      float t = y01 / 0.33;
      return base * vec3(0.45, 0.85, 1.4) * mix(0.25, 0.7, t);
    } else if (y01 < 0.66) {
      // smoke: milky, desaturated
      float g = dot(base, vec3(0.299, 0.587, 0.114));
      vec3 gray = vec3(g);
      float t = (y01 - 0.33) / 0.33;
      return mix(gray, base, 0.25 + 0.55 * t) * mix(0.35, 0.9, t);
    } else {
      // fire: hot, additive
      float t = (y01 - 0.66) / 0.34;
      return base * vec3(1.4, 0.9, 0.35) * mix(0.7, 2.0, t);
    }
  }

  void main() {
    // --- LIVING BACKGROUND ---
    vec3 col = vec3(0.02, 0.03, 0.05);
    col += 0.02 * sin(vec3(
      vUv.x * 7.0 + uTime * 0.25,
      vUv.y * 9.0 - uTime * 0.18,
      (vUv.x + vUv.y) * 5.0 + uTime * 0.21
    ));

    // --- SOFT INTENSITY FIELD (small blur) ---
    vec2 px = 1.0 / uRes;
    vec4 c0 = texture2D(uTex, vUv);
    float i0 = c0.r;
    float i1 = texture2D(uTex, vUv + vec2( px.x, 0.0)).r;
    float i2 = texture2D(uTex, vUv + vec2(-px.x, 0.0)).r;
    float i3 = texture2D(uTex, vUv + vec2(0.0,  px.y)).r;
    float i4 = texture2D(uTex, vUv + vec2(0.0, -px.y)).r;

    float intensity = (i0 * 2.0 + i1 + i2 + i3 + i4) / 6.0;

    // keep style/color info from center sample
    float styleY = c0.g;
    float colorX = c0.b;

    if (intensity > 0.001) {
      vec3 base = bandColor(colorX);
      vec3 vol  = materialize(base, styleY);

      // "alive" swirling smoke vs settled pigment
      float alive   = smoothstep(0.02, 0.22, intensity);
      float pigment = smoothstep(0.0, 0.16, intensity) * (1.0 - alive);

      // swirling volume (additive-ish)
      col = mix(col, col + vol * (0.6 + 1.6 * intensity), alive);

      // settled pigment: softly tint background without going gray
      vec3 dry = mix(base * 0.6, base * 1.15, pigment);
      col = mix(col, dry, pigment * 0.85);
    }

    // --- SUBTLE FINGERTIP GLOW (locator) ---
    vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
    float dp = length((vUv - uPointer) * aspect);
    float pr = mix(0.012, 0.022, uDown); // tiny
    float pGlow = 1.0 - smoothstep(0.0, pr, dp);

    vec3 pBase = bandColor(uPointer.x);
    vec3 pInk  = materialize(pBase, uPointer.y);
    col += pInk * pGlow * (0.2 + 0.55 * uDown);

    // --- COUNTDOWN LIFT ---
    col *= 1.0 + uCountdown * 0.25;

    // tonemap & gamma
    col = col / (1.0 + col);
    col = pow(col, vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const FlowFieldInstrument: React.FC<Props> = ({
  pointer01,
  countdownProgress = 0,
}) => {
  const { gl, size } = useThree();

  // Ping‑pong render targets
  const targets = useRef<{ a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null>(null);

  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCam = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cam.position.z = 1;
    return cam;
  }, []);

  const palette = useMemo(() => makePaletteArray(), []);

  const simMat = useRef<THREE.ShaderMaterial | null>(null);
  const renderMat = useRef<THREE.ShaderMaterial | null>(null);
  const ping = useRef(true);

  // Create FBOs + sim quad
  useEffect(() => {
    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };

    const a = new THREE.WebGLRenderTarget(size.width, size.height, opts);
    const b = new THREE.WebGLRenderTarget(size.width, size.height, opts);
    targets.current = { a, b };

    simMat.current = new THREE.ShaderMaterial({
      vertexShader: FSQ_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        uPrev:    { value: b.texture },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) },
        uDown:    { value: 0 },
        uRes:     { value: new THREE.Vector2(size.width, size.height) },
        uTime:    { value: 0 },
      },
    });

    const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat.current);
    simQuad.frustumCulled = false;
    simScene.add(simQuad);

    // initial clear
    const prevClr = new THREE.Color();
    gl.getClearColor(prevClr);
    const prevAlpha = gl.getClearAlpha();

    gl.setClearColor(new THREE.Color(0, 0, 0), 1);
    gl.setRenderTarget(a);
    gl.clear(true, true, true);
    gl.setRenderTarget(b);
    gl.clear(true, true, true);
    gl.setRenderTarget(null);
    gl.setClearColor(prevClr, prevAlpha);

    return () => {
      simScene.remove(simQuad);
      simQuad.geometry.dispose();
      simMat.current?.dispose();
      a.dispose();
      b.dispose();
      targets.current = null;
      simMat.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize targets + uniforms
  useEffect(() => {
    if (!targets.current) return;
    targets.current.a.setSize(size.width, size.height);
    targets.current.b.setSize(size.width, size.height);

    if (simMat.current) {
      (simMat.current.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
    }
    if (renderMat.current) {
      (renderMat.current.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
    }
  }, [size.width, size.height]);

  // Main loop
  useFrame(({ clock }) => {
    if (!targets.current || !simMat.current || !renderMat.current) return;

    const a = targets.current.a;
    const b = targets.current.b;
    const write = ping.current ? a : b;
    const read  = ping.current ? b : a;

    // SIM
    simMat.current.uniforms.uPrev.value = read.texture;
    (simMat.current.uniforms.uPointer.value as THREE.Vector2).set(pointer01.x, pointer01.y);
    simMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    simMat.current.uniforms.uTime.value = clock.elapsedTime;

    gl.setRenderTarget(write);
    gl.render(simScene, simCam);
    gl.setRenderTarget(null);

    // RENDER (sample the freshly written texture)
    renderMat.current.uniforms.uTex.value = write.texture;
    (renderMat.current.uniforms.uPointer.value as THREE.Vector2).set(pointer01.x, pointer01.y);
    renderMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    renderMat.current.uniforms.uTime.value = clock.elapsedTime;
    renderMat.current.uniforms.uCountdown.value = countdownProgress;

    ping.current = !ping.current;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={renderMat}
        vertexShader={FSQ_VERT}
        fragmentShader={RENDER_FRAG}
        uniforms={{
          uTex:       { value: null },
          uPointer:   { value: new THREE.Vector2(0.5, 0.5) },
          uDown:      { value: 0 },
          uRes:       { value: new THREE.Vector2(size.width, size.height) },
          uTime:      { value: 0 },
          uCountdown: { value: 0 },
          uPalette:   { value: palette },
        }}
      />
    </mesh>
  );
};