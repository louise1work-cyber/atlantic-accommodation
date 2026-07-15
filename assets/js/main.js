/* Atlantic Accommodation — interactions */
(function () {
  "use strict";

  /* Mobile nav toggle */
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav__toggle");
  if (toggle && header) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    header.querySelectorAll(".nav__links a").forEach(function (a) {
      a.addEventListener("click", function () { header.classList.remove("open"); });
    });
  }

  /* Scroll reveal */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* Enquiry form (demo — no backend yet) */
  var form = document.querySelector("[data-enquiry]");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var success = form.parentNode.querySelector(".form-success");
      form.style.display = "none";
      if (success) success.classList.add("show");
      // Placeholder: wire up to email service / backend before going live.
      console.info("Enquiry captured (demo):", Object.fromEntries(new FormData(form)));
    });
  }

  /* Prefill property on enquiry form when arriving via ?property= */
  var params = new URLSearchParams(window.location.search);
  var prop = params.get("property");
  if (prop) {
    var select = document.querySelector('select[name="property"]');
    if (select) {
      Array.prototype.forEach.call(select.options, function (o) {
        if (o.value.toLowerCase() === prop.toLowerCase()) o.selected = true;
      });
    }
  }

  /* Footer year */
  var yr = document.querySelector("[data-year]");
  if (yr) yr.textContent = new Date().getFullYear();
})();
