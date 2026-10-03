const en = {
  app: { name: 'Unicali Mockups', untitled: 'Untitled project' },
  header: {
    undo: 'Undo', redo: 'Redo', export: 'Export', projects: 'Projects', newProject: 'New project',
    delete: 'Delete', noProjects: 'No saved projects yet', saved: 'Saved locally',
  },
  sidebar: { device: 'Device', media: 'Media', motion: 'Motion' },
  device: { model: 'Model', finish: 'Finish' },
  media: {
    drop: 'Drop a screenshot or screen recording', browse: 'or click to browse',
    formats: 'PNG, JPG, WebP, MP4, WebM, MOV', library: 'Library', use: 'Use on device',
    importing: 'Importing…', inUse: 'On screen',
  },
  motion: {
    hint: 'Click a motion to add it at the playhead. Motions stack, so combine an entrance with a camera move.',
    categories: { entrance: 'Entrances', camera: 'Camera', emphasis: 'Emphasis', loop: 'Loops' },
  },
  inspector: {
    scene: 'Scene', format: 'Format', duration: 'Duration', fps: 'Frame rate',
    background: 'Background', solid: 'Solid', gradient: 'Gradient', transparent: 'Transparent',
    color: 'Color', color2: 'Color 2', angle: 'Angle', lighting: 'Lighting', preset: 'Preset',
    intensity: 'Intensity', environment: 'Reflections', studio: 'Studio', soft: 'Soft', dramatic: 'Dramatic',
    transform: 'Transform', position: 'Position', rotation: 'Rotation', scale: 'Scale',
    screen: 'Screen', fit: 'Fit', cover: 'Cover', contain: 'Contain', fill: 'Fill',
    zoom: 'Content zoom', panX: 'Pan X', panY: 'Pan Y', noMedia: 'No media — import one in the Media tab',
    camera: 'Camera', target: 'Target', yaw: 'Orbit', pitch: 'Height', distance: 'Distance', fov: 'Lens (FOV)',
    reset: 'Reset', frameDevice: 'Frame device',
    clip: 'Motion', start: 'Start', length: 'Length', bake: 'Convert to keyframes',
    bakeHint: 'Turns this motion into editable keyframes (advanced).', remove: 'Remove',
    focusPick: 'Drag on the screen to choose what to zoom into',
    tracks: 'Keyframe tracks', clearTracks: 'Clear keyframes',
  },
  timeline: { play: 'Play', pause: 'Pause', loop: 'Loop', camera: 'Camera', keyframes: 'Keyframes' },
  export: {
    title: 'Export video', format: 'Format', mp4: 'MP4 (H.264)', webm: 'WebM (VP9, supports transparency)',
    png: 'PNG sequence (.zip)', resolution: 'Resolution', fps: 'Frame rate', quality: 'Quality',
    standard: 'Standard', high: 'High', max: 'Maximum', motionBlur: 'Motion blur', off: 'Off',
    audio: 'Include screen-recording audio', saveToDisk: 'Stream directly to a file (large exports)',
    start: 'Export', cancel: 'Cancel', close: 'Close', rendering: 'Rendering frame {{done}} of {{total}}',
    done: 'Done in {{seconds}}s · {{frames}} frames · {{codec}}', download: 'Download',
    unsupported: 'This browser lacks WebCodecs video encoding. Use a recent Chrome, Edge, Safari or Firefox.',
    transparentHint: 'Transparent background is preserved in WebM and PNG. MP4 has no alpha channel.',
    failed: 'Export failed: {{message}}',
  },
}

export default en
