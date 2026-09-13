/* AInovations site chatbot widget — self-contained, no dependencies.
   Injects a floating launcher + chat panel on every page, talks to
   /.netlify/functions/chat, and keeps the conversation across page
   navigation via sessionStorage. Loaded site-wide with:
     <script src="/chatbot.js" defer></script>
*/
(function () {
  if (window.__ainovChat) return; // guard against double-injection
  window.__ainovChat = true;

  var ENDPOINT = '/.netlify/functions/chat';
  var SS_MSGS = 'ainov_chat_msgs';
  var SS_SID = 'ainov_chat_sid';
  var OPENER = '[The visitor just opened the chat widget.]';

  /* ---- session + persistence (all guarded; storage can throw) ---- */
  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function getSid() {
    try {
      var s = sessionStorage.getItem(SS_SID);
      if (!s) { s = uuid(); sessionStorage.setItem(SS_SID, s); }
      return s;
    } catch (e) { return uuid(); }
  }
  function loadMsgs() {
    try { var raw = sessionStorage.getItem(SS_MSGS); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveMsgs() {
    try { sessionStorage.setItem(SS_MSGS, JSON.stringify(messages)); } catch (e) {}
  }

  var sid = getSid();
  var messages = loadMsgs() || [{ role: 'user', content: OPENER, hidden: true }];
  var busy = false;
  var greeted = messages.some(function (m) { return m.role === 'assistant'; });

  /* ---- styles ---- */
  var css =
    '#ainov-cw,#ainov-cw *{box-sizing:border-box}' +
    '#ainov-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:60px;height:60px;border:none;border-radius:50%;cursor:pointer;' +
    'background:linear-gradient(180deg,#1dc8c6,#0f9c9a);box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}' +
    '#ainov-launch:hover{transform:scale(1.06)}' +
    '#ainov-launch svg{width:28px;height:28px;fill:#04222b}' +
    '#ainov-panel{position:fixed;right:20px;bottom:92px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);' +
    'display:none;flex-direction:column;overflow:hidden;border-radius:18px;border:1px solid rgba(255,255,255,.14);' +
    'background:linear-gradient(180deg,#0a2033,#06121e);box-shadow:0 24px 70px rgba(0,0,0,.5);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,Helvetica,sans-serif}' +
    '#ainov-cw.open #ainov-panel{display:flex}' +
    '#ainov-head{display:flex;align-items:center;gap:10px;padding:14px 16px;background:rgba(29,200,198,.12);border-bottom:1px solid rgba(255,255,255,.1)}' +
    '#ainov-head .dot{width:9px;height:9px;border-radius:50%;background:#4ade80;box-shadow:0 0 10px #4ade80;flex:none}' +
    '#ainov-head .t{color:#f7fbff;font-weight:800;font-size:15px;line-height:1.1}' +
    '#ainov-head .s{color:#9fd8d5;font-size:11.5px;font-weight:600}' +
    '#ainov-x{margin-left:auto;background:none;border:none;color:#bcd;cursor:pointer;font-size:20px;line-height:1;padding:4px 6px;border-radius:8px}' +
    '#ainov-x:hover{background:rgba(255,255,255,.1);color:#fff}' +
    '#ainov-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}' +
    '.ainov-b{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}' +
    '.ainov-b a{color:#72e6df;font-weight:700}' +
    '.ainov-user{align-self:flex-end;background:linear-gradient(180deg,#1dc8c6,#149c9a);color:#04222b;font-weight:600;border-bottom-right-radius:4px}' +
    '.ainov-bot{align-self:flex-start;background:rgba(255,255,255,.07);color:#eaf4f8;border:1px solid rgba(255,255,255,.09);border-bottom-left-radius:4px}' +
    '.ainov-typing{align-self:flex-start;color:#9fd8d5;font-size:13px;padding:6px 4px}' +
    '.ainov-typing span{display:inline-block;width:6px;height:6px;margin:0 1px;border-radius:50%;background:#72e6df;animation:ainovb 1s infinite}' +
    '.ainov-typing span:nth-child(2){animation-delay:.15s}.ainov-typing span:nth-child(3){animation-delay:.3s}' +
    '@keyframes ainovb{0%,60%,100%{opacity:.3}30%{opacity:1}}' +
    '#ainov-foot{padding:10px;border-top:1px solid rgba(255,255,255,.1);display:flex;gap:8px;align-items:flex-end;background:rgba(0,0,0,.15)}' +
    '#ainov-in{flex:1;resize:none;max-height:110px;min-height:42px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.16);' +
    'background:rgba(255,255,255,.06);color:#f7fbff;font-size:14.5px;font-family:inherit;line-height:1.4;outline:none}' +
    '#ainov-in::placeholder{color:#8fa6b3}' +
    '#ainov-in:focus{border-color:#1dc8c6}' +
    '#ainov-send{flex:none;height:42px;padding:0 16px;border:none;border-radius:12px;cursor:pointer;font-weight:800;font-size:14px;' +
    'background:linear-gradient(180deg,#ffd982,#ffc94d);color:#3a2a00}' +
    '#ainov-send:disabled{opacity:.5;cursor:default}' +
    '#ainov-note{text-align:center;color:#7f97a4;font-size:10.5px;padding:0 10px 9px;background:rgba(0,0,0,.15)}' +
    '@media (max-width:480px){#ainov-panel{right:10px;left:10px;width:auto;bottom:84px;height:calc(100vh - 104px)}#ainov-launch{right:14px;bottom:14px}}';

  /* ---- build DOM ---- */
  var wrap = document.createElement('div');
  wrap.id = 'ainov-cw';
  wrap.innerHTML =
    '<style>' + css + '</style>' +
    '<button id="ainov-launch" aria-label="Chat with Aiden, the AInovations assistant">' +
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.3 1.1 4.4 2.9 5.9-.1 1-.5 2.4-1.4 3.6 1.7-.3 3.3-1 4.5-1.9 1.2.4 2.5.6 4 .6 5.5 0 10-3.8 10-8.2S17.5 3 12 3z"/></svg>' +
    '</button>' +
    '<div id="ainov-panel" role="dialog" aria-label="Chat with Aiden">' +
    '<div id="ainov-head"><span class="dot"></span><div><div class="t">Aiden</div><div class="s">AInovations&rsquo; AI assistant</div></div>' +
    '<button id="ainov-x" aria-label="Close chat">&times;</button></div>' +
    '<div id="ainov-msgs"></div>' +
    '<div id="ainov-foot"><textarea id="ainov-in" rows="1" placeholder="Type your message…" aria-label="Message"></textarea>' +
    '<button id="ainov-send">Send</button></div>' +
    '<div id="ainov-note">AI assistant · may be imperfect · <a href="mailto:support@ainovations.net">support@ainovations.net</a></div>' +
    '</div>';
  document.body.appendChild(wrap);

  var elMsgs = wrap.querySelector('#ainov-msgs');
  var elIn = wrap.querySelector('#ainov-in');
  var elSend = wrap.querySelector('#ainov-send');

  /* ---- rendering ---- */
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // minimal, safe formatting: escape, then linkify URLs / emails / **bold**
  function format(text) {
    var h = escapeHtml(text);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/(^|[\s(])(\/[a-z0-9\-\/]+)/gi, '$1<a href="$2">$2</a>');
    h = h.replace(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi, '<a href="mailto:$1">$1</a>');
    return h;
  }
  function addBubble(role, text) {
    var d = document.createElement('div');
    d.className = 'ainov-b ' + (role === 'user' ? 'ainov-user' : 'ainov-bot');
    d.innerHTML = format(text);
    elMsgs.appendChild(d);
    elMsgs.scrollTop = elMsgs.scrollHeight;
    return d;
  }
  function renderAll() {
    elMsgs.innerHTML = '';
    messages.forEach(function (m) {
      if (m.hidden) return;
      addBubble(m.role, m.content);
    });
  }
  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'ainov-typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    elMsgs.appendChild(typingEl);
    elMsgs.scrollTop = elMsgs.scrollHeight;
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  /* ---- API ---- */
  function apiMessages() {
    return messages.map(function (m) { return { role: m.role, content: m.content }; });
  }
  function send(payloadMessages) {
    busy = true; elSend.disabled = true; showTyping();
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: payloadMessages,
        meta: { session_id: sid, source_url: location.href, referrer: document.referrer },
      }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        hideTyping();
        var reply = (data && data.reply) || 'Sorry — something went wrong. You can reach us at support@ainovations.net.';
        messages.push({ role: 'assistant', content: reply });
        addBubble('assistant', reply);
        saveMsgs();
      })
      .catch(function () {
        hideTyping();
        var reply = "Sorry — I couldn't connect just now. Please try again, or email support@ainovations.net.";
        messages.push({ role: 'assistant', content: reply });
        addBubble('assistant', reply);
        saveMsgs();
      })
      .then(function () { busy = false; elSend.disabled = false; elIn.focus(); });
  }
  function submit() {
    var text = elIn.value.trim();
    if (!text || busy) return;
    messages.push({ role: 'user', content: text });
    addBubble('user', text);
    elIn.value = '';
    elIn.style.height = 'auto';
    saveMsgs();
    send(apiMessages());
  }

  /* ---- open/close + events ---- */
  function open() {
    wrap.classList.add('open');
    if (!greeted && !busy) { greeted = true; send(apiMessages()); } // fetch the greeting on first open
    setTimeout(function () { elIn.focus(); }, 50);
  }
  function close() { wrap.classList.remove('open'); }

  wrap.querySelector('#ainov-launch').addEventListener('click', function () {
    wrap.classList.contains('open') ? close() : open();
  });
  wrap.querySelector('#ainov-x').addEventListener('click', close);
  elSend.addEventListener('click', submit);
  elIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  elIn.addEventListener('input', function () {
    elIn.style.height = 'auto';
    elIn.style.height = Math.min(elIn.scrollHeight, 110) + 'px';
  });

  renderAll(); // restore any prior conversation from this session
})();
