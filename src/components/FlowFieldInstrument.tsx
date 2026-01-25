// src/components/FlowFieldInstrument.tsx
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BAND_COLORS } from '../config/bandColors';

const MAX_BANDS = 36;

type Props = {
  pointer01: { x: number; y: number; down: boolean };
  downcountProgress?: number;

  // Visual Tuning Props (with safe defaults)
  simDriftStrength?: number;
  simAdvectStrength?: number;
  simBlurAmount?: number;
  simDecayLow?: number;
  simDecayHigh?: number;
  sparkCoreRadius?: number;
  sparkAuraRadius?: number;
  sparkStrengthStrength?: number;
  sparkAuraStrength?: number;
  powderStrength?: number;
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

const FSQ_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SIM_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uPrev;
  uniform vec2 uPointer;
  uniform float uDown;
  uniform vec2 uRes;
  uniform float uTime;

  // Parameters
  uniform float uDrStrengthStrength;
  uniform float uAdvectStrength;
  uniform float uBlurAmount;
  uniform float uDecayLow;
  uniform float uDecayHigh;
  uniform float uSparkCoreR;
  uniform float uSparkAuraR;
  uniform float uSparkStrengthStrength;
  uniform float uSparkAuraStrength;

  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  vec2 curl(vec2 p) {
    float e = 0.0025;
    float n1 = vnoise(p + vec2(e, 0.0));
    float n2 = vnoise(p - vec2(e, 0.0));
    float n3 = vnoise(p + vec2(0.0, e));
    float n4 = vnoise(p - vec2(0.0, e));
    vec2 g = vec2(n1 - n2, n3 - n4);
    return vec2(g.y, -g.x);
  }

  void main() {
    vec2 uv = vUv;
    vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));

    // 1) Advection / swirl
    vec2 p = uv * 1.65;
    vec2 vel = curl(p + uTime * 0.05);
    float activity = mix(0.25, 1.0, smoothstep(0.2, 0.9, uv.y));
    
    // Configurable upward drift
    vel += vec2(0.0, uDrStrengthStrength);

    vec2 advect = vel * (uAdvectStrength * activity) / aspect;
    vec4 prev = texture2D(uPrev, clamp(uv - advect, 0.0, 1.0));

    // 2) Diffuse (bloom)
    vec2 px = 1.0 / uRes;
    vec4 c0 = prev;
    vec4 c1 = texture2D(uPrev, clamp(uv + vec2(px.x, 0.0), 0.0, 1.0));
    vec4 c2 = texture2D(uPrev, clamp(uv - vec2(px.x, 0.0), 0.0, 1.0));
    vec4 c3 = texture2D(uPrev, clamp(uv + vec2(0.0, px.y), 0.0, 1.0));
    vec4 c4 = texture2D(uPrev, clamp(uv - vec2(0.0, px.y), 0.0, 1.0));
    vec4 blur = (c0 * 0.60 + (c1 + c2 + c3 + c4) * 0.10);
    vec4 state = mix(prev, blur, uBlurAmount);

    // 3) Decay (settle / dry)
    float i = state.r;
    float decay = mix(uDecayLow, uDecayHigh, smoothstep(0.2, 1.0, i));
    state.r *= decay;
    if (state.r < 0.0015) state.r = 0.0;

    // 4) Inject spark
    vec2 d = (uv - uPointer) * aspect;
    float dist = length(d);
    float core = 1.0 - smoothstep(0.0, uSparkCoreR, dist);
    float aura = 1.0 - smoothstep(uSparkCoreR, uSparkAuraR, dist);

    if (uDown > 0.5) {
      float add = core * uSparkStrengthStrength + aura * uSparkAuraStrength;
      if (add > 0.0005) {
        state.r = min(1.0, state.r + add);
        state.g = mix(state.g, uPointer.y, 0.25);
        state.b = mix(state.b, uPointer.x, 0.35);
        state.a = mix(state.a, hash(uv * uRes + uTime), 0.35);
      }
    }

    gl_FragColor = state;
  }
`;

const RENDER_FRAG = /* glsl */ `
  precision highp float;
  #define MAX_BANDS 36

  uniform sampler2D uTex;
  uniform vec2 uPointer;
  uniform float uDown;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uCountdown;
  uniform float uPalette[MAX_BANDS * 3];
  uniform float uPowderStrength;

  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  vec3 bandColor(float x01) {
    float b = clamp(floor(x01 * float(MAX_BANDS)), 0.0, float(MAX_BANDS - 1));
    int i = int(b) * 3;
    return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
  }

  vec3 materialize(vec3 base, float y01) {
    if (y01 < 0.33) {
      float t = y01 / 0.33;
      return base * vec3(0.35, 0.75, 1.25) * mix(0.20, 0.55, t);
    } else if (y01 < 0.66) {
      float t = (y01 - 0.33) / 0.33;
      float g = dot(base, vec3(0.299, 0.587, 0.114));
      vec3 smoke = mix(vec3(g), base, 0.35);
      return smoke * mix(0.35, 0.85, t);
    } else {
      float t = (y01 - 0.66) / 0.34;
      return base * vec3(1.35, 0.85, 0.25) * mix(0.65, 2.1, t);
    }
  }

  void main() {
    vec2 uv = vUv;
    vec3 col = vec3(0.010, 0.018, 0.030);
    col += 0.018 * sin(vec3(uv.x * 6.0, uv.y * 7.0, (uv.x + uv.y) * 4.0) + uTime * 0.12);

    vec4 d = texture2D(uTex, uv);
    float intensity = d.r;
    float styleY = d.g;
    float colorX = d.b;
    float seed = d.a;

    if (intensity > 0.001) {
      vec3 base = bandColor(colorX);
      vec3 ink = materialize(base, styleY);

      float body = smoothstep(0.02, 0.35, intensity);
      float powderZone = 1.0 - smoothstep(0.03, 0.14, intensity);
      float grain = hash(uv * uRes * 0.65 + seed * 97.0);
      float powder = powderZone * smoothstep(0.35, 0.80, grain) * uPowderStrength;

      float shimmer = 0.5 + 0.5 * sin((uv.x * 90.0 + uv.y * 70.0) + uTime * 0.7 + seed * 6.0);
      shimmer *= 0.06 * body;

      col += ink * (0.55 * body + 0.35 * intensity);
      col += ink * powder;
      col += ink * shimmer;
    }

    vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
    float dp = length((uv - uPointer) * aspect);
    float sparkR = 0.012;
    float spark = 1.0 - smoothstep(0.0, sparkR, dp);

    vec3 pBase = bandColor(uPointer.x);
    vec3 pInk = materialize(pBase, uPointer.y);
    col += pInk * spark * mix(0.08, 0.20, uDown);

    col *= 1.0 + uCountdown * 0.18;
    col = col / (1.0 + col);
    col = pow(col, vec3(0.4545));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const FlowFieldInstrument: React.FC<Props> = ({
  pointer01,
  downcountProgress = 0,
  simDriftStrength = 0.20,
  simAdvectStrength = 0.010,
  simBlurAmount = 0.10,
  simDecayLow = 0.995,
  simDecayHigh = 0.985,
  sparkCoreRadius = 0.010,
  sparkAuraRadius = 0.030,
  sparkStrengthStrength = 0.70,
  sparkAuraStrength = 0.10,
  powderStrength = 0.25,
}) => {
  const { gl, size } = useThree();
  const palette = useMemo(() => makePaletteArray(), []);

  const targets = useRef<{ a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null>(null);
  const ping = useRef(true);

  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCam = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cam.position.z = 1;
    return cam;
  }, []);

  const simMat = useRef<THREE.ShaderMaterial | null>(null);
  const renderMat = useRef<THREE.ShaderMaterial | null>(null);

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
        uPrev: { value: b.texture },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) },
        uDown: { value: 0 },
        uRes: { value: new THREE.Vector2(size.width, size.height) },
        uTime: { value: 0 },
        uDrStrengthStrength: { value: simDriftStrength },
        uAdvectStrength: { value: simAdvectStrength },
        uBlurAmount: { value: simBlurAmount },
        uDecayLow: { value: simDecayLow },
        ecayHigh: { value: simDecayHigh },
        uSparkCoreR: { value: sparkCoreRadius },
        uSparkAuraR: { value: sparkAuraRadius },
        uSparkStrengthStrength: { value: sparkStrengthStrength },
        uSparkAuraStrength: { value: sparkAuraStrength },
      },
    });

    const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat.current);
    simQuad.frustumCulled = false;
    simScene.add(simQuad);

    const prevClear = gl.getClearColor(new THREE.Color());
    const prevAlpha = gl.getClearAlpha();
    gl.setClearColor(new THREE.Color(0, 0, 0), 1);

    gl.setRenderTarget(a);
    gl.clear(true, true, true);
    gl.setRenderTarget(b);
    gl.clear(true, true, true);

    gl.setRenderTarget(null);
    gl.setClearColor(prevClear, prevAlpha);

    return () => {
      simScene.remove(simQuad);
      simQuad.geometry.dispose();
      simMat.current?.dispose();
      a.dispose();
      b.dispose();
      targets.current = null;
      simMat.current = null;
    };
  }, [size.width, size.height]);

  useEffect(() => {
    if (!targets.current) return;
    targets.current.a.setSize(size.width, size.height);
    targets.current.b.setSize(size.width, size.height);
    if (simMat.current) (simMat.current.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
    if (renderMat.current) (renderMat.current.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
  }, [size.width, size.height]);

  useFrame(({ clock }) => {
    if (!targets.current || !simMat.current || !renderMat.current) return;

    const a = targets.current.a;
    const b = targets.current.b;
    const write = ping.current ? a : b;
    const read = ping.current ? b : a;

    simMat.current.uniforms.uPrev.value = read.texture;
    (simMat.current.uniforms.uPointer.value as THREE.Vector2).set(pointer01.x, pointer01.y);
    simMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    simMat.current.uniforms.uTime.value = clock.elapsedTime;

    gl.setRenderTarget(write);
    gl.render(simScene, simCam);
    gl.setRenderTarget(null);

    renderMat.current.uniforms.uTex.value = write.texture;
    (renderMat.current.uniforms.uPointer.value as THREE.Vector2).set(pointer01.x, pointer01.y);
    renderMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    (renderMat.current.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
    renderMat.current.uniforms.uTime.value = clock.elapsedTime;
    renderMat.current.uniforms.uCountdown.value = downcountProgress;
    renderMat.current.uniforms.uPowderStrength.value = powderStrength;

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
          uTex: { value: null },
          uPointer: { value: new THREE.Vector2(0.5, 0.5) },
          uDown: { value: 0 },
          uRes: { value: new THREE.Vector2(size.width, size.height) },
          uTime: { value: 0 },
          uCountdown: { value: 0 },
          uPalette: { value: palette },
          uPowderStrength: { value: powderStrength },
        }}
      />
    </mesh>
  );
};