import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

const MAX_BANDS = 36;

type Props = {
  pointer01: { x: number; y: number; down: boolean };
  countdownProgress?: number;
};

// Generate a vibrant palette array (0.0 to 1.0 RGB)
function makePaletteArray() {
  const arr = new Float32Array(MAX_BANDS * 3);
  // Create a vibrant rainbow palette
  for (let i = 0; i < MAX_BANDS; i++) {
    const hue = i / MAX_BANDS;
    // HSV to RGB conversion (simplified for shader compatibility)
    // We want high saturation (1.0) and high value (1.0)
    const rgb = hsvToRgb(hue, 1.0, 1.0);
    arr[i * 3 + 0] = rgb[0];
    arr[i * 3 + 1] = rgb[1];
    arr[i * 3 + 2] = rgb[2];
  }
  return arr;
}

// Helper: HSV to RGB (0-1 range)
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: r = 0; g = 0; b = 0;
  }
  return [r, g, b];
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
  uniform vec2 uPointerVel;
  uniform float uDown;
  uniform vec2 uRes;
  uniform float uTime;

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

    // 1) Advection
    vec2 p = uv * 1.65;
    vec2 vel = curl(p + uTime * 0.05);
    float activity = mix(0.25, 1.0, smoothstep(0.2, 0.9, uv.y));
    
    // Gentle upward drift (incense)
    vel += vec2(0.0, 0.05 * activity);
    
    // Advect backwards (wake behind finger)
    float advectStrength = 0.012 * activity;
    vec2 advect = vel * advectStrength / aspect;
    
    // If moving, shift sample point backwards
    float speed = length(uPointerVel);
    if (speed > 0.001) {
      vec2 dir = normalize(uPointerVel);
      advect += dir * 0.05; // Extra push backwards
    }

    vec4 prev = texture2D(uPrev, clamp(uv - advect, 0.0, 1.0));

    // 2) Diffuse
    vec2 px = 1.0 / uRes;
    vec4 c0 = prev;
    vec4 c1 = texture2D(uPrev, clamp(uv + vec2(px.x, 0.0), 0.0, 1.0));
    vec4 c2 = texture2D(uPrev, clamp(uv - vec2(px.x, 0.0), 0.0, 1.0));
    vec4 c3 = texture2D(uPrev, clamp(uv + vec2(0.0, px.y), 0.0, 1.0));
    vec4 c4 = texture2D(uPrev, clamp(uv - vec2(0.0, px.y), 0.0, 1.0));
    vec4 blur = (c0 * 0.60 + (c1 + c2 + c3 + c4) * 0.10);
    vec4 state = mix(prev, blur, 0.12);

    // 3) Decay
    float i = state.r;
    float decay = mix(0.994, 0.982, smoothstep(0.2, 1.0, i));
    state.r *= decay;
    if (state.r < 0.001) state.r = 0.0;

    // 4) Inject Spark (Fuse)
    vec2 center = uPointer;
    if (uDown > 0.5 && speed > 0.001) {
      vec2 dir = normalize(uPointerVel);
      center = uPointer - dir * 0.06; // Behind the motion
    }

    vec2 d = (uv - center) * aspect;
    float dist = length(d);
    float coreR = 0.006;
    float auraR = 0.020;
    float core = 1.0 - smoothstep(0.0, coreR, dist);
    float aura = 1.0 - smoothstep(coreR, auraR, dist);

    if (uDown > 0.5) {
      float add = core * 0.80 + aura * 0.15;
      if (add > 0.0005) {
        state.r = min(1.0, state.r + add);
        state.g = mix(state.g, uPointer.y, 0.3);
        state.b = mix(state.b, uPointer.x, 0.4);
        state.a = mix(state.a, hash(uv * uRes + uTime), 0.4);
      }
    }

    gl_FragColor = state;
  }
`;

const RENDER_FRAG = /* glsl */ `
  precision highp float;
  #define MAX_BANDS 36.0

  uniform sampler2D uTex;
  uniform vec2 uPointer;
  uniform float uDown;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uCountdown;
  uniform float uPalette[MAX_BANDS * 3];

  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  // Convert 0..1 to RGB using the palette
  vec3 getBandColor(float x) {
    float idx = x * (MAX_BANDS - 1.0);
    float floorIdx = floor(idx);
    float fractIdx = fract(idx);
    
    int i0 = int(floorIdx) * 3;
    int i1 = int(min(floorIdx + 1.0, MAX_BANDS - 1.0)) * 3;
    
    vec3 c0 = vec3(uPalette[i0], uPalette[i0+1], uPalette[i0+2]);
    vec3 c1 = vec3(uPalette[i1], uPalette[i1+1], uPalette[i1+2]);
    
    return mix(c0, c1, fractIdx);
  }

  vec3 materialize(vec3 base, float y) {
    // y: 0=water, 0.5=smoke, 1=fire
    if (y < 0.35) {
      // Water: Cool, bright
      return base * vec3(0.4, 0.8, 1.5); 
    } else if (y < 0.65) {
      // Smoke: Desaturated but colorful
      float g = dot(base, vec3(0.299, 0.587, 0.114));
      return mix(vec3(g), base, 0.5) * 1.2;
    } else {
      // Fire: Hot, emissive
      return base * vec3(1.5, 1.0, 0.5) * 1.5;
    }
  }

  void main() {
    vec2 uv = vUv;
    
    // Deep space background
    vec3 col = vec3(0.005, 0.01, 0.015);
    
    // Subtle background noise
    col += vec3(0.01) * hash(uv * 100.0);

    // Sample simulation
    vec4 d = texture2D(uTex, uv);
    float intensity = d.r;
    float styleY = d.g;
    float colorX = d.b;

    // Only render if there's energy
    if (intensity > 0.005) {
      // POSTERIZATION: Create hard edges between colors to avoid mud
      // This creates the "powder cloud" look
      float posterize = 20.0;
      intensity = floor(intensity * posterize) / posterize;
      
      // Get base color from palette
      vec3 base = getBandColor(colorX);
      vec3 ink = materialize(base, styleY);

      // ADDITIVE BLENDING: Colors add light, don't mix paint
      // This is key for the "explosion" look
      float brightness = pow(intensity, 0.8) * 2.0;
      col += ink * brightness;

      // POWDER EFFECT: Granular sparkles on top
      if (intensity > 0.1) {
        float grain = hash(uv * uRes * 3.0 + uTime * 10.0);
        // Only show grain in bright areas
        float powder = step(0.8, grain) * intensity;
        col += ink * powder * 0.5;
      }
    }

    // Pointer spark (subtle guide)
    vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
    float dp = length((uv - uPointer) * aspect);
    float spark = 1.0 - smoothstep(0.0, 0.015, dp);
    vec3 pInk = materialize(getBandColor(uPointer.x), uPointer.y);
    col += pInk * spark * 0.5 * float(uDown);

    // Tone mapping (Reinhard) to handle high brightness without clipping
    col = col / (col + vec3(1.0));
    
    // Gamma correction
    col = pow(col, vec3(0.4545));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const FlowFieldInstrument: React.FC<Props> = ({
  pointer01,
  countdownProgress = 0,
}) => {
  const { gl, size } = useThree();
  const palette = useMemo(() => makePaletteArray(), []);

  const targets = useRef<{ a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget } | null>(null);
  const ping = useRef(true);
  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCam = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  
  // Velocity tracking
  const prevPointerRef = useRef(new THREE.Vector2(0.5, 0.5));

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
        uPointerVel: { value: new THREE.Vector2(0.0, 0.0) },
        uDown: { value: 0 },
        uRes: { value: new THREE.Vector2(size.width, size.height) },
        uTime: { value: 0 },
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
  }, [size.width, size.height, gl]);

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

    // Calculate velocity
    const prev = prevPointerRef.current;
    const vx = pointer01.x - prev.x;
    const vy = pointer01.y - prev.y;
    prev.set(pointer01.x, pointer01.y);

    // Sim pass
    simMat.current.uniforms.uPrev.value = read.texture;
    (simMat.current.uniforms.uPointer.value as THREE.Vector2).set(pointer01.x, pointer01.y);
    (simMat.current.uniforms.uPointerVel.value as THREE.Vector2).set(vx, vy);
    simMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    simMat.current.uniforms.uTime.value = clock.elapsedTime;

    gl.setRenderTarget(write);
    gl.render(simScene, simCam);
    gl.setRenderTarget(null);

    // Render pass
    renderMat.current.uniforms.uTex.value = write.texture;
    (renderMat.current.uniforms.uPointer.value as THREE.Vector2).set(pointer01.x, pointer01.y);
    renderMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    (renderMat.current.uniforms.uRes.value as THREE.Vector2).set(size.width, size.height);
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
          uTex: { value: null },
          uPointer: { value: new THREE.Vector2(0.5, 0.5) },
          uDown: { value: 0 },
          uRes: { value: new THREE.Vector2(size.width, size.height) },
          uTime: { value: 0 },
          uCountdown: { value: 0 },
          uPalette: { value: palette },
        }}
      />
    </mesh>
  );
};