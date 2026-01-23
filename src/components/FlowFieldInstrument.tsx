import { useFrame, useThree, createPortal } from '@react-three/fiber';
import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { BAND_COLORS } from '../config/bandColors';

type Props = {
  activeRows: number[];
  handleInteraction: (x: number, y: number) => void;
  countdownProgress: number;
};

export const FlowFieldInstrument: React.FC<Props> = ({
  activeRows,
  handleInteraction,
  countdownProgress,
}) => {
  const { gl, size } = useThree();

  // 1. Setup Palette
  const palette = useMemo(() => {
    const arr = new Float32Array(36 * 3);
    BAND_COLORS.forEach((c, i) => {
      arr[i * 3 + 0] = c.rgb[0] / 255;
      arr[i * 3 + 1] = c.rgb[1] / 255;
      arr[i * 3 + 2] = c.rgb[2] / 255;
    });
    return arr;
  }, []);

  const eqUniform = useMemo(() => new Float32Array(36), []);
  useEffect(() => {
    for (let i = 0; i < 36; i++) eqUniform[i] = activeRows[i];
  }, [activeRows, eqUniform]);

  // 2. Setup Double Buffering (FBO)
  const [targetA, targetB] = useMemo(() => {
    const createTarget = () => new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    return [createTarget(), createTarget()];
  }, [size.width, size.height]);

  const readTarget = useRef(targetA);
  const writeTarget = useRef(targetB);

  const simulationScene = useMemo(() => new THREE.Scene(), []);
  const simMatRef = useRef<THREE.ShaderMaterial>(null!);
  const displayMatRef = useRef<THREE.MeshBasicMaterial>(null!);

  const pointer = useRef(new THREE.Vector2(-1, -1));
  const isDown = useRef(false);

  useFrame((state) => {
    if (!simMatRef.current || !displayMatRef.current) return;

    // PASS 1: Update the simulation (The "Painting")
    simMatRef.current.uniforms.uBuffer.value = readTarget.current.texture;
    simMatRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    simMatRef.current.uniforms.uPointer.value.copy(pointer.current);
    simMatRef.current.uniforms.uIsDown.value = isDown.current ? 1 : 0;
    simMatRef.current.uniforms.uCountdown.value = countdownProgress;

    gl.setRenderTarget(writeTarget.current);
    gl.render(simulationScene, state.camera);
    
    // PASS 2: Display to screen
    gl.setRenderTarget(null);
    displayMatRef.current.map = writeTarget.current.texture;

    // SWAP
    const temp = readTarget.current;
    readTarget.current = writeTarget.current;
    writeTarget.current = temp;
  });

  return (
    <>
      {/* Simulation Plane (Hidden Pass) */}
      {createPortal(
        <mesh>
          <planeGeometry args={[2, 2]} />
          <shaderMaterial
            ref={simMatRef}
            uniforms={{
              uBuffer: { value: null },
              uTime: { value: 0 },
              uPointer: { value: new THREE.Vector2(-1, -1) },
              uIsDown: { value: 0 },
              uPalette: { value: palette },
              uEQ: { value: eqUniform },
              uCountdown: { value: 0 },
              uRes: { value: new THREE.Vector2(size.width, size.height) }
            }}
            vertexShader={`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`}
            fragmentShader={`
              precision highp float;
              uniform sampler2D uBuffer;
              uniform float uTime, uIsDown, uCountdown;
              uniform vec2 uPointer, uRes;
              uniform float uPalette[108], uEQ[36];
              varying vec2 vUv;

              vec3 getBandColor(float x) {
                int i = int(clamp(x * 36.0, 0.0, 35.0)) * 3;
                return vec3(uPalette[i], uPalette[i+1], uPalette[i+2]);
              }

              void main() {
                vec2 uv = vUv;
                vec3 prev = texture2D(uBuffer, uv).rgb;
                
                // Fade logic: rework bands fade faster
                float activeRow = uEQ[int(uv.x * 36.0)];
                prev *= (activeRow >= 0.0) ? 0.985 : 0.996;

                // Turbulence Curl
                vec2 aspect = uRes / min(uRes.x, uRes.y);
                float d = length((uv - uPointer) * aspect);
                float curl = sin(uv.y * 10.0 + uTime) * 0.02;
                
                if (uIsDown > 0.5 && d < 0.12) {
                  vec3 base = getBandColor(uv.x);
                  // Material shifting
                  vec3 color = base;
                  if (uv.y < 0.33) color *= vec3(0.4, 0.7, 1.2); // Water (Colder/Blue)
                  else if (uv.y > 0.66) color *= vec3(1.6, 0.9, 0.3); // Fire (Hotter/Gold)
                  
                  float strength = smoothstep(0.12, 0.0, d + curl);
                  prev += color * strength * 0.25;
                }

                // Final Ritual Reveal
                if (uCountdown > 0.0 && activeRow >= 0.0) {
                  float line = smoothstep(0.01, 0.0, abs(uv.y - (activeRow/36.0)));
                  prev += getBandColor(uv.x) * line * uCountdown * 0.2;
                }

                gl_FragColor = vec4(prev, 1.0);
              }
            `}
          />
        </mesh>,
        simulationScene
      )}

      {/* Visible Interactive Plane */}
      <mesh
        onPointerDown={(e) => { 
          isDown.current = true; 
          pointer.current.copy(e.uv!); 
          handleInteraction(e.uv!.x, e.uv!.y); 
        }}
        onPointerMove={(e) => { 
          pointer.current.copy(e.uv!); 
          if(isDown.current) handleInteraction(e.uv!.x, e.uv!.y); 
        }}
        onPointerUp={() => { 
          isDown.current = false; 
          pointer.current.set(-1, -1); 
        }}
      >
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial ref={displayMatRef} />
      </mesh>
    </>
  );
};