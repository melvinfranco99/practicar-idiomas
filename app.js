import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

// ---------- Datos ----------
const TOPICS = [
  { emoji: "👋", es: "Presentarte", en: "Introducing yourself: name, age, where you live, family" },
  { emoji: "✈️", es: "Viajes", en: "Travel and holidays" },
  { emoji: "🍕", es: "Comida", en: "Food, cooking and restaurants" },
  { emoji: "💼", es: "Trabajo", en: "Work, jobs and studies" },
  { emoji: "🎬", es: "Cine y series", en: "Movies, TV series and books" },
  { emoji: "⚽", es: "Deporte", en: "Sports and staying healthy" },
  { emoji: "🏠", es: "Rutina diaria", en: "Daily routine and weekend plans" },
  { emoji: "🛍️", es: "De compras", en: "Role-play: shopping in a store (you are the shop assistant)" },
  { emoji: "🏨", es: "En el hotel", en: "Role-play: checking in at a hotel (you are the receptionist)" },
  { emoji: "🧑‍💼", es: "Entrevista", en: "Role-play: a job interview (you are the interviewer)" },
  { emoji: "💻", es: "Tecnología", en: "Technology, apps and the internet" },
  { emoji: "🎲", es: "Sorpréndeme", en: "RANDOM" },
];

const LEVELS = {
  A1: "A1 (beginner). Use very short, simple sentences (5-8 words), present simple, very common words. Speak about concrete, everyday things. Ask one easy question at a time, sometimes offering choices (e.g. 'Do you like tea or coffee?').",
  A2: "A2 (elementary). Use short simple sentences, present and past simple, 'going to' for plans, common vocabulary. Ask one clear question at a time.",
  B1: "B1 (intermediate). Use natural everyday English with some variety of tenses (present perfect, conditionals), common phrasal verbs. Ask open questions that invite opinions and short stories.",
  B2: "B2 (upper-intermediate). Speak naturally at normal speed, use idioms occasionally, a wide range of tenses and linking words. Ask for opinions, reasons, comparisons and hypotheticals.",
  C1: "C1 (advanced). Speak like a native in a relaxed conversation: idioms, nuanced vocabulary, complex structures. Challenge the learner with abstract topics, debate and follow-ups.",
  C2: "C2 (proficiency). Speak exactly as an articulate native speaker would, including subtle humour, idioms, colloquialisms and sophisticated vocabulary. Push for precision and nuance.",
};

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "What you say out loud in English. Must end with a question or prompt that keeps the conversation going." },
    reply_es: { type: "string", description: "Spanish translation of reply (for subtitles)." },
    has_mistake: { type: "boolean", description: "True if the learner's last message had a real grammar, vocabulary or usage mistake worth correcting." },
    correction_es: { type: "string", description: "If has_mistake: a short, kind explanation IN SPANISH of the mistake. Otherwise empty string." },
    corrected_sentence: { type: "string", description: "If has_mistake: the learner's sentence rewritten correctly in English. Otherwise empty string." },
  },
  required: ["reply", "reply_es", "has_mistake", "correction_es", "corrected_sentence"],
  additionalProperties: false,
};

// ---------- Estado ----------
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  level: store.get("level", "A2"),
  topicIdx: store.get("topicIdx", 1),
  history: [],          // mensajes para la API
  lastReply: null,
  mode: "idle",         // idle | thinking | speaking | listening
  running: false,
};

const settings = {
  apiKey: store.get("apiKey", ""),
  model: store.get("model", "claude-opus-5"),
  voiceURI: store.get("voiceURI", ""),
  rate: store.get("rate", 1),
  silence: store.get("silence", 12),
};

// ---------- UI de configuración ----------
function renderSetup() {
  document.querySelectorAll("#levels button").forEach((b) =>
    b.classList.toggle("active", b.dataset.level === state.level));

  const topics = $("topics");
  topics.innerHTML = "";
  TOPICS.forEach((t, i) => {
    const b = document.createElement("button");
    b.textContent = `${t.emoji} ${t.es}`;
    b.classList.toggle("active", i === state.topicIdx && !$("customTopic").value.trim());
    b.onclick = () => { state.topicIdx = i; store.set("topicIdx", i); $("customTopic").value = ""; renderSetup(); };
    topics.appendChild(b);
  });
  $("apiKeyWarning").classList.toggle("hidden", !!settings.apiKey);
}

document.querySelectorAll("#levels button").forEach((b) => {
  b.onclick = () => { state.level = b.dataset.level; store.set("level", state.level); renderSetup(); };
});
$("customTopic").addEventListener("input", renderSetup);

for (const id of ["optSubs", "optSubsEs", "optHandsFree", "optSpeakCorrections"]) {
  $(id).checked = store.get(id, $(id).checked);
  $(id).addEventListener("change", () => store.set(id, $(id).checked));
}

// ---------- Ajustes ----------
function openSettings() {
  $("apiKey").value = settings.apiKey;
  $("model").value = settings.model;
  $("rate").value = settings.rate;
  $("rateLabel").textContent = Number(settings.rate).toFixed(2);
  $("silence").value = settings.silence;
  fillVoices();
  $("settings").showModal();
}
$("btnSettings").onclick = openSettings;
$("linkSettings").onclick = (e) => { e.preventDefault(); openSettings(); };
$("rate").oninput = () => { $("rateLabel").textContent = Number($("rate").value).toFixed(2); };
$("settings").addEventListener("close", () => {
  settings.apiKey = $("apiKey").value.trim();
  settings.model = $("model").value;
  settings.voiceURI = $("voice").value;
  settings.rate = Number($("rate").value);
  settings.silence = Math.max(5, Number($("silence").value) || 12);
  for (const k of Object.keys(settings)) store.set(k, settings[k]);
  renderSetup();
});

// ---------- Voz (TTS) ----------
let voices = [];
function loadVoices() { voices = speechSynthesis.getVoices(); fillVoices(); }
function englishVoices() { return voices.filter((v) => v.lang.toLowerCase().startsWith("en")); }
function fillVoices() {
  const sel = $("voice");
  const list = englishVoices();
  sel.innerHTML = list.map((v) => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join("");
  const def = pickEnglishVoice();
  if (def) sel.value = def.voiceURI;
}
function pickEnglishVoice() {
  const list = englishVoices();
  return list.find((v) => v.voiceURI === settings.voiceURI)
    || list.find((v) => /google us english/i.test(v.name))
    || list.find((v) => /natural|neural|online/i.test(v.name) && v.lang.startsWith("en-US"))
    || list.find((v) => v.lang === "en-US")
    || list[0];
}
function pickSpanishVoice() {
  const list = voices.filter((v) => v.lang.toLowerCase().startsWith("es"));
  return list.find((v) => /google/i.test(v.name) && v.lang === "es-ES") || list.find((v) => v.lang === "es-ES") || list[0];
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speak(text, { lang = "en", rate = settings.rate } = {}) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = lang === "es" ? pickSpanishVoice() : pickEnglishVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : (lang === "es" ? "es-ES" : "en-US");
    u.rate = rate;
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
    // Seguro por si el navegador no dispara onend
    const guard = setTimeout(finish, 2500 + text.length * 110 / rate);
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

// ---------- Reconocimiento de voz ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let finalText = "";
let endpointTimer = null;
let silenceTimer = null;

if (!SR) $("browserWarning").classList.remove("hidden");

function startListening() {
  if (!SR || !state.running) return;
  speechSynthesis.cancel();
  setMode("listening");
  finalText = "";
  $("interim").textContent = "";
  rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (e) => {
    clearTimeout(silenceTimer);
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    $("interim").textContent = (finalText + interim).trim();
    clearTimeout(endpointTimer);
    // Cuando dejas de hablar ~1.8 s, se envía automáticamente
    endpointTimer = setTimeout(() => {
      const said = ($("interim").textContent || "").trim();
      if (said) submitUser(said);
    }, 1800);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      setStatus("⚠️ No hay permiso para usar el micrófono. Actívalo en el navegador o escribe tu respuesta.");
      stopListening(); setMode("idle");
    }
  };
  rec.onend = () => {
    // Chrome corta la escucha sola a veces: si seguimos escuchando, se reinicia
    if (state.mode === "listening" && rec) { try { rec.start(); } catch {} }
  };
  try { rec.start(); } catch {}

  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    if (state.mode === "listening" && !$("interim").textContent.trim()) submitUser("[SILENCE]");
  }, settings.silence * 1000);
}

function stopListening() {
  clearTimeout(endpointTimer);
  clearTimeout(silenceTimer);
  if (rec) { const r = rec; rec = null; try { r.abort(); } catch {} }
}

// ---------- Conversación ----------
function topicText() {
  const custom = $("customTopic").value.trim();
  if (custom) return { label: custom, en: custom };
  const t = TOPICS[state.topicIdx] || TOPICS[1];
  if (t.en === "RANDOM") return { label: "Sorpresa", en: "Any interesting everyday topic you choose (surprise the learner), and change topic naturally when it runs dry" };
  return { label: t.es, en: t.en };
}

function systemPrompt() {
  const topic = topicText();
  return `You are Alex, a warm, friendly and curious native English speaker having a SPOKEN, face-to-face conversation with a Spanish-speaking learner who wants to practise speaking English.

Learner level: ${LEVELS[state.level]}
Conversation topic: ${topic.en}

How to talk:
- Your "reply" is spoken aloud by a text-to-speech voice, so write it exactly as you would say it: natural spoken English, no emojis, no lists, no markdown, no stage directions.
- Keep each turn short (1-3 sentences; at A1/A2 even shorter), like a real person in a conversation, then hand the turn back.
- NEVER leave the conversation hanging. Every reply must end with a question or a clear prompt for the learner. If the learner gives a minimal answer ("ok", "vale", "yes", "I don't know", "nothing"), react briefly and ask a new, easy, specific question, or move to a related sub-topic. Keep the conversation flowing all the time.
- Show interest: react to what they say, share a tiny bit about yourself, ask follow-ups.
- Stay in character in role-plays.
- If the learner speaks Spanish or seems stuck, gently help them say it in English (give them the phrase) and invite them to try.
- The input comes from speech recognition, so ignore missing punctuation, capitalisation and obvious transcription glitches; do not correct those.

Special inputs:
- "[START]": greet the learner and open the conversation about the topic with a first question.
- "[SILENCE]": the learner has been quiet for a while. Gently check in, rephrase your last question more simply or ask an easier one.

Corrections:
- If the learner's last message has a real grammar, vocabulary or word-order mistake, set has_mistake=true, write "correction_es" in SPANISH, very kind and encouraging (e.g. "¡Casi! Se dice ... porque ..."), max 2 short sentences, and give "corrected_sentence" in English.
- Only correct mistakes that matter for the learner's level; don't nitpick. If it's fine, has_mistake=false and empty strings.
- Do NOT mention the correction inside "reply"; just keep the conversation going naturally.
- "reply_es" is always a Spanish translation of "reply".`;
}

function makeClient() {
  return new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
}

function requestParams(extraSystem) {
  const isHaiku = settings.model.startsWith("claude-haiku");
  const output_config = { format: { type: "json_schema", schema: REPLY_SCHEMA } };
  // Conversación en tiempo real: esfuerzo bajo para responder rápido (Haiku no admite effort)
  if (!isHaiku) output_config.effort = "low";
  return {
    model: settings.model,
    max_tokens: 4000,
    system: systemPrompt() + (extraSystem || ""),
    messages: state.history,
    output_config,
  };
}

async function callClaude(params) {
  const client = makeClient();
  let response;
  if (params.model === "claude-opus-5") {
    // Si un filtro de seguridad rechaza la petición, la API reintenta con otro modelo
    try {
      response = await client.beta.messages.create({
        ...params,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      response = await client.messages.create(params);
    }
  } else {
    response = await client.messages.create(params);
  }
  if (response.stop_reason === "refusal") throw new Error("La IA no ha podido responder a eso. Prueba a decirlo de otra forma.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API key no válida. Revísala en Ajustes ⚙️.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Tu API key no tiene permiso para este modelo. Prueba otro en Ajustes ⚙️.";
  if (err instanceof Anthropic.RateLimitError) return "Demasiadas peticiones o sin saldo. Espera un momento o revisa tu cuenta de Anthropic.";
  if (err instanceof Anthropic.NotFoundError) return "Modelo no disponible. Elige otro en Ajustes ⚙️.";
  if (err instanceof Anthropic.APIConnectionError) return "Sin conexión con la API. Revisa tu internet.";
  if (err instanceof Anthropic.APIError) return `Error de la API (${err.status ?? "?"}): ${err.message}`;
  return err.message || String(err);
}

async function submitUser(text) {
  if (state.mode === "thinking") return;
  stopListening();
  $("interim").textContent = "";
  const isMarker = text === "[START]" || text === "[SILENCE]";
  if (!isMarker) addLog("me", text);
  state.history.push({ role: "user", content: text });

  setMode("thinking");
  setStatus("Alex está pensando…");
  try {
    const data = await callClaude(requestParams());
    if (!state.running) return;
    state.history.push({ role: "assistant", content: JSON.stringify(data) });
    state.lastReply = data;
    showCorrection(data, isMarker ? null : text);
    addLog("ai", data.reply, data);

    if (data.has_mistake && $("optSpeakCorrections").checked && data.correction_es) {
      setMode("speaking"); setStatus("Corrección…");
      await speak(data.correction_es, { lang: "es" });
      if (!state.running || state.mode !== "speaking") return;
    }
    await sayReply(data);
  } catch (err) {
    state.history.pop(); // quitamos el mensaje que falló para poder reintentar
    setMode("idle");
    setStatus("⚠️ " + friendlyError(err));
  }
}

async function sayReply(data, rate) {
  showSubtitles(data);
  setMode("speaking");
  setStatus("Alex está hablando… (pulsa 🎤 para interrumpir)");
  await speak(data.reply, { rate: rate ?? settings.rate });
  if (!state.running || state.mode !== "speaking") return;
  if ($("optHandsFree").checked && SR) {
    startListening();
  } else {
    setMode("idle");
    setStatus(SR ? "Pulsa 🎤 para responder" : "Escribe tu respuesta abajo");
  }
}

// ---------- Ayuda "¿Qué digo?" ----------
async function getHint() {
  if (!state.lastReply || state.mode === "thinking") return;
  const prev = state.mode;
  stopListening();
  setMode("thinking");
  setStatus("Buscando ideas…");
  try {
    const client = makeClient();
    const isHaiku = settings.model.startsWith("claude-haiku");
    const output_config = {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            ideas: { type: "array", items: { type: "object", properties: { en: { type: "string" }, es: { type: "string" } }, required: ["en", "es"], additionalProperties: false } },
          },
          required: ["ideas"],
          additionalProperties: false,
        },
      },
    };
    if (!isHaiku) output_config.effort = "low";
    const resp = await client.messages.create({
      model: settings.model,
      max_tokens: 2000,
      output_config,
      messages: [{
        role: "user",
        content: `A Spanish-speaking English learner at level ${state.level} was asked this in a conversation:\n"${state.lastReply.reply}"\n\nGive 3 short, natural example answers they could say, suited to their level, each with its Spanish translation.`,
      }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const { ideas } = JSON.parse(text);
    const box = $("correction");
    box.className = "correction good";
    box.innerHTML = "<strong>💡 Podrías decir:</strong>" + ideas.map((i) =>
      `<div class="fixed">“${escapeHtml(i.en)}”</div><div class="muted small">${escapeHtml(i.es)}</div>`).join("");
  } catch (err) {
    setStatus("⚠️ " + friendlyError(err));
  }
  setMode("idle");
  if (prev === "listening" || $("optHandsFree").checked) startListening();
  else setStatus("Pulsa 🎤 para responder");
}

// ---------- Helpers de UI ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function setStatus(t) { $("status").textContent = t; }
function setMode(m) {
  state.mode = m;
  const av = $("avatar");
  av.className = "avatar " + m;
  av.querySelector("span").textContent = { speaking: "😃", listening: "👂", thinking: "🤔", idle: "🙂" }[m] || "🙂";
  $("btnMic").classList.toggle("on", m === "listening");
  $("btnMic").textContent = m === "listening" ? "⏹️" : "🎤";
  if (m === "listening") setStatus("Te escucho… habla en inglés");
}
function showSubtitles(data) {
  const on = $("toggleSubs").checked;
  $("subEn").textContent = on ? data.reply : "";
  $("subEs").textContent = on && $("optSubsEs").checked ? data.reply_es : "";
}
function showCorrection(data, userText) {
  const box = $("correction");
  if (!userText) { box.classList.add("hidden"); return; }
  if (data.has_mistake && data.correction_es) {
    box.className = "correction";
    box.innerHTML = `<strong>✏️ Pequeña corrección</strong><div>${escapeHtml(data.correction_es)}</div>` +
      (data.corrected_sentence ? `<div class="fixed">✅ “${escapeHtml(data.corrected_sentence)}”</div>` : "") +
      `<div class="muted small">Tú dijiste: “${escapeHtml(userText)}”</div>`;
  } else {
    box.className = "correction good";
    box.innerHTML = `<strong>👍 ¡Bien dicho!</strong> <span class="muted small">“${escapeHtml(userText)}”</span>`;
  }
}
function addLog(who, text, data) {
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.innerHTML = escapeHtml(text) +
    (data?.has_mistake && data.corrected_sentence ? `<span class="fix">✏️ ${escapeHtml(data.corrected_sentence)}</span>` : "") +
    (who === "ai" && data?.reply_es ? `<span class="muted small" style="display:block">${escapeHtml(data.reply_es)}</span>` : "");
  $("log").appendChild(d);
}

// ---------- Navegación ----------
$("btnStart").onclick = () => {
  if (!settings.apiKey) { openSettings(); return; }
  const topic = topicText();
  $("talkInfo").textContent = `${state.level} · ${topic.label}`;
  $("toggleSubs").checked = $("optSubs").checked;
  $("subEn").textContent = ""; $("subEs").textContent = "";
  $("correction").classList.add("hidden");
  $("log").innerHTML = "";
  state.history = [];
  state.lastReply = null;
  state.running = true;
  $("setup").classList.add("hidden");
  $("talk").classList.remove("hidden");
  // Desbloquea la voz en navegadores que exigen un gesto del usuario
  try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
  submitUser("[START]");
};

$("btnBack").onclick = () => {
  state.running = false;
  stopListening();
  speechSynthesis.cancel();
  setMode("idle");
  $("talk").classList.add("hidden");
  $("setup").classList.remove("hidden");
};

$("btnMic").onclick = () => {
  if (state.mode === "thinking") return;
  if (state.mode === "listening") {
    const said = $("interim").textContent.trim();
    if (said) submitUser(said);
    else { stopListening(); setMode("idle"); setStatus("Pulsa 🎤 para responder"); }
    return;
  }
  if (!SR) { $("textInput").focus(); return; }
  startListening();
};

$("btnRepeat").onclick = () => { if (state.lastReply && state.mode !== "thinking") { stopListening(); sayReply(state.lastReply); } };
$("btnSlow").onclick = () => { if (state.lastReply && state.mode !== "thinking") { stopListening(); sayReply(state.lastReply, Math.max(0.5, settings.rate * 0.7)); } };
$("btnHint").onclick = getHint;

$("toggleSubs").onchange = () => { if (state.lastReply) showSubtitles(state.lastReply); };

$("textForm").onsubmit = (e) => {
  e.preventDefault();
  const t = $("textInput").value.trim();
  if (!t || state.mode === "thinking") return;
  $("textInput").value = "";
  speechSynthesis.cancel();
  submitUser(t);
};

renderSetup();
if (!settings.apiKey) setTimeout(openSettings, 400);
