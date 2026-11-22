(function () {
  "use strict";

  if (!location.hostname.endsWith(".github.io") && location.hostname !== "gityus13.dev") return;
  document.documentElement.setAttribute("data-static", "true");

  var chip = document.getElementById("chip-ai");
  if (chip) chip.title = "Public demo — no backend connection";

  function animate() {
    if (!window.gsap) return;
    gsap.set("#app > *", { transformOrigin: "50% 50%" });
    gsap.from("#top", { y: -24, opacity: 0, duration: .8, ease: "power3.out" });
    gsap.from("#left .panel", { x: -28, opacity: 0, duration: .75, stagger: .08, delay: .18, ease: "power3.out" });
    gsap.from("#right .panel", { x: 28, opacity: 0, duration: .75, stagger: .08, delay: .18, ease: "power3.out" });
    gsap.from("#stage", { scale: .96, opacity: 0, duration: 1, delay: .12, ease: "power3.out" });
    gsap.from("#feed", { y: 16, opacity: 0, duration: .7, delay: .45, ease: "power2.out" });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(animate, 760);
  });

  document.addEventListener("click", function (event) {
    var mode = event.target.closest && event.target.closest("#modes button");
    if (!mode || !window.gsap) return;
    gsap.fromTo(mode, { scale: .94 }, { scale: 1, duration: .35, ease: "back.out(2)" });
    gsap.fromTo("#stage", { filter: "brightness(1.5)" }, { filter: "brightness(1)", duration: .55, ease: "power2.out" });
  });
})();
