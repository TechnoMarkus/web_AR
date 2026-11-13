(function () {
  'use strict';

  var THREE = AFRAME.THREE;
  var SUPPORTED = ['stl', '3mf', 'glb', 'gltf', 'obj'];

  var rootEl = document.getElementById('root');
  var modelEl = document.getElementById('model');

  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var statusEl = document.getElementById('status');
  var dragOverlay = document.getElementById('drag-overlay');

  var currentUrl = null;

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

  // ---- 3MF parsing (zip + XML) ------------------------------------------

  function localName(el) { return el.localName || el.nodeName.replace(/^.*:/, ''); }

  function childrenNamed(parent, name) {
    var out = [];
    for (var n = parent.firstElementChild; n; n = n.nextElementSibling) {
      if (localName(n) === name) out.push(n);
    }
    return out;
  }

  // 3MF stores a row-vector matrix as 12 numbers; convert to a THREE matrix.
  function parse3MFTransform(str) {
    var m = new THREE.Matrix4();
    if (!str) return m;
    var a = str.trim().split(/\s+/).map(Number);
    if (a.length !== 12 || a.some(isNaN)) return m;
    m.set(a[0], a[3], a[6], a[9],
          a[1], a[4], a[7], a[10],
          a[2], a[5], a[8], a[11],
          0, 0, 0, 1);
    return m;
  }

  function parse3MF(buffer) {
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('The 3MF reader (JSZip) failed to load. Check your connection.'));
    }
    var material = new THREE.MeshStandardMaterial({
      color: 0xcccccc, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide
    });

    // Slicers (Bambu Studio, PrusaSlicer, Orca) split a model across several parts and
    // reference them with p:path (the 3MF production extension). Load every part up front.
    var PROD_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
    var zipRef = null;
    var docs = {}; // part path -> { objects, build }

    function componentPath(c) {
      var p = c.getAttributeNS(PROD_NS, 'path') || c.getAttribute('p:path') || '';
      return p.replace(/^\//, '');
    }

    function loadDoc(path) {
      path = path.replace(/^\//, '');
      if (docs[path]) return Promise.resolve(docs[path]);
      var file = zipRef.file(path);
      if (!file) return Promise.reject(new Error('This 3MF file refers to a missing part: ' + path));
      return file.async('string').then(function (xml) {
        var doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) {
          throw new Error('This 3MF file contains invalid XML.');
        }
        var resources = doc.getElementsByTagNameNS('*', 'resources')[0];
        var objects = {};
        var refs = [];
        if (resources) {
          childrenNamed(resources, 'object').forEach(function (o) {
            objects[o.getAttribute('id')] = o;
            var comps = childrenNamed(o, 'components')[0];
            if (comps) {
              childrenNamed(comps, 'component').forEach(function (c) {
                var p = componentPath(c);
                if (p) refs.push(p);
              });
            }
          });
        }
        var entry = { objects: objects, build: doc.getElementsByTagNameNS('*', 'build')[0] };
        docs[path] = entry; // registered before recursing, so reference cycles terminate
        return Promise.all(refs.map(loadDoc)).then(function () { return entry; });
      });
    }

    return JSZip.loadAsync(buffer).catch(function () {
      throw new Error('This is not a valid 3MF file.');
    }).then(function (zip) {
      zipRef = zip;
      // Find the model part via the package relationships, else the usual path.
      var modelPath = '3D/3dmodel.model';
      var relsFile = zip.file('_rels/.rels');
      var relsPromise = relsFile ? relsFile.async('string') : Promise.resolve('');
      return relsPromise.then(function (relsText) {
        if (relsText) {
          var rels = new DOMParser().parseFromString(relsText, 'application/xml')
            .getElementsByTagName('Relationship');
          for (var i = 0; i < rels.length; i++) {
            if (/3dmodel$/i.test(rels[i].getAttribute('Type') || '')) {
              modelPath = (rels[i].getAttribute('Target') || modelPath).replace(/^\//, '');
              break;
            }
          }
        }
        if (!zip.file(modelPath)) throw new Error('No 3D model found inside this 3MF file.');
        return loadDoc(modelPath);
      });
    }).then(function (main) {
      var build = main.build;
      if (!build) throw new Error('This 3MF file has no printable model.');

      function buildObject(doc, id, depth) {
        var o = doc.objects[id];
        if (!o || depth > 16) return null;
        var group = new THREE.Group();

        var meshEl = childrenNamed(o, 'mesh')[0];
        if (meshEl) {
          var vertEl = childrenNamed(meshEl, 'vertices')[0];
          var triEl = childrenNamed(meshEl, 'triangles')[0];
          if (vertEl && triEl) {
            var verts = childrenNamed(vertEl, 'vertex').map(function (v) {
              return [+v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z')];
            });
            var tris = childrenNamed(triEl, 'triangle');
            var positions = new Float32Array(tris.length * 9);
            for (var t = 0; t < tris.length; t++) {
              var idx = [+tris[t].getAttribute('v1'), +tris[t].getAttribute('v2'), +tris[t].getAttribute('v3')];
              for (var k = 0; k < 3; k++) {
                var p = verts[idx[k]];
                if (!p) throw new Error('This 3MF file references a missing vertex.');
                positions.set(p, t * 9 + k * 3);
              }
            }
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.computeVertexNormals();
            group.add(new THREE.Mesh(geometry, material));
          }
        }

        var compsEl = childrenNamed(o, 'components')[0];
        if (compsEl) {
          childrenNamed(compsEl, 'component').forEach(function (c) {
            var part = componentPath(c);
            var target = part ? docs[part] : doc; // p:path points at another part of the package
            var child = target ? buildObject(target, c.getAttribute('objectid'), depth + 1) : null;
            if (child) {
              child.applyMatrix4(parse3MFTransform(c.getAttribute('transform')));
              group.add(child);
            }
          });
        }
        return group;
      }

      var root = new THREE.Group();
      childrenNamed(build, 'item').forEach(function (item) {
        if (item.getAttribute('printable') === '0') return;
        var obj = buildObject(main, item.getAttribute('objectid'), 0);
        if (obj) {
          obj.applyMatrix4(parse3MFTransform(item.getAttribute('transform')));
          root.add(obj);
        }
      });
      var meshCount = 0;
      root.traverse(function (n) { if (n.isMesh) meshCount++; });
      if (meshCount === 0) throw new Error('This 3MF file has no geometry I can read.');
      return root;
    });
  }

  // ---- Fit the model to a 1-unit cube ------------------------------------

  function fitModel() {
    var obj = modelEl.object3D;
    var parent = obj.parent;

    // Measure in isolation so the parent's pose doesn't skew the bounding box.
    if (parent) parent.remove(obj);
    obj.position.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrixWorld(true);

    var box = new THREE.Box3().setFromObject(obj);
    if (parent) parent.add(obj);

    if (box.isEmpty()) return false;

    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var s = 1 / maxDim; // longest side becomes 1 unit

    obj.scale.set(s, s, s);
    obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    return true;
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

  // ---- Markerless AR (surface placement) via <model-viewer> -------------

  var mv = document.getElementById('mv');
  var arBtn = document.getElementById('ar-btn');
  var sizeInput = document.getElementById('size-cm');
  var glbUrl = null;
  var exportTimer = null;
  var exportToken = 0;

  // Export the fitted model as a GLB at real-world size (metres) for model-viewer.
  function exportForAR() {
    if (!modelEl.getObject3D('mesh') || typeof THREE.GLTFExporter === 'undefined') {
      arBtn.disabled = true;
      return Promise.resolve();
    }
    var token = ++exportToken;
    var cm = Math.max(1, Math.min(500, parseFloat(sizeInput.value) || 20));
    var wrapper = new THREE.Group();
    wrapper.add(modelEl.object3D.clone()); // clone keeps the auto-fit scale/offset, shares geometry
    wrapper.scale.setScalar(cm / 100);     // fitted model is 1 unit; AR uses metres
    wrapper.updateMatrixWorld(true);

    return new Promise(function (resolve, reject) {
      new THREE.GLTFExporter().parse(wrapper, resolve, reject, { binary: true });
    }).then(function (glb) {
      if (token !== exportToken) return; // a newer export superseded this one
      var url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      if (glbUrl) URL.revokeObjectURL(glbUrl);
      glbUrl = url;
      mv.src = url;
      arBtn.disabled = false;
    }).catch(function () {
      arBtn.disabled = true;
      setStatus('Could not prepare the model for surface AR.', true);
    });
  }

  sizeInput.addEventListener('input', function () {
    clearTimeout(exportTimer);
    exportTimer = setTimeout(exportForAR, 400);
  });

  arBtn.addEventListener('click', function () {
    if (!window.isSecureContext) {
      setStatus('AR needs HTTPS. Open the hosted (https://) version of this page on your phone.', true);
      return;
    }
    if (!mv.canActivateAR) {
      setStatus('Surface AR isn’t available on this device or browser. Try Chrome on a recent Android phone or Safari on an iPhone.', true);
      return;
    }
    mv.activateAR();
  });

  function onLoaded(name) {
    if (!fitModel()) {
      setStatus('"' + name + '" loaded but contains no visible geometry.', true);
      return;
    }
    rootEl.object3D.rotation.set(0.6, 0, 0); // tilt toward the viewer so flat models aren't seen edge-on
    rootEl.object3D.scale.set(1, 1, 1);      // reset any zoom from the previous model
    exportForAR();
    setStatus('Loaded "' + name + '". Drag to rotate, or tap View in AR.');
  }

  function loadFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (SUPPORTED.indexOf(ext) === -1) {
      setStatus('Unsupported file type ".' + ext + '". Use STL, 3MF, GLB/GLTF or OBJ.', true);
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

    if (ext === '3mf') {
      file.arrayBuffer().then(parse3MF).then(function (group) {
        group.rotation.x = -Math.PI / 2; // 3MF is Z-up like STL
        modelEl.setObject3D('mesh', group);
        onLoaded(file.name);
      }).catch(function (err) {
        setStatus(err.message || 'Failed to read the 3MF file.', true);
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

  // ---- Viewer gestures: drag = rotate, wheel / pinch = zoom ---------------
  // This only changes the on-screen preview. The size used for AR is the cm field.

  var MIN_ZOOM = 0.2;
  var MAX_ZOOM = 6;
  var pointers = {};    // active pointers by id
  var pinchStart = null; // { dist, scale } while two fingers are down

  function inPanel(e) { return e.target.closest && e.target.closest('#panel'); }

  function setZoom(z) {
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    rootEl.object3D.scale.set(z, z, z);
  }

  function pointerCount() { return Object.keys(pointers).length; }

  function pinchDistance() {
    var ids = Object.keys(pointers);
    var a = pointers[ids[0]];
    var b = pointers[ids[1]];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  document.body.addEventListener('pointerdown', function (e) {
    if (inPanel(e)) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pointerCount() === 2) {
      pinchStart = { dist: pinchDistance(), scale: rootEl.object3D.scale.x };
    }
  });

  window.addEventListener('pointermove', function (e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    if (pointerCount() >= 2 && pinchStart) {
      p.x = e.clientX; p.y = e.clientY;
      setZoom(pinchStart.scale * pinchDistance() / pinchStart.dist);
      return;
    }
    var r = rootEl.object3D.rotation;
    r.y += (e.clientX - p.x) * 0.01;
    r.x = Math.max(-1.5, Math.min(1.5, r.x + (e.clientY - p.y) * 0.01));
    p.x = e.clientX; p.y = e.clientY;
  });

  function endPointer(e) {
    delete pointers[e.pointerId];
    if (pointerCount() < 2) pinchStart = null;
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  window.addEventListener('wheel', function (e) {
    if (inPanel(e)) return;
    e.preventDefault();
    setZoom(rootEl.object3D.scale.x * Math.exp(-e.deltaY * 0.001));
  }, { passive: false });

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
    var dt = e.dataTransfer;
    var file = dt && dt.files && dt.files[0];
    if (!file && dt && dt.items) {
      // iPadOS can deliver dragged files only through items
      for (var i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file') { file = dt.items[i].getAsFile(); break; }
      }
    }
    if (file) loadFile(file);
  });
})();
