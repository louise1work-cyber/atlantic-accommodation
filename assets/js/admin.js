/* Owner admin (/admin) — sign-in, the change-request chat, and the request list.
   Talks only to /api/admin/*; the session lives in an HttpOnly cookie this script
   never sees. Loaded as an external file because the site's CSP forbids inline
   scripts. */
(function () {
  "use strict";

  var MAX_PHOTOS = 6;
  var MAX_EDGE = 2000;       // px — photos are downsized in the browser before upload
  var JPEG_QUALITY = 0.85;

  var STATUS_LABELS = { new: "Received", in_progress: "In progress", done: "Done", declined: "Not going ahead" };

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    conversationId: null,
    photos: [],          // { id, name, thumb, status: "uploading" | "ready" | "error", ref }
    sending: false,
    assistantReady: true,
    requestsStale: true
  };

  // ---- API -----------------------------------------------------------------

  function api(action, body) {
    var options = { method: body ? "POST" : "GET", credentials: "same-origin", headers: {} };
    if (body) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    return fetch("/api/admin/" + action, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "Something went wrong. Please check your connection and try again.");
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error("Couldn't reach the server. Please check your connection and try again.");
    });
  }

  function onAuthLost(err) {
    if (err && err.status === 401) {
      showView("login");
      setStatus("login-status", "You've been signed out. Please sign in again.", false);
      return true;
    }
    return false;
  }

  // ---- Views ---------------------------------------------------------------

  function showView(name) {
    ["loading", "login", "verify", "app"].forEach(function (v) {
      $("view-" + v).hidden = v !== name;
    });
    $("sign-out").hidden = name !== "app";
  }

  function setStatus(id, message, isError) {
    var el = $(id);
    el.textContent = message || "";
    el.classList.toggle("is-error", Boolean(isError));
  }

  // ---- Sign-in -------------------------------------------------------------

  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("login-email");
    var email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("login-status", "Please enter a valid email address.", true);
      input.focus();
      return;
    }
    var button = e.target.querySelector("button");
    button.disabled = true;
    setStatus("login-status", "Sending…", false);
    api("login", { email: email })
      .then(function () {
        setStatus("login-status",
          "If that address has access, a sign-in link is on its way. It expires in 15 minutes. " +
          "Nothing after a few minutes? Check your spam folder, or contact Nimbus Design.", false);
      })
      .catch(function (err) { setStatus("login-status", err.message, true); })
      .then(function () { button.disabled = false; });
  });

  // The link's token is only spent when the owner taps "Sign in" — not on page load —
  // so an email security scanner that opens links to check them can't use it up first.
  function startVerify(token) {
    showView("verify");
    $("verify-button").addEventListener("click", function () {
      var button = this;
      button.disabled = true;
      setStatus("verify-status", "Signing you in…", false);
      api("verify", { token: token })
        .then(function () { return api("me"); })
        .then(startApp)
        .catch(function (err) {
          showView("login");
          setStatus("login-status", err.message, true);
        })
        .then(function () { button.disabled = false; });
    });
  }

  $("sign-out").addEventListener("click", function () {
    api("logout", {}).catch(function () {}).then(function () {
      state.conversationId = null;
      clearChat();
      showView("login");
      setStatus("login-status", "You're signed out.", false);
    });
  });

  // ---- App -----------------------------------------------------------------

  function startApp(me) {
    state.assistantReady = Boolean(me.assistantReady);
    $("assistant-off").hidden = state.assistantReady;
    $("composer-text").disabled = !state.assistantReady;
    $("photo-input").disabled = !state.assistantReady;
    updateSendButton();
    // Keep the "For example" hints hidden until we know whether there's a conversation
    // to resume; otherwise a returning owner sees them flash up before their chat loads.
    $("chat-empty").hidden = true;
    showView("app");
    selectTab("chat");

    return api("conversation").then(function (data) {
      state.conversationId = data.conversationId;
      clearChat();
      data.items.forEach(function (item) { addMessage(item.role, item.text, item.photos); });
      scrollToEnd();
    }).catch(function (err) {
      if (!onAuthLost(err)) addMessage("error", err.message);
    });
  }

  function selectTab(name) {
    ["chat", "requests"].forEach(function (t) {
      var active = t === name;
      $("tab-" + t).classList.toggle("is-active", active);
      $("tab-" + t).setAttribute("aria-selected", active ? "true" : "false");
      $("panel-" + t).hidden = !active;
    });
    if (name === "requests" && state.requestsStale) loadRequests();
  }
  $("tab-chat").addEventListener("click", function () { selectTab("chat"); });
  $("tab-requests").addEventListener("click", function () { selectTab("requests"); });

  // ---- Chat ----------------------------------------------------------------

  var log = $("chat-log");
  var textarea = $("composer-text");

  function clearChat() {
    Array.prototype.slice.call(log.querySelectorAll(".msg")).forEach(function (el) { el.remove(); });
    $("chat-empty").hidden = false;
  }

  // `photos` is a list of names (from history) or of { name, thumb } (just sent).
  function addMessage(role, text, photos) {
    $("chat-empty").hidden = true;
    var el = document.createElement("div");
    el.className = "msg msg--" + role;

    if (photos && photos.length) {
      var strip = document.createElement("div");
      strip.className = "msg__photos";
      photos.forEach(function (p) {
        if (p && p.thumb) {
          var img = document.createElement("img");
          img.className = "msg__photo";
          img.src = p.thumb;
          img.alt = p.name;
          strip.appendChild(img);
        } else {
          var tag = document.createElement("span");
          tag.className = "msg__photo-name";
          tag.textContent = "📷 " + (p && p.name ? p.name : p);
          strip.appendChild(tag);
        }
      });
      el.appendChild(strip);
    }
    if (text) {
      var body = document.createElement("div");
      body.textContent = text;
      el.appendChild(body);
    }
    log.appendChild(el);
    return el;
  }

  function scrollToEnd() {
    window.scrollTo({ top: document.body.scrollHeight });
  }

  $("new-request").addEventListener("click", function () {
    if (state.sending) return;
    state.conversationId = null;
    clearChat();
    textarea.focus();
  });

  function growTextarea() {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + 2 + "px";
  }
  textarea.addEventListener("input", function () { growTextarea(); updateSendButton(); });

  // Enter makes a new line (most owners are on phones); Ctrl/Cmd+Enter sends.
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });

  function updateSendButton() {
    var uploading = state.photos.some(function (p) { return p.status === "uploading"; });
    var ready = state.photos.some(function (p) { return p.status === "ready"; });
    var hasContent = textarea.value.trim() || ready;
    var button = $("send-button");
    button.disabled = !state.assistantReady || state.sending || uploading || !hasContent;
    // Only the label changes: on phones the label is hidden and the arrow icon shows.
    var label = uploading ? "Uploading…" : "Send";
    $("send-label").textContent = label;
    button.setAttribute("aria-label", label);
  }

  $("composer").addEventListener("submit", function (e) {
    e.preventDefault();
    var text = textarea.value.trim();
    var ready = state.photos.filter(function (p) { return p.status === "ready"; });
    if (state.sending || (!text && !ready.length)) return;

    state.sending = true;
    addMessage("owner", text, ready.map(function (p) { return { name: p.name, thumb: p.thumb }; }));
    textarea.value = "";
    growTextarea();
    var sentPhotos = state.photos;
    state.photos = [];
    renderPhotoTray();
    updateSendButton();

    var typing = document.createElement("div");
    typing.className = "msg msg--assistant msg--typing";
    typing.setAttribute("aria-label", "Assistant is typing");
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing);
    scrollToEnd();

    api("chat", {
      conversationId: state.conversationId,
      text: text,
      photos: ready.map(function (p) { return { ref: p.ref, name: p.name }; })
    })
      .then(function (data) {
        state.conversationId = data.conversationId;
        typing.remove();
        // Notice before reply — the same order the conversation redraws in after a reload.
        (data.requests || []).forEach(function (r) {
          addMessage("notice", "Request #" + r.number + (r.updated ? " updated" : " sent to Nimbus Design"));
        });
        if (data.reply) addMessage("assistant", data.reply);
        if (data.requests && data.requests.length) state.requestsStale = true;
      })
      .catch(function (err) {
        typing.remove();
        if (onAuthLost(err)) return;
        addMessage("error", err.message);
        // Hand the unsent message back so nothing has to be retyped.
        if (!textarea.value) { textarea.value = text; growTextarea(); }
        if (!state.photos.length) { state.photos = sentPhotos; renderPhotoTray(); }
      })
      .then(function () {
        state.sending = false;
        updateSendButton();
        scrollToEnd();
      });
  });

  // ---- Photos --------------------------------------------------------------

  $("photo-input").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = "";
    var room = MAX_PHOTOS - state.photos.length;
    if (files.length > room) {
      addMessage("error", "You can attach up to " + MAX_PHOTOS + " photos per message.");
      files = files.slice(0, Math.max(room, 0));
    }
    files.forEach(addPhoto);
  });

  function addPhoto(file) {
    var photo = { id: Math.random().toString(36).slice(2), name: file.name || "photo", thumb: "", status: "uploading", ref: null };
    state.photos.push(photo);
    renderPhotoTray();
    updateSendButton();

    shrink(file)
      .then(function (jpeg) {
        photo.thumb = jpeg.thumb;
        renderPhotoTray();
        return api("upload", { name: photo.name, type: "image/jpeg", data: jpeg.base64 });
      })
      .then(function (data) {
        photo.ref = data.ref;
        photo.status = "ready";
      })
      .catch(function (err) {
        if (onAuthLost(err)) return;
        photo.status = "error";
        photo.error = err.message;
      })
      .then(function () {
        renderPhotoTray();
        updateSendButton();
      });
  }

  // Decode, cap the longest edge, re-encode as JPEG. Phone photos drop from several
  // MB to a few hundred KB, which keeps uploads fast on mobile data and well inside
  // the server's request size limit. Read via a data: URL because the site's CSP
  // doesn't allow blob: images.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Couldn't read that photo.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Couldn't open that photo — try a JPEG or PNG.")); };
        img.onload = function () {
          var full = draw(img, MAX_EDGE, JPEG_QUALITY);
          resolve({ base64: full.split(",")[1], thumb: draw(img, 240, 0.8) });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function draw(img, maxEdge, quality) {
    var scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // transparent PNG areas would otherwise turn black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  function renderPhotoTray() {
    var tray = $("photo-tray");
    tray.innerHTML = "";
    tray.hidden = !state.photos.length;
    state.photos.forEach(function (photo) {
      var chip = document.createElement("div");
      chip.className = "photo-chip is-" + photo.status;
      chip.title = photo.error || photo.name;
      if (photo.thumb) {
        var img = document.createElement("img");
        img.src = photo.thumb;
        img.alt = photo.name;
        chip.appendChild(img);
      }
      if (photo.status !== "ready") {
        var label = document.createElement("span");
        label.className = "photo-chip__state";
        label.textContent = photo.status === "error" ? "Failed" : "Uploading";
        chip.appendChild(label);
      }
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-chip__remove";
      remove.setAttribute("aria-label", "Remove " + photo.name);
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        state.photos = state.photos.filter(function (p) { return p !== photo; });
        renderPhotoTray();
        updateSendButton();
      });
      chip.appendChild(remove);
      tray.appendChild(chip);
    });
  }

  // ---- Requests ------------------------------------------------------------

  function loadRequests() {
    var list = $("request-list");
    list.innerHTML = '<li class="request-empty">Loading…</li>';
    api("requests")
      .then(function (data) {
        state.requestsStale = false;
        list.innerHTML = "";
        if (!data.requests.length) {
          list.innerHTML = '<li class="request-empty">No requests yet. Use “Request a change” to send your first one.</li>';
          return;
        }
        data.requests.forEach(function (r) { list.appendChild(requestItem(r)); });
      })
      .catch(function (err) {
        if (onAuthLost(err)) return;
        list.innerHTML = "";
        var li = document.createElement("li");
        li.className = "request-empty";
        li.textContent = err.message;
        list.appendChild(li);
      });
  }

  function requestItem(r) {
    var li = document.createElement("li");
    li.className = "request";

    var top = document.createElement("div");
    top.className = "request__top";
    var title = document.createElement("h3");
    title.className = "request__title";
    title.textContent = "#" + r.number + " · " + r.title;
    var status = document.createElement("span");
    status.className = "status status--" + r.status;
    status.textContent = STATUS_LABELS[r.status] || r.status;
    top.appendChild(title);
    top.appendChild(status);
    li.appendChild(top);

    var meta = document.createElement("p");
    meta.className = "request__meta";
    var parts = [formatDate(r.createdAt)];
    if (r.property) parts.push(r.property);
    if (r.photos) parts.push(r.photos + (r.photos === 1 ? " photo" : " photos"));
    meta.textContent = parts.join(" · ");
    li.appendChild(meta);

    if (r.note) {
      var note = document.createElement("p");
      note.className = "request__note";
      note.textContent = r.note;
      li.appendChild(note);
    }
    return li;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  // ---- Boot ----------------------------------------------------------------

  var token = new URLSearchParams(window.location.search).get("token");
  if (token) {
    // Take the token out of the address bar straight away, so it doesn't sit in
    // browser history or get shared by accident.
    window.history.replaceState(null, "", window.location.pathname);
    startVerify(token);
  } else {
    api("me").then(startApp).catch(function (err) {
      showView("login");
      if (err.status !== 401) setStatus("login-status", err.message, true);
    });
  }
})();
