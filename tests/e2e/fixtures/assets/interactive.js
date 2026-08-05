const target = document.querySelector('#motion-target');
const offlineAssets = JSON.parse(
  '{"images":["http://sitecapsule.test:4173/assets/interactive-frame.svg"]}',
);
let frame = 0;

if (location.hostname !== 'sitecapsule.test') {
  const image = new Image();
  image.addEventListener('load', () => {
    document.documentElement.dataset.nestedAssetLoaded = 'true';
  });
  image.src = offlineAssets.images[0];
}

function animate() {
  frame += 1;
  document.documentElement.dataset.animationFrame = String(frame);
  if (target) target.style.transform = `translateX(${frame % 120}px)`;
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
