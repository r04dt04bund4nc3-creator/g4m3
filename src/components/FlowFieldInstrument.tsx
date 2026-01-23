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
  const { gl, size } = useThree();

  // 1. GPU Palette Setup
  const palette = useMemo(() => {
    const arr = new Float32Array(MAX_BANDS * 3);
    BAND_COLORS.forEach((c, i) => {
      arr[i * 3 + 0] = c.rgb[0] / 255;
      arr[i * 3 + 1] = c.rgb[1] / 255;
      arr[i * 3 + 2] = c.rgb[2] / 255;
    });
    return arr;
  }, []);

  // 2. Ping-Pong Buffers for the "Painting" effect
  const [targetA, targetB] = useMemo(() => {
    const createTarget = () => new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });
    return [createTarget(), createTarget()];
  }, [size.width, size.height]);

  const readTarget = useRef(targetA);
  const writeTarget = useRef(targetB);

  // 3. Materials
  const simMat = useRef<THREE.ShaderMaterial>(null!);
  const displayMat = useRef<THREE.MeshBasicMaterial>(null!);
  
  // We need a separate scene for the simulation pass to avoid feedback loops
  const simScene = useMemo(() => {
    const s = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    s.add(mesh);
    return s;
  }, []);

  useFrame((state) => {
    if (!simMat.current || !displayMat.current) return;

    // STEP 1: Run simulation pass
    simMat.current.uniforms.uBuffer.value = readTarget.current.texture;
    simMat.current.uniforms.uTime.value = state.clock.elapsedTime;
    simMat.current.uniforms.uPointer.value.set(pointer01.x, pointer01.y);
    simMat.current.uniforms.uDown.value = pointer01.down ? 1 : 0;
    simMat.current.uniforms.uCountdown.value = countdownProgress;

    gl.setRenderTarget(writeTarget.current);
    // Use the orthographic camera provided by R3F via state.camera
    gl.render(simScene, state.camera);
    
    // STEP 2: Render results to the screen
    gl.setRenderTarget(null);
    displayMat.current.map = writeTarget.current.texture;

    // STEP 3: Swap targets for the next frame
    const temp = readTarget.current;
    readTarget.current = writeTarget.current;
    writeTarget.current = temp;
  });

  return (
    <>
      {/* Simulation Logic Mesh (Hidden in private scene) */}
      {/* We apply the shader to the mesh inside the private scene manually */}
      {(() => {
        const mesh = simScene.children[0] as THREE.Mesh;
        if (mesh && !simMat.current) {
          mesh.material = new THREE.ShaderMaterial({
            uniforms: {
              uBuffer: { value: null },
              uTime: { value: 0 },
              uPointer: { value: new THREE.Vector2(0.5, 0.5) },
              uDown: { value: 0 },
              uCountdown: { value: 0 },
              uRes: { value: new THREE.Vector2(size.width, size.height) },
              uPalette: { value: palette },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: `
              precision highp float;
              uniform sampler2D uBuffer;
              uniform float uTime, uDown, uCountdown;
              uniform vec2 uPointer, uRes;
              uniform float uPalette[108];
              varying vec2 vUv;

              vec3 getBandColor(float x) {
                float b = clamp(floor(x * 36.0), 0.0, 35.0);
                int i = int(b) * 3;
                return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
              }

              void main() {
                vec2 uv = vUv;
                vec3 prev = texture2D(uBuffer, uv).rgb;
                
                // Persistence: Slow fade creates the "wake"
                prev *= 0.992;

                // Visual streak logic
                vec2 aspect = uRes / min(uRes.x, uRes.y);
                float dist = length((uv - uPointer) * aspect);
                
                // Add curl/turbulence
                float noise = sin(uv.y * 15.0 + uTime * 2.0) * 0.01;
                
                if (uDown > 0.5 && dist < 0.12) {
                  vec3 base = getBandColor(uPointer.x);
                  vec3 ink = base;

                  // MATERIAL TRANSITIONS (Y-AXIS)
                  if (uv.y < 0.33) {
                    // WATER: Deep, cool ripples
                    ink *= vec3(0.4, 0.8, 1.4); 
                  } else if (uv.y > 0.66) {
                    // FIRE: Glowing, sparking embers
                    float spark = pow(max(0.0, sin(uv.x * 100.0 + uTime * 25.0)), 30.0);
                    ink = (ink * 1.5) + (vec3(1.0, 0.6, 0.2) * spark);
                  } else {
                    // SMOKE: Soft, desaturated billowing
                    float gray = dot(ink, vec3(0.299, 0.587, 0.114));
                    ink = vec3(gray) * 0.8;
                  }

                  float strength = smoothstep(0.12, 0.0, dist + noise);
                  prev += ink * strength * 0.25;
                }

                // Global countdown brighten
                prev *= 1.0 + (uCountdown * 0.005);

                gl_FragColor = vec4(prev, 1.0);
              }
            `
          });
          simMat.current = mesh.material as THREE.ShaderMaterial;
        }
        return null;
      })()}

      {/* Visible Mesh (What you actually see) */}
      <mesh frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial ref={displayMat} />
      </mesh>
    </>
  );
};