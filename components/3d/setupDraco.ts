/**
 * Configure Draco decoder path for useGLTF so Draco-compressed GLBs load correctly.
 * Import this from any component that uses useGLTF (ModelViewer, TableWithModel).
 *
 * Using the official CDN. To self-host: copy node_modules/three/examples/jsm/libs/draco/gltf/*
 * to public/draco/gltf/ and set DRACO_DECODER_PATH to '/draco/gltf/'.
 */
import { useGLTF } from '@react-three/drei'

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'

useGLTF.setDecoderPath(DRACO_DECODER_PATH)
