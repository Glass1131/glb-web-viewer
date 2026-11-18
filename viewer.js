import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * 뷰어 기본 설정값 (필요에 맞게 커스터마이징하세요)
 */
const VIEWER_CONFIG = {
  // 기본 로드할 .glb 경로 (URL 쿼리 ?model=경로 로도 덮어쓸 수 있음)
  modelUrl: './models/model.glb',
  // 외부 HDRI(.hdr)를 쓰려면 경로 지정, null이면 내장 스튜디오 환경(RoomEnvironment) 사용
  hdriUrl: null,
  // 배경색 및 투명도
  backgroundColor: '#1a1d24',
  transparentBackground: false,
  // PBR 환경광 & 3점 조명 강도
  environmentIntensity: 0.65,
  enableThreePointLights: true,
  enableShadows: true,
  // 톤 매핑: NeutralToneMapping(블렌더 원색 유지) 또는 ACESFilmicToneMapping(시네마틱)
  toneMapping: THREE.NeutralToneMapping,
  toneMappingExposure: 1.0,
  // 카메라 자동 프레이밍 여백 배수 (1.0에 가까울수록 화면에 꽉 참)
  fitMargin: 1.25,
  // 모드별 기본 시야각 (세로 FOV, 도 단위)
  orbitFov: 60,
  spectatorFov: 75,
  // 초기 자동 회전 여부
  autoRotate: false,
  autoRotateSpeed: 1.5,
};

const DRACO_DECODER_URL =
  'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/draco/gltf/';

const dom = {
  stage: document.getElementById('viewer-stage'),
  canvas: document.getElementById('viewer-canvas'),
  statusOverlay: document.getElementById('status-overlay'),
  statusTitle: document.getElementById('status-title'),
  statusDetail: document.getElementById('status-detail'),
  progressBar: document.getElementById('progress-bar'),
  progressFill: document.getElementById('progress-fill'),
  overlayFileBtn: document.getElementById('overlay-file-btn'),
  openFileBtn: document.getElementById('open-file-btn'),
  fileInput: document.getElementById('file-input'),
  spectatorBtn: document.getElementById('spectator-btn'),
  resetCameraBtn: document.getElementById('reset-camera-btn'),
  autoRotateBtn: document.getElementById('autorotate-btn'),
  animationBtn: document.getElementById('animation-btn'),
  transparentBtn: document.getElementById('transparent-btn'),
  bgColorInput: document.getElementById('bg-color-input'),
  fovSlider: document.getElementById('fov-slider'),
  fovValue: document.getElementById('fov-value'),
  hintBadge: document.getElementById('hint-badge'),
  playlistToggleBtn: document.getElementById('playlist-toggle-btn'),
  playlistPanel: document.getElementById('playlist-panel'),
  playlistTitle: document.getElementById('playlist-title'),
  playlistItems: document.getElementById('playlist-items'),
  playlistAddBtn: document.getElementById('playlist-add-btn'),
  playlistClearBtn: document.getElementById('playlist-clear-btn'),
  prevModelBtn: document.getElementById('prev-model-btn'),
  nextModelBtn: document.getElementById('next-model-btn'),
  toolbarPrevBtn: document.getElementById('toolbar-prev-btn'),
  toolbarNextBtn: document.getElementById('toolbar-next-btn'),
  playlistCounter: document.getElementById('playlist-counter'),
};

const state = {
  currentModel: null,
  mixer: null,
  animationActions: [],
  isAnimationPlaying: true,
  isTransparent: VIEWER_CONFIG.transparentBackground,
  backgroundColor: VIEWER_CONFIG.backgroundColor,
  loadId: 0,
  envTexture: null,
  cameraMode: 'orbit', // 'orbit' | 'spectator'
  orbitFov: VIEWER_CONFIG.orbitFov,
  spectatorFov: VIEWER_CONFIG.spectatorFov,
  modelRadius: 1,
  spectatorSpeedMultiplier: 1.0,
  spectatorEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
  spectatorVelocity: new THREE.Vector3(),
  keysPressed: new Set(),
  isDraggingLook: false,
  lastPointer: { x: 0, y: 0 },
  playlist: [], // { id, name, sizeBytes, file?, url? }
  activePlaylistIndex: -1,
  nextPlaylistId: 1,
  isPlaylistOpen: false,
};

const _forwardVec = new THREE.Vector3();
const _rightVec = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

// 1. 렌더러, 씬, 카메라, 컨트롤 초기화
const renderer = createRenderer(dom.canvas);
const scene = new THREE.Scene();
scene.environmentIntensity = VIEWER_CONFIG.environmentIntensity;

const camera = new THREE.PerspectiveCamera(VIEWER_CONFIG.orbitFov, 1, 0.01, 1000);
const controls = createControls(camera, dom.canvas);
const lights = createThreePointLights(scene);
const shadowFloor = createShadowFloor(scene);
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const timer = new THREE.Timer();
timer.connect(document);

// 2. GLTFLoader + DRACOLoader(블렌더 Draco 압축 지원)
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO_DECODER_URL);

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// 3. 초기 환경광, 배경, 리사이즈, UI 바인딩 실행
init();

async function init() {
  applyBackground();
  await setupEnvironment(VIEWER_CONFIG.hdriUrl);
  handleResize();

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(dom.stage);

  setupUI();
  setupDesktopIntegration();
  renderer.setAnimationLoop(animate);

  const queryModel = new URLSearchParams(window.location.search).get('model');
  if (queryModel) {
    loadGLB(queryModel);
  } else if (window.desktopAPI) {
    showWelcomeState();
  } else {
    loadGLB(VIEWER_CONFIG.modelUrl);
  }
}

function createRenderer(canvas) {
  const webglRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true, // 투명 배경 지원을 위해 필수
    powerPreference: 'high-performance',
  });
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
  webglRenderer.toneMapping = VIEWER_CONFIG.toneMapping;
  webglRenderer.toneMappingExposure = VIEWER_CONFIG.toneMappingExposure;
  webglRenderer.shadowMap.enabled = VIEWER_CONFIG.enableShadows;
  webglRenderer.shadowMap.type = THREE.PCFShadowMap;
  return webglRenderer;
}

function createControls(targetCamera, canvas) {
  const orbit = new OrbitControls(targetCamera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;
  orbit.enableZoom = true;
  orbit.enablePan = true;
  orbit.screenSpacePanning = true;
  orbit.autoRotate = VIEWER_CONFIG.autoRotate;
  orbit.autoRotateSpeed = VIEWER_CONFIG.autoRotateSpeed;
  return orbit;
}

/**
 * PBR 텍스처(Roughness/Normal) 입체감을 살리기 위한 3점 조명 + 보조 환경광
 */
function createThreePointLights(targetScene) {
  const group = new THREE.Group();
  group.visible = VIEWER_CONFIG.enableThreePointLights;

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3b4252, 0.25);

  const keyLight = new THREE.DirectionalLight(0xfff8ef, 1.35);
  keyLight.castShadow = VIEWER_CONFIG.enableShadows;
  keyLight.shadow.mapSize.set(1024, 1024);

  const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.5);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.85);

  group.add(hemiLight, keyLight, fillLight, rimLight);
  targetScene.add(group);

  return { group, keyLight, fillLight, rimLight };
}

function createShadowFloor(targetScene) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShadowMaterial({ opacity: 0.24 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.visible = VIEWER_CONFIG.enableShadows;
  targetScene.add(mesh);
  return mesh;
}

/**
 * HDRI(.hdr) 또는 기본 RoomEnvironment로 PBR IBL(Image-Based Lighting) 구성
 */
async function setupEnvironment(hdriUrl) {
  if (state.envTexture) {
    state.envTexture.dispose();
    state.envTexture = null;
  }

  if (hdriUrl) {
    try {
      const hdrLoader = new HDRLoader();
      const hdrTexture = await hdrLoader.loadAsync(hdriUrl);
      state.envTexture = pmremGenerator.fromEquirectangular(hdrTexture).texture;
      hdrTexture.dispose();
      scene.environment = state.envTexture;
      return;
    } catch (error) {
      console.warn('HDRI 로드 실패, 기본 RoomEnvironment로 대체합니다:', error);
    }
  }

  const roomEnv = new RoomEnvironment();
  state.envTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;
  roomEnv.dispose();
  scene.environment = state.envTexture;
}

/**
 * 비동기 .glb 로드 및 진행률 UI 처리
 */
function loadGLB(url, { isObjectUrl = false, label = url } = {}) {
  const loadId = ++state.loadId;
  showLoadingState(label);

  gltfLoader.load(
    url,
    (gltf) => {
      if (loadId !== state.loadId) {
        disposeObject3D(gltf.scene);
        if (isObjectUrl) URL.revokeObjectURL(url);
        return;
      }

      if (isObjectUrl) URL.revokeObjectURL(url);
      replaceModel(gltf);
      hideStatusOverlay();
    },
    (xhr) => {
      if (loadId !== state.loadId) return;
      updateLoadingProgress(xhr);
    },
    (error) => {
      if (loadId !== state.loadId) return;
      if (isObjectUrl) URL.revokeObjectURL(url);
      console.error('GLB 로드 오류:', error);
      showErrorState(label, error);
    }
  );
}

function replaceModel(gltf) {
  clearCurrentModel();

  const model = gltf.scene;
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = VIEWER_CONFIG.enableShadows;
    node.receiveShadow = VIEWER_CONFIG.enableShadows;
  });

  scene.add(model);
  state.currentModel = model;

  fitCameraToModel(model, { resetAngle: true });
  setupModelAnimations(model, gltf.animations);
}

/**
 * Bounding Box 기반 모델 자동 중앙 정렬 및 화면 맞춤 카메라 거리 계산
 */
function fitCameraToModel(model, { resetAngle = false } = {}) {
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // 피벗 위치와 무관하게 기하학적 중심을 월드 원점(0, 0, 0)으로 이동
  model.position.sub(center);
  model.updateMatrixWorld(true);

  // 바운딩 구 반지름 기준으로 수직/수평 FOV를 모두 만족하는 거리 계산
  const radius = Math.max(size.length() * 0.5, 0.001);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const safeAspect = Math.max(camera.aspect || 1, 0.1);
  const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * safeAspect);

  const distV = radius / Math.sin(vFov * 0.5);
  const distH = radius / Math.sin(hFov * 0.5);
  const distance = Math.max(distV, distH) * VIEWER_CONFIG.fitMargin;

  const direction = resetAngle
    ? new THREE.Vector3(0.75, 0.45, 1.0).normalize()
    : camera.position.clone().sub(controls.target).normalize();

  if (direction.lengthSq() === 0) {
    direction.set(0.75, 0.45, 1.0).normalize();
  }

  controls.target.set(0, 0, 0);
  camera.position.copy(direction.multiplyScalar(distance));
  camera.near = Math.max(distance * 0.005, 0.001);
  camera.far = Math.max(distance * 50, 100);
  camera.updateProjectionMatrix();

  controls.minDistance = radius * 0.35;
  controls.maxDistance = distance * 6;
  controls.update();

  state.modelRadius = radius;
  if (state.cameraMode === 'spectator') {
    syncSpectatorEulerFromCamera();
  }

  updateLightingScale(radius, size.y);
}

function updateLightingScale(radius, height) {
  const { keyLight, fillLight, rimLight } = lights;
  keyLight.position.set(radius * 2.0, radius * 2.8, radius * 2.2);
  fillLight.position.set(-radius * 2.2, radius * 1.0, radius * 1.6);
  rimLight.position.set(-radius * 1.5, radius * 2.2, -radius * 2.4);

  const shadowExtent = radius * 1.4;
  keyLight.shadow.camera.left = -shadowExtent;
  keyLight.shadow.camera.right = shadowExtent;
  keyLight.shadow.camera.top = shadowExtent;
  keyLight.shadow.camera.bottom = -shadowExtent;
  keyLight.shadow.camera.near = Math.max(radius * 0.1, 0.001);
  keyLight.shadow.camera.far = radius * 10;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = Math.min(Math.max(radius * 0.015, 0.0005), 0.05);
  keyLight.shadow.camera.updateProjectionMatrix();

  shadowFloor.position.y = -height * 0.5;
  shadowFloor.scale.setScalar(radius * 4.5);
}

function setupModelAnimations(model, animations) {
  state.animationActions = [];
  if (!animations || animations.length === 0) {
    dom.animationBtn.classList.add('is-hidden-el');
    return;
  }

  state.mixer = new THREE.AnimationMixer(model);
  state.animationActions = animations.map((clip) => {
    const action = state.mixer.clipAction(clip);
    action.play();
    return action;
  });

  state.isAnimationPlaying = true;
  dom.animationBtn.textContent = '애니메이션 일시정지';
  dom.animationBtn.classList.add('is-active');
  dom.animationBtn.classList.remove('is-hidden-el');
}

function clearCurrentModel() {
  if (state.mixer) {
    state.mixer.stopAllAction();
    state.mixer.uncacheRoot(state.currentModel);
    state.mixer = null;
  }
  state.animationActions = [];

  if (state.currentModel) {
    scene.remove(state.currentModel);
    disposeObject3D(state.currentModel);
    state.currentModel = null;
  }
}

function disposeObject3D(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    if (node.geometry) node.geometry.dispose();

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        if (value && value.isTexture) value.dispose();
      }
      mat.dispose();
    }
  });
}

function handleResize() {
  const width = dom.stage.clientWidth;
  const height = dom.stage.clientHeight;
  if (width === 0 || height === 0) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function applyBackground() {
  dom.bgColorInput.value = state.backgroundColor;
  dom.transparentBtn.classList.toggle('is-active', state.isTransparent);
  dom.stage.classList.toggle('is-transparent', state.isTransparent);

  if (state.isTransparent) {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  } else {
    scene.background = new THREE.Color(state.backgroundColor);
    renderer.setClearColor(state.backgroundColor, 1);
  }
}

function showLoadingState(label) {
  dom.statusOverlay.classList.remove('is-hidden', 'is-error');
  dom.overlayFileBtn.classList.add('is-hidden-el');
  dom.progressFill.classList.remove('is-indeterminate');
  dom.progressFill.style.width = '0%';
  dom.progressBar.setAttribute('aria-valuenow', '0');
  dom.statusTitle.textContent = '3D 모델 불러오는 중... 0%';
  dom.statusDetail.textContent = label;
}

function updateLoadingProgress(xhr) {
  if (xhr.lengthComputable && xhr.total > 0) {
    const percent = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
    const loadedMB = (xhr.loaded / (1024 * 1024)).toFixed(2);
    const totalMB = (xhr.total / (1024 * 1024)).toFixed(2);
    dom.progressFill.classList.remove('is-indeterminate');
    dom.progressFill.style.width = `${percent}%`;
    dom.progressBar.setAttribute('aria-valuenow', String(percent));
    dom.statusTitle.textContent = `3D 모델 불러오는 중... ${percent}%`;
    dom.statusDetail.textContent = `${loadedMB} MB / ${totalMB} MB`;
  } else {
    const loadedMB = (xhr.loaded / (1024 * 1024)).toFixed(2);
    dom.progressFill.classList.add('is-indeterminate');
    dom.statusTitle.textContent = '3D 모델 불러오는 중...';
    dom.statusDetail.textContent = `${loadedMB} MB 수신됨`;
  }
}

function hideStatusOverlay() {
  dom.progressFill.classList.remove('is-indeterminate');
  dom.progressFill.style.width = '100%';
  dom.progressBar.setAttribute('aria-valuenow', '100');
  dom.statusTitle.textContent = '로딩 완료';
  requestAnimationFrame(() => {
    dom.statusOverlay.classList.add('is-hidden');
  });
}

function showWelcomeState() {
  dom.statusOverlay.classList.remove('is-hidden');
  dom.statusOverlay.classList.add('is-error');
  dom.overlayFileBtn.classList.remove('is-hidden-el');
  dom.overlayFileBtn.textContent = '여러 .glb 파일 선택';
  dom.statusTitle.textContent = '3D GLB 뷰어 준비 완료';
  dom.statusDetail.textContent =
    '.glb 파일을 1개 또는 여러 개 선택하거나 화면에 드래그하면 목록에 추가되어 하나씩 넘겨볼 수 있습니다.';
}

function showErrorState(label, error) {
  if (label === VIEWER_CONFIG.modelUrl && state.playlist.length === 0) {
    showWelcomeState();
    return;
  }
  dom.statusOverlay.classList.remove('is-hidden');
  dom.statusOverlay.classList.add('is-error');
  dom.overlayFileBtn.classList.remove('is-hidden-el');
  dom.overlayFileBtn.textContent = '로컬 .glb 파일 직접 선택';
  dom.statusTitle.textContent = '모델 파일을 불러오지 못했습니다';
  dom.statusDetail.textContent =
    `경로(${label})를 확인하거나, 로컬 .glb 파일을 직접 선택·드래그해서 열어보세요. (${error?.message || '로드 오류'})`;
}

function setupUI() {
  const triggerFileSelect = () => dom.fileInput.click();
  dom.openFileBtn.addEventListener('click', triggerFileSelect);
  dom.overlayFileBtn.addEventListener('click', triggerFileSelect);
  dom.playlistAddBtn.addEventListener('click', triggerFileSelect);

  dom.fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) addLocalFilesToPlaylist(files);
    e.target.value = '';
  });

  // 드래그 앤 드롭으로 .glb 파일 여러 개 즉시 추가 및 미리보기
  dom.stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.stage.classList.add('is-dragover');
  });

  dom.stage.addEventListener('dragleave', (e) => {
    if (!dom.stage.contains(e.relatedTarget)) {
      dom.stage.classList.remove('is-dragover');
    }
  });

  dom.stage.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.stage.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) addLocalFilesToPlaylist(files);
  });

  dom.playlistToggleBtn.addEventListener('click', () => {
    setPlaylistOpen(!state.isPlaylistOpen);
  });

  dom.playlistClearBtn.addEventListener('click', clearPlaylist);
  dom.prevModelBtn.addEventListener('click', () => stepPlaylist(-1));
  dom.nextModelBtn.addEventListener('click', () => stepPlaylist(1));
  dom.toolbarPrevBtn.addEventListener('click', () => stepPlaylist(-1));
  dom.toolbarNextBtn.addEventListener('click', () => stepPlaylist(1));

  renderPlaylist();

  dom.spectatorBtn.addEventListener('click', () => {
    setCameraMode(state.cameraMode === 'orbit' ? 'spectator' : 'orbit');
  });

  dom.resetCameraBtn.addEventListener('click', () => {
    if (state.currentModel) fitCameraToModel(state.currentModel, { resetAngle: true });
  });

  setupSpectatorControls();

  dom.autoRotateBtn.classList.toggle('is-active', controls.autoRotate);
  dom.autoRotateBtn.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    dom.autoRotateBtn.classList.toggle('is-active', controls.autoRotate);
  });

  dom.animationBtn.addEventListener('click', () => {
    state.isAnimationPlaying = !state.isAnimationPlaying;
    for (const action of state.animationActions) {
      action.paused = !state.isAnimationPlaying;
    }
    dom.animationBtn.textContent = state.isAnimationPlaying
      ? '애니메이션 일시정지'
      : '애니메이션 재생';
    dom.animationBtn.classList.toggle('is-active', state.isAnimationPlaying);
  });

  dom.transparentBtn.addEventListener('click', () => {
    state.isTransparent = !state.isTransparent;
    applyBackground();
  });

  dom.bgColorInput.addEventListener('input', (e) => {
    state.backgroundColor = e.target.value;
    state.isTransparent = false;
    applyBackground();
  });

  applyFov(state.orbitFov);
  dom.fovSlider.addEventListener('input', (e) => {
    const nextFov = Number(e.target.value);
    if (state.cameraMode === 'spectator') {
      state.spectatorFov = nextFov;
    } else {
      state.orbitFov = nextFov;
    }
    applyFov(nextFov);
  });
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setPlaylistOpen(isOpen) {
  state.isPlaylistOpen = isOpen;
  dom.playlistPanel.classList.toggle('is-collapsed', !isOpen);
  dom.playlistToggleBtn.classList.toggle('is-active', isOpen);
}

function addLocalFilesToPlaylist(files) {
  const validFiles = files
    .filter((file) => file.name.toLowerCase().endsWith('.glb'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  if (validFiles.length === 0) {
    showErrorState(files[0]?.name || '', new Error('.glb 파일만 지원합니다.'));
    return;
  }

  const startIndex = state.playlist.length;
  for (const file of validFiles) {
    state.playlist.push({
      id: state.nextPlaylistId++,
      name: file.name,
      sizeBytes: file.size,
      file,
    });
  }

  if (validFiles.length > 1 || state.playlist.length > 1) {
    setPlaylistOpen(true);
  }
  selectPlaylistItem(startIndex);
}

function addExternalEntriesToPlaylist(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const startIndex = state.playlist.length;
  for (const entry of entries) {
    state.playlist.push({
      id: state.nextPlaylistId++,
      name: entry.name,
      sizeBytes: entry.sizeBytes || 0,
      url: entry.url,
    });
  }
  if (state.playlist.length > 1) {
    setPlaylistOpen(true);
  }
  selectPlaylistItem(startIndex);
}

function selectPlaylistItem(index) {
  if (index < 0 || index >= state.playlist.length) return;
  state.activePlaylistIndex = index;
  renderPlaylist();

  const item = state.playlist[index];
  if (item.file) {
    const objectUrl = URL.createObjectURL(item.file);
    loadGLB(objectUrl, { isObjectUrl: true, label: item.name });
  } else if (item.url) {
    loadGLB(item.url, { isObjectUrl: false, label: item.name });
  }
}

function stepPlaylist(delta) {
  const total = state.playlist.length;
  if (total === 0) return;
  const current = state.activePlaylistIndex >= 0 ? state.activePlaylistIndex : 0;
  const nextIndex = (current + delta + total) % total;
  selectPlaylistItem(nextIndex);
}

function removePlaylistItem(index) {
  if (index < 0 || index >= state.playlist.length) return;
  const wasActive = index === state.activePlaylistIndex;
  state.playlist.splice(index, 1);

  if (state.playlist.length === 0) {
    state.activePlaylistIndex = -1;
    clearCurrentModel();
    renderPlaylist();
    showWelcomeState();
    return;
  }

  if (wasActive) {
    const nextIndex = Math.min(index, state.playlist.length - 1);
    selectPlaylistItem(nextIndex);
  } else {
    if (index < state.activePlaylistIndex) {
      state.activePlaylistIndex -= 1;
    }
    renderPlaylist();
  }
}

function clearPlaylist() {
  state.playlist = [];
  state.activePlaylistIndex = -1;
  clearCurrentModel();
  renderPlaylist();
  showWelcomeState();
}

function renderPlaylist() {
  const count = state.playlist.length;
  const activePos = count > 0 && state.activePlaylistIndex >= 0 ? state.activePlaylistIndex + 1 : 0;

  dom.playlistToggleBtn.textContent = `모델 목록 (${count})`;
  dom.playlistTitle.textContent = `모델 목록 (${count})`;
  dom.playlistCounter.textContent = `${activePos} / ${count}`;

  const hasMultiple = count > 1;
  const hasAny = count > 0;
  dom.playlistClearBtn.disabled = !hasAny;
  dom.prevModelBtn.disabled = !hasMultiple;
  dom.nextModelBtn.disabled = !hasMultiple;
  dom.toolbarPrevBtn.disabled = !hasMultiple;
  dom.toolbarNextBtn.disabled = !hasMultiple;

  dom.playlistItems.replaceChildren();
  if (count === 0) {
    const empty = document.createElement('p');
    empty.className = 'playlist-empty';
    empty.innerHTML =
      '여러 개의 .glb 파일을 선택하거나<br />화면에 드래그하면 하나씩 넘겨볼 수 있습니다.';
    dom.playlistItems.appendChild(empty);
    return;
  }

  state.playlist.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `playlist-item${index === state.activePlaylistIndex ? ' is-active' : ''}`;
    row.title = item.name;
    row.addEventListener('click', () => selectPlaylistItem(index));

    const idxEl = document.createElement('span');
    idxEl.className = 'playlist-item-index';
    idxEl.textContent = String(index + 1);

    const infoEl = document.createElement('div');
    infoEl.className = 'playlist-item-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'playlist-item-name';
    nameEl.textContent = item.name;

    const sizeEl = document.createElement('div');
    sizeEl.className = 'playlist-item-size';
    sizeEl.textContent = formatFileSize(item.sizeBytes);

    infoEl.append(nameEl, sizeEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'playlist-item-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `${item.name} 목록에서 제거`);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removePlaylistItem(index);
    });

    row.append(idxEl, infoEl, removeBtn);
    dom.playlistItems.appendChild(row);
  });
}

function setupDesktopIntegration() {
  if (!window.desktopAPI) return;
  window.desktopAPI.onOpenFiles((entries) => {
    addExternalEntriesToPlaylist(entries);
  });
  window.desktopAPI.onTriggerOpenDialog(() => {
    dom.fileInput.click();
  });
}

function animate(timestamp) {
  timer.update(timestamp);
  const delta = timer.getDelta();

  if (state.mixer && state.isAnimationPlaying) {
    state.mixer.update(delta);
  }

  if (state.cameraMode === 'spectator') {
    updateSpectatorCamera(delta);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}

/**
 * 1인칭 관전자 모드(WASD 자유 이동 + FPS 마우스 시점) 전환
 */
function setCameraMode(mode) {
  if (state.cameraMode === mode) return;
  state.cameraMode = mode;

  const isSpectator = mode === 'spectator';
  dom.stage.classList.toggle('is-spectator', isSpectator);
  dom.spectatorBtn.classList.toggle('is-active', isSpectator);
  dom.autoRotateBtn.disabled = isSpectator;

  if (isSpectator) {
    controls.enabled = false;
    applyFov(state.spectatorFov);
    syncSpectatorEulerFromCamera();
    state.spectatorVelocity.set(0, 0, 0);
    dom.hintBadge.textContent =
      'WASD: 이동 · E/Space: 상승 · Q/Ctrl: 하강 · Shift: 가속 · 휠: 속도 조절 · 클릭/드래그: 시점 · V: 오르빗 복귀';
  } else {
    if (document.pointerLockElement === dom.canvas) {
      document.exitPointerLock?.();
    }
    state.keysPressed.clear();
    state.isDraggingLook = false;
    applyFov(state.orbitFov);

    // 현재 카메라 시선 앞쪽 지점을 Orbit 타깃으로 맞춰 급격한 점프 방지
    camera.getWorldDirection(_forwardVec);
    const orbitDist = THREE.MathUtils.clamp(
      camera.position.length() * 0.6,
      state.modelRadius * 0.5,
      state.modelRadius * 4
    );
    controls.target.copy(camera.position).addScaledVector(_forwardVec, orbitDist);
    controls.enabled = true;
    controls.update();
    dom.hintBadge.textContent =
      '좌클릭: 회전 · 우클릭: 이동(Pan) · 휠/핀치: 줌 · V: 관전자 모드 · .glb 드래그 앤 드롭 가능';
  }
}

function applyFov(fov) {
  camera.fov = fov;
  camera.updateProjectionMatrix();
  dom.fovSlider.value = String(fov);
  dom.fovValue.textContent = `${fov}°`;
}

function syncSpectatorEulerFromCamera() {
  state.spectatorEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  const maxPitch = Math.PI * 0.5 - 0.02;
  state.spectatorEuler.x = THREE.MathUtils.clamp(state.spectatorEuler.x, -maxPitch, maxPitch);
}

function rotateSpectatorCamera(deltaX, deltaY) {
  const sensitivity = 0.0022;
  const maxPitch = Math.PI * 0.5 - 0.02;
  state.spectatorEuler.y -= deltaX * sensitivity;
  state.spectatorEuler.x = THREE.MathUtils.clamp(
    state.spectatorEuler.x - deltaY * sensitivity,
    -maxPitch,
    maxPitch
  );
  camera.quaternion.setFromEuler(state.spectatorEuler);
}

function setupSpectatorControls() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'KeyV' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setCameraMode(state.cameraMode === 'orbit' ? 'spectator' : 'orbit');
      return;
    }

    if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (state.currentModel) fitCameraToModel(state.currentModel, { resetAngle: true });
      return;
    }

    if (e.code === 'KeyL' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setPlaylistOpen(!state.isPlaylistOpen);
      return;
    }

    if ((e.code === 'BracketLeft' || e.code === 'PageUp') && !e.repeat) {
      e.preventDefault();
      stepPlaylist(-1);
      return;
    }

    if ((e.code === 'BracketRight' || e.code === 'PageDown') && !e.repeat) {
      e.preventDefault();
      stepPlaylist(1);
      return;
    }

    if (state.cameraMode !== 'spectator') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    state.keysPressed.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    state.keysPressed.delete(e.code);
  });

  window.addEventListener('blur', () => {
    state.keysPressed.clear();
    state.isDraggingLook = false;
  });

  // 관전자 모드: 클릭 시 Pointer Lock 시도 + 미지원/해제 상태에서도 드래그 시점 회전 지원
  dom.canvas.addEventListener('pointerdown', (e) => {
    if (state.cameraMode !== 'spectator' || e.button !== 0) return;
    state.isDraggingLook = true;
    state.lastPointer.x = e.clientX;
    state.lastPointer.y = e.clientY;

    if (document.pointerLockElement !== dom.canvas && dom.canvas.requestPointerLock) {
      Promise.resolve(dom.canvas.requestPointerLock()).catch(() => {});
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (state.cameraMode !== 'spectator') return;

    if (document.pointerLockElement === dom.canvas) {
      rotateSpectatorCamera(e.movementX, e.movementY);
      return;
    }

    if (!state.isDraggingLook) return;
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    state.lastPointer.x = e.clientX;
    state.lastPointer.y = e.clientY;
    rotateSpectatorCamera(dx * 1.4, dy * 1.4);
  });

  window.addEventListener('pointerup', () => {
    state.isDraggingLook = false;
  });

  // 관전자 모드에서 마우스 휠로 이동 속도 실시간 조절
  dom.canvas.addEventListener(
    'wheel',
    (e) => {
      if (state.cameraMode !== 'spectator') return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      state.spectatorSpeedMultiplier = THREE.MathUtils.clamp(
        state.spectatorSpeedMultiplier * factor,
        0.1,
        15
      );
    },
    { passive: false }
  );
}

function updateSpectatorCamera(delta) {
  const keys = state.keysPressed;
  const forwardInput =
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
    (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const strafeInput =
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const verticalInput =
    (keys.has('KeyE') || keys.has('Space') ? 1 : 0) -
    (keys.has('KeyQ') || keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight')
      ? 1
      : 0);

  camera.getWorldDirection(_forwardVec).normalize();
  _rightVec.crossVectors(_forwardVec, _worldUp).normalize();

  _moveVec
    .set(0, 0, 0)
    .addScaledVector(_forwardVec, forwardInput)
    .addScaledVector(_rightVec, strafeInput)
    .addScaledVector(_worldUp, verticalInput);

  if (_moveVec.lengthSq() > 0) {
    _moveVec.normalize();
  }

  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1.0;
  const speed = Math.max(state.modelRadius, 0.2) * 0.9 * state.spectatorSpeedMultiplier * boost;

  const targetVelocity = _moveVec.multiplyScalar(speed);
  const damping = 1 - Math.exp(-12 * Math.min(delta, 0.1));
  state.spectatorVelocity.lerp(targetVelocity, damping);

  camera.position.addScaledVector(state.spectatorVelocity, delta);
}
