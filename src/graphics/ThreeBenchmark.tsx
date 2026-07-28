import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { BenchmarkProfile } from './benchmark'
import { temperatureColor } from './benchmark'

type Props = {
  profile: BenchmarkProfile
  running: boolean
  onRendererInfo: (value: string) => void
}

export function ThreeBenchmark({ profile, running, onRendererInfo }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101827)
    scene.fog = new THREE.Fog(0x101827, profile.side * 0.75, profile.side * 2.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.replaceChildren(renderer.domElement)

    const view = profile.side * 0.68
    const camera = new THREE.OrthographicCamera(-view, view, view * 0.62, -view * 0.62, 0.1, 1000)
    camera.position.set(profile.side * 0.9, profile.side * 1.05, profile.side * 0.9)
    camera.lookAt(0, 0, 0)

    scene.add(new THREE.HemisphereLight(0xbfdcff, 0x34281d, 1.4))
    const keyLight = new THREE.DirectionalLight(0xffe4b8, 2.2)
    keyLight.position.set(profile.side * 0.5, profile.side, profile.side * 0.25)
    scene.add(keyLight)

    const tileGeometry = new THREE.BoxGeometry(0.92, 0.16, 0.92)
    const tileMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.82,
      metalness: 0.02,
      vertexColors: true,
    })
    const tileMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial, profile.tiles)
    tileMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    scene.add(tileMesh)

    const actorGeometry = new THREE.CylinderGeometry(0.18, 0.24, 0.55, 8)
    const actorMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.65,
      vertexColors: true,
    })
    const actorMesh = new THREE.InstancedMesh(actorGeometry, actorMaterial, profile.actors)
    actorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(actorMesh)

    const matrixObject = new THREE.Object3D()
    const color = new THREE.Color()
    const half = (profile.side - 1) * 0.5

    for (let index = 0; index < profile.tiles; index += 1) {
      const x = index % profile.side
      const z = Math.floor(index / profile.side)
      const elevation = ((index * 17) % 9 === 0 ? 0.18 : 0) + ((index * 31) % 53 === 0 ? 0.35 : 0)
      matrixObject.position.set(x - half, elevation, z - half)
      matrixObject.scale.set(1, 1 + elevation * 0.6, 1)
      matrixObject.updateMatrix()
      tileMesh.setMatrixAt(index, matrixObject.matrix)
      color.setHex(temperatureColor(index))
      tileMesh.setColorAt(index, color)
    }
    tileMesh.instanceMatrix.needsUpdate = true
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true

    for (let index = 0; index < profile.actors; index += 1) {
      const x = (index * 17) % profile.side
      const z = (index * 31) % profile.side
      matrixObject.position.set(x - half, 0.45, z - half)
      matrixObject.scale.set(1, 1, 1)
      matrixObject.updateMatrix()
      actorMesh.setMatrixAt(index, matrixObject.matrix)
      color.setHex(index % 4 === 0 ? 0x55a5d9 : index % 3 === 0 ? 0xc55b67 : 0xe7b45c)
      actorMesh.setColorAt(index, color)
    }
    actorMesh.instanceMatrix.needsUpdate = true
    if (actorMesh.instanceColor) actorMesh.instanceColor.needsUpdate = true

    const particlePositions = new Float32Array(profile.particles * 3)
    for (let index = 0; index < profile.particles; index += 1) {
      particlePositions[index * 3] = ((index * 37) % profile.side) - half
      particlePositions[index * 3 + 1] = 1.2 + ((index * 13) % 12) * 0.12
      particlePositions[index * 3 + 2] = ((index * 53) % profile.side) - half
    }
    const particleGeometry = new THREE.BufferGeometry()
    const particleAttribute = new THREE.BufferAttribute(particlePositions, 3)
    particleGeometry.setAttribute('position', particleAttribute)
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xd9edff,
      size: 0.08,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    })
    const weather = new THREE.Points(particleGeometry, particleMaterial)
    scene.add(weather)

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      const aspect = width / height
      camera.left = -view * aspect
      camera.right = view * aspect
      camera.top = view
      camera.bottom = -view
      camera.updateProjectionMatrix()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    let animationFrame = 0
    let frame = 0
    let lastReport = performance.now()

    const render = (time: number) => {
      if (running) {
        const updateCount = Math.max(1, Math.floor(profile.tiles * profile.updateRatio))
        for (let offset = 0; offset < updateCount; offset += 1) {
          const index = (offset + frame * 13) % profile.tiles
          color.setHex(temperatureColor(index, time))
          tileMesh.setColorAt(index, color)
        }
        if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true

        for (let index = 0; index < profile.actors; index += 1) {
          const x = (index * 17) % profile.side
          const z = (index * 31) % profile.side
          const bob = Math.sin(time * 0.004 + index) * 0.08
          matrixObject.position.set(x - half, 0.45 + bob, z - half)
          matrixObject.scale.set(1, 1, 1)
          matrixObject.updateMatrix()
          actorMesh.setMatrixAt(index, matrixObject.matrix)
        }
        actorMesh.instanceMatrix.needsUpdate = true

        for (let index = 0; index < profile.particles; index += 1) {
          const offset = index * 3
          particlePositions[offset] += 0.006 + (index % 5) * 0.0015
          if (particlePositions[offset] > half) particlePositions[offset] = -half
          particlePositions[offset + 1] = 1.4 + ((index * 13) % 12) * 0.12 + Math.sin(time * 0.001 + index) * 0.2
        }
        particleAttribute.needsUpdate = true
        frame += 1
      }

      renderer.render(scene, camera)

      if (time - lastReport > 750) {
        onRendererInfo(`${renderer.info.render.calls} calls · ${renderer.info.render.triangles.toLocaleString()} triangles`)
        lastReport = time
      }

      animationFrame = requestAnimationFrame(render)
    }

    animationFrame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      tileGeometry.dispose()
      tileMaterial.dispose()
      actorGeometry.dispose()
      actorMaterial.dispose()
      particleGeometry.dispose()
      particleMaterial.dispose()
      renderer.dispose()
      host.replaceChildren()
    }
  }, [onRendererInfo, profile, running])

  return (
    <div className="benchmark-stage three-benchmark">
      <div className="canvas-host" ref={hostRef} />
      <div className="benchmark-caption">
        Three.js WebGL：InstancedMesh 地块与 Actor，Points 天气层，固定等轴测相机。
      </div>
    </div>
  )
}
