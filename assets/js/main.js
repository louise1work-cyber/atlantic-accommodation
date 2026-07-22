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

  /* Enquiry form — posts to our own /api/enquiry function, which sends via Resend.
     Never show success unless the send is actually confirmed: a false "thank you"
     loses a real booking silently. */
  var ENDPOINT = "/api/enquiry";
  var FALLBACK =
    'Please email <a href="mailto:info@atlanticaccommodation.co.za">info@atlanticaccommodation.co.za</a> ' +
    'or call <a href="tel:+27713252574">+27 71 325 2574</a> and we\'ll pick it up right away.';

  var form = document.querySelector("[data-enquiry]");
  if (form) {
    var errorBox = form.querySelector("[data-form-error]");
    var button = form.querySelector("[data-submit]");
    var successBox = form.parentNode.querySelector(".form-success");
    var loadedAt = Date.now();

    // Load Cloudflare Turnstile only if a real site key is configured, so the
    // form isn't blocked by a broken widget before setup.
    var siteKey = form.getAttribute("data-turnstile-sitekey");
    var turnstileReady = false;
    if (siteKey && siteKey.indexOf("REPLACE_WITH") !== 0) {
      var holder = form.querySelector("[data-turnstile]");
      if (holder) {
        holder.setAttribute("data-sitekey", siteKey);
        holder.hidden = false;
        var s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
        turnstileReady = true;
      }
    }

    var showError = function (msg) {
      if (!errorBox) return;
      errorBox.innerHTML = msg;
      errorBox.hidden = false;
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (errorBox) errorBox.hidden = true;

      // Let the browser flag missing/invalid required fields.
      if (typeof form.checkValidity === "function" && !form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.elapsed = Date.now() - loadedAt;

      // Turnstile token is attached when present, but the browser never
      // hard-blocks on it — the server is the real gate. If the widget is
      // still solving or errored, the submit proceeds and the server (once
      // its secret is set) accepts or rejects. This avoids a stuck form if
      // the widget ever fails to load.

      button.disabled = true;
      var label = button.textContent;
      button.textContent = "Sending…";

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data)
      })
        .then(function (res) {
          return res.json()
            .catch(function () { return {}; })            // non-JSON (proxy error page, etc.)
            .then(function (j) { return { ok: res.ok, body: j || {} }; });
        })
        .then(function (r) {
          if (!r.ok || r.body.ok !== true) throw new Error(r.body.error || "Send failed");
          form.style.display = "none";
          if (successBox) successBox.classList.add("show");
        })
        .catch(function () {
          button.disabled = false;
          button.textContent = label;
          showError("Sorry — your enquiry didn't send. " + FALLBACK);
        });
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

  /* Optional "from R X" pricing — reads /api/rates (backed by an Airtable Rates
     table). Until a rate is set for a property this stays untouched, so the
     page keeps showing "Enquire — for rates & availability" by default. */
  var rateBox = document.querySelector("[data-rate]");
  if (rateBox) {
    var property = rateBox.getAttribute("data-rate");
    fetch("/api/rates")
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (rates) {
        var rate = rates && rates[property];
        if (!rate || !(rate.fromPrice > 0)) return;
        var amount = Math.round(rate.fromPrice).toLocaleString("en-ZA");
        rateBox.innerHTML = "<b>From R" + amount + "</b><span>per " + (rate.per === "week" ? "week" : "night") + "</span>";
      })
      .catch(function () { /* keep the Enquire fallback */ });
  }

  /* Footer year */
  var yr = document.querySelector("[data-year]");
  if (yr) yr.textContent = new Date().getFullYear();
})();
