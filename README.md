# AR-tool

A browser-based, markerless augmented reality viewer for classroom use. It is a lightweight replacement for Adobe Aero in teaching demonstrations.

A student drops a 3D model into a web page, checks it in a 3D viewer, then opens it in AR on their phone to place it on a floor or table. No marker and no app install.

> **Status:** early development. Not yet tested on a real phone.

## Goals

- Drag and drop a 3D model into a web interface.
- A built-in 3D viewer to inspect the model (drag to rotate).
- Markerless AR on a phone: place the model on a real surface at a chosen real-world size.
- Run entirely in the browser, so it is easy to host and demo in a class.

Marker-based AR is out of scope. It is a separate application.

## Supported model formats

| Format | Extension |
| --- | --- |
| STL | `.stl` |
| 3MF | `.3mf` |
| glTF / GLB | `.gltf`, `.glb` |
| OBJ | `.obj` |

## How it works

1. The student opens the page and drops a model file onto it (or taps to choose one).
2. The model appears in the 3D viewer. Drag to rotate.
3. The student sets the real-world size (default 20 cm, longest side).
4. They tap "View in AR". The model is exported to GLB in the browser and handed to the phone's AR viewer, where it is placed on the floor or a table.

## Tech stack

- [A-Frame](https://aframe.io/) for the 3D viewer
- [`<model-viewer>`](https://modelviewer.dev/) for surface AR (WebXR and Scene Viewer on Android, Quick Look on iPhone). The loaded model is exported to GLB in the browser with three.js `GLTFExporter`.
- [JSZip](https://stuk.github.io/jszip/) to read 3MF files
- Plain HTML and JavaScript, hosted as a static site

## Getting started

There is no build step. It is a static site: `index.html`, `css/style.css` and `js/main.js`.

Serve the folder locally:

```bash
npx serve .
```

AR needs a secure origin. To test on a phone, host the site over HTTPS (for example GitHub Pages) or use an HTTPS tunnel. A plain `http://` address, a `file://` page or a network address like `http://192.168.x.x` will not work for AR on a phone.

AR depends on the device: it needs Chrome on a recent Android phone with Google Play Services for AR, or Safari on an iPhone. It does not work on desktop browsers. If the device can't do it, the page says so.

Known limits: `.gltf` files that reference separate `.bin` or texture files won't load from a single file, so use `.glb`. OBJ files load without their `.mtl` materials. STL and 3MF models are shown in plain grey: 3MF colours and materials are ignored. 3MF files from slicers that split a model into several parts (Bambu Studio, PrusaSlicer, Orca) are supported.

## Roadmap

- [x] Drag-and-drop model loading
- [x] STL, 3MF, glTF/GLB and OBJ support
- [x] Drag-to-rotate 3D viewer
- [x] Real-world size control
- [ ] Markerless AR tested on Android and iPhone
- [ ] Colour and material support
- [ ] Shareable viewer link or QR code

## License

TBD
