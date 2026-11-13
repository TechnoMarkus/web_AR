(function () {
  'use strict';

  var THREE = AFRAME.THREE;
  var SUPPORTED = ['stl', 'glb', 'gltf', 'obj'];

  var sceneEl = document.querySelector('a-scene');
  var markerEl = document.getElementById('marker');
  var cameraEl = document.getElementById('camera');
  var rootEl = document.getElementById('root');
  var modelEl = document.getElementById('model');

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var statusEl = document.getElementById('status');
  var modeBtn = document.getElementById('mode-btn');
  var dragOverlay = document.getElementById('drag-overlay');

  var currentUrl = null;
  var previewMode = false;

  // Start AR.js only if the browser exposes the camera API (needs HTTPS or localhost).
  var cameraAvailable = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (cameraAvailable) {
    sceneEl.setAttribute('arjs', 'sourceType: webcam; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3;');
  } else {
    document.getElementById('hint').textContent =
      'Camera unavailable: this page needs HTTPS (or localhost) for AR. Showing a plain 3D preview instead.';
    document.body.style.background = '#2a2d34';
    sceneEl.addEventListener('loaded', function () { setPreview(true); modeBtn.hidden = true; });
  }

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }

  // ---- STL parsing (binary + ASCII) -------------------------------------

  function parseSTL(buffer) {
    var view = new DataView(buffer);
    var isBinary = false;
    if (buffer.byteLength >= 84) {
      var triangles = view.getUint32(80, true);
      isBinary = 84 + triangles * 50 === buffer.byteLength;
    }
    var positions;

    if (isBinary) {
      var count = view.getUint32(80, true);
      positions = new Float32Array(count * 9);
      for (var i = 0; i < count; i++) {
        var offset = 84 + i * 50 + 12; // skip the stored normal
        for (var j = 0; j < 9; j++) {
          positions[i * 9 + j] = view.getFloat32(offset + j * 4, true);
        }
      }
    } else {
      var text = new TextDecoder().decode(buffer);
      var re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
      var values = [];
      var m;
      while ((m = re.exec(text)) !== null) {
        values.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
      }
      if (values.length === 0 || values.length % 9 !== 0) {
        throw new Error('Could not read this STL file.');
      }
      positions = new Float32Array(values);
    }

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); // non-indexed, so this gives flat shading
    return geometry;
  }

  // ---- Fit the model to the marker --------------------------------------

  function fitModel() {
    var obj = modelEl.object3D;
    var parent = obj.parent;

    // Measure in isolation so the marker's pose doesn't skew the bounding box.
    if (parent) parent.remove(obj);
    obj.position.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrixWorld(true);

    var box = new THREE.Box3().setFromObject(obj);
    if (parent) parent.add(obj);

    if (box.isEmpty()) {
      setStatus('The model loaded but appears to be empty.', true);
      return;
    }

    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var s = 1 / maxDim; // marker is 1 unit wide

    obj.scale.set(s, s, s);
    obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  }

  // ---- Loading ----------------------------------------------------------

  function clearModel() {
    modelEl.removeAttribute('gltf-model');
    modelEl.removeAttribute('obj-model');
    modelEl.removeObject3D('mesh');
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
  }

  function onLoaded(name) {
    fitModel();
    modeBtn.disabled = false;
    setStatus(previewMode ? 'Showing "' + name + '" (preview).' : 'Loaded "' + name + '". Point the camera at the marker.');
  }

  function loadFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (SUPPORTED.indexOf(ext) === -1) {
      setStatus('Unsupported file type ".' + ext + '". Use STL, GLB/GLTF or OBJ.', true);
      return;
    }

    clearModel();
    setStatus('Loading "' + file.name + '"...');

    if (ext === 'stl') {
      file.arrayBuffer().then(function (buffer) {
        var geometry = parseSTL(buffer);
        var material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.1 });
        var mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2; // STL files are normally Z-up
        modelEl.setObject3D('mesh', mesh);
        onLoaded(file.name);
      }).catch(function (err) {
        setStatus(err.message || 'Failed to read the STL file.', true);
      });
      return;
    }

    currentUrl = URL.createObjectURL(file);
    var onModelLoaded = function () {
      modelEl.removeEventListener('model-loaded', onModelLoaded);
      modelEl.removeEventListener('model-error', onModelError);
      onLoaded(file.name);
    };
    var onModelError = function () {
      modelEl.removeEventListener('model-loaded', onModelLoaded);
      modelEl.removeEventListener('model-error', onModelError);
      setStatus('Could not load "' + file.name + '".', true);
    };
    modelEl.addEventListener('model-loaded', onModelLoaded);
    modelEl.addEventListener('model-error', onModelError);

    if (ext === 'obj') {
      modelEl.setAttribute('obj-model', 'obj: ' + currentUrl);
    } else {
      // Note: .gltf files that reference external .bin/texture files won't
      // resolve from a single dropped file. Use .glb for those.
      modelEl.setAttribute('gltf-model', currentUrl);
    }
  }

  // ---- Preview (no marker) toggle ---------------------------------------

  function setPreview(on) {
    previewMode = on;
    if (on) {
      cameraEl.object3D.add(rootEl.object3D);
      rootEl.object3D.position.set(0, -0.4, -1.8);
      rootEl.object3D.visible = true;
      modeBtn.textContent = 'Back to marker mode';
    } else {
      markerEl.object3D.add(rootEl.object3D);
      rootEl.object3D.position.set(0, 0, 0);
      modeBtn.textContent = 'Preview without marker';
    }
  }

  modeBtn.addEventListener('click', function () { setPreview(!previewMode); });

  // ---- Drag to rotate the model (mouse or touch on the 3D view) ----------

  var rotating = null;
  var canvasHost = document.body;
  canvasHost.addEventListener('pointerdown', function (e) {
    if (e.target.closest('#panel')) return;
    rotating = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointermove', function (e) {
    if (!rotating) return;
    var r = rootEl.object3D.rotation;
    r.y += (e.clientX - rotating.x) * 0.01;
    r.x = Math.max(-1.5, Math.min(1.5, r.x + (e.clientY - rotating.y) * 0.01));
    rotating = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', function () { rotating = null; });

  // ---- Drag and drop / file picker --------------------------------------

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) {
    e.preventDefault();
    dragDepth++;
    dragOverlay.classList.add('active');
  });
  window.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragOverlay.classList.remove('active');
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    dragOverlay.classList.remove('active');
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
})();
