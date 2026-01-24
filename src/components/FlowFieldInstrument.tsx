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

const FSQ_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * SIMULATION SHADER
 * Logic: Buoyancy (upward drift) + Advection (swirl) + Injection (pointer)
 */
const SIM_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uPrev;
  uniform vec2 uPointer;
  uniform float uDown;
  uniform vec2 uRes;
  uniform float uTime;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // 1. BUOYANCY & CURL
    // We sample slightly below the current pixel to make colors "rise"
    // We add a tiny bit of horizontal oscillation (smoke curl)
    float drift = 0.0015;
    float curl = sin(vUv.y * 10.0 + uTime * 2.0) * 0.001;
    vec2 sampleCoord = vUv + vec2(curl, -drift);
    
    vec4 prev = texture2D(uPrev, sampleCoord);

    // 2. DECAY
    // Slowly fade intensity, but keep the color/style data longer
    prev.r *= 0.994; 
    if (prev.r < 0.001) prev.r = 0.0;

    // 3. BRUSH (The Spark)
    vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
    float d = length((vUv - uPointer) * aspect);

    // Tiny concentrated spark
    float radius = 0.008;
    float brush = smoothstep(radius, 0.0, d);

    if (uDown > 0.5 && brush > 0.0) {
      float add = brush * 0.8;
      prev.r = min(1.0, prev.r + add);
      // Inject style and color
      prev.g = mix(prev.g, uPointer.y, 0.2);
      prev.b = uPointer.x;
      prev.a = 1.0;
    }

    gl_FragColor = prev;
  }
`;

/**
 * RENDER SHADER
 * Logic: Background ambiance + Materializing Smoke/Water/Fire + Powder Grain
 */
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

  varying vec2 vUv;

  float rand(vec2 n) { 
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
  }

  vec3 getPaletteColor(float x01) {
    float b = clamp(floor(x01 * float(MAX_BANDS)), 0.0, float(MAX_BANDS - 1.0));
    int i = int(b) * 3;
    // Manual lookup to avoid dynamic indexing issues on some mobile GPUs
    for(int j=0; j<MAX_BANDS; j++) {
      if(int(b) == j) return vec3(uPalette[j*3], uPalette[j*3+1], uPalette[j*3+2]);
    }
    return vec3(0.5);
  }

  void main() {
    // 1. ATMOSPHERIC BACKGROUND
    vec3 col = vec3(0.005, 0.008, 0.012);
    float bgNoise = rand(vUv + uTime * 0.01);
    col += bgNoise * 0.015; // Subtle background static

    // 2. SAMPLE SIMULATION
    vec4 data = texture2D(uTex, vUv);
    float intensity = data.r;
    float styleY = data.g;
    float colorX = data.b;

    if (intensity > 0.0) {
      vec3 base = getPaletteColor(colorX);
      vec3 material;

      // Logic for Water -> Smoke -> Fire transitions
      if (styleY < 0.33) {
        // WATER
        material = base * vec3(0.6, 0.9, 1.4) * (0.4 + intensity);
      } else if (styleY < 0.66) {
        // SMOKE
        float gray = dot(base, vec3(0.299, 0.587, 0.114));
        material = mix(vec3(gray), base, 0.4) * (0.6 + intensity);
      } else {
        // FIRE
        material = base * (1.2 + intensity * 3.0) + vec3(0.4, 0.1, 0.0) * intensity;
      }

      // 3. POWDER EFFECT
      // Add fine grain to the settled pigment
      float grain = rand(vUv * 500.0) * 0.2;
      material *= (1.0 - grain * (1.0 - intensity));

      col = mix(col, material, smoothstep(0.0, 0.1, intensity));
    }

    // 4. THE FLAME TIP (The Pointer)
    vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
    float distToPointer = length((vUv - uPointer) * aspect);
    float spark = smoothstep(0.012, 0.0, distToPointer);
    
    if (uDown > 0.5) {
      vec3 sparkColor = getPaletteColor(uPointer.x) * 2.0;
      col += sparkColor * spark * 0.8;
    }

    // 5. POST
    col *= (1.0 + uCountdown * 0.4); // End of ritual glow
    col = col / (1.0 + col); // Reinhard-ish tonemap
    col = pow(col, vec3(0.4545)); // Gamma correction

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const FlowFieldInstrument: React.FC<Props> = ({
  pointer01,
  countdownProgress = 0,
}) => {
  const { gl, size } = useThree();

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
      },
    });

    const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat.current);
    simQuad.frustumCulled = false;
    simScene.add(simQuad);

    return () => {
      simScene.remove(simQuad);
      simQuad.geometry.dispose();
      simMat.current?.dispose();
      a.dispose();
      b.dispose();
    };
  }, [gl, size.width, size.height, simScene]);

  useFrame(({ clock }) => {
    if (!targets.current || !simMat.current || !renderMat.current) return;

    const { a, b } = targets.current;
    const write = ping.current ? a : b;
    const read = ping.current ? b : a;

    // Simulation Step
    simMat.current.uniforms.uPrev.value = read.texture;
    simMat.current.uniforms.uPointer.value.set(pointer01.x, pointer01.y);
    simMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    simMat.current.uniforms.uTime.value = clock.elapsedTime;

    gl.setRenderTarget(write);
    gl.render(simScene, simCam);
    gl.setRenderTarget(null);

    // Render Step
    renderMat.current.uniforms.uTex.value = write.texture;
    renderMat.current.uniforms.uPointer.value.set(pointer01.x, pointer01.y);
    renderMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    renderMat.current.uniforms.uTime.value = clock.elapsedTime;
    renderMat.current.uniforms.uCountdown.value = countdownProgress;
    renderMat.current.uniforms.uRes.value.set(size.width, size.height);

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