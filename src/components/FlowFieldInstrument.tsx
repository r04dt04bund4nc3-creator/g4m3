import { useFrame, useThree } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BAND_COLORS } from '../config/bandColors';

const MAX_BANDS = 36;

type Props = {
  activeRows: number[];
  handleInteraction: (uv: THREE.Vector2) => void;
  countdownProgress: number; // 0..1 during last 36s
};

export const FlowFieldInstrument: React.FC<Props> = ({
  activeRows,
  handleInteraction,
  countdownProgress,
}) => {
  const { size } = useThree();

  const pointer = useRef(new THREE.Vector2(-10, -10));
  const lastPointer = useRef(new THREE.Vector2(-10, -10));
  const pointerDown = useRef(false);

  // palette packed for GPU
  const palette = useMemo(() => {
    const arr = new Float32Array(MAX_BANDS * 3);
    BAND_COLORS.forEach((c, i) => {
      arr[i * 3 + 0] = c.rgb[0] / 255;
      arr[i * 3 + 1] = c.rgb[1] / 255;
      arr[i * 3 + 2] = c.rgb[2] / 255;
    });
    return arr;
  }, []);

  const activeRowsUniform = useMemo(() => new Float32Array(MAX_BANDS), []);
  useEffect(() => {
    for (let i = 0; i < MAX_BANDS; i++) activeRowsUniform[i] = activeRows[i];
  }, [activeRows, activeRowsUniform]);

  // shader material ref so we can tick time and pointer
  const matRef = useRef<THREE.ShaderMaterial | null>(null);

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value = clock.elapsedTime;
    matRef.current.uniforms.uPointer.value.copy(pointer.current);
    matRef.current.uniforms.uLastPointer.value.copy(lastPointer.current);
    matRef.current.uniforms.uPointerDown.value = pointerDown.current ? 1 : 0;
    matRef.current.uniforms.uCountdown.value = countdownProgress;
    matRef.current.uniforms.uActiveRows.value = activeRowsUniform;
  });

  const onPointerDown = (e: any) => {
    pointerDown.current = true;
    lastPointer.current.copy(pointer.current);
    pointer.current.copy(e.uv);
    handleInteraction(e.uv);
  };

  const onPointerMove = (e: any) => {
    lastPointer.current.copy(pointer.current);
    pointer.current.copy(e.uv);
    if (pointerDown.current || e.pointerType === 'touch' || e.buttons > 0) {
      handleInteraction(e.uv);
    }
  };

  const onPointerUp = () => {
    pointerDown.current = false;
    pointer.current.set(-10, -10);
    lastPointer.current.set(-10, -10);
  };

  return (
    <mesh
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        uniforms={{
          uTime: { value: 0 },
          uPointer: { value: new THREE.Vector2(-10, -10) },
          uLastPointer: { value: new THREE.Vector2(-10, -10) },
          uPointerDown: { value: 0 },
          uCountdown: { value: 0 },
          uPalette: { value: palette },
          uActiveRows: { value: activeRowsUniform },
          uResolution: { value: new THREE.Vector2(size.width, size.height) },
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
          #define MAX_ROWS 36

          uniform float uTime;
          uniform vec2 uPointer;
          uniform vec2 uLastPointer;
          uniform float uPointerDown;
          uniform float uCountdown;
          uniform float uPalette[MAX_BANDS * 3];
          uniform float uActiveRows[MAX_BANDS];
          uniform vec2 uResolution;

          varying vec2 vUv;

          vec3 bandColor(float band) {
            int i = int(band) * 3;
            return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
          }

          vec3 materialize(vec3 base, float y) {
            if (y < 0.33) {
              float t = y / 0.33;
              return base * vec3(0.55, 0.8, 1.1) * mix(0.35, 0.65, t);
            } else if (y < 0.66) {
              float t = (y - 0.33) / 0.33;
              float g = dot(base, vec3(0.299, 0.587, 0.114));
              vec3 gray = vec3(g);
              return mix(gray, base, 0.25) * mix(0.55, 0.85, t);
            } else {
              float t = (y - 0.66) / 0.34;
              return base * vec3(1.25, 0.85, 0.35) * mix(0.8, 1.8, t);
            }
          }

          vec2 curl(vec2 p) {
            float s = sin(p.x * 6.0 + uTime * 1.7) + cos(p.y * 6.5 - uTime * 1.3);
            float c = cos(p.x * 5.2 - uTime * 1.1) - sin(p.y * 5.8 + uTime * 1.5);
            return vec2(s, c);
          }

          void main() {
            vec2 uv = vUv;

            // base background: dark teal circuitry hint
            vec3 color = vec3(0.02, 0.06, 0.08);
            color += 0.08 * sin(vec3(uv.x * 12.0, uv.y * 18.0, (uv.x+uv.y)*6.0));

            vec2 aspect = vec2(uResolution.x / min(uResolution.x, uResolution.y),
                               uResolution.y / min(uResolution.x, uResolution.y));
            float d = length((uv - uPointer) * aspect);
            vec2 v = (uPointer - uLastPointer) * aspect;
            float speed = clamp(length(v) * 60.0, 0.0, 2.0);

            float band = clamp(floor(uv.x * float(MAX_BANDS)), 0.0, float(MAX_BANDS - 1));
            vec3 base = bandColor(band);

            // pointer trail
            if (uPointerDown > 0.5 && uPointer.x > -1.0) {
              vec2 w = curl(uv * 2.0) * (0.002 + speed * 0.004);
              float radius = mix(0.08, 0.03, clamp(speed, 0.0, 1.0));
              float core = smoothstep(radius, 0.0, length((uv + w - uPointer) * aspect));

              vec3 ink = materialize(base, uv.y);
              color += ink * core * (0.7 + speed * 0.8);

              // ember sparkle in upper third
              if (uv.y > 0.66) {
                float spark = pow(max(0.0, sin((uv.x + uv.y) * 120.0 + uTime * 18.0)), 20.0);
                color += ink * spark * 0.4 * core;
              }
            }

            // countdown: energize + thin EQ lines
            if (uCountdown > 0.0) {
              float energize = 1.0 + uCountdown * 0.35;
              color *= energize;

              int bandIdx = int(band);
              float row = uActiveRows[bandIdx];
              if (row >= 0.0) {
                float rowNorm = clamp(row / float(MAX_ROWS), 0.0, 1.0);
                float line = smoothstep(rowNorm - 0.005, rowNorm, uv.y) *
                             smoothstep(rowNorm + 0.005, rowNorm, uv.y);
                color += materialize(base, rowNorm) * line * (0.6 * uCountdown);
              }
            }

            color = clamp(color, 0.0, 1.2);
            color = color / (1.0 + color);
            color = pow(color, vec3(0.4545));

            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  );
};