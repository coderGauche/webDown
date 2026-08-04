const target = document.querySelector('#motion-target');
let frame = 0;

function animate() {
  frame += 1;
  document.documentElement.dataset.animationFrame = String(frame);
  if (target) target.style.transform = `translateX(${frame % 120}px)`;
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
