(function () {
  "use strict";
  if (!window.gsap) return;
  gsap.registerPlugin(ScrollTrigger);

  var glow = document.querySelector(".cursor-glow");
  window.addEventListener("pointermove", function (event) {
    gsap.to(glow, { x:event.clientX, y:event.clientY, duration:.8, ease:"power2.out" });
  });

  gsap.set(".hero-copy .reveal", { y:20, opacity:0 });
  gsap.set(".title-line>span", { y:"110%" });
  var intro = gsap.timeline({ defaults:{ease:"power4.out"} });
  intro.to(".title-line>span", { y:"0%", duration:1.05, stagger:.12, delay:.15 })
       .to(".hero-copy .reveal", { y:0, opacity:1, duration:.8, stagger:.12 }, "-=.55")
       .from(".hero-visual", { scale:.86, opacity:0, duration:1.2 }, "-=.9");

  gsap.utils.toArray(".manifesto .feature-card").forEach(function (card, index) {
    gsap.from(card, { y:70, opacity:0, duration:.9, delay:index*.03,
      scrollTrigger:{trigger:card, start:"top 88%", once:true} });
  });

  gsap.from(".proof-strip>div", { y:20, opacity:0, duration:.7, stagger:.08,
    scrollTrigger:{trigger:".proof-strip", start:"top 88%", once:true} });

  gsap.from(".step", { x:-35, opacity:0, duration:.8, stagger:.12,
    scrollTrigger:{trigger:".steps", start:"top 80%", once:true} });

  gsap.from(".terminal", { x:35, opacity:0, scale:.97, duration:1,
    scrollTrigger:{trigger:".terminal", start:"top 80%", once:true} });

  gsap.from(".final-cta h2", { y:40, opacity:0, duration:.9,
    scrollTrigger:{trigger:".final-cta", start:"top 75%", once:true} });

  gsap.to(".core-wrap", { y:-12, duration:2.8, repeat:-1, yoyo:true, ease:"sine.inOut" });
})();


document.querySelectorAll('.copy-btn').forEach(button => {
  button.addEventListener('click', async () => {
    const originalText = button.textContent;

    try {
      await navigator.clipboard.writeText(button.dataset.copy);

      button.textContent = 'Copied!';
      button.classList.add('copied');

      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);

    } catch (error) {
      button.textContent = 'Failed';

      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
    }
  });
});
