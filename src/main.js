import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1020);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x202030, 1.2));
const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0x4488ff }));
scene.add(box);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop((t) => {
  box.rotation.y = t / 1000;
  camera.position.x = Math.sin(t / 2000) * 10; camera.position.z = Math.cos(t / 2000) * 10;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
});
