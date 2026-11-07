// The approved wallpaper defaults, with desktop-friendly density and motion.
export const defaults = {
  quality: 'eco', brightness: 90, speed: 45, parallax: 45,
  showtitle: false, showbrand: false, cruise: true,
  audio: 'off', sensitivity: 85, gravity: false,
};
export const qualityPresets = {
  eco: { density: .46, dpr: 1, maxHeight: 1080 },
  balanced: { density: .76, dpr: 1.25, maxHeight: 1440 },
  high: { density: 1, dpr: 1.75, maxHeight: 2160 },
};
