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
    'or call <a href="tel:+27722517390">+27 72 251 7390</a> and we\'ll pick it up right away.';

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
          showError("Sorry – your enquiry didn't send. " + FALLBACK);
        });
    });
  }

  /* Prefill the enquiry form from ?property=&checkin=&checkout= — the availability
     calendar on each property page links here with the dates already chosen, so the
     guest never re-types what they just clicked. */
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
  ["checkin", "checkout"].forEach(function (key) {
    var value = params.get(key);
    var field = document.querySelector('input[name="' + key + '"]');
    // Only ISO dates — anything else is junk to a type="date" input anyway.
    if (field && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) field.value = value;
  });

  /* Optional "from R X" pricing — reads /api/rates (backed by a Supabase rates
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

  /* Property-location map with tabs (Langebaan) — Google's no-API-key embed
     format (`output=embed`), so no Cloud project/billing setup is needed.
     Pins are approximate-area (matching how holiday rentals usually handle
     this), sourced from Louise's own Google Maps links, not guessed. */
  var LOC_MAP_PINS = {
    "beach-cottage": { name: "Atlantic Beach Cottage", lat: -33.0833287, lng: 18.0320084 },
    "apartment": { name: "Atlantic Apartment", lat: -33.0918692, lng: 18.033316 }
  };
  document.querySelectorAll("[data-loc-map]").forEach(function (widget) {
    var frame = widget.querySelector("[data-loc-frame]");
    var tabs = widget.querySelectorAll("[data-loc-tab]");
    if (!frame || !tabs.length) return;

    var activate = function (key) {
      var pin = LOC_MAP_PINS[key];
      if (!pin) return;
      tabs.forEach(function (t) {
        var isActive = t.getAttribute("data-loc-tab") === key;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      frame.src = "https://www.google.com/maps?q=" + pin.lat + "," + pin.lng + "&z=15&output=embed";
      frame.title = "Map showing " + pin.name + " in Langebaan";
    };

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () { activate(tab.getAttribute("data-loc-tab")); });
    });

    activate(widget.getAttribute("data-loc-map") || tabs[0].getAttribute("data-loc-tab"));
  });

  /* Availability calendar — reads /api/availability/:slug (Airbnb + Booking.com +
     direct, merged server-side), renders a 2-month grid, and lets a guest pick a
     date range and carry it straight to whichever channel they want to book on.

     It never "reserves" anything: the site is enquire-only, so selecting dates just
     pre-fills the enquiry form (or Airbnb/Booking.com's own date params) instead of
     making the guest re-type dates they already picked. Blocked ranges only ever
     come from a channel that's actually configured — see the fail-soft contract in
     api/availability/[property].js, which this trusts rather than re-deciding. */
  document.querySelectorAll("[data-availability]").forEach(function (root) {
    var slug = root.getAttribute("data-availability");
    var propertyName = root.getAttribute("data-property") || "";
    var airbnbUrl = root.getAttribute("data-airbnb") || "";
    var bookingUrl = root.getAttribute("data-booking") || "";
    var contactUrl = root.getAttribute("data-contact") || "../contact.html";

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    var MAX_MONTHS_AHEAD = 12;
    var DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    var MONTHS = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    var blocked = null;        // [{from, to}], `to` exclusive — sorted + merged by the API
    var checkin = null;        // ISO string
    var checkout = null;       // ISO string

    function toISO(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    // Parse as a LOCAL date — new Date('2026-10-16') is UTC midnight, which renders
    // as the 15th anywhere west of Greenwich.
    function fromISO(iso) {
      var p = iso.split("-");
      return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    function fmt(iso) {
      var d = fromISO(iso);
      return d.getDate() + " " + SHORT[d.getMonth()] + " " + d.getFullYear();
    }

    function nightsBetween(a, b) {
      return Math.round((fromISO(b) - fromISO(a)) / 86400000);
    }

    function isTaken(iso) {
      for (var i = 0; i < blocked.length; i++) {
        if (iso >= blocked[i].from && iso < blocked[i].to) return true;
      }
      return false;
    }

    /* The earliest booking that starts after `iso`. Once a check-in is picked this
       is how far the stay can run: you may check OUT on that day (the outgoing and
       incoming guest share a turnover day) but not stay through it. */
    function nextBookingStart(iso) {
      var best = null;
      for (var i = 0; i < blocked.length; i++) {
        if (blocked[i].from > iso && (best === null || blocked[i].from < best)) best = blocked[i].from;
      }
      return best;
    }

    function dayState(iso, d, limit) {
      if (d < today) return "past";
      if (checkin && checkout) {
        if (iso === checkin || iso === checkout) return "sel";
        if (iso > checkin && iso < checkout) return "inrange";
        return isTaken(iso) ? "taken" : "free";
      }
      if (checkin) {
        if (iso === checkin) return "sel";
        if (iso < checkin) return isTaken(iso) ? "taken" : "free";
        if (limit && iso > limit) return "out";          // can't stay past the next booking
        if (isTaken(iso)) return iso === limit ? "turn" : "taken";
        return "free";
      }
      return isTaken(iso) ? "taken" : "free";
    }

    var STATE_CLASS = {
      past: " avail-cal__day--past",
      taken: " avail-cal__day--taken",
      out: " avail-cal__day--out",
      free: " avail-cal__day--free",
      turn: " avail-cal__day--taken avail-cal__day--turn",
      sel: " avail-cal__day--sel",
      inrange: " avail-cal__day--inrange"
    };
    var SELECTABLE = { free: 1, turn: 1, sel: 1 };

    function renderMonth(monthStart, limit) {
      var year = monthStart.getFullYear(), month = monthStart.getMonth();
      var firstDow = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      var dow = '<div class="avail-cal__dow">' + DOW.map(function (d) { return "<span>" + d + "</span>"; }).join("") + "</div>";

      var cells = "";
      for (var i = 0; i < firstDow; i++) cells += '<div class="avail-cal__day avail-cal__day--empty"></div>';
      for (var day = 1; day <= daysInMonth; day++) {
        var d = new Date(year, month, day);
        var iso = toISO(d);
        var state = dayState(iso, d, limit);
        var attrs = ' data-d="' + iso + '" data-state="' + state + '"';
        if (SELECTABLE[state]) attrs += ' role="button" tabindex="0"';
        if (state === "turn") attrs += ' title="Free as a check-out day"';
        cells += '<div class="avail-cal__day' + STATE_CLASS[state] + '"' + attrs + ">" + day + "</div>";
      }

      return '<div class="avail-cal__month">' +
        '<div class="avail-cal__month-name">' + MONTHS[month] + " " + year + "</div>" +
        dow + '<div class="avail-cal__days">' + cells + "</div>" +
        "</div>";
    }

    // Adds the picked dates to a channel's own URL. Each platform names these
    // differently, hence the key arguments.
    function withDates(base, inKey, outKey) {
      if (!checkin || !checkout) return base;
      return base + (base.indexOf("?") === -1 ? "?" : "&") +
        inKey + "=" + checkin + "&" + outKey + "=" + checkout;
    }

    function channelBtn(href, variant, icon, label, sub) {
      return '<a class="channel-btn channel-btn--' + variant + '" href="' + href + '"' +
        (variant === "direct" ? "" : ' target="_blank" rel="noopener"') + ">" +
        '<span class="ic">' + icon + "</span>" +
        "<span>" + label + " <small>" + sub + "</small></span>" +
        '<span class="chev"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="' +
        (variant === "direct" ? "M9 6l6 6-6 6" : "M7 17L17 7M9 7h8v8") + '"/></svg></span></a>';
    }

    var ICON_DIRECT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10l9-7 9 7v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>';
    var ICON_AIRBNB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3c3 5 6 8 6 12a6 6 0 01-12 0c0-4 3-7 6-12z"/></svg>';
    var ICON_BOOKING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M9 8h.01M9 12h.01M15 8h.01M15 12h.01"/></svg>';

    function footerHtml() {
      var summary;
      if (!checkin) {
        summary = '<p class="avail-cal__hint">Pick your check-in date, then your check-out date — we\'ll carry them through to whichever way you book.</p>';
      } else if (!checkout) {
        summary = '<p class="avail-cal__hint"><b>' + fmt(checkin) + '</b> — now choose your check-out date.</p>';
      } else {
        var n = nightsBetween(checkin, checkout);
        summary = '<div class="avail-cal__summary"><div>' +
          "<b>" + fmt(checkin) + " &rarr; " + fmt(checkout) + "</b>" +
          "<span>" + n + " night" + (n === 1 ? "" : "s") + "</span></div>" +
          '<button type="button" class="avail-cal__clear" data-avail-clear>Clear dates</button></div>';
      }

      var directHref = withDates(contactUrl + "?property=" + encodeURIComponent(propertyName), "checkin", "checkout");
      var btns = channelBtn(directHref, "direct", ICON_DIRECT, "Book direct", "Best rate &middot; no service fees");
      if (airbnbUrl) btns += channelBtn(withDates(airbnbUrl, "check_in", "check_out"), "airbnb", ICON_AIRBNB, "Book on Airbnb", "Reviews &amp; secure checkout");
      if (bookingUrl) btns += channelBtn(withDates(bookingUrl, "checkin", "checkout"), "booking", ICON_BOOKING, "Book on Booking.com", "Reviews &amp; secure checkout");

      return summary + '<div class="avail-cal__channels">' + btns + "</div>";
    }

    function render() {
      var limit = checkin && !checkout ? nextBookingStart(checkin) : null;
      var next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      root.innerHTML =
        '<div class="avail-cal__head">' +
        '<button type="button" class="avail-cal__nav" data-avail-prev aria-label="Previous month">&#8249;</button>' +
        '<div class="avail-cal__label">' + MONTHS[cursor.getMonth()] + " " + cursor.getFullYear() + "</div>" +
        '<button type="button" class="avail-cal__nav" data-avail-next aria-label="Next month">&#8250;</button>' +
        "</div>" +
        '<div class="avail-cal__grids">' + renderMonth(cursor, limit) + renderMonth(next, limit) + "</div>" +
        '<div class="avail-cal__legend">' +
        '<span><i class="avail-cal__day">15</i> Available</span>' +
        '<span><i class="avail-cal__day avail-cal__day--taken">15</i> Already booked</span>' +
        '<span><i class="avail-cal__day avail-cal__day--sel">15</i> Your dates</span>' +
        "</div>" +
        footerHtml() +
        '<p class="avail-cal__note">Booked dates are pulled from Airbnb, Booking.com and direct bookings. ' +
        "We don't take instant bookings, so nothing is charged here — we confirm your dates within 24 hours.</p>";

      var prevBtn = root.querySelector("[data-avail-prev]");
      var nextBtn = root.querySelector("[data-avail-next]");
      prevBtn.disabled = cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth();
      var monthsAhead = (cursor.getFullYear() - today.getFullYear()) * 12 + (cursor.getMonth() - today.getMonth());
      nextBtn.disabled = monthsAhead >= MAX_MONTHS_AHEAD;
    }

    function pick(iso, state) {
      if (!SELECTABLE[state]) return;
      if (checkin && !checkout && iso === checkin) { checkin = null; }        // click it again to undo
      else if (!checkin || checkout) { checkin = iso; checkout = null; }      // start (or restart) a range
      else if (iso < checkin) { checkin = iso; }                              // moved earlier — treat as new check-in
      else { checkout = iso; }
      render();
    }

    // Delegated once, on the container that survives every re-render.
    root.addEventListener("click", function (e) {
      if (e.target.closest("[data-avail-clear]")) { checkin = checkout = null; render(); return; }
      var nav = e.target.closest("[data-avail-prev], [data-avail-next]");
      if (nav) {
        if (nav.disabled) return;
        var step = nav.hasAttribute("data-avail-prev") ? -1 : 1;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
        render();
        return;
      }
      var cell = e.target.closest("[data-d]");
      if (cell) pick(cell.getAttribute("data-d"), cell.getAttribute("data-state"));
    });

    root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var cell = e.target.closest && e.target.closest("[data-d]");
      if (!cell) return;
      e.preventDefault();
      pick(cell.getAttribute("data-d"), cell.getAttribute("data-state"));
    });

    function showStatus(message) {
      root.innerHTML = '<p class="avail-cal__status">' + message + "</p>";
    }

    showStatus("Loading availability…");
    fetch("/api/availability/" + slug)
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("bad response")); })
      .then(function (data) {
        if (!data || !Array.isArray(data.blocked)) throw new Error("malformed response");
        blocked = data.blocked;
        render();
      })
      .catch(function () {
        showStatus("We couldn't load live availability right now — send us your dates and we'll confirm by return.");
      });
  });

  /* Footer year */
  var yr = document.querySelector("[data-year]");
  if (yr) yr.textContent = new Date().getFullYear();
})();
