import * as THREE from 'three';
import { useRef, useState, Suspense } from 'react';
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import { useFBO, useGLTF, MeshTransmissionMaterial, useTexture } from '@react-three/drei';
import { easing } from 'maath';

function LensScene({ imageSrc, ior = 1.15, thickness = 5, chromaticAberration = 0.1, anisotropy = 0.01, scale = 0.22 }) {
  const lensRef = useRef();
  const { nodes } = useGLTF('/assets/3d/lens.glb');
  const texture = useTexture(imageSrc);
  const buffer = useFBO();
  const { viewport, pointer, camera } = useThree();
  const [bgScene] = useState(() => new THREE.Scene());

  useFrame((state, delta) => {
    const { gl } = state;
    const v = state.viewport.getCurrentViewport(camera, [0, 0, 5]);
    easing.damp3(lensRef.current.position, [pointer.x * v.width / 2, pointer.y * v.height / 2, 5], 0.12, delta);

    gl.setRenderTarget(buffer);
    gl.render(bgScene, camera);
    gl.setRenderTarget(null);
  });

  const geo = nodes?.Cylinder?.geometry;

  return (
    <>
      {createPortal(
        <mesh scale={[viewport.width, viewport.height, 1]}>
          <planeGeometry />
          <meshBasicMaterial map={texture} />
        </mesh>,
        bgScene
      )}
      <mesh scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry />
        <meshBasicMaterial map={buffer.texture} transparent />
      </mesh>
      {geo && (
        <mesh ref={lensRef} scale={scale} rotation-x={Math.PI / 2} geometry={geo}>
          <MeshTransmissionMaterial
            buffer={buffer.texture}
            ior={ior}
            thickness={thickness}
            anisotropy={anisotropy}
            chromaticAberration={chromaticAberration}
          />
        </mesh>
      )}
    </>
  );
}

export default function FluidGlass({ imageSrc, lensProps = {} }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 20], fov: 15 }}
      gl={{ alpha: true }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <Suspense fallback={null}>
        <LensScene imageSrc={imageSrc} {...lensProps} />
      </Suspense>
    </Canvas>
  );
}
