import { AdditiveBlending, Color, HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget } from "three"
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js"
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js"
import { CopyShader } from "three/addons/shaders/CopyShader.js"

export function createSectionOutline(renderer, scene, camera, transparentTracks = []) {
  const pass = new OutlinePass(new Vector2(1, 1), scene, camera)
  pass.visibleEdgeColor.setHex(0xf3d49a)
  pass.hiddenEdgeColor.setHex(0x000000)
  pass.edgeThickness = 1
  pass.edgeGlow = 0.3
  const overlay = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const quad = new FullScreenQuad(new ShaderMaterial({
    uniforms: { tDiffuse: { value: overlay.texture }, opacity: { value: 1 } },
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
    blending: AdditiveBlending,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }))
  const clearColor = new Color()

  function resize(width, height) {
    const scale = Math.min(1, 960 / width, 640 / height)
    const w = Math.max(2, Math.round(width * scale))
    const h = Math.max(2, Math.round(height * scale))
    pass.setSize(w, h)
    overlay.setSize(w, h)
  }

  function render(objects, strength, dt) {
    renderer.render(scene, camera)
    if (!objects.length || strength < 0.04) return
    const target = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    const alpha = renderer.getClearAlpha()
    const trackVisibility = transparentTracks.map(track => track.visible)
    renderer.getClearColor(clearColor)
    try {
      renderer.setRenderTarget(overlay)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)
      renderer.setClearColor(clearColor, alpha)
      pass.selectedObjects = objects
      pass.edgeStrength = strength
      // A track tints the stage, but should not cut a hole in a player outline.
      for (const track of transparentTracks) track.visible = false
      pass.render(renderer, overlay, overlay, dt, false)
      renderer.setRenderTarget(target)
      renderer.autoClear = false
      quad.render(renderer)
    } finally {
      transparentTracks.forEach((track, i) => { track.visible = trackVisibility[i] })
      renderer.autoClear = autoClear
      renderer.setClearColor(clearColor, alpha)
      renderer.setRenderTarget(target)
    }
  }
  return { resize, render }
}
