import { useFrame, useThree } from '@react-three/fiber';
import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BAND_COLORS } from '../config/bandColors';

const MAX_BANDS = 36;

type Props = {
  pointer01: { x: number; y: number; down: boolean };
  countdownProgress: number;
};

export const FlowFieldInstrument: React.FC<Props> = ({ pointer01, countdownProgress }) => {
  const { size } = useThree();
  const mat = useRef<THREE.ShaderMaterial | null>(null);

  const palette = useMemo(() => {
    const arr = new Float32Array(MAX_BANDS * 3);
    BAND_COLORS.forEach((c, i) => {
      arr[i * 3 + 0] = c.rgb[0] / 255;
      arr[i * 3 + 1] = c.rgb[1] / 255;
      arr[i * 3 + 2] = c.rgb[2] / 255;
    });
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!mat.current) return;
    mat.current.uniforms.uTime.value = clock.elapsedTime;
    mat.current.uniforms.uPointer.value.set(pointer01.x, pointer01.y);
    mat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    mat.current.uniforms.uCountdown.value = countdownProgress;
    mat.current.uniforms.uRes.value.set(size.width, size.height);
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        uniforms={{
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2(0.5, 0.5) },
          uDown: { value: 0 },
          uCountdown: { value: 0 },
          uRes: { value: new THREE.Vector2(size.width, size.height) },
          uPalette: { value: palette },
        }}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          precision highp float;

          #define MAX_BANDS 36

          uniform float uTime;
          uniform vec2 uPointer;   // 0..1
          uniform float uDown;
          uniform float uCountdown;
          uniform vec2 uRes;
          uniform float uPalette[MAX_BANDS * 3];

          varying vec2 vUv;

          vec3 bandColor(float x01) {
            float b = clamp(floor(x01 * float(MAX_BANDS)), 0.0, float(MAX_BANDS - 1));
            int i = int(b) * 3;
            return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
          }

          vec3 materialize(vec3 base, float y01) {
            if (y01 < 0.33) {
              float t = y01 / 0.33;
              return base * vec3(0.35, 0.7, 1.2) * mix(0.25, 0.55, t);
            } else if (y01 < 0.66) {
              float g = dot(base, vec3(0.299, 0.587, 0.114));
              vec3 gray = vec3(g);
              float t = (y01 - 0.33) / 0.33;
              return mix(gray, base, 0.2) * mix(0.35, 0.75, t);
            } else {
              float t = (y01 - 0.66) / 0.34;
              return base * vec3(1.35, 0.85, 0.25) * mix(0.7, 1.8, t);
            }
          }

          void main() {
            vec2 uv = vUv;

            // base background
            vec3 col = vec3(0.01, 0.04, 0.06);
            col += 0.05 * sin(vec3(uv.x * 10.0, uv.y * 14.0, (uv.x+uv.y) * 6.0) + uTime * 0.2);

            // pointer glow
            vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
            float d = length((uv - uPointer) * aspect);

            vec3 base = bandColor(uPointer.x);
            vec3 ink = materialize(base, uPointer.y);

            float radius = mix(0.09, 0.05, uDown);
            float glow = smoothstep(radius, 0.0, d);
            col += ink * glow * (0.9 + 0.6 * uDown);

            // countdown: subtle global lift so performer feels the end approaching
            col *= 1.0 + uCountdown * 0.25;

            // tonemap
            col = col / (1.0 + col);
            col = pow(col, vec3(0.4545));
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
};