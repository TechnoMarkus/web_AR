# AR-tool

A browser-based, marker-based augmented reality viewer for classroom use. It is a lightweight replacement for Adobe Aero in teaching demonstrations.

A student drops a 3D model into a web page and gets a viewer they can open on their phone. Point the phone camera at a marker and the model appears anchored to it.

> **Status:** early development. The features below describe the intended behaviour. Nothing here is a finished feature unless stated.

## Goals

- Drag and drop a 3D model into a web interface.
- Generate a viewer that works on a phone browser, with no app install.
- Run entirely in the browser, so it is easy to host and demo in a class.

## Supported model formats

| Format | Extension |
| --- | --- |
| STL | `.stl` |
| glTF / GLB | `.gltf`, `.glb` |
| OBJ | `.obj` |

## How it works

1. The student opens the web interface and drags a model file onto it.
2. The tool loads the model and previews it.
3. The student opens the generated viewer on their phone.
4. The phone camera detects the marker and displays the model anchored to it.

## Tech stack

- [A-Frame](https://aframe.io/) for the 3D scene
- [AR.js](https://ar-js-org.github.io/AR.js-Docs/) for marker-based tracking
- Plain HTML and JavaScript, hosted as a static site

## Getting started

There is no build step. It is a static site: `index.html`, `css/style.css` and `js/main.js`.

Serve the folder locally:

```bash
npx serve .
```

Phone browsers only allow camera access on a secure origin. To test on a phone, host the site over HTTPS (for example GitHub Pages) or use an HTTPS tunnel. `localhost` works on the same computer only.

To use it:

1. Open the page and allow camera access.
2. Drag a model onto the page, or tap the drop zone to pick a file (on a phone, choose a file from the device).
3. Show the Hiro marker to the camera. Use "Preview without marker" to check the model without one.

Known limits: `.gltf` files that reference separate `.bin` or texture files won't load from a single file, so use `.glb`. OBJ files load without their `.mtl` materials.

## Roadmap

- [ ] Drag-and-drop model loading
- [ ] STL, glTF/GLB and OBJ support
- [ ] Marker-based AR viewer for phones
- [ ] Model scale, rotation and position controls
- [ ] Shareable viewer link or QR code
- [ ] Printable marker

## License

TBD
