import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

const EVENT_COLORS = {
  APPEAR: 0x31b36b,
  MOVE: 0x2e7ce6,
  DISAPPEAR: 0xef5b5b,
  REAPPEAR: 0x8b5bd1,
  NONE: 0x8b96a8,
};

const state = {
  index: null,
  env: "Lab-S",
  memory: null,
  selectedObject: null,
  session: 1,
  cloudVisible: true,
  denseCloud: true,
  qaEvidence: null,
};

const el = Object.fromEntries(
  [
    "viewer", "loader", "cloudStats", "objectSelect", "objectName", "eventBadge",
    "stateValue", "locationValue", "lastObservedValue", "volatilityValue",
    "confidenceValue", "observationFigure", "observationImage", "observationCaption",
    "observedCountValue", "historyList", "sessionRange", "sessionLabel",
    "sessionTicks", "eventTimeline", "questionButtons", "answerText",
    "toggleCloud", "resetView", "pointSmaller", "pointLarger", "densityMode",
    "answerEvidence", "answerStatus", "mapEvidenceCue", "sceneModeLabel",
  ].map((id) => [id, document.getElementById(id)])
);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
// No distance fog: it made the research point cloud look washed out.

const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 1000);
camera.position.set(8, 7, 8);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
el.viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xdbeafe, 0x111827, 1.7));
const markerGroup = new THREE.Group();
const trajectoryGroup = new THREE.Group();
scene.add(markerGroup, trajectoryGroup);

let cloud = null;
let gaussianCloud = null;
let gaussianAssetPath = null;
let gaussianLoadPromise = null;
let objectClouds = [];
let objectBounds = null;
let objectLoadToken = 0;
let cloudLoadToken = 0;
let sessionLoadTimer = null;
let fittedView = null;
let clickableMarkers = [];
let answerTimer = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function projectionScale() {
  return Math.max(renderer.domElement.height, 1) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
}

function makeSurfaceCloudMaterial(worldSize, hasColor, hasNormal) {
  return new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: worldSize },
      projectionScale: { value: projectionScale() },
      useColor: { value: hasColor ? 1 : 0 },
      useNormal: { value: hasNormal ? 1 : 0 },
      fallbackColor: { value: new THREE.Color(0xa5b4c7) },
    },
    vertexShader: `
      uniform float pointSize;
      uniform float projectionScale;
      uniform float useColor;
      uniform float useNormal;
      uniform vec3 fallbackColor;
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vViewNormal;
      varying vec3 vToCamera;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(pointSize * projectionScale / max(-viewPosition.z, 0.1), 1.25, 4.25);
        vColor = mix(fallbackColor, color, useColor);
        vViewNormal = normalize(mix(vec3(0.0, 0.0, 1.0), normalMatrix * normal, useNormal));
        vToCamera = normalize(-viewPosition.xyz);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying vec3 vViewNormal;
      varying vec3 vToCamera;
      void main() {
        if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
        vec3 n = normalize(vViewNormal);
        float facing = abs(dot(n, normalize(vToCamera)));
        float contour = mix(0.70, 1.0, smoothstep(0.08, 0.58, facing));
        float diffuse = 0.90 + 0.10 * abs(dot(n, normalize(vec3(0.35, 0.60, 0.72))));
        vec3 color = clamp(pow(vColor, vec3(0.94)) * contour * diffuse * 1.04, 0.0, 1.0);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthTest: true,
    depthWrite: true,
  });
}

function resize() {
  const width = el.viewer.clientWidth;
  const height = el.viewer.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (cloud?.material.uniforms?.projectionScale) cloud.material.uniforms.projectionScale.value = projectionScale();
}

new ResizeObserver(resize).observe(el.viewer);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
    else child.material?.dispose();
  }
}

function formatPosition(position) {
  if (!position) return "Not observed";
  return position.map((v) => Number(v).toFixed(2)).join(", ");
}

function eventClass(event) {
  return String(event || "NONE").toLowerCase();
}

async function loadEnvironment(env) {
  clearQaEvidence();
  if (sessionLoadTimer) window.clearTimeout(sessionLoadTimer);
  sessionLoadTimer = null;
  state.env = env;
  el.loader.classList.remove("hidden");
  document.querySelectorAll(".env-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.env === env);
  });

  const config = state.index.environments[env];
  const memory = await fetch(`./assets/${config.memory.path}?v=${state.index.version}`, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`Memory manifest failed: ${response.status}`);
    return response.json();
  });
  state.memory = memory;
  state.qaEvidence = null;
  state.selectedObject = Object.keys(memory.objects)[0];
  state.session = 1;
  el.sessionRange.value = "1";

  removeObjectCloud();
  removeSceneCloud();
  await loadSessionCloud(1, { fitView: true, showLoader: false });

  populateObjectSelect();
  renderSessionTicks();
  renderAll();
  el.loader.classList.add("hidden");
}

function removeSceneCloud() {
  cloudLoadToken += 1;
  if (cloud) {
    scene.remove(cloud);
    cloud.geometry.dispose();
    cloud.material.dispose();
    cloud = null;
  }
  if (gaussianCloud) gaussianCloud.visible = false;
}

function ensureGaussianCloud() {
  if (gaussianCloud) return gaussianCloud;
  gaussianCloud = new GaussianSplats3D.DropInViewer({
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    integerBasedSort: true,
    halfPrecisionCovariancesOnGPU: false,
    antialiased: false,
    kernel2DSize: 0.055,
    sphericalHarmonicsDegree: 0,
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
    renderMode: GaussianSplats3D.RenderMode.Always,
    inMemoryCompressionLevel: 1,
    optimizeSplatData: true,
    freeIntermediateSplatData: true,
  });
  gaussianCloud.visible = false;
  scene.add(gaussianCloud);
  return gaussianCloud;
}

function fitDisplaySphere(center, radius) {
  const distance = Math.max(radius * 1.85, 3);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.72, distance));
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance * 30;
  camera.updateProjectionMatrix();
  controls.update();
  fittedView = { center: center.clone(), position: camera.position.clone() };
}

async function loadGaussianMap(gaussianConfig, { fitView = false, showLoader = true } = {}) {
  const token = ++cloudLoadToken;
  el.loader.classList.remove("hidden");
  el.loader.innerHTML = "<span class="spinner"></span><strong>Starting 3D map…</strong><small>Preparing the 800k Gaussian scene.</small>";
  const loaderTitle = el.loader.querySelector("strong");
  const loaderDetail = el.loader.querySelector("small");
  const dropIn = ensureGaussianCloud();
  if (gaussianAssetPath !== gaussianConfig.path) {
    if (gaussianAssetPath !== null) {
      await dropIn.removeSplatScene(0, false);
      gaussianAssetPath = null;
    }
    gaussianLoadPromise = dropIn.addSplatScene(`./assets/${gaussianConfig.path}?v=${state.index.version}`, {
      format: gaussianConfig.format === "ksplat" ? GaussianSplats3D.SceneFormat.KSplat : GaussianSplats3D.SceneFormat.Ply,
      splatAlphaRemovalThreshold: 2,
      showLoadingUI: false,
      progressiveLoad: gaussianConfig.format === "ksplat",
      onProgress: (percent, label, status) => {
        if (status === 0) {
          loaderTitle.textContent = "Downloading 3D map · " + Math.round(percent) + "%";
          loaderDetail.textContent = "19 MB compressed Gaussian scene";
        } else if (status === 1) {
          loaderTitle.textContent = "Preparing 800k splats…";
          loaderDetail.textContent = "Building the first interactive frame";
        } else {
          loaderTitle.textContent = "Rendering scene…";
          loaderDetail.textContent = "Almost ready";
        }
      },
      position: gaussianConfig.position,
      rotation: gaussianConfig.rotation,
      scale: [1, 1, 1],
    });
    await Promise.race([
      gaussianLoadPromise,
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("3D initialization timed out after 90 seconds")), 90000)),
    ]);
    gaussianAssetPath = gaussianConfig.path;
    gaussianLoadPromise = null;
  } else if (gaussianLoadPromise) {
    await gaussianLoadPromise;
  }
  if (token !== cloudLoadToken) return;
  dropIn.visible = state.cloudVisible;
  if (fitView || !fittedView) {
    fitDisplaySphere(
      new THREE.Vector3().fromArray(gaussianConfig.boundingSphere.center),
      gaussianConfig.boundingSphere.radius
    );
  }
  el.cloudStats.textContent = `${Number(gaussianConfig.pointCount).toLocaleString()} Gaussian splats · ${(gaussianConfig.bytes / 1048576).toFixed(1)} MiB · ${gaussianConfig.label || "RGB-D scan"}`;
  el.sceneModeLabel.textContent = "Aligned Gaussian scene";
  el.densityMode.textContent = "GS";
  el.densityMode.classList.add("active");
  el.densityMode.disabled = true;
  el.pointSmaller.disabled = true;
  el.pointLarger.disabled = true;
  if (showLoader) el.loader.classList.add("hidden");
}

async function loadSessionCloud(session, { fitView = false, showLoader = true } = {}) {
  const config = state.index.environments[state.env];
  if (config.gaussian) {
    return loadGaussianMap(config.gaussian, { fitView, showLoader });
  }
  el.sceneModeLabel.textContent = "Session-aligned point cloud";
  el.densityMode.disabled = false;
  el.pointSmaller.disabled = false;
  el.pointLarger.disabled = false;
  const denseConfig = state.denseCloud ? config.sessionDenseClouds?.[`s${session}`] : null;
  const cloudConfig = denseConfig || config.sessionClouds?.[`s${session}`] || config.cleanCloud || config.cloud;
  const token = ++cloudLoadToken;
  if (showLoader) el.loader.classList.remove("hidden");
  const geometry = await new PLYLoader().loadAsync(
    `./assets/${cloudConfig.path}?v=${state.index.version}`
  );
  if (token !== cloudLoadToken || session !== state.session) {
    geometry.dispose();
    return;
  }
  geometry.computeBoundingSphere();
  const material = makeSurfaceCloudMaterial(
    0.030,
    geometry.hasAttribute("color"),
    geometry.hasAttribute("normal")
  );
  if (cloud) {
    scene.remove(cloud);
    cloud.geometry.dispose();
    cloud.material.dispose();
  }
  cloud = new THREE.Points(geometry, material);
  // MAST3R/OpenCV global coordinates use a downward-positive Y axis.
  // Flip only for display; stored aligned coordinates remain unchanged.
  cloud.scale.y = -1;
  cloud.visible = state.cloudVisible;
  scene.add(cloud);
  if (fitView || !fittedView) fitCamera(geometry.boundingSphere);
  el.cloudStats.textContent = `S${session} · ${Number(cloudConfig.pointCount).toLocaleString()} points · ${(cloudConfig.bytes / 1048576).toFixed(1)} MiB${denseConfig ? " · locally densified" : ""}`;
  el.densityMode.textContent = denseConfig ? "Dense ✓" : "Dense";
  el.densityMode.classList.toggle("active", Boolean(denseConfig));
  if (showLoader) el.loader.classList.add("hidden");
}

function queueSessionCloud(session) {
  if (sessionLoadTimer) window.clearTimeout(sessionLoadTimer);
  sessionLoadTimer = window.setTimeout(() => {
    sessionLoadTimer = null;
    loadSessionCloud(session).catch(showError);
  }, 100);
}

function fitCamera(sphere) {
  const center = sphere.center.clone();
  center.y *= -1;
  fitDisplaySphere(center, sphere.radius);
}

function populateObjectSelect() {
  el.objectSelect.innerHTML = "";
  Object.keys(state.memory.objects).sort().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    el.objectSelect.append(option);
  });
  el.objectSelect.value = state.selectedObject;
}

function renderSessionTicks() {
  el.sessionTicks.innerHTML = "";
  for (let i = 1; i <= 10; i += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `S${i}`;
    button.classList.toggle("active", i === state.session);
    button.classList.toggle("evidence", Boolean(state.qaEvidence?.sessions.includes(i)));
    button.title = state.qaEvidence?.sessions.includes(i) ? "Used as QA evidence" : `Session ${i}`;
    button.addEventListener("click", () => setSession(i));
    el.sessionTicks.append(button);
  }
}

function setSession(session, { preserveEvidence = false } = {}) {
  if (!preserveEvidence) clearQaEvidence();
  state.session = session;
  el.sessionRange.value = String(session);
  renderSessionTicks();
  renderAll();
  queueSessionCloud(session);
}

function renderAll() {
  renderMarkers();
  renderSemanticMap();
  renderMemoryCard();
  renderTimeline();
  renderQuestions();
  el.sessionLabel.textContent = `Session ${state.session}`;
}

function removeObjectCloud() {
  objectLoadToken += 1;
  if (objectBounds) {
    scene.remove(objectBounds);
    objectBounds.geometry?.dispose();
    objectBounds.material?.dispose();
    objectBounds = null;
  }
  objectClouds.forEach((item) => {
    scene.remove(item);
    item.geometry.dispose();
    item.material.dispose();
  });
  objectClouds = [];
}

async function renderSemanticMap() {
  // Keep only spatial markers. Object RGB point crops and bounding boxes made
  // the scene look like pasted-in photographs and obscured the base map.
  removeObjectCloud();
}

function markerPositionFor(object, session) {
  const row = object.sessions[`s${session}`];
  if (row?.present && row.position) return { position: row.position, ghost: false };
  for (let index = session - 1; index >= 1; index -= 1) {
    const prior = object.sessions[`s${index}`];
    if (prior?.present && prior.position) return { position: prior.position, ghost: true };
  }
  return null;
}

function makeLabelSprite(text, selected, ghost) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 112;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = selected ? "rgba(239,91,91,0.96)" : ghost ? "rgba(72,82,98,0.82)" : "rgba(7,20,38,0.88)";
  context.beginPath();
  context.roundRect(7, 7, 498, 98, 22);
  context.fill();
  context.strokeStyle = selected ? "rgba(255,255,255,0.92)" : "rgba(110,231,221,0.8)";
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = "white";
  context.font = "700 42px Inter, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 57, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.scale.set(selected ? 1.8 : 1.35, selected ? 0.39 : 0.29, 1);
  sprite.position.y = selected ? 0.32 : 0.23;
  sprite.renderOrder = 10;
  return sprite;
}

function renderSelectedTrajectory(object) {
  const controlPoints = [];
  for (let session = 1; session <= 10; session += 1) {
    const row = object.sessions[`s${session}`];
    if (!row?.present || !row.position || row.event === "NONE") continue;
    const point = new THREE.Vector3().fromArray(row.position);
    point.y = -point.y + 0.18;
    controlPoints.push(point);
  }

  if (controlPoints.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "centripetal");
  const divisions = Math.max(160, controlPoints.length * 28);
  const outerMaterial = new THREE.SpriteMaterial({
    color: 0x680018,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const innerMaterial = new THREE.SpriteMaterial({
    color: 0xff1645,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });

  curve.getSpacedPoints(divisions).forEach((point, index) => {
    const outer = new THREE.Sprite(outerMaterial.clone());
    outer.position.copy(point);
    outer.scale.setScalar(0.075);
    outer.renderOrder = 998;
    if (index === 0) outer.onBeforeRender = (activeRenderer) => activeRenderer.clearDepth();
    trajectoryGroup.add(outer);

    const inner = new THREE.Sprite(innerMaterial.clone());
    inner.position.copy(point);
    inner.scale.setScalar(0.038);
    inner.renderOrder = 999;
    trajectoryGroup.add(inner);
  });
  outerMaterial.dispose();
  innerMaterial.dispose();
}

function renderMarkers() {
  clearGroup(markerGroup);
  clearGroup(trajectoryGroup);
  clickableMarkers = [];

  renderSelectedTrajectory(state.memory.objects[state.selectedObject]);

  Object.entries(state.memory.objects).forEach(([name, object]) => {
    const markerState = markerPositionFor(object, state.session);
    if (!markerState) return;
    const selected = name === state.selectedObject;
    const evidence = Boolean(state.qaEvidence?.objects.includes(name));
    const targetPosition = new THREE.Vector3().fromArray(markerState.position);
    targetPosition.y *= -1;

    const anchor = new THREE.Group();
    anchor.position.copy(targetPosition);
    const label = makeLabelSprite(
      `${evidence ? "evidence · " : ""}${name}${markerState.ghost ? " · last" : ""}`,
      selected,
      markerState.ghost
    );
    label.userData.objectName = name;
    anchor.add(label);
    markerGroup.add(anchor);
    clickableMarkers.push(label);
  });
}

function renderMemoryCard() {
  const object = state.memory.objects[state.selectedObject];
  const row = object.sessions[`s${state.session}`];
  el.objectName.textContent = object.name;
  el.eventBadge.textContent = row.event;
  el.eventBadge.className = `event-badge ${eventClass(row.event)}`;
  el.stateValue.textContent = row.present ? "Observed" : "Not observed";
  el.locationValue.textContent = row.position ? `[${formatPosition(row.position)}] m · ${row.locationToken}` : "—";
  el.lastObservedValue.textContent = object.lastObservedSession ? `Session ${object.lastObservedSession}` : "Never";
  if (row.observationImage) {
    el.observationFigure.classList.remove("hidden");
    el.observationImage.src = `./assets/${row.observationImage}`;
    el.observationImage.alt = `${object.name}, Session ${state.session}`;
    el.observationCaption.textContent = `Actual RGB observation · S${state.session} · frame ${row.observationFrame}`;
    el.confidenceValue.textContent = row.observationConfidence.toFixed(3);
  } else {
    el.observationFigure.classList.add("hidden");
    el.observationImage.removeAttribute("src");
    el.confidenceValue.textContent = "No observation";
  }
  const v = row.volatility ?? object.finalVolatility;
  el.volatilityValue.textContent = v == null ? "Not recorded" : `${v.toFixed(3)} · ${v >= 0.9 ? "High" : v >= 0.6 ? "Medium" : "Low"}`;
  el.observedCountValue.textContent = `${object.observedSessions} / 10 sessions`;

  el.historyList.innerHTML = "";
  for (let i = 10; i >= 1; i -= 1) {
    const history = object.sessions[`s${i}`];
    const fragment = document.getElementById("historyItemTemplate").content.cloneNode(true);
    fragment.querySelector(".history-session").textContent = `S${i}`;
    fragment.querySelector(".history-event").textContent = history.event;
    fragment.querySelector(".history-event").style.color = `#${EVENT_COLORS[history.event].toString(16).padStart(6, "0")}`;
    fragment.querySelector(".history-position").textContent = history.position ? formatPosition(history.position) : "not observed";
    el.historyList.append(fragment);
  }
}

function renderTimeline() {
  const object = state.memory.objects[state.selectedObject];
  el.eventTimeline.innerHTML = "";
  for (let i = 1; i <= 10; i += 1) {
    const event = object.sessions[`s${i}`].event;
    const chip = document.createElement("span");
    chip.textContent = event;
    chip.classList.toggle("evidence", Boolean(state.qaEvidence?.sessions.includes(i)));
    chip.title = state.qaEvidence?.sessions.includes(i) ? `Session ${i} · QA evidence` : `Session ${i}`;
    chip.style.color = `#${EVENT_COLORS[event].toString(16).padStart(6, "0")}`;
    el.eventTimeline.append(chip);
  }
}

function clearQaEvidence({ resetAnswer = true } = {}) {
  if (answerTimer) window.clearTimeout(answerTimer);
  answerTimer = null;
  state.qaEvidence = null;
  if (!el.answerEvidence) return;
  el.answerEvidence.innerHTML = "";
  el.mapEvidenceCue.classList.add("hidden");
  el.mapEvidenceCue.textContent = "";
  el.answerStatus.textContent = "Ready";
  el.answerStatus.classList.remove("searching");
  el.questionButtons?.querySelectorAll("button").forEach((button) => button.classList.remove("active"));
  if (resetAnswer) el.answerText.textContent = "Choose a question. LT-Mem will link its answer to the 3D map, session timeline, and RGB observations.";
}

function qaQuestions() {
  const objectName = state.selectedObject;
  const session = state.session;
  return [
    { id: "last", label: `Where was ${objectName} last observed?`, objectName, session },
    { id: "history", label: `How has ${objectName} changed over time?`, objectName, session },
    { id: "changes", label: `What changed in Session ${session}?`, objectName, session },
    { id: "volatile", label: "Which object is most volatile?", objectName, session },
  ];
}

function renderQuestions() {
  el.questionButtons.innerHTML = "";
  qaQuestions().forEach((question) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.question = question.id;
    button.textContent = question.label;
    button.addEventListener("click", () => runQuestion(question, button));
    el.questionButtons.append(button);
  });
  if (!state.qaEvidence) clearQaEvidence();
}

function uniqueEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.object}:s${item.session}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildQaResult(id, originObjectName, originSession) {
  const objects = state.memory.objects;
  const originObject = objects[originObjectName];

  if (id === "last") {
    const targetSession = originObject.lastObservedSession;
    const row = originObject.sessions[`s${targetSession}`];
    const observed = Array.from({ length: 10 }, (_, index) => index + 1)
      .filter((session) => originObject.sessions[`s${session}`].present)
      .slice(-3);
    return {
      text: `${originObject.name} was last observed in Session ${targetSession} at [${formatPosition(row.position)}] m (${row.locationToken}). The preceding observations are shown below for temporal context.`,
      targetObject: originObject.name,
      targetSession,
      objects: [originObject.name],
      sessions: observed,
      evidence: observed.map((session) => ({ object: originObject.name, session })),
    };
  }

  if (id === "history") {
    const changes = Array.from({ length: 10 }, (_, index) => index + 1)
      .filter((session) => originObject.sessions[`s${session}`].event !== "NONE");
    const observedRows = Array.from({ length: 10 }, (_, index) => originObject.sessions[`s${index + 1}`]).filter((row) => row.present);
    const locations = [...new Set(observedRows.map((row) => row.locationToken))];
    const eventSummary = changes.map((session) => `S${session} ${originObject.sessions[`s${session}`].event}`).join(" → ") || "no recorded changes";
    const evidenceSessions = changes.length ? changes.slice(-4) : [originObject.lastObservedSession];
    return {
      text: `${originObject.name} was observed in ${originObject.observedSessions}/10 sessions across ${locations.length} location region${locations.length === 1 ? "" : "s"}. Its recorded change sequence is ${eventSummary}.`,
      targetObject: originObject.name,
      targetSession: evidenceSessions[evidenceSessions.length - 1],
      objects: [originObject.name],
      sessions: evidenceSessions,
      evidence: evidenceSessions.map((session) => ({ object: originObject.name, session })),
    };
  }

  if (id === "changes") {
    const previousSession = originSession > 1 ? originSession - 1 : null;
    const changed = Object.values(objects).filter((object) => object.sessions[`s${originSession}`].event !== "NONE");
    const target = changed[0] || originObject;
    const evidence = [];
    changed.slice(0, 5).forEach((object) => {
      if (previousSession) evidence.push({ object: object.name, session: previousSession, label: "Before" });
      evidence.push({ object: object.name, session: originSession, label: previousSession ? "After" : "Current" });
    });
    const transitions = changed.map((object) => {
      const current = object.sessions[`s${originSession}`];
      const previous = previousSession ? object.sessions[`s${previousSession}`] : null;
      return { object: object.name, event: current.event, from: previous?.position || null, to: current.position || null };
    });
    const comparison = previousSession ? `Compared with Session ${previousSession}` : "Initial observation";
    const onlyMoves = changed.length > 0 && changed.every((object) => object.sessions[`s${originSession}`].event === "MOVE");
    return {
      text: changed.length
        ? `${changed.length} object${changed.length === 1 ? "" : "s"} changed in Session ${originSession}.`
        : `No changes were recorded in Session ${originSession}.`,
      headline: changed.length
        ? `${changed.length} object${changed.length === 1 ? "" : "s"} ${onlyMoves ? "moved" : "changed"} in Session ${originSession}`
        : `No changes in Session ${originSession}`,
      subtext: comparison,
      items: changed.map((object) => ({ name: object.name, event: object.sessions[`s${originSession}`].event })),
      cue: previousSession ? `QA comparison · S${previousSession} → S${originSession}` : `QA evidence · S${originSession}`,
      targetObject: target.name,
      targetSession: originSession,
      objects: changed.map((object) => object.name),
      sessions: previousSession ? [previousSession, originSession] : [originSession],
      evidence,
      transitions,
    };
  }

  const winner = Object.values(objects)
    .filter((object) => object.finalVolatility != null)
    .sort((a, b) => b.finalVolatility - a.finalVolatility)[0];
  const changeSessions = Array.from({ length: 10 }, (_, index) => index + 1)
    .filter((session) => winner.sessions[`s${session}`].event !== "NONE");
  const evidenceSessions = (changeSessions.length ? changeSessions : [winner.lastObservedSession]).slice(-4);
  return {
    text: `${winner.name} has the highest final volatility in ${state.env}: ${winner.finalVolatility.toFixed(3)}. It accumulated ${winner.changeCount} recorded changes, including ${winner.moveCount} MOVE event${winner.moveCount === 1 ? "" : "s"}.`,
    targetObject: winner.name,
    targetSession: evidenceSessions[evidenceSessions.length - 1],
    objects: [winner.name],
    sessions: evidenceSessions,
    evidence: evidenceSessions.map((session) => ({ object: winner.name, session })),
  };
}

function runQuestion(question, button) {
  if (answerTimer) window.clearTimeout(answerTimer);
  const { id, objectName: originObject, session: originSession } = question;
  el.questionButtons.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  el.answerStatus.textContent = "Searching 10 sessions…";
  el.answerStatus.classList.add("searching");
  el.answerText.textContent = "Retrieving temporal states and matching observations…";
  el.answerEvidence.innerHTML = '<div class="evidence-loading"><span class="spinner"></span> Linking evidence</div>';
  answerTimer = window.setTimeout(() => {
    answerTimer = null;
    applyQaResult(buildQaResult(id, originObject, originSession));
  }, 360);
}

function refreshSceneForEvidence() {
  el.sessionRange.value = String(state.session);
  el.sessionLabel.textContent = `Session ${state.session}`;
  renderSessionTicks();
  renderMarkers();
  renderSemanticMap();
  renderMemoryCard();
  renderTimeline();
  queueSessionCloud(state.session);
}

function renderEvidenceCards(items) {
  el.answerEvidence.innerHTML = "";
  if (!items.length) {
    el.answerEvidence.textContent = "No observation was required for this answer.";
    return;
  }
  uniqueEvidence(items).forEach(({ object: objectName, session, label }) => {
    const object = state.memory.objects[objectName];
    const row = object.sessions[`s${session}`];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "evidence-card";
    card.classList.toggle("active", objectName === state.selectedObject && session === state.session);
    if (row.observationImage) {
      const image = document.createElement("img");
      image.src = `./assets/${row.observationImage}`;
      image.alt = `${objectName}, Session ${session}`;
      image.loading = "lazy";
      card.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "evidence-placeholder";
      placeholder.textContent = row.position ? `Position · [${formatPosition(row.position)}] m` : "No observed position";
      card.append(placeholder);
    }
    const body = document.createElement("span");
    body.className = "evidence-card-body";
    if (label) {
      const role = document.createElement("em");
      role.className = "evidence-role";
      role.textContent = `${label} · S${session}`;
      body.append(role);
    }
    const title = document.createElement("strong");
    title.textContent = objectName;
    const meta = document.createElement("span");
    const confidence = row.observationConfidence == null ? "" : ` · conf. ${row.observationConfidence.toFixed(2)}`;
    meta.textContent = `${label ? row.event : `S${session} · ${row.event}`}${confidence}`;
    body.append(title, meta);
    card.append(body);
    card.addEventListener("click", () => inspectEvidence(objectName, session));
    el.answerEvidence.append(card);
  });
}

function renderAnswerResult(result) {
  el.answerText.innerHTML = "";
  if (!result.headline) {
    el.answerText.textContent = result.text;
    return;
  }
  const title = document.createElement("strong");
  title.className = "answer-result-title";
  title.textContent = result.headline;
  const subtitle = document.createElement("span");
  subtitle.className = "answer-result-subtitle";
  subtitle.textContent = result.subtext || "";
  el.answerText.append(title, subtitle);
  if (result.items?.length) {
    const list = document.createElement("div");
    list.className = "answer-change-list";
    result.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "answer-change-item";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const event = document.createElement("span");
      event.className = `answer-event-pill ${eventClass(item.event)}`;
      event.textContent = item.event;
      row.append(name, event);
      list.append(row);
    });
    el.answerText.append(list);
  }
}

function applyQaResult(result) {
  state.qaEvidence = {
    objects: [...new Set(result.objects)],
    sessions: [...new Set(result.sessions)],
    evidence: uniqueEvidence(result.evidence),
    transitions: result.transitions || [],
    cue: result.cue || null,
  };
  state.selectedObject = result.targetObject;
  state.session = result.targetSession;
  el.objectSelect.value = state.selectedObject;
  renderAnswerResult(result);
  el.answerStatus.textContent = "Evidence linked";
  el.answerStatus.classList.remove("searching");
  renderEvidenceCards(state.qaEvidence.evidence);
  el.mapEvidenceCue.textContent = state.qaEvidence.cue || `QA evidence highlighted · ${state.qaEvidence.objects.join(", ")} · ${state.qaEvidence.sessions.map((session) => `S${session}`).join(", ")}`;
  el.mapEvidenceCue.classList.remove("hidden");
  refreshSceneForEvidence();
}

function inspectEvidence(name, session) {
  state.selectedObject = name;
  state.session = session;
  el.objectSelect.value = name;
  refreshSceneForEvidence();
  renderEvidenceCards(state.qaEvidence.evidence);
}

function selectObject(name, { preserveEvidence = false } = {}) {
  if (!preserveEvidence) clearQaEvidence();
  state.selectedObject = name;
  el.objectSelect.value = name;
  renderMarkers();
  renderSemanticMap();
  renderMemoryCard();
  renderTimeline();
  renderQuestions();
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(clickableMarkers, false)[0];
  if (hit?.object.userData.objectName) {
    selectObject(hit.object.userData.objectName);
  }
});



document.querySelectorAll(".env-button").forEach((button) => {
  button.addEventListener("click", () => loadEnvironment(button.dataset.env).catch(showError));
});
el.objectSelect.addEventListener("change", () => selectObject(el.objectSelect.value));
el.sessionRange.addEventListener("input", () => setSession(Number(el.sessionRange.value)));
el.densityMode.addEventListener("click", () => {
  if (state.index.environments[state.env].gaussian) return;
  state.denseCloud = !state.denseCloud;
  loadSessionCloud(state.session, { showLoader: true }).catch(showError);
});
el.pointSmaller.addEventListener("click", () => {
  const size = cloud?.material.uniforms?.pointSize;
  if (size) size.value = Math.max(size.value / 1.2, 0.012);
});
el.pointLarger.addEventListener("click", () => {
  const size = cloud?.material.uniforms?.pointSize;
  if (size) size.value = Math.min(size.value * 1.2, 0.12);
});
el.toggleCloud.addEventListener("click", () => {
  state.cloudVisible = !state.cloudVisible;
  if (cloud) cloud.visible = state.cloudVisible;
  if (gaussianCloud) gaussianCloud.visible = state.cloudVisible && Boolean(state.index.environments[state.env].gaussian);
  el.toggleCloud.textContent = state.cloudVisible ? "Cloud" : "Show cloud";
});
el.resetView.addEventListener("click", () => {
  if (!fittedView) return;
  controls.target.copy(fittedView.center);
  camera.position.copy(fittedView.position);
  controls.update();
});

function showError(error) {
  console.error(error);
  el.loader.innerHTML = `<strong>Could not load the demo assets.</strong><small>${error.message}<br>Run export_web_assets.py, then serve this folder over HTTP.</small>`;
  el.loader.classList.remove("hidden");
}

fetch("./assets/manifest-index.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`Asset index failed: ${response.status}`);
    return response.json();
  })
  .then((index) => {
    state.index = index;
    return loadEnvironment(state.env);
  })
  .catch(showError);
