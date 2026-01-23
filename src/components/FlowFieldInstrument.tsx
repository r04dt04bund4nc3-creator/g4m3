import React, { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BAND_COLORS } from '../config/bandColors';

const MAX_BANDS = 36;

type Props = {
  pointer01: { x: number; y: number; down: boolean };
  countdownProgress: number;
};

export const FlowFieldInstrument: React.FC<Props> = ({ pointer01, countdownProgress }) => {
  const mat = useRef<THREE.ShaderMaterial | null>(null);

  // IMPORTANT: invalidate() forces a redraw when uniforms change
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);

  const palette = useMemo(() => {
    const arr = new Float32Array(MAX_BANDS * 3);
    BAND_COLORS.forEach((c, i) => {
      arr[i * 3 + 0] = c.rgb[0] / 255;
      arr[i * 3 + 1] = c.rgb[1] / 255;
      arr[i * 3 + 2] = c.rgb[2] / 255;
    });
    return arr;
  }, []);

  // Push React state -> shader uniforms (no useFrame needed)
  useEffect(() => {
    if (!mat.current) return;

    mat.current.uniforms.uPointer.value.set(pointer01.x, pointer01.y);
    mat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    mat.current.uniforms.uCountdown.value = countdownProgress;
    mat.current.uniforms.uRes.value.set(size.width, size.height);

    // force redraw
    invalidate();
  }, [
    pointer01.x,
    pointer01.y,
    pointer01.down,
    countdownProgress,
    size.width,
    size.height,
    invalidate,
  ]);

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        uniforms={{
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

          uniform vec2 uPointer;   // 0..1
          uniform float uDown;     // 0/1
          uniform float uCountdown;
          uniform vec2 uRes;
          uniform float uPalette[MAX_BANDS * 3];

          varying vec2 vUv;

          vec3 bandColor(float x01) {
            float b = clamp(floor(x01 * float(MAX_BANDS)), 0.0, float(MAX_BANDS - 1));
            int i = int(b) * 3;
            return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
          }

          void main() {
            vec2 uv = vUv;

            // DEBUG BACKGROUND:
            // This should visibly change color as your pointer moves.
            vec3 debug = vec3(uPointer.x, uPointer.y, uDown);

            // dark base + debug tint so it's obvious when uniforms change
            vec3 col = vec3(0.02, 0.04, 0.07);
            col = mix(col, debug, 0.35);

            // dot under pointer
            vec2 aspect = vec2(uRes.x / min(uRes.x, uRes.y), uRes.y / min(uRes.x, uRes.y));
            float d = length((uv - uPointer) * aspect);
            float dot = smoothstep(0.08, 0.0, d);

            vec3 dotCol = bandColor(uPointer.x);
            col += dotCol * dot * (1.2 + 0.8 * uDown);

            // subtle "end is coming" lift
            col *= 1.0 + uCountdown * 0.2;

            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
};