const colors = ['#e2c38b', '#b8ded9', '#86c7c5'];
let seed = 606;
const random = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
};
const stars = Array.from({ length: 24 }, () => ({
  x: 5 + random() * 166, y: 4 + random() * 79,
  radius: .35 + random() * .4, opacity: .22 + random() * .34,
  color: colors[Math.floor(random() * colors.length)],
}));
const dust = Array.from({ length: 96 }, () => {
  const t = random(), spread = (random() - .5) * 15;
  return { x: 83 + t * 102 + spread, y: 83 - t * 43 + Math.sin(t * 4) * 7 + spread,
    radius: .2 + random() * .5, opacity: .18 + random() * .4,
    color: colors[t < .4 ? 0 : 1 + Math.floor(random() * 2)] };
});
const lights = [
  { x: 153, y: 65, radius: 2.5, color: colors[1] },
  { x: 113, y: 80, radius: 1.65, color: colors[0] },
  { x: 169, y: 25, radius: 1.4, color: colors[2] },
];

export function TrayStars() {
  return <svg className="tray-stars" viewBox="0 0 176 87" preserveAspectRatio="none"
    aria-hidden="true" focusable="false">
    {[...stars, ...dust].map((star, index) => <circle key={index} cx={star.x} cy={star.y}
      r={star.radius} fill={star.color} opacity={star.opacity}/>)}
    {lights.map((star, index) => <g key={index} className="tray-stars-light" fill={star.color}
      style={{ animationDelay: `${index * -1.7}s` }}>
      <path d={`M${star.x},${star.y - star.radius}l.45,${star.radius - .45}l${star.radius - .45},.45l${.45 - star.radius},.45l-.45,${star.radius - .45}l-.45,${.45 - star.radius}l${.45 - star.radius},-.45l${star.radius - .45},-.45Z`}/>
      <circle cx={star.x} cy={star.y} r=".65" fill="#e7f2ed"/>
    </g>)}
  </svg>;
}
